"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Ground from "@/components/village/Ground";
import House from "@/components/village/House";
import {
  FriendHousePanel,
  HallPanel,
  MyHousePanel,
  PeoplePanel,
  type Stats,
} from "@/components/village/panels";
import { makeAgent, nudgePlayer, paint, PLAYER_SPEED, step, walkTo, type Agent } from "@/components/village/engine";
import { ATLAS, buildWorld, inRect, PROPS, T, type World } from "@/components/village/world";
import { composeSheet } from "@/lib/sprite";
import { checkIn, publishPulse, useSessionStore } from "@/lib/session-store";
import { markNudgesSeen } from "@/lib/village-actions";
import { bloomFor, ONLINE_MS, PULSE_MS, tierFor, type Place, type SessionView, type Villager } from "@/lib/village";
import type { VillageData } from "@/lib/village-server";

/* --------------------------------------------------------------------------
   The village: you, your friends' houses, and whoever's about.

   Walk with the arrow keys or WASD, or tap/click where to go. Walk up to a
   door (or tap the house) to visit; the town hall is where work sessions
   sit. Friends who have the village open show up where they are — at home,
   at someone's house, on the square, or at a table — checked every few
   seconds. Close the tab and your knight goes home.
   -------------------------------------------------------------------------- */

type Open =
  | { kind: "house"; id: string }
  | { kind: "mine" }
  | { kind: "hall" }
  | { kind: "people" }
  | null;

type Prompt = { kind: "house"; id: string } | { kind: "hall" } | null;

function useScale() {
  const [scale, setScale] = useState(2);
  useEffect(() => {
    const set = () => setScale(window.innerWidth < 640 ? 1 : 2);
    set();
    window.addEventListener("resize", set);
    return () => window.removeEventListener("resize", set);
  }, []);
  return scale;
}

const placeKey = (p: Place) => (p.kind === "house" ? `house:${p.hostId}` : p.kind);

