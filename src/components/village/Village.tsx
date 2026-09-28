"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Ground from "@/components/village/Ground";
import House from "@/components/village/House";
import Furniture from "@/components/village/Furniture";
import ChatBar from "@/components/village/ChatBar";
import DecoratePanel from "@/components/village/DecoratePanel";
import { DuelUI, HeadBar } from "@/components/village/DuelUI";
import { ArenaGate, ArenaView, RoomView } from "@/components/village/scenes";
import { buildArena, buildRoom, type ArenaScene, type RoomScene } from "@/components/village/rooms";
import { FriendHousePanel, HallPanel, MyHousePanel, Panel, PeoplePanel, type Stats } from "@/components/village/panels";
import { makeAgent, nudgePlayer, paint, PLAYER_SPEED, step, walkTo, type Agent } from "@/components/village/engine";
import { ATLAS, buildWorld, inRect, PROPS, T, type Grid, type World } from "@/components/village/world";
import { composeSheet } from "@/lib/sprite";
import { checkIn, publishPulse, serverNow, useSessionStore } from "@/lib/session-store";
import { challenge, loadInterior, markNudgesSeen, saveInterior } from "@/lib/village-actions";
import { cleanInterior, FURNITURE, type FurnitureKind, type Interior } from "@/lib/furniture";
import {
  bloomFor,
  BUBBLE_MS,
  ONLINE_MS,
  PULSE_MS,
  ROOM_PULSE_MS,
  spaceOf,
  tierFor,
  type ChatLine,
  type DuelView,
  type Place,
  type SessionView,
  type Villager,
} from "@/lib/village";
import type { VillageData } from "@/lib/village-server";

/* --------------------------------------------------------------------------
   The village: you, your friends' houses, and whoever's about.

   Three kinds of scene share one engine:
     outside   everyone's own layout; friends shown where they are, by place
     a house   the same room for everyone in it, positions shared
     the arena likewise, and where duels happen

   Walk with the arrow keys or WASD, or tap where to go. Tap a house to go
   in; the door of a room, or the arena's gate, takes you back out. People
   in the same room, the arena, or at the town hall can talk.
   -------------------------------------------------------------------------- */

type Open =
  | { kind: "house"; id: string }
  | { kind: "mine" }
  | { kind: "hall" }
  | { kind: "people" }
  | { kind: "duelist"; id: string }
  | null;

type Prompt =
  | { kind: "house"; id: string }
  | { kind: "hall" }
  | { kind: "arena" }
  | { kind: "leave" }
  | null;

type Scene =
  | { kind: "out" }
  | { kind: "room"; hostId: string; room: RoomScene; name: string; level: number }
  | { kind: "arena"; arena: ArenaScene };

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