export default function Village({ data }: { data: VillageData }) {
  const [me, setMe] = useState<Stats>(data.me);
  const neighbours = data.neighbours;
  const byId = useMemo(() => new Map<string, Stats>([[me.id, me], ...neighbours.map((n) => [n.id, n] as const)]), [me, neighbours]);
  const scale = useScale();
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Friends alphabetically, so a house stays on its plot as others are added.
  const world: World = useMemo(
    () =>
      buildWorld(
        me.id,
        [...neighbours].sort((a, b) => a.name.localeCompare(b.name)).map((n) => n.id)
      ),
    // The layout depends only on who's in it.
    [me.id, neighbours]
  );
  const plotOf = useMemo(() => new Map(world.plots.filter((p) => p.owner).map((p) => [p.owner!, p])), [world]);

  /* ------------------------------------------------------------ state */

  const { pulse } = useSessionStore();
  const [open, setOpen] = useState<Open>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string; nudge?: boolean }[]>([]);
  const [sheets, setSheets] = useState<Record<string, string>>({});

  useEffect(() => {
    publishPulse(data.pulse);
  }, [data.pulse]);

  const livePulse = pulse ?? data.pulse;
  const now = livePulse.now;
  const online = useCallback(
    (id: string) => {
      const p = livePulse.presence[id];
      return !!p && now - p.seenAt < ONLINE_MS;
    },
    [livePulse, now]
  );

  /** Tables in the order they're drawn, and who sits where. */
  const seating = useMemo(() => {
    const seats = new Map<string, { x: number; y: number; face: 0 | 1 | 2 | 3 }>();
    const sessions = [...livePulse.sessions].sort((a, b) => a.startedAt - b.startedAt);
    sessions.forEach((s, i) => {
      const table = world.tables[i % world.tables.length];
      s.members.forEach((m, j) => {
        const seat = table.seats[j] ?? { x: table.x + (j % 3), y: table.y + 2, face: 0 as const };
        seats.set(m.villager.id, seat);
      });
    });
    return seats;
  }, [livePulse.sessions, world]);

  const sessionOf = useCallback(
    (id: string): SessionView | null => livePulse.sessions.find((s) => s.members.some((m) => m.villager.id === id)) ?? null,
    [livePulse.sessions]
  );

  /** Everyone to draw besides you: friends who are about, and anyone at a table. */
  const visible: (Villager & { known: boolean })[] = useMemo(() => {
    const out = new Map<string, Villager & { known: boolean }>();
    for (const n of neighbours) if (online(n.id) || seating.has(n.id)) out.set(n.id, { ...n, known: true });
    for (const s of livePulse.sessions)
      for (const m of s.members)
        if (m.villager.id !== me.id && !out.has(m.villager.id)) out.set(m.villager.id, { ...m.villager, known: m.known });
    return [...out.values()];
  }, [neighbours, online, seating, livePulse.sessions, me.id]);

  /* ----------------------------------------------------------- sheets */

  useEffect(() => {
    let live = true;
    const all: Villager[] = [me, ...neighbours, ...visible];
    for (const v of all) {
      if (sheets[v.id]) continue;
      void composeSheet(v.appearance, v.equipped).then((url) => {
        if (live && url) setSheets((s) => (s[v.id] ? s : { ...s, [v.id]: url }));
      });
    }
    return () => {
      live = false;
    };
  }, [me, neighbours, visible, sheets]);

  /* ----------------------------------------------------------- agents */

  const agents = useRef(new Map<string, Agent>());
  const player = useRef<Agent | null>(null);
  if (player.current == null) {
    const home = world.plots.find((p) => p.owner === me.id)!;
    player.current = makeAgent(me.id, home.door.x, home.door.y + 1, PLAYER_SPEED);
  }

  // Where each visible friend should be, whenever the check-in changes.
  useEffect(() => {
    const map = agents.current;
    const seen = new Set<string>();
    const hallSpot = { x: world.hall.door.x, y: world.hall.door.y + 2 };
    for (const v of visible) {
      seen.add(v.id);
      let a = map.get(v.id);
      if (!a) {
        const plot = plotOf.get(v.id);
        const start = plot ? plot.door : world.hall.door;
        a = makeAgent(v.id, start.x, start.y);
        map.set(v.id, a);
      }
      const seat = seating.get(v.id) ?? null;
      if (seat) {
        if (!a.seat || a.seat.x !== seat.x || a.seat.y !== seat.y) {
          a.seat = seat;
          a.home = null;
          a.path = [];
        }
        continue;
      }
      a.seat = null;
      const p = livePulse.presence[v.id]?.place ?? { kind: "home" as const };
      let spot: { x: number; y: number; r: number };
      if (p.kind === "house" && plotOf.get(p.hostId)) {
        const d = plotOf.get(p.hostId)!.door;
        spot = { x: d.x, y: d.y + 1, r: 1 };
      } else if (p.kind === "hall") spot = { ...hallSpot, r: 2 };
      else if (p.kind === "home" && plotOf.get(v.id)) {
        const d = plotOf.get(v.id)!.door;
        spot = { x: d.x, y: d.y + 1, r: 2 };
      } else {
        // The square: a spot on the main street near the hall, the same one each time.
        const h = [...v.id].reduce((s, c) => s + c.charCodeAt(0), 0);
        spot = { x: world.hall.plaza.x + (h % world.hall.plaza.w), y: world.hall.plaza.y + 2 + (h % 2), r: 3 };
      }
      if (!a.home || a.home.x !== spot.x || a.home.y !== spot.y) {
        a.home = spot;
        a.nextStroll = 0; // head there now
      }
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
  }, [visible, seating, livePulse.presence, plotOf, world]);

  /* ------------------------------------------------------- the loop */

  const viewport = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const placeRef = useRef<Place>({ kind: "home" });
  const promptRef = useRef<Prompt>(null);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastCheck = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const S = scaleRef.current;
      const me = player.current!;

      const k = keys.current;
      const vx = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
      const vy = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
      if (vx || vy) nudgePlayer(world, me, vx, vy, dt);
      else step(world, me, dt, t);
      paint(me, S);
      for (const a of agents.current.values()) {
        step(world, a, dt, t);
        paint(a, S);
      }

      // Camera: follow, but never show past the world's edge.
      const vp = viewport.current;
      if (vp && layer.current) {
        const vw = vp.clientWidth;
        const vh = vp.clientHeight;
        const W = world.w * T * S;
        const H = world.h * T * S;
        const cx = W <= vw ? (W - vw) / 2 : Math.max(0, Math.min(W - vw, me.x * S - vw / 2));
        const cy = H <= vh ? (H - vh) / 2 : Math.max(0, Math.min(H - vh, me.y * S - vh / 2));
        layer.current.style.transform = `translate3d(${-Math.round(cx)}px, ${-Math.round(cy)}px, 0)`;
        layer.current.dataset.cx = String(cx);
        layer.current.dataset.cy = String(cy);
      }

      // What's in reach, and where that puts me — a few times a second.
      if (t - lastCheck > 200) {
        lastCheck = t;
        const tx = me.x / T;
        const ty = (me.y - 8) / T;
        let best: Prompt = null;
        let bestD = 1.7;
        let place: Place = { kind: "square" };
        for (const p of world.plots) {
          if (!p.owner) continue;
          const d = Math.hypot(tx - (p.door.x + 0.5), ty - (p.door.y + 0.5));
          if (d < bestD) {
            bestD = d;
            best = { kind: "house", id: p.owner };
          }
          if (d < 3) place = p.owner === me.id ? { kind: "home" } : { kind: "house", hostId: p.owner };
        }
        const dh = Math.hypot(tx - (world.hall.door.x + 0.5), ty - (world.hall.door.y + 0.5));
        if (inRect(world.hall.plaza, Math.floor(tx), Math.floor(ty)) || dh < 2) {
          place = { kind: "hall" };
          if (!best && dh < 2.5) best = { kind: "hall" };
        }
        placeRef.current = place;
        const key = best ? (best.kind === "hall" ? "hall" : best.id) : "";
        const had = promptRef.current ? (promptRef.current.kind === "hall" ? "hall" : promptRef.current.id) : "";
        if (key !== had) {
          promptRef.current = best;
          setPrompt(best);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world]);

  /* ---------------------------------------------------------- check-ins */

  const toast = useCallback((text: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const shownNudges = useRef(new Set<string>());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPlace = "";
    const beat = async () => {
      if (document.visibilityState === "visible") {
        const p = await checkIn(placeRef.current);
        lastPlace = placeKey(placeRef.current);
        if (p?.focusXp) toast(`+${p.focusXp} XP for focus time`);
        for (const n of p?.nudges ?? []) {
          if (shownNudges.current.has(n.id)) continue;
          shownNudges.current.add(n.id);
          setToasts((t) => [...t, { id: n.id, nudge: true, text: `${n.fromName} nudged you: “${n.body}”${n.about ? ` (${n.about})` : ""}` }]);
        }
      }
      timer = setTimeout(beat, PULSE_MS);
    };
    void beat();
    // Moving somewhere new is worth telling people about straight away.
    const quick = setInterval(() => {
      if (placeKey(placeRef.current) !== lastPlace && document.visibilityState === "visible") {
        clearTimeout(timer);
        void beat();
      }
    }, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void beat();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      clearInterval(quick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [toast]);

  /* ------------------------------------------------------------- input */

  const openPrompt = useCallback((p: Prompt) => {
    if (!p) return;
    if (p.kind === "hall") setOpen({ kind: "hall" });
    else setOpen(p.id === me.id ? { kind: "mine" } : { kind: "house", id: p.id });
  }, [me.id]);

  useEffect(() => {
    const map: Record<string, string> = {
      ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
      ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
    };
    const typing = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const dir = map[e.code];
      if (dir) {
        e.preventDefault();
        keys.current.add(dir);
      } else if (e.code === "KeyE" || e.code === "Enter" || e.code === "Space") {
        if (promptRef.current) {
          e.preventDefault();
          openPrompt(promptRef.current);
        }
      } else if (e.code === "Escape") setOpen(null);
    };
    const up = (e: KeyboardEvent) => {
      const dir = map[e.code];
      if (dir) keys.current.delete(dir);
    };
    const blur = () => keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [openPrompt]);

  /** Tap or click on the ground: walk there. */
  function onGround(e: React.PointerEvent) {
    const vp = viewport.current;
    const l = layer.current;
    if (!vp || !l) return;
    const r = vp.getBoundingClientRect();
    const S = scaleRef.current;
    const wx = (e.clientX - r.left + Number(l.dataset.cx ?? 0)) / S;
    const wy = (e.clientY - r.top + Number(l.dataset.cy ?? 0)) / S;
    walkTo(world, player.current!, Math.floor(wx / T), Math.floor(wy / T));
  }

  function visitHouse(id: string) {
    const plot = plotOf.get(id);
    if (!plot) return;
    walkTo(world, player.current!, plot.door.x, plot.door.y, () => openPrompt({ kind: "house", id }));
  }

  function goToHall() {
    walkTo(world, player.current!, world.hall.door.x, world.hall.door.y + 1, () => setOpen({ kind: "hall" }));
  }

  /* ------------------------------------------------------------- words */

  function whereIs(id: string): string {
    if (seating.has(id)) return "Working at the town hall";
    if (!online(id)) {
      const seen = livePulse.presence[id]?.seenAt;
      if (!seen) return "Hasn't been to the village yet";
      const mins = Math.round((now - seen) / 60000);
      return mins < 60 ? `Away · here ${mins} min ago` : mins < 1440 ? `Away · here ${Math.round(mins / 60)} h ago` : "Away";
    }
    const p = livePulse.presence[id]?.place;
    if (!p || p.kind === "home") return "At home";
    if (p.kind === "hall") return "At the town hall";
    if (p.kind === "square") return "Out on the square";
    if (p.hostId === me.id) return "At your house";
    return `Visiting ${byId.get(p.hostId)?.name ?? "someone"}`;
  }

  const S = scale;
  const promptLabel = prompt
    ? prompt.kind === "hall"
      ? "Enter the town hall"
      : prompt.id === me.id
        ? "Go inside"
        : `Visit ${byId.get(prompt.id)?.name ?? ""}`
    : null;
  const onlineCount = neighbours.filter((n) => online(n.id)).length;
  const unreadNotes = data.notes.filter((n) => !n.read).length;

  return (
    <div className="relative h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] select-none overflow-hidden bg-[#5f8f34] sm:h-[calc(100dvh-env(safe-area-inset-top))]">
      <div ref={viewport} className="absolute inset-0 touch-none" onPointerDown={onGround}>
        <div ref={layer} className="absolute left-0 top-0 will-change-transform" style={{ width: world.w * T * S, height: world.h * T * S }}>
          <Ground world={world} scale={S} />

          {/* Scenery */}
          {world.props.map((p, i) => {
            const spec = PROPS[p.kind];
            return (
              <div
                key={i}
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: (p.px - spec.w / 2) * S,
                  top: (p.py - spec.h) * S,
                  width: spec.w * S,
                  height: spec.h * S,
                  zIndex: Math.round(p.py),
                  backgroundImage: `url(${ATLAS})`,
                  backgroundPosition: `${-spec.sx * S}px ${-spec.sy * S}px`,
                  backgroundSize: `${1024 * S}px ${1024 * S}px`,
                  imageRendering: "pixelated",
                }}
              />
            );
          })}

          {/* The town hall and its tables */}
          <button
            onPointerDown={(e) => {
              e.stopPropagation();
              goToHall();
            }}
            aria-label="The town hall"
            className="absolute"
            style={{
              left: world.hall.body.x * T * S,
              top: world.hall.body.y * T * S,
              width: world.hall.body.w * T * S,
              height: world.hall.body.h * T * S,
              zIndex: (world.hall.body.y + world.hall.body.h) * T,
            }}
          >
            <TownHall busy={livePulse.sessions.length > 0} />
          </button>
          {world.tables.map((t, i) => (
            <div
              key={i}
              aria-hidden
              className="pointer-events-none absolute"
              style={{ left: t.x * T * S, top: (t.y * T - 6) * S, width: t.w * T * S, height: (T + 6) * S, zIndex: (t.y + 1) * T - 1 }}
            >
              <svg viewBox="0 0 96 38" className="h-full w-full" shapeRendering="crispEdges">
                <rect x="4" y="30" width="6" height="8" fill="#5a3e28" />
                <rect x="86" y="30" width="6" height="8" fill="#5a3e28" />
                <rect x="0" y="10" width="96" height="22" fill="#9a7048" stroke="#3b2a1c" strokeWidth="2" />
                <rect x="0" y="10" width="96" height="5" fill="#b58b5e" />
                {i < livePulse.sessions.length && (
                  <>
                    <rect x="20" y="15" width="14" height="9" fill="#f4ecd6" />
                    <rect x="60" y="14" width="12" height="10" fill="#efe3c8" />
                    <rect x="46" y="4" width="4" height="10" fill="#f4ecd6" />
                    <rect x="46" y="0" width="4" height="4" fill="#ffc94d" />
                  </>
                )}
              </svg>
            </div>
          ))}

          {/* Houses */}
          {world.plots.map((p) => {
            if (!p.owner) return null;
            const n = byId.get(p.owner);
            if (!n) return null;
            const isMe = p.owner === me.id;
            const tier = tierFor(n.level);
            return (
              <div key={p.owner}>
                <button
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    visitHouse(p.owner!);
                  }}
                  aria-label={isMe ? "Your house" : `${n.name}'s house`}
                  className="absolute [&>svg]:h-full [&>svg]:w-full"
                  style={{ left: p.x * T * S, top: p.y * T * S, width: 8 * T * S, height: 7 * T * S, zIndex: (p.y + 6) * T }}
                >
                  <House
                    tier={tier.tier}
                    look={n.house}
                    bloom={bloomFor(n.streak)}
                    lit={seating.has(n.id) || (isMe && !!livePulse.mySessionId)}
                    smoke={isMe || online(n.id)}
                  />
                </button>
                <div
                  className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-full bg-mud-50/90 px-2 py-0.5 text-[11px] font-semibold text-mud-800 shadow-sm ring-1 ring-mud-300"
                  style={{ left: (p.x + 4) * T * S, top: (p.y + 0.1) * T * S, zIndex: 50000 }}
                >
                  {isMe ? "You" : n.name}
                  <span className="font-normal text-mud-500"> · {tier.label}</span>
                  {isMe && unreadNotes > 0 && (
                    <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unreadNotes}</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Walkers: friends and table-mates, then you */}
          {visible.map((v) => (
            <Walker
              key={v.id}
              sheet={sheets[v.id]}
              scale={S}
              label={v.name}
              stranger={!v.known}
              bind={(el) => {
                const a = agents.current.get(v.id);
                if (a) a.el = el;
              }}
              onTap={v.known ? () => setOpen({ kind: "house", id: v.id }) : () => setOpen({ kind: "hall" })}
            />
          ))}
          <Walker
            sheet={sheets[me.id]}
            scale={S}
            label={null}
            bind={(el) => {
              if (player.current) player.current.el = el;
            }}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------ HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[70000] flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link href="/" className="panel hidden rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700 sm:block">
            ← Quests
          </Link>
          <h1 className="panel rounded-lg px-3 py-1.5 font-display text-sm font-bold text-mud-900">Village</h1>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button onClick={() => setOpen({ kind: "people" })} className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
            <span className={`mr-1.5 inline-block size-2 rounded-full ${onlineCount ? "bg-grass-500" : "bg-mud-300"}`} />
            {onlineCount} here
          </button>
          <button onClick={() => visitHouse(me.id)} className="panel relative rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
            My house
            {unreadNotes > 0 && <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-red-600" />}
          </button>
          <button onClick={goToHall} className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
            Town hall
          </button>
        </div>
      </div>

      {promptLabel && !open && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[70000] flex justify-center">
          <button
            onClick={() => openPrompt(prompt)}
            className="pointer-events-auto rounded-full bg-grass-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-grass-500"
          >
            {promptLabel} <span className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs sm:inline">E</span>
          </button>
        </div>
      )}

      <p className="pointer-events-none absolute bottom-3 right-4 z-[70000] hidden text-[11px] font-semibold text-white/80 drop-shadow sm:block">
        Arrow keys or WASD to walk · click to go somewhere · E to visit
      </p>

      {toasts.length > 0 && (
        <div className="absolute inset-x-0 top-14 z-[70000] flex flex-col items-center gap-2 px-3">
          {toasts.map((t) => (
            <div key={t.id} role="status" className="panel flex max-w-md items-center gap-3 rounded-xl px-3 py-2 text-sm text-mud-800 shadow-lg">
              <span className="min-w-0 flex-1">{t.text}</span>
              {t.nudge && (
                <button
                  className="shrink-0 rounded-md bg-grass-600 px-2 py-1 text-xs font-semibold text-white"
                  onClick={() => {
                    setToasts((x) => x.filter((y) => y.id !== t.id));
                    void markNudgesSeen([t.id]);
                  }}
                >
                  On it
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---------------------------------------------------------- panels */}
      {open?.kind === "house" && byId.get(open.id) && (
        <FriendHousePanel n={byId.get(open.id)!} where={whereIs(open.id)} session={sessionOf(open.id)} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "mine" && (
        <MyHousePanel me={me} notes={data.notes} onLook={(look) => setMe((m) => ({ ...m, house: look }))} onClose={() => setOpen(null)} />
      )}
      {open?.kind === "hall" && <HallPanel sessions={livePulse.sessions} sheets={sheets} me={me} onClose={() => setOpen(null)} />}
      {open?.kind === "people" && (
        <PeoplePanel
          people={neighbours.map((n) => ({ n, online: online(n.id) || seating.has(n.id), where: whereIs(n.id) }))}
          sheets={sheets}
          onGo={(id) => {
            setOpen(null);
            if (seating.has(id)) goToHall();
            else visitHouse(id);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function Walker({
  sheet,
  scale,
  label,
  stranger = false,
  bind,
  onTap,
}: {
  sheet: string | undefined;
  scale: number;
  label: string | null;
  stranger?: boolean;
  bind: (el: HTMLDivElement | null) => void;
  onTap?: () => void;
}) {
  return (
    <div
      ref={bind}
      className="absolute left-0 top-0"
      style={{ width: 64 * scale, height: 64 * scale, willChange: "transform" }}
      onPointerDown={
        onTap
          ? (e) => {
              e.stopPropagation();
              onTap();
            }
          : undefined
      }
    >
      <div
        style={{
          width: 64 * scale,
          height: 64 * scale,
          backgroundImage: sheet ? `url(${sheet})` : undefined,
          backgroundSize: `${576 * scale}px ${256 * scale}px`,
          backgroundPosition: `0 ${-128 * scale}px`,
          imageRendering: "pixelated",
          cursor: onTap ? "pointer" : undefined,
        }}
      />
      {label && (
        <span
          className={`pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1 whitespace-nowrap rounded px-1 text-[10px] font-semibold shadow-sm ${
            stranger ? "bg-mud-800/70 text-white" : "bg-white/85 text-mud-800"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/** The biggest building in the village: stone, a slate roof, a bell, a banner. */
function TownHall({ busy }: { busy: boolean }) {
  return (
    <svg viewBox="0 0 256 224" className="h-full w-full" shapeRendering="crispEdges" aria-hidden>
      <rect x="20" y="206" width="216" height="12" fill="#000" opacity="0.12" />
      <rect x="120" y="4" width="16" height="30" fill="#6e6258" stroke="#3b2a1c" strokeWidth="3" />
      <rect x="123" y="14" width="10" height="10" fill={busy ? "#ffc94d" : "#3b2a1c"} />
      <rect x="20" y="96" width="216" height="116" fill="#b4ada2" stroke="#3b2a1c" strokeWidth="3" />
      {Array.from({ length: 7 }, (_, r) => (
        <rect key={r} x="20" y={110 + r * 14} width="216" height="2" fill="#948d83" />
      ))}
      <path d="M8 100 L128 30 L248 100 Z" fill="#4e5864" stroke="#3b2a1c" strokeWidth="3" />
      <path d="M128 30 L248 100 L128 100 Z" fill="#3e4751" />
      <rect x="92" y="104" width="72" height="16" fill="#e8dcc0" stroke="#3b2a1c" strokeWidth="2" />
      <text x="128" y="116" textAnchor="middle" fontSize="10" fontWeight="700" fill="#3b2a1c" fontFamily="Georgia, serif">
        TOWN HALL
      </text>
      {[40, 72, 176, 208].map((x) => (
        <g key={x}>
          <rect x={x - 12} y="130" width="24" height="34" fill={busy ? "#ffd66b" : "#4a5a6e"} stroke="#5a3e28" strokeWidth="3" />
          <rect x={x - 1} y="130" width="2" height="34" fill="#5a3e28" />
        </g>
      ))}
      <path d="M120 212 V168 A20 20 0 0 1 160 168 V212 Z" fill="#6b4226" stroke="#3b2a1c" strokeWidth="3" />
      <rect x="139" y="170" width="2" height="42" fill="#3b2a1c" />
      <rect x="100" y="140" width="6" height="40" fill="#3b2a1c" />
      <path d="M106 140 L124 146 L106 154 Z" fill="#437a28" />
    </svg>
  );
}