const placeKey = (p: Place) => ("hostId" in p ? `${p.kind}:${p.hostId}` : p.kind);
const promptKey = (p: Prompt) => (!p ? "" : p.kind === "house" ? `house:${p.id}` : p.kind);

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
    () => buildWorld(me.id, [...neighbours].sort((a, b) => a.name.localeCompare(b.name)).map((n) => n.id)),
    [me.id, neighbours]
  );
  const plotOf = useMemo(() => new Map(world.plots.filter((p) => p.owner).map((p) => [p.owner!, p])), [world]);

  /* ------------------------------------------------------------ state */

  const { pulse, skew } = useSessionStore();
  const [open, setOpen] = useState<Open>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string; nudge?: boolean }[]>([]);
  const [sheets, setSheets] = useState<Record<string, string>>({});
  const [scene, setScene] = useState<Scene>({ kind: "out" });
  const [place, setPlace] = useState<Place>({ kind: "home" });
  const [said, setSaid] = useState<ChatLine[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hits, setHits] = useState<Record<string, { dmg: number; key: number }>>({});

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
  const indoors = useCallback(
    (id: string) => {
      const k = livePulse.presence[id]?.place.kind;
      return online(id) && (k === "inside" || k === "arena");
    },
    [livePulse, online]
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

  /** Outside: friends who are about (not indoors), and anyone at a table. */
  const outdoorPeople: (Villager & { known: boolean })[] = useMemo(() => {
    const out = new Map<string, Villager & { known: boolean }>();
    for (const n of neighbours) if ((online(n.id) && !indoors(n.id)) || seating.has(n.id)) out.set(n.id, { ...n, known: true });
    for (const s of livePulse.sessions)
      for (const m of s.members)
        if (m.villager.id !== me.id && !out.has(m.villager.id)) out.set(m.villager.id, { ...m.villager, known: m.known });
    return [...out.values()];
  }, [neighbours, online, indoors, seating, livePulse.sessions, me.id]);

  /** In a room or the arena: whoever the check-in says is here with me. */
  const roomPeople = useMemo(
    () => (scene.kind !== "out" && livePulse.room && livePulse.room.space !== "hall" ? livePulse.room.people : []),
    [scene.kind, livePulse.room]
  );

  /* ----------------------------------------------------------- sheets */

  useEffect(() => {
    let live = true;
    const all: Villager[] = [me, ...neighbours, ...outdoorPeople, ...roomPeople.map((p) => p.villager)];
    for (const v of all) {
      if (sheets[v.id]) continue;
      void composeSheet(v.appearance, v.equipped).then((url) => {
        if (live && url) setSheets((s) => (s[v.id] ? s : { ...s, [v.id]: url }));
      });
    }
    return () => {
      live = false;
    };
  }, [me, neighbours, outdoorPeople, roomPeople, sheets]);

  /* --------------------------------------------------------- the grid */

  const grid: Grid = scene.kind === "out" ? world : scene.kind === "room" ? scene.room : scene.arena;
  const gridRef = useRef<Grid>(grid);
  const sceneRef = useRef<Scene>(scene);
  useEffect(() => {
    gridRef.current = grid;
    sceneRef.current = scene;
  }, [grid, scene]);

  /* ----------------------------------------------------------- agents */

  const agents = useRef(new Map<string, Agent>()); // outside
  const roomAgents = useRef(new Map<string, Agent>()); // in a room or the arena
  const player = useRef<Agent | null>(null);
  /** Hands a walker's element to its agent, so the loop can move it. */
  const bindAgent = useCallback(
    (where: "out" | "room" | "me", id: string) => (el: HTMLDivElement | null) => {
      const a = where === "me" ? player.current : (where === "out" ? agents.current : roomAgents.current).get(id);
      if (a) a.el = el;
    },
    []
  );
  if (player.current == null) {
    const home = world.plots.find((p) => p.owner === me.id)!;
    player.current = makeAgent(me.id, home.door.x, home.door.y + 1, PLAYER_SPEED);
  }

  // Outside: where each visible friend should be, whenever the check-in changes.
  useEffect(() => {
    const map = agents.current;
    const seen = new Set<string>();
    const hallSpot = { x: world.hall.door.x, y: world.hall.door.y + 2 };
    for (const v of outdoorPeople) {
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
  }, [outdoorPeople, seating, livePulse.presence, plotOf, world]);

  // In a room: everyone walks to where their own screen says they are.
  useEffect(() => {
    const map = roomAgents.current;
    if (scene.kind === "out") {
      map.clear();
      return;
    }
    const g = scene.kind === "room" ? scene.room : scene.arena;
    const entry = scene.kind === "room" ? scene.room.door : scene.arena.gate;
    const seen = new Set<string>();
    for (const p of roomPeople) {
      seen.add(p.villager.id);
      let a = map.get(p.villager.id);
      if (!a) {
        a = makeAgent(p.villager.id, entry.x, entry.y - 1, PLAYER_SPEED);
        map.set(p.villager.id, a);
      }
      const tx = Math.round(p.x);
      const ty = Math.round(p.y);
      const cur = { x: Math.floor(a.x / T), y: Math.floor((a.y - 8) / T) };
      if (cur.x !== tx || cur.y !== ty) walkTo(g, a, tx, ty);
      else if (!a.path.length) a.dir = p.facing;
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
  }, [roomPeople, scene]);

  /* ------------------------------------------------------ duel state */

  const myDuel: DuelView | null = useMemo(
    () =>
      livePulse.duels.find(
        // Finished ones only come back for a few seconds, which is how long
        // the result stays up unless it's closed first.
        (d) => (d.a.id === me.id || d.b.id === me.id) && !dismissed.has(d.id)
      ) ?? null,
    [livePulse.duels, me.id, dismissed]
  );
  const fighting = myDuel?.status === "active";

  // Fighters take their marks: challenger on the left, facing right.
  useEffect(() => {
    if (scene.kind !== "arena" || !fighting || !myDuel) return;
    const mine = myDuel.a.id === me.id ? scene.arena.spots.a : scene.arena.spots.b;
    const p = player.current!;
    walkTo(scene.arena, p, mine.x, mine.y, () => {
      p.dir = myDuel.a.id === me.id ? 3 : 1;
    });
  }, [scene, fighting, myDuel, me.id]);

  // A round landing: numbers over heads, and a flash.
  const lastRound = useRef<Record<string, number>>({});
  useEffect(() => {
    for (const d of livePulse.duels) {
      if (!d.last || lastRound.current[d.id] === d.last.r) continue;
      const first = lastRound.current[d.id] === undefined;
      lastRound.current[d.id] = d.last.r;
      if (first && d.status !== "active") continue;
      const key = Date.now();
      setHits((h) => ({ ...h, [d.a.id]: { dmg: d.last!.ad, key }, [d.b.id]: { dmg: d.last!.bd, key } }));
      setTimeout(() => setHits((h) => {
        const next = { ...h };
        if (next[d.a.id]?.key === key) delete next[d.a.id];
        if (next[d.b.id]?.key === key) delete next[d.b.id];
        return next;
      }), 1100);
    }
  }, [livePulse.duels]);

  /** Health over heads in the arena, for fighters and everyone watching. */
  const bars = useMemo(() => {
    const out: Record<string, { hp: number; max: number }> = {};
    if (scene.kind !== "arena") return out;
    for (const d of livePulse.duels)
      if (d.status === "active" && d.hp) {
        out[d.a.id] = { hp: d.hp.a, max: d.hp.aMax };
        out[d.b.id] = { hp: d.hp.b, max: d.hp.bMax };
      }
    return out;
  }, [scene.kind, livePulse.duels]);

  /* ------------------------------------------------------------ talk */

  const space = spaceOf(place);
  const chatLines = useMemo(() => {
    const server = livePulse.room && livePulse.room.space === space ? livePulse.room.chat : [];
    const ids = new Set(server.map((l) => `${l.authorId}|${l.body}`));
    return [...server, ...said.filter((l) => !ids.has(`${l.authorId}|${l.body}`))].sort((a, b) => a.at - b.at);
  }, [livePulse.room, said, space]);

  const bubbles = useMemo(() => {
    const out: Record<string, string> = {};
    const t = serverNow(skew);
    for (const l of chatLines) if (t - l.at < BUBBLE_MS) out[l.authorId] = l.body;
    return out;
    // `now` moves with every check-in, which is what ages the bubbles out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLines, skew, now]);

  /* ------------------------------------------------------ decorating */

  const [deco, setDeco] = useState<{ draft: Interior; pick: FurnitureKind | null; selected: number | null; saving: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const shownRoom: RoomScene | null = useMemo(() => {
    if (scene.kind !== "room") return null;
    return deco ? buildRoom(scene.room.tier, deco.draft) : scene.room;
  }, [scene, deco]);

  /* ------------------------------------------------------- the loop */

  const viewport = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const keys = useRef(new Set<string>());
  const placeRef = useRef<Place>({ kind: "home" });
  const promptRef = useRef<Prompt>(null);
  const enteredAt = useRef(0);
  const leaveRef = useRef<() => void>(() => {});
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = !!fighting;
  }, [fighting]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastCheck = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const S = scaleRef.current;
      const g = gridRef.current;
      const sc = sceneRef.current;
      const p = player.current!;

      const k = keys.current;
      const vx = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
      const vy = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
      if ((vx || vy) && !lockedRef.current) nudgePlayer(g, p, vx, vy, dt);
      else step(g, p, dt, t);
      paint(p, S);
      const others = sc.kind === "out" ? agents.current : roomAgents.current;
      for (const a of others.values()) {
        step(g, a, dt, t);
        paint(a, S);
      }

      // Camera: follow, but never show past the edge; small rooms sit centred.
      const vp = viewport.current;
      if (vp && layer.current) {
        const vw = vp.clientWidth;
        const vh = vp.clientHeight;
        const W = g.w * T * S;
        const H = g.h * T * S;
        const cx = W <= vw ? (W - vw) / 2 : Math.max(0, Math.min(W - vw, p.x * S - vw / 2));
        const cy = H <= vh ? (H - vh) / 2 : Math.max(0, Math.min(H - vh, p.y * S - vh / 2));
        layer.current.style.transform = `translate3d(${-Math.round(cx)}px, ${-Math.round(cy)}px, 0)`;
        layer.current.dataset.cx = String(cx);
        layer.current.dataset.cy = String(cy);
      }

      if (t - lastCheck > 200) {
        lastCheck = t;
        const tx = p.x / T;
        const ty = (p.y - 8) / T;
        let best: Prompt = null;

        if (sc.kind === "out") {
          // What's in reach, and where that puts me.
          let bestD = 1.7;
          let where: Place = { kind: "square" };
          for (const pl of world.plots) {
            if (!pl.owner) continue;
            const d = Math.hypot(tx - (pl.door.x + 0.5), ty - (pl.door.y + 0.5));
            if (d < bestD) {
              bestD = d;
              best = { kind: "house", id: pl.owner };
            }
            if (d < 3) where = pl.owner === me.id ? { kind: "home" } : { kind: "house", hostId: pl.owner };
          }
          const dh = Math.hypot(tx - (world.hall.door.x + 0.5), ty - (world.hall.door.y + 0.5));
          if (inRect(world.hall.plaza, Math.floor(tx), Math.floor(ty)) || dh < 2) {
            where = { kind: "hall" };
            if (!best && dh < 2.5) best = { kind: "hall" };
          }
          const da = Math.hypot(tx - (world.arena.door.x + 0.5), ty - (world.arena.door.y + 0.5));
          if (!best && da < 1.7) best = { kind: "arena" };
          if (placeKey(where) !== placeKey(placeRef.current)) {
            placeRef.current = where;
            setPlace(where);
          }
        } else {
          // Inside: the way out. Stepping onto it leaves.
          const exit = sc.kind === "room" ? sc.room.door : sc.arena.gate;
          const d = Math.hypot(tx - (exit.x + 0.5), ty - (exit.y + 0.5));
          if (d < 1.8) best = { kind: "leave" };
          if (Math.floor(tx) === exit.x && Math.floor(ty) === exit.y && t - enteredAt.current > 800) leaveRef.current();
        }
        if (promptKey(best) !== promptKey(promptRef.current)) {
          promptRef.current = best;
          setPrompt(best);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [world, me.id]);

  /* ---------------------------------------------------------- check-ins */

  const toast = useCallback((text: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const shownNudges = useRef(new Set<string>());
  const beatNow = useRef<() => void>(() => {});
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPlace = "";
    const beat = async () => {
      clearTimeout(timer);
      const inRoom = sceneRef.current.kind !== "out";
      if (document.visibilityState === "visible") {
        const p = player.current!;
        const pos = inRoom ? { x: (p.x - T / 2) / T, y: (p.y - T / 2 - 8) / T, facing: p.dir } : null;
        const r = await checkIn(placeRef.current, pos);
        lastPlace = placeKey(placeRef.current);
        if (r?.focusXp) toast(`+${r.focusXp} XP for focus time`);
        for (const n of r?.nudges ?? []) {
          if (shownNudges.current.has(n.id)) continue;
          shownNudges.current.add(n.id);
          setToasts((t) => [...t, { id: n.id, nudge: true, text: `${n.fromName} nudged you: “${n.body}”${n.about ? ` (${n.about})` : ""}` }]);
        }
      }
      timer = setTimeout(beat, sceneRef.current.kind !== "out" ? ROOM_PULSE_MS : PULSE_MS);
    };
    beatNow.current = () => void beat();
    void beat();
    // Moving somewhere new is worth telling people about straight away.
    const quick = setInterval(() => {
      if (placeKey(placeRef.current) !== lastPlace && document.visibilityState === "visible") void beat();
    }, 1000);
    const onVis = () => document.visibilityState === "visible" && void beat();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      clearInterval(quick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [toast]);

  /* ------------------------------------------------- scene changes */

  const outsideAt = useRef<{ x: number; y: number } | null>(null);

  const enterHouse = useCallback(
    async (hostId: string) => {
      const d = await loadInterior(hostId).catch(() => null);
      if (!d) return toast("The door's locked — try again in a moment.");
      const room = buildRoom(d.tier, d.interior);
      const p = player.current!;
      const plot = plotOf.get(hostId);
      outsideAt.current = plot ? { x: plot.door.x, y: plot.door.y + 1 } : null;
      p.path = [];
      p.x = room.door.x * T + T / 2;
      p.y = (room.door.y - 1) * T + T / 2 + 8;
      p.dir = 0;
      const next: Scene = { kind: "room", hostId, room, name: d.name, level: d.level };
      gridRef.current = room;
      sceneRef.current = next;
      enteredAt.current = performance.now();
      placeRef.current = { kind: "inside", hostId };
      setPlace(placeRef.current);
      setScene(next);
      setOpen(null);
      beatNow.current();
    },
    [plotOf, toast]
  );

  const enterArena = useCallback(() => {
    const arena = buildArena();
    const p = player.current!;
    outsideAt.current = { x: world.arena.door.x, y: world.arena.door.y + 1 };
    p.path = [];
    p.x = arena.gate.x * T + T / 2;
    p.y = (arena.gate.y - 1) * T + T / 2 + 8;
    p.dir = 0;
    const next: Scene = { kind: "arena", arena };
    gridRef.current = arena;
    sceneRef.current = next;
    enteredAt.current = performance.now();
    placeRef.current = { kind: "arena" };
    setPlace(placeRef.current);
    setScene(next);
    setOpen(null);
    beatNow.current();
  }, [world]);

  const leave = useCallback(() => {
    if (sceneRef.current.kind === "out") return;
    if (lockedRef.current) return toast("Finish or yield your duel first.");
    const p = player.current!;
    const back = outsideAt.current ?? { x: world.hall.door.x, y: world.hall.door.y + 2 };
    p.path = [];
    p.x = back.x * T + T / 2;
    p.y = back.y * T + T / 2 + 8;
    p.dir = 2;
    gridRef.current = world;
    sceneRef.current = { kind: "out" };
    setDeco(null);
    setScene({ kind: "out" });
    setOpen(null);
    placeRef.current = { kind: "square" };
    setPlace(placeRef.current);
    beatNow.current();
  }, [world, toast]);
  useEffect(() => {
    leaveRef.current = leave;
  }, [leave]);

  /* ------------------------------------------------------------- input */

  const openPrompt = useCallback(
    (p: Prompt) => {
      if (!p) return;
      if (p.kind === "hall") setOpen({ kind: "hall" });
      else if (p.kind === "arena") enterArena();
      else if (p.kind === "leave") leave();
      else void enterHouse(p.id);
    },
    [enterArena, enterHouse, leave]
  );

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
      } else if (e.code === "KeyE" || e.code === "Enter") {
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

  /** Screen point → grid tile. */
  const tileAtPoint = (clientX: number, clientY: number) => {
    const vp = viewport.current;
    const l = layer.current;
    if (!vp || !l) return null;
    const r = vp.getBoundingClientRect();
    const S = scaleRef.current;
    const wx = (clientX - r.left + Number(l.dataset.cx ?? 0)) / S;
    const wy = (clientY - r.top + Number(l.dataset.cy ?? 0)) / S;
    return { x: Math.floor(wx / T), y: Math.floor(wy / T) };
  };

  /** Tap on the ground: walk there — or, decorating, put the piece down. */
  function onGround(e: React.PointerEvent) {
    const tile = tileAtPoint(e.clientX, e.clientY);
    if (!tile) return;
    if (deco && scene.kind === "room") {
      if (deco.pick) place_(deco.pick, tile);
      else setDeco({ ...deco, selected: null });
      return;
    }
    if (lockedRef.current) return;
    walkTo(gridRef.current, player.current!, tile.x, tile.y);
  }

  function place_(kind: FurnitureKind, tile: { x: number; y: number }) {
    if (!deco || scene.kind !== "room") return;
    const spec = FURNITURE[kind];
    const fx = tile.x - 1;
    const fy = spec.layer === "wall" ? 0 : tile.y - 2;
    if (spec.layer === "wall" && tile.y > 1) return toast("Hangings go on the back wall.");
    const tried = { ...deco.draft, items: [...deco.draft.items, { k: kind, x: fx, y: fy }] };
    const clean = cleanInterior(tried, scene.room.tier, me.level);
    if (clean.items.length <= deco.draft.items.length) return toast("That doesn't fit there.");
    setDeco({ ...deco, draft: clean });
  }

  function visitHouse(id: string) {
    const plot = plotOf.get(id);
    if (!plot) return;
    walkTo(world, player.current!, plot.door.x, plot.door.y, () => void enterHouse(id));
  }

  function goToHall() {
    if (scene.kind !== "out") return setOpen({ kind: "hall" });
    walkTo(world, player.current!, world.hall.door.x, world.hall.door.y + 1, () => setOpen({ kind: "hall" }));
  }

  function goToArena() {
    walkTo(world, player.current!, world.arena.door.x, world.arena.door.y, () => enterArena());
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
    if (p.kind === "arena") return "In the arena";
    if (p.kind === "inside") return p.hostId === me.id ? "Inside your house" : p.hostId === id ? "Inside at home" : `Inside ${byId.get(p.hostId)?.name ?? "someone"}'s house`;
    if (p.hostId === me.id) return "At your house";
    return `Visiting ${byId.get(p.hostId)?.name ?? "someone"}`;
  }

  const S = scale;
  const promptLabel = !prompt
    ? null
    : prompt.kind === "hall"
      ? "Enter the town hall"
      : prompt.kind === "arena"
        ? "Enter the arena"
        : prompt.kind === "leave"
          ? scene.kind === "arena"
            ? "Leave the arena"
            : "Go outside"
          : prompt.id === me.id
            ? "Go inside"
            : `Go into ${byId.get(prompt.id)?.name ?? ""}'s house`;
  const onlineCount = neighbours.filter((n) => online(n.id)).length;
  const unreadNotes = data.notes.filter((n) => !n.read).length;
  const insideCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of neighbours) {
      const p = livePulse.presence[n.id]?.place;
      if (online(n.id) && p?.kind === "inside") m.set(p.hostId, (m.get(p.hostId) ?? 0) + 1);
    }
    return m;
  }, [neighbours, livePulse.presence, online]);
  const isMyRoom = scene.kind === "room" && scene.hostId === me.id;
  const hostName = scene.kind === "room" ? (isMyRoom ? "Your" : `${scene.name}'s`) : "";
  const roomTier = scene.kind === "room" ? tierFor(scene.level).label.toLowerCase() : "";

  return (
    <div className="relative h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] select-none overflow-hidden bg-[#2c2018] sm:h-[calc(100dvh-env(safe-area-inset-top))]">
      <div
        ref={viewport}
        className={`absolute inset-0 touch-none ${scene.kind === "out" ? "bg-[#5f8f34]" : ""}`}
        onPointerDown={onGround}
        onPointerMove={(e) => {
          if (!deco?.pick) return;
          const t = tileAtPoint(e.clientX, e.clientY);
          if (t && (t.x !== ghost?.x || t.y !== ghost?.y)) setGhost(t);
        }}
      >
        <div ref={layer} className="absolute left-0 top-0 will-change-transform" style={{ width: grid.w * T * S, height: grid.h * T * S }}>
          {scene.kind === "out" && (
            <Outdoors
              world={world}
              S={S}
              byId={byId}
              meId={me.id}
              seating={seating}
              online={online}
              insideCount={insideCount}
              mySession={!!livePulse.mySessionId}
              sessionsCount={livePulse.sessions.length}
              unreadNotes={unreadNotes}
              onHouse={visitHouse}
              onHall={goToHall}
              onArena={goToArena}
            />
          )}
          {scene.kind === "room" && shownRoom && (
            <RoomView
              room={shownRoom}
              scale={S}
              onPiece={deco ? (i) => setDeco({ ...deco, selected: i, pick: null }) : undefined}
            />
          )}
          {scene.kind === "arena" && <ArenaView arena={scene.arena} scale={S} />}

          {/* Where a piece being placed would go */}
          {deco?.pick && ghost && (
            <div
              className="pointer-events-none absolute"
              style={{
                left: ghost.x * T * S,
                top: (FURNITURE[deco.pick].layer === "wall" ? 0.4 : ghost.y) * T * S,
                width: FURNITURE[deco.pick].w * T * S,
                height: (FURNITURE[deco.pick].layer === "wall" ? 36 : FURNITURE[deco.pick].h * T) * S,
                zIndex: 99999,
              }}
            >
              <Furniture kind={deco.pick} ghost />
            </div>
          )}

          {/* Walkers */}
          {scene.kind === "out"
            ? outdoorPeople.map((v) => (
                <Walker
                  key={v.id}
                  sheet={sheets[v.id]}
                  scale={S}
                  label={v.name}
                  stranger={!v.known}
                  bubble={space === "hall" && seatingOrHall(v.id, livePulse.presence) ? bubbles[v.id] : undefined}
                  bind={bindAgent("out", v.id)}
                  onTap={v.known ? () => setOpen({ kind: "house", id: v.id }) : () => setOpen({ kind: "hall" })}
                />
              ))
            : roomPeople.map((p) => (
                <Walker
                  key={p.villager.id}
                  sheet={sheets[p.villager.id]}
                  scale={S}
                  label={p.villager.name}
                  stranger={!p.known}
                  bubble={bubbles[p.villager.id]}
                  bar={bars[p.villager.id]}
                  hit={hits[p.villager.id]}
                  bind={bindAgent("room", p.villager.id)}
                  onTap={
                    p.known
                      ? () => setOpen(scene.kind === "arena" ? { kind: "duelist", id: p.villager.id } : { kind: "house", id: p.villager.id })
                      : undefined
                  }
                />
              ))}
          <Walker
            sheet={sheets[me.id]}
            scale={S}
            label={null}
            bubble={space ? bubbles[me.id] : undefined}
            bar={bars[me.id]}
            hit={hits[me.id]}
            bind={bindAgent("me", me.id)}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------ HUD */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[70000] flex flex-wrap items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          {scene.kind === "out" ? (
            <Link href="/" className="panel hidden rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700 sm:block">
              ← Quests
            </Link>
          ) : (
            <button onClick={leave} className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
              ← Outside
            </button>
          )}
          <h1 className="panel rounded-lg px-3 py-1.5 font-display text-sm font-bold text-mud-900">
            {scene.kind === "out" ? "Village" : scene.kind === "arena" ? "Arena" : `${hostName} ${roomTier}`}
          </h1>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
          {scene.kind === "out" && (
            <>
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
              <button onClick={goToArena} className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
                Arena
              </button>
            </>
          )}
          {scene.kind === "room" && isMyRoom && !deco && (
            <>
              <button
                onClick={() => setDeco({ draft: scene.room.interior, pick: null, selected: null, saving: false })}
                className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-grass-700 hover:text-grass-600"
              >
                ✎ Decorate
              </button>
              <button onClick={() => setOpen({ kind: "mine" })} className="panel relative rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
                Notes & outside
                {unreadNotes > 0 && <span className="absolute -right-1 -top-1 size-2.5 rounded-full bg-red-600" />}
              </button>
            </>
          )}
          {scene.kind === "room" && !isMyRoom && byId.get(scene.hostId) && (
            <button onClick={() => setOpen({ kind: "house", id: scene.hostId })} className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
              About {scene.name}
            </button>
          )}
          {scene.kind === "arena" && (
            <span className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700">
              Your record: {me.duels?.wins ?? 0}–{me.duels?.losses ?? 0}
            </span>
          )}
        </div>
      </div>

      {/* Bottom: what you can do here, and talking */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[70000] flex flex-col items-center gap-2 px-3">
        {myDuel && (
          <DuelUI
            duel={myDuel}
            meId={me.id}
            skew={skew}
            onDismiss={() => setDismissed((s) => new Set(s).add(myDuel.id))}
          />
        )}
        {promptLabel && !open && !deco && !fighting && (
          <button
            onClick={() => openPrompt(prompt)}
            className="pointer-events-auto rounded-full bg-grass-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-grass-500"
          >
            {promptLabel} <span className="ml-1 hidden rounded bg-white/20 px-1.5 text-xs sm:inline">E</span>
          </button>
        )}
        {space && !deco && (
          <ChatBar
            space={space}
            lines={chatLines}
            others={scene.kind === "out" ? outdoorPeople.filter((v) => seatingOrHall(v.id, livePulse.presence)).length : roomPeople.length}
            onSaid={(text) => {
              setSaid((s) => [...s.slice(-10), { id: `me-${Date.now()}`, authorId: me.id, name: me.name, body: text, at: serverNow(skew) }]);
              beatNow.current();
            }}
          />
        )}
      </div>

      {scene.kind === "out" && (
        <p className="pointer-events-none absolute bottom-3 right-4 z-[70000] hidden text-[11px] font-semibold text-white/80 drop-shadow lg:block">
          Arrow keys or WASD to walk · click to go somewhere · E to go in
        </p>
      )}

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
      {deco && scene.kind === "room" && (
        <DecoratePanel
          draft={deco.draft}
          level={me.level}
          pick={deco.pick}
          selected={deco.selected}
          saving={deco.saving}
          onPick={(k) => setDeco({ ...deco, pick: k, selected: null })}
          onChange={(draft) => setDeco({ ...deco, draft })}
          onRemoveSelected={() =>
            deco.selected != null &&
            setDeco({ ...deco, draft: { ...deco.draft, items: deco.draft.items.filter((_, i) => i !== deco.selected) }, selected: null })
          }
          onMoveSelected={() => {
            if (deco.selected == null) return;
            const k = deco.draft.items[deco.selected].k;
            setDeco({ ...deco, draft: { ...deco.draft, items: deco.draft.items.filter((_, i) => i !== deco.selected) }, selected: null, pick: k });
          }}
          onCancel={() => {
            setDeco(null);
            setGhost(null);
          }}
          onSave={async () => {
            setDeco({ ...deco, saving: true });
            const saved = await saveInterior(deco.draft).catch(() => null);
            if (!saved) {
              toast("Couldn't save your room.");
              setDeco({ ...deco, saving: false });
              return;
            }
            const room = buildRoom(scene.room.tier, saved);
            gridRef.current = room;
            const next: Scene = { ...scene, room };
            sceneRef.current = next;
            setScene(next);
            setDeco(null);
            setGhost(null);
            toast("Room saved.");
          }}
        />
      )}
      {!deco && open?.kind === "house" && byId.get(open.id) && (
        <FriendHousePanel n={byId.get(open.id)!} where={whereIs(open.id)} session={sessionOf(open.id)} onClose={() => setOpen(null)} />
      )}
      {!deco && open?.kind === "mine" && (
        <MyHousePanel me={me} notes={data.notes} onLook={(look) => setMe((m) => ({ ...m, house: look }))} onClose={() => setOpen(null)} />
      )}
      {!deco && open?.kind === "hall" && <HallPanel sessions={livePulse.sessions} sheets={sheets} me={me} onClose={() => setOpen(null)} />}
      {!deco && open?.kind === "people" && (
        <PeoplePanel
          people={neighbours.map((n) => ({ n, online: online(n.id) || seating.has(n.id), where: whereIs(n.id) }))}
          sheets={sheets}
          onGo={(id) => {
            setOpen(null);
            const p = livePulse.presence[id]?.place;
            if (seating.has(id)) goToHall();
            else if (online(id) && p?.kind === "arena") goToArena();
            else if (online(id) && p?.kind === "inside") visitHouse(p.hostId);
            else visitHouse(id);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {!deco && open?.kind === "duelist" && byId.get(open.id) && (
        <DuelistCard
          n={byId.get(open.id)!}
          busy={!!myDuel && (myDuel.status === "pending" || myDuel.status === "active")}
          onChallenge={async () => {
            const r = await challenge(open.id).catch(() => ({ ok: false as const, error: "Couldn't send the challenge." }));
            if (!r.ok) toast(r.error);
            else {
              setOpen(null);
              beatNow.current();
            }
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** Is this friend at the town hall (for hearing them there)? */
function seatingOrHall(id: string, presence: Record<string, { place: Place }>) {
  return presence[id]?.place.kind === "hall";
}

/* ------------------------------------------------------------ outdoors */

function Outdoors({
  world,
  S,
  byId,
  meId,
  seating,
  online,
  insideCount,
  mySession,
  sessionsCount,
  unreadNotes,
  onHouse,
  onHall,
  onArena,
}: {
  world: World;
  S: number;
  byId: Map<string, Stats>;
  meId: string;
  seating: Map<string, unknown>;
  online: (id: string) => boolean;
  insideCount: Map<string, number>;
  mySession: boolean;
  sessionsCount: number;
  unreadNotes: number;
  onHouse: (id: string) => void;
  onHall: () => void;
  onArena: () => void;
}) {
  return (
    <>
      <Ground world={world} scale={S} />

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
          onHall();
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
        <TownHall busy={sessionsCount > 0} />
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
            {i < sessionsCount && (
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

      {/* The arena's gatehouse */}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          onArena();
        }}
        aria-label="The arena"
        className="absolute"
        style={{
          left: world.arena.body.x * T * S,
          top: world.arena.body.y * T * S,
          width: world.arena.body.w * T * S,
          height: world.arena.body.h * T * S,
          zIndex: (world.arena.body.y + world.arena.body.h) * T,
        }}
      >
        <ArenaGate />
      </button>

      {/* Houses, each with a signpost */}
      {world.plots.map((p) => {
        if (!p.owner) return null;
        const n = byId.get(p.owner);
        if (!n) return null;
        const isMe = p.owner === meId;
        const tier = tierFor(n.level);
        const inside = insideCount.get(p.owner) ?? 0;
        return (
          <div key={p.owner}>
            <button
              onPointerDown={(e) => {
                e.stopPropagation();
                onHouse(p.owner!);
              }}
              aria-label={isMe ? "Go into your house" : `Go into ${n.name}'s house`}
              className="absolute [&>svg]:h-full [&>svg]:w-full"
              style={{ left: p.x * T * S, top: p.y * T * S, width: 8 * T * S, height: 7 * T * S, zIndex: (p.y + 6) * T }}
            >
              <House
                tier={tier.tier}
                look={n.house}
                bloom={bloomFor(n.streak)}
                lit={seating.has(n.id) || (isMe && mySession) || inside > 0}
                smoke={isMe || online(n.id)}
              />
            </button>
            <div
              aria-hidden
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
              style={{ left: (p.x + 0.5) * T * S, top: (p.y + 7) * T * S - 4 * S, zIndex: (p.y + 7) * T }}
            >
              <div
                className="relative rounded-[3px] border-2 border-[#5a3e28] bg-[#c9a06a] px-1.5 py-0.5 text-center leading-tight shadow-[0_2px_0_#5a3e28]"
                style={{ maxWidth: 2 * T * S }}
              >
                <p className="truncate font-display text-[11px] font-bold text-[#3b2a1c]">{n.name}</p>
                <p className="truncate text-[9px] font-semibold text-[#5a3e28]">
                  {isMe ? `Your ${tier.label.toLowerCase()}` : tier.label}
                  {inside > 0 ? ` · ${inside} inside` : ""}
                </p>
                {isMe && unreadNotes > 0 && (
                  <span className="absolute -right-2 -top-2 grid size-4 place-items-center rounded-full bg-red-600 text-[9px] font-bold text-white">
                    {unreadNotes}
                  </span>
                )}
              </div>
              <div className="bg-[#6b4a2b]" style={{ width: 3 * S, height: 12 * S }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

function DuelistCard({ n, busy, onChallenge, onClose }: { n: Stats; busy: boolean; onChallenge: () => void; onClose: () => void }) {
  const [sending, setSending] = useState(false);
  return (
    <Panel title={n.name} sub={`Level ${n.level} · duels ${n.duels?.wins ?? 0}–${n.duels?.losses ?? 0}`} onClose={onClose}>
      <p className="text-sm text-mud-600">
        Each round you both pick at once: <b>Strike</b> beats Feint, <b>Guard</b> beats Strike, <b>Feint</b> beats Guard. Gear gives an
        edge; reading each other wins. Nothing is won or lost but pride.
      </p>
      <button
        disabled={busy || sending}
        onClick={async () => {
          setSending(true);
          await onChallenge();
          setSending(false);
        }}
        className="mt-3 w-full rounded-lg bg-mud-800 px-3 py-2 text-sm font-bold text-white hover:bg-mud-700 disabled:opacity-50"
      >
        {busy ? "You're already in a duel" : sending ? "Challenging…" : `⚔ Challenge ${n.name}`}
      </button>
    </Panel>
  );
}

function Walker({
  sheet,
  scale,
  label,
  stranger = false,
  bubble,
  bar,
  hit,
  bind,
  onTap,
}: {
  sheet: string | undefined;
  scale: number;
  label: string | null;
  stranger?: boolean;
  bubble?: string;
  bar?: { hp: number; max: number };
  hit?: { dmg: number; key: number };
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
        className={hit && hit.dmg > 0 ? "walker-hit" : undefined}
        key={hit?.key}
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
      <div className="pointer-events-none absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-full flex-col items-center gap-0.5">
        {bubble && (
          <p className="relative mb-1 max-w-[180px] break-words rounded-xl bg-white px-2 py-1 text-center text-[11px] leading-snug text-mud-900 shadow-md ring-1 ring-mud-200">
            {bubble}
            <span className="absolute -bottom-1 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-white ring-1 ring-mud-200 [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
          </p>
        )}
        {hit && hit.dmg > 0 && (
          <span key={hit.key} className="damage-pop text-sm font-black text-red-600 drop-shadow-[0_1px_0_white]">
            −{hit.dmg}
          </span>
        )}
        {bar && <HeadBar hp={bar.hp} max={bar.max} />}
      </div>
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
