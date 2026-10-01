"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Ground from "@/components/village/Ground";
import House from "@/components/village/House";
import Furniture from "@/components/village/Furniture";
import ChatBar from "@/components/village/ChatBar";
import DecoratePanel from "@/components/village/DecoratePanel";
import { DuelUI, HeadBar } from "@/components/village/DuelUI";
import { ArenaGate, ArenaView, LibraryView, RoomView, StoreView } from "@/components/village/scenes";
import { ShopPanel } from "@/components/village/ShopPanel";
import { Bakery, Fountain, GardenGround, Hedge, Library, ParkGround, Station, Store, Well } from "@/components/village/Landmarks";
import TrainRide from "@/components/village/TrainRide";
import { buildArena, buildLibrary, buildRoom, buildStore, type ArenaScene, type IndoorScene, type RoomScene } from "@/components/village/rooms";
import { FriendHousePanel, HallPanel, MyHousePanel, Panel, PeoplePanel, type Stats } from "@/components/village/panels";
import { follow, keepInRing, makeAgent, nudgePlayer, paint, PLAYER_SPEED, step, swingNow, tilesOf, walkTo, type Agent } from "@/components/village/engine";
import { ATLAS, buildWorld, inRect, PLOTS_PER_VILLAGE, PROPS, T, villageInfo, villageOf, type Grid, type Theme, type World } from "@/components/village/world";
import { composeAttack, composeSheet, type AttackSheet } from "@/lib/sprite";
import { checkIn, keepSeat, patchDuelHp, publishPulse, serverNow, setVillageWhere, useSessionStore } from "@/lib/session-store";
import { facingToward, HIT_COOLDOWN_MS } from "@/lib/duel";
import { useVillageLive } from "@/lib/live-client";
import { challenge, loadInterior, loadResidents, markNudgesSeen, moveHouse, saveInterior } from "@/lib/village-actions";
import { cleanInterior, FURNITURE, type FurnitureKind, type Interior } from "@/lib/furniture";
import {
  APP_PULSE_MS,
  bloomFor,
  BUBBLE_MS,
  liveSpaceOf,
  LIVE_ROOM_PULSE_MS,
  ONLINE_MS,
  PULSE_MS,
  ROOM_PULSE_MS,
  spaceOf,
  STATUS_LABEL,
  statusOf,
  tierFor,
  type ChatLine,
  type DuelView,
  type OutdoorPerson,
  type Place,
  type Resident,
  type SessionView,
  type Villager,
} from "@/lib/village";
import type { VillageData } from "@/lib/village-server";

/* --------------------------------------------------------------------------
   The village: one for everyone, every house on its own plot, and whoever's
   about — friends or not, the same on every screen.

   Three kinds of scene share one engine, each with positions shared live:
     outside   the village itself; I start at my own front door
     a house   one room for everyone in it (companions only)
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
  | { kind: "train" }
  | { kind: "shop" }
  | { kind: "desks" }
  | null;

type Prompt =
  | { kind: "house"; id: string }
  | { kind: "hall" }
  | { kind: "arena" }
  | { kind: "station" }
  | { kind: "indoor"; what: "library" | "store" }
  | { kind: "counter" }
  | { kind: "desk" }
  | { kind: "leave" }
  | null;

type Scene =
  | { kind: "out" }
  | { kind: "room"; hostId: string; room: RoomScene; name: string; level: number }
  | { kind: "arena"; arena: ArenaScene }
  | { kind: "indoor"; indoor: IndoorScene };

/** The way out of a scene inside: a room's door, the arena's gate, the library's or store's door. */
function exitOf(sc: Scene): { x: number; y: number } | null {
  return sc.kind === "room" ? sc.room.door : sc.kind === "arena" ? sc.arena.gate : sc.kind === "indoor" ? sc.indoor.door : null;
}

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

/** A live position this recent outranks the check-in's. */
const LIVE_FRESH_MS = 8_000;
/**
 * Standing still in a shared room, say where I am this often anyway: it
 * keeps my live position fresh for everyone (so their check-ins, which can
 * be seconds old, never pull me back), and mends any that went missing.
 */
const POS_HEARTBEAT_MS = 2_500;

/** Each village's trees, turned to its season (world.ts, Theme). */
const TREE_TINT: Record<Theme, string | undefined> = {
  meadow: undefined,
  autumn: "hue-rotate(-55deg) saturate(1.4)",
  forest: "brightness(0.85) saturate(1.1)",
  spring: "hue-rotate(250deg) saturate(0.75) brightness(1.15)",
  snowy: "saturate(0.35) brightness(1.3)",
};

const placeKey = (p: Place) => ("hostId" in p ? `${p.kind}:${p.hostId}` : p.kind);
const promptKey = (p: Prompt) => (!p ? "" : p.kind === "house" ? `house:${p.id}` : p.kind === "indoor" ? `indoor:${p.what}` : p.kind);

export default function Village({ data }: { data: VillageData }) {
  const [me, setMe] = useState<Stats>(data.me);
  const neighbours = data.neighbours;
  const byId = useMemo(() => new Map<string, Stats>([[me.id, me], ...neighbours.map((n) => [n.id, n] as const)]), [me, neighbours]);
  const scale = useScale();
  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Villages of PLOTS_PER_VILLAGE houses each, every house on its own plot,
  // the same on every screen (world.ts), joined by trains. I start in my
  // own. Redrawn when someone arrives or moves house.
  const [residents, setResidents] = useState<Resident[]>(data.residents);
  const residentOf = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);
  const [v, setV] = useState(() => villageOf(data.residents.find((r) => r.id === data.me.id)?.plot ?? 0));
  const vRef = useRef(v);
  useEffect(() => {
    vRef.current = v;
  }, [v]);
  const villages = useMemo(() => Math.max(1, ...residents.map((r) => villageOf(r.plot) + 1)), [residents]);
  const world: World = useMemo(() => {
    const owners: (string | null)[] = Array(PLOTS_PER_VILLAGE).fill(null);
    for (const r of residents) if (villageOf(r.plot) === v) owners[r.plot % PLOTS_PER_VILLAGE] = r.id;
    return buildWorld(v, owners);
  }, [residents, v]);
  const plotOf = useMemo(() => new Map(world.plots.filter((p) => p.owner).map((p) => [p.owner!, p])), [world]);

  /* ------------------------------------------------------------ state */

  const { pulse, skew } = useSessionStore();
  const [open, setOpen] = useState<Open>(null);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [toasts, setToasts] = useState<{ id: string; text: string; nudge?: boolean }[]>([]);
  const [sheets, setSheets] = useState<Record<string, string>>({});
  const [scene, setScene] = useState<Scene>({ kind: "out" });
  // In the village I start by my own front door ("home" is the app outside it).
  const [place, setPlace] = useState<Place>({ kind: "house", hostId: data.me.id });
  const [said, setSaid] = useState<ChatLine[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hits, setHits] = useState<Record<string, { dmg: number; blocked?: boolean; key: number }>>({});
  /** Duel animation sheets (sprite.ts, composeAttack), made for whoever's in the arena. */
  const [attacks, setAttacks] = useState<Record<string, AttackSheet>>({});
  /** Movement keys held, and "guard" while G is. */
  const keys = useRef(new Set<string>());
  /** Where the mouse is over the village, on screen: I face it (the loop). */
  const aimRef = useRef<{ x: number; y: number } | null>(null);

  const toast = useCallback((text: string) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

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

  // Someone got a plot or moved house: fetch the village afresh.
  const plotsSeen = useRef(data.pulse.plotsAt);
  useEffect(() => {
    const v = livePulse.plotsAt;
    if (!v || v === plotsSeen.current) return;
    plotsSeen.current = v;
    void loadResidents()
      .then(setResidents)
      .catch(() => {
        plotsSeen.current = ""; // try again at the next check-in
      });
  }, [livePulse.plotsAt]);

  /** This village's tables in the order they're drawn, and who sits where. */
  const seating = useMemo(() => {
    const seats = new Map<string, { x: number; y: number; face: 0 | 1 | 2 | 3 }>();
    const sessions = livePulse.sessions
      .filter((s) => (s.village ?? 0) === v && (s.spot ?? "hall") === "hall")
      .sort((a, b) => a.startedAt - b.startedAt);
    sessions.forEach((s, i) => {
      const table = world.tables[i % world.tables.length];
      s.members.forEach((m, j) => {
        const seat = table.seats[j] ?? { x: table.x + (j % 3), y: table.y + 2, face: 0 as const };
        seats.set(m.villager.id, seat);
      });
    });
    return seats;
  }, [livePulse.sessions, world, v]);

  const sessionOf = useCallback(
    (id: string): SessionView | null => livePulse.sessions.find((s) => s.members.some((m) => m.villager.id === id)) ?? null,
    [livePulse.sessions]
  );

  /**
   * Outside: everyone about in the village (friends or not) or at home in
   * the app, and anyone keeping a seat at a table.
   */
  const outdoorPeople: OutdoorPerson[] = useMemo(() => {
    const out = new Map<string, OutdoorPerson>();
    // Only a check-in from this village: one from the last can still be
    // on its way back after a train ride.
    if ((livePulse.village ?? 0) === v) for (const o of livePulse.outdoors ?? []) out.set(o.villager.id, o);
    for (const s of livePulse.sessions)
      if ((s.village ?? 0) === v)
        for (const m of s.members)
          if (m.villager.id !== me.id && !out.has(m.villager.id))
            out.set(m.villager.id, { villager: m.villager, known: m.known, place: { kind: "home" }, pos: null });
    return [...out.values()];
  }, [livePulse.village, livePulse.outdoors, livePulse.sessions, me.id, v]);

  const space = spaceOf(place, v);

  /** In a room or the arena: whoever the check-in says is here with me. */
  const roomPeople = useMemo(
    // Only a check-in from this room counts: one sent from where I was
    // before can still be on its way back.
    () => (scene.kind !== "out" && livePulse.room && livePulse.room.space === space ? livePulse.room.people : []),
    [scene.kind, livePulse.room, space]
  );

  /* ----------------------------------------------------------- sheets */

  useEffect(() => {
    let live = true;
    const all: Villager[] = [me, ...neighbours, ...outdoorPeople.map((o) => o.villager), ...roomPeople.map((p) => p.villager)];
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

  // Duel animations, for whoever's in the arena with me (and me): built
  // there only, since that's the one place anyone swings.
  useEffect(() => {
    if (scene.kind !== "arena") return;
    let live = true;
    for (const v of [me, ...roomPeople.map((p) => p.villager)]) {
      if (attacks[v.id]) continue;
      void composeAttack(v.appearance, v.equipped).then((a) => {
        if (live && a) setAttacks((s) => (s[v.id] ? s : { ...s, [v.id]: a }));
      });
    }
    return () => {
      live = false;
    };
  }, [scene.kind, me, roomPeople, attacks]);

  /* --------------------------------------------------------- the grid */

  const grid: Grid = scene.kind === "out" ? world : scene.kind === "room" ? scene.room : scene.kind === "arena" ? scene.arena : scene.indoor;
  const gridRef = useRef<Grid>(grid);
  const sceneRef = useRef<Scene>(scene);
  useEffect(() => {
    gridRef.current = grid;
    sceneRef.current = scene;
  }, [grid, scene]);

  /* ----------------------------------------------------------- agents */

  const agents = useRef(new Map<string, Agent>()); // outside
  const roomAgents = useRef(new Map<string, Agent>()); // in a room or the arena
  /**
   * The latest position from the live connection for each person in my
   * room, and when it came — kept even before there's an agent to move, so
   * one made later starts where they really are.
   */
  const lastLive = useRef(new Map<string, { x: number; y: number; f: Agent["dir"]; g: boolean; at: number }>());
  /** Check in right now; set up by the check-in loop further down. */
  const beatNow = useRef<() => void>(() => {});
  const player = useRef<Agent | null>(null);
  /**
   * Walkers' elements, by "out:id" / "room:id". A walker's element can
   * mount before its agent exists (the agent is made in an effect, after
   * the render that drew it), so a new agent picks its element up here.
   */
  const walkerEls = useRef(new Map<string, HTMLDivElement>());
  /** Hands a walker's element to its agent, so the loop can move it. */
  const bindAgent = useCallback(
    (where: "out" | "room" | "me", id: string) => (el: HTMLDivElement | null) => {
      const key = `${where}:${id}`;
      if (el) walkerEls.current.set(key, el);
      else walkerEls.current.delete(key);
      const a = where === "me" ? player.current : (where === "out" ? agents.current : roomAgents.current).get(id);
      if (a) a.el = el;
    },
    []
  );
  // I start at my own front door: everyone's is somewhere different.
  if (player.current == null) {
    const door = world.plots.find((p) => p.owner === me.id)?.door ?? { x: world.hall.door.x, y: world.hall.door.y + 1 };
    player.current = makeAgent(me.id, door.x, door.y + 1, PLAYER_SPEED);
  }

  // Outside: everyone about walks where their own screen has them, as in a
  // room — one village, so a position means the same thing to everyone.
  // Anyone not in the village stands still: at their table if they're
  // keeping a seat, otherwise by their own front door ("at home" in the app).
  useEffect(() => {
    const map = agents.current;
    const seen = new Set<string>();
    const make = (id: string, x: number, y: number) => {
      const a = makeAgent(id, x, y, PLAYER_SPEED);
      a.el = walkerEls.current.get(`out:${id}`) ?? null;
      map.set(id, a);
      return a;
    };
    for (const o of outdoorPeople) {
      const id = o.villager.id;
      seen.add(id);
      let a = map.get(id);
      const live = lastLive.current.get(id);
      const fresh = live && Date.now() - live.at < LIVE_FRESH_MS ? live : null;
      const at = fresh ? { x: fresh.x, y: fresh.y, facing: fresh.f } : o.pos;
      if (at) {
        if (!a) {
          a = make(id, 0, 0);
          follow(a, at.x, at.y, at.facing, true);
        } else if (!fresh) follow(a, at.x, at.y, at.facing);
        a.seat = null;
        a.stand = null;
        continue;
      }
      // Not in the village: put straight there — they didn't walk it.
      const seat = seating.get(id) ?? null;
      const door = plotOf.get(id)?.door;
      const spot = seat ?? (door ? { x: door.x, y: door.y + 1 } : { x: world.hall.door.x, y: world.hall.door.y + 2 });
      if (!a) a = make(id, spot.x, spot.y);
      a.goal = null;
      if (seat ? a.seat?.x !== seat.x || a.seat?.y !== seat.y : a.stand?.x !== spot.x || a.stand?.y !== spot.y) {
        a.path = [];
        a.x = spot.x * T + T / 2;
        a.y = spot.y * T + T / 2 + 8;
        a.dir = seat ? seat.face : 2;
        a.moving = false;
      }
      a.seat = seat;
      a.stand = seat ? null : spot;
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
  }, [outdoorPeople, seating, plotOf, world]);

  // Live positions are in the space they came from: a new scene starts afresh.
  const sceneKey = `${v}:${scene.kind === "room" ? `room:${scene.hostId}` : scene.kind}`;
  useEffect(() => {
    lastLive.current.clear();
  }, [sceneKey]);

  /**
   * In the library: whoever's keeping a seat at one of its desks without
   * being here — at home in the app, or away — sat at it. (Those who are
   * here walk about like anyone else.)
   */
  const deskSitters = useMemo(() => {
    const out: { villager: Villager; known: boolean; seat: { x: number; y: number; face: 0 | 1 | 2 | 3 } }[] = [];
    if (scene.kind !== "indoor" || scene.indoor.kind !== "library") return out;
    const desks = scene.indoor.desks;
    const here = new Set(roomPeople.map((p) => p.villager.id));
    livePulse.sessions
      .filter((s) => (s.village ?? 0) === v && s.spot === "library")
      .sort((a, b) => a.startedAt - b.startedAt)
      .forEach((s, i) => {
        const desk = desks[i % desks.length];
        s.members.forEach((m, j) => {
          if (m.villager.id === me.id || here.has(m.villager.id)) return;
          out.push({ villager: m.villager, known: m.known, seat: desk.seats[j % desk.seats.length] });
        });
      });
    return out;
  }, [scene, roomPeople, livePulse.sessions, v, me.id]);

  // In a room: everyone walks to where their own screen says they are.
  useEffect(() => {
    const map = roomAgents.current;
    if (scene.kind === "out") {
      map.clear();
      return;
    }
    const entry = exitOf(scene)!;
    const seen = new Set<string>();
    for (const p of roomPeople) {
      seen.add(p.villager.id);
      // Someone whose position is arriving live (they send it every few
      // seconds even standing still) is already where they should be; the
      // check-in's copy is older and would pull them back.
      const live = lastLive.current.get(p.villager.id);
      const fresh = live && Date.now() - live.at < LIVE_FRESH_MS ? live : null;
      // 0,0 is what the check-in says for "no position yet": a wall corner.
      const known = p.x !== 0 || p.y !== 0;
      let a = map.get(p.villager.id);
      if (!a) {
        a = makeAgent(p.villager.id, entry.x, entry.y - 1, PLAYER_SPEED);
        a.el = walkerEls.current.get(`room:${p.villager.id}`) ?? null;
        map.set(p.villager.id, a);
        if (fresh) {
          follow(a, fresh.x, fresh.y, fresh.f, true);
          a.guard = fresh.g;
        } else if (known) follow(a, p.x, p.y, p.facing, true);
        continue;
      }
      if (!fresh && known) follow(a, p.x, p.y, p.facing);
    }
    for (const d of deskSitters) {
      seen.add(d.villager.id);
      let a = map.get(d.villager.id);
      if (!a) {
        a = makeAgent(d.villager.id, d.seat.x, d.seat.y, PLAYER_SPEED);
        a.el = walkerEls.current.get(`room:${d.villager.id}`) ?? null;
        map.set(d.villager.id, a);
      }
      a.goal = null;
      a.seat = d.seat;
    }
    for (const id of [...map.keys()]) if (!seen.has(id)) map.delete(id);
  }, [roomPeople, deskSitters, scene]);

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
  const duelId = myDuel?.id;
  const mySide = !myDuel ? null : myDuel.a.id === me.id ? "a" : "b";

  // Fighters take their marks: challenger on the left, facing right. Once
  // per duel — the duel itself comes anew with every check-in and every
  // hit, and walking back to the mark each time would drag me there by
  // myself whenever I stood still mid-fight.
  const markedFor = useRef<string | null>(null);
  useEffect(() => {
    if (scene.kind !== "arena" || !fighting || !duelId || !mySide || markedFor.current === duelId) return;
    markedFor.current = duelId;
    const mine = scene.arena.spots[mySide];
    const p = player.current!;
    walkTo(scene.arena, p, mine.x, mine.y, () => {
      p.dir = mySide === "a" ? 3 : 1;
    });
  }, [scene, fighting, duelId, mySide]);

  /** Numbers over heads for a moment: a hit (−1), or a hit caught on a guard. */
  const flashHit = useCallback((id: string, blocked: boolean) => {
    const key = Date.now() + Math.random();
    setHits((h) => ({ ...h, [id]: { dmg: blocked ? 0 : 1, blocked, key } }));
    setTimeout(
      () =>
        setHits((h) => {
          if (h[id]?.key !== key) return h;
          const next = { ...h };
          delete next[id];
          return next;
        }),
      900
    );
  }, []);
  /** Plays someone's swing (engine.ts paint) — once, however many times it's reported. */
  const startSwing = useCallback(
    (id: string) => {
      swingNow(id === me.id ? player.current : (roomAgents.current.get(id) ?? agents.current.get(id)), performance.now());
    },
    [me.id]
  );

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

  /* ------------------------------------------------------------ live */

  // Pokes come in bursts — a move, then the round it settles — and one
  // check-in covers the lot.
  const pokeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pokeBeat = useCallback(() => {
    clearTimeout(pokeTimer.current);
    pokeTimer.current = setTimeout(() => beatNow.current(), 120);
  }, []);

  /** Set on every (re)connect and every room joined: send where I am even if I haven't moved. */
  const resendPos = useRef(false);

  /**
   * Whether friends see me through this device. Signed in on another that
   * got here first, they see me where that one has me (Pulse.elsewhere),
   * so this one keeps its steps to itself. Not until a check-in from here
   * says so: the page's first pulse is from before any.
   */
  const shownHere = useRef(false);
  const elsewhere = livePulse !== data.pulse && livePulse.elsewhere;
  useEffect(() => {
    if (livePulse === data.pulse) return;
    const was = shownHere.current;
    shownHere.current = !livePulse.elsewhere;
    // Just took over from the other device: say where I am straight away.
    if (shownHere.current && !was) resendPos.current = true;
  }, [livePulse, data.pulse]);
  /** At a table: kept while the village is hidden too. */
  const seatedRef = useRef(false);
  useEffect(() => {
    seatedRef.current = !!livePulse.mySessionId;
  }, [livePulse.mySessionId]);

  const live = useVillageLive(liveSpaceOf(place, v), {
    poke: pokeBeat,
    joined: () => {
      resendPos.current = true;
    },
    pos: ({ id, x, y, f, g }) => {
      const sc = sceneRef.current;
      const dir = (f % 4) as Agent["dir"];
      const prev = lastLive.current.get(id);
      const now = Date.now();
      lastLive.current.set(id, { x, y, f: dir, g, at: now });
      const a = (sc.kind === "out" ? agents.current : roomAgents.current).get(id);
      // Someone new: the check-in brings what they look like, and they're
      // placed from lastLive when it does. Asked once; the regular
      // check-ins carry on after that.
      if (!a) {
        if (!prev || now - prev.at > LIVE_FRESH_MS) pokeBeat();
        return;
      }
      follow(a, x, y, dir);
      a.guard = g;
      a.seat = null;
      a.stand = null;
    },
    swing: (by) => startSwing(by),
    blow: (b) => {
      startSwing(b.by);
      flashHit(b.target, b.t === "block");
      if (b.t === "hit") patchDuelHp(b.duel, b.a, b.b);
    },
  });
  const liveRef = useRef(false);
  const sendPosRef = useRef(live.sendPos);
  useEffect(() => {
    liveRef.current = live.connected;
    sendPosRef.current = live.sendPos;
  }, [live.connected, live.sendPos]);

  // The fight's clock, for the loop: when it starts (after the countdown)
  // and ends. Null when I'm not fighting.
  const startsAt = fighting ? myDuel!.startsAt : null;
  const endsAt = fighting ? myDuel!.endsAt : null;
  const fightRef = useRef<{ startsAt: number; endsAt: number } | null>(null);
  const skewRef = useRef(skew);
  useEffect(() => {
    fightRef.current = startsAt && endsAt ? { startsAt, endsAt } : null;
    skewRef.current = skew;
  }, [startsAt, endsAt, skew]);

  // Check in the moment the fight starts and the moment time runs out,
  // rather than waiting to be told.
  useEffect(() => {
    if (!duelId || !startsAt || !endsAt) return;
    const at = [startsAt, endsAt].map((t) =>
      setTimeout(() => beatNow.current(), Math.max(0, t - serverNow(skew) + 250))
    );
    return () => at.forEach(clearTimeout);
  }, [duelId, startsAt, endsAt, skew]);

  const opponentRef = useRef<string | null>(null);
  useEffect(() => {
    opponentRef.current = fighting && myDuel ? (myDuel.a.id === me.id ? myDuel.b.id : myDuel.a.id) : null;
  }, [fighting, myDuel, me.id]);

  /** H, or the Hit button: a swing, judged by the server. */
  const lastSwing = useRef(0);
  const swing = useCallback(() => {
    const f = fightRef.current;
    const now = serverNow(skewRef.current);
    if (!f || now < f.startsAt || now > f.endsAt || keys.current.has("guard")) return;
    if (performance.now() - lastSwing.current < HIT_COOLDOWN_MS) return;
    lastSwing.current = performance.now();
    // A swing goes all the way round. With a mouse I'm already facing where
    // I aim (the loop); without one, turn to face them for it.
    const p = player.current!;
    const them = opponentRef.current ? roomAgents.current.get(opponentRef.current) : null;
    if (them && !aimRef.current) p.dir = facingToward(them.x - p.x, them.y - p.y);
    startSwing(me.id);
    if (!liveRef.current) return toast("Reconnecting to the arena — hold on a second.");
    live.sendHit();
  }, [startSwing, me.id, live, toast]);
  const swingRef = useRef(swing);
  useEffect(() => {
    swingRef.current = swing;
  }, [swing]);

  /* ------------------------------------------------------------ talk */

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
  const placeRef = useRef<Place>({ kind: "house", hostId: data.me.id });
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
    let sentKey = "";
    let sentGuard = false;
    let sentAt = 0;
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const S = scaleRef.current;
      const g = gridRef.current;
      const sc = sceneRef.current;
      const p = player.current!;

      // A duel: the countdown walks me to my mark; then I'm free to move,
      // at half pace while guarding, but only inside the ring.
      const fight = fightRef.current;
      const countdown = !!fight && serverNow(skewRef.current) < fight.startsAt;
      const k = keys.current;
      p.guard = !!fight && !countdown && k.has("guard");
      const vx = (k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0);
      const vy = (k.has("down") ? 1 : 0) - (k.has("up") ? 1 : 0);
      if ((vx || vy) && !countdown) nudgePlayer(g, p, vx, vy, p.guard ? dt / 2 : dt);
      else step(g, p, dt);
      if (fight && !countdown && sc.kind === "arena") keepInRing(p, sc.arena.ring);
      // Facing the pointer, all the way round (the sprite shows the nearest of
      // its four ways): whenever I'm not walking somewhere — and in a fight,
      // always, so I can back off still facing them.
      const aim = aimRef.current;
      if (aim && (fight ? !countdown : !p.moving)) {
        const vp = viewport.current;
        const l = layer.current;
        if (vp && l) {
          const r = vp.getBoundingClientRect();
          const wx = (aim.x - r.left + Number(l.dataset.cx ?? 0)) / S;
          const wy = (aim.y - r.top + Number(l.dataset.cy ?? 0)) / S;
          // From the middle of the knight, not their feet.
          if (Math.hypot(wx - p.x, wy - (p.y - 24)) > 6) p.dir = facingToward(wx - p.x, wy - (p.y - 24));
        }
      }
      paint(p, S, t);

      // In a shared room, tell the others exactly where I am whenever I've
      // moved a pixel, turned or guarded — the same numbers the check-in
      // sends, just sooner. At most ~7 a second; the last one, where I
      // stopped, always goes, because the key stays changed until it's sent.
      // Raising or lowering a guard goes at once: a swing is judged by it.
      // Standing still, the same again every POS_HEARTBEAT_MS.
      if (liveRef.current && shownHere.current) {
        const key = `${Math.round(p.x)},${Math.round(p.y)},${p.dir},${p.guard}`;
        const changed = key !== sentKey || resendPos.current;
        const wait = p.guard !== sentGuard ? 0 : changed ? 140 : POS_HEARTBEAT_MS;
        if (t - sentAt >= wait) {
          resendPos.current = false;
          sentKey = key;
          sentGuard = p.guard;
          sentAt = t;
          const at = tilesOf(p);
          sendPosRef.current(at.x, at.y, at.facing, p.guard);
        }
      }
      const others = sc.kind === "out" ? agents.current : roomAgents.current;
      for (const a of others.values()) {
        step(g, a, dt);
        paint(a, S, t);
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
            if (d < 3) where = { kind: "house", hostId: pl.owner };
          }
          const dh = Math.hypot(tx - (world.hall.door.x + 0.5), ty - (world.hall.door.y + 0.5));
          if (inRect(world.hall.plaza, Math.floor(tx), Math.floor(ty)) || dh < 2) {
            where = { kind: "hall" };
            if (!best && dh < 2.5) best = { kind: "hall" };
          }
          const da = Math.hypot(tx - (world.arena.door.x + 0.5), ty - (world.arena.door.y + 0.5));
          if (!best && da < 1.7) best = { kind: "arena" };
          const ds = Math.hypot(tx - (world.station.door.x + 0.5), ty - (world.station.door.y + 0.5));
          if (!best && ds < 1.7) best = { kind: "station" };
          for (const l of world.landmarks) {
            if (best || !l.door || (l.kind !== "library" && l.kind !== "store")) continue;
            if (Math.hypot(tx - (l.door.x + 0.5), ty - (l.door.y + 0.5)) < 1.7) best = { kind: "indoor", what: l.kind };
          }
          if (placeKey(where) !== placeKey(placeRef.current)) {
            placeRef.current = where;
            setPlace(where);
          }
        } else {
          // Inside: the way out. Stepping onto it leaves.
          const exit = exitOf(sc)!;
          // The store's counter, or a library desk: stand by it.
          if (sc.kind === "indoor") {
            const c = sc.indoor.counter;
            if (c && ty >= c.y + 1 && ty < c.y + 2.6 && tx >= c.x - 0.5 && tx <= c.x + c.w + 0.5) best = { kind: "counter" };
            for (const d of sc.indoor.desks)
              if (!best && d.seats.some((st: { x: number; y: number }) => Math.hypot(tx - (st.x + 0.5), ty - (st.y + 0.5)) < 1.3)) best = { kind: "desk" };
          }
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

  // Where I am, as every check-in says it — this loop's, and any other on
  // the page (session-store.ts).
  const here = useCallback(
    () => ({ place: placeRef.current, pos: tilesOf(player.current!), village: vRef.current }),
    []
  );
  useEffect(() => {
    setVillageWhere(here);
    return () => setVillageWhere(null);
  }, [here]);

  const shownNudges = useRef(new Set<string>());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastPlace = "";
    let stopped = false;
    // One at a time: asked again while one's out, it goes once that's back,
    // from wherever I am by then.
    let busy = false;
    let again = false;
    const beat = async () => {
      if (stopped) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      clearTimeout(timer);
      try {
        if (document.visibilityState === "visible") {
          const at = here();
          const r = await checkIn(at.place, at.pos, at.village);
          lastPlace = placeKey(at.place);
          if (r?.focusXp) toast(`+${r.focusXp} XP for focus time`);
          for (const n of r?.nudges ?? []) {
            if (shownNudges.current.has(n.id)) continue;
            shownNudges.current.add(n.id);
            setToasts((t) => [...t, { id: n.id, nudge: true, text: `${n.fromName} nudged you: “${n.body}”${n.about ? ` (${n.about})` : ""}` }]);
          }
        } else if (seatedRef.current) keepSeat(); // working elsewhere: keep my place at the table
      } finally {
        busy = false;
      }
      if (stopped) return;
      if (again) {
        again = false;
        return void beat();
      }
      timer = setTimeout(
        beat,
        document.visibilityState !== "visible"
          ? APP_PULSE_MS
          : sceneRef.current.kind === "out"
            ? PULSE_MS
            : liveRef.current
              ? LIVE_ROOM_PULSE_MS
              : ROOM_PULSE_MS
      );
    };
    beatNow.current = () => void beat();
    void beat();
    // Moving somewhere new is worth telling people about straight away.
    const quick = setInterval(() => {
      if (placeKey(placeRef.current) !== lastPlace && document.visibilityState === "visible") void beat();
    }, 1000);
    const onVis = () => {
      if (document.visibilityState === "visible") return void beat();
      // Leaving the tab stops my live position, and soon everyone falls back
      // on my last check-in — so make that where I actually stopped.
      if (sceneRef.current.kind !== "out") {
        const at = here();
        void checkIn(at.place, at.pos, at.village);
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(quick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [toast, here]);

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

  /** Into this village's library or store, by its front door. */
  const enterIndoor = useCallback(
    (what: "library" | "store") => {
      const indoor = what === "library" ? buildLibrary() : buildStore();
      const door = world.landmarks.find((l) => l.kind === what)?.door;
      const p = player.current!;
      outsideAt.current = door ? { x: door.x, y: door.y + 1 } : null;
      p.path = [];
      p.x = indoor.door.x * T + T / 2;
      p.y = (indoor.door.y - 1) * T + T / 2 + 8;
      p.dir = 0;
      const next: Scene = { kind: "indoor", indoor };
      gridRef.current = indoor;
      sceneRef.current = next;
      enteredAt.current = performance.now();
      placeRef.current = { kind: what };
      setPlace(placeRef.current);
      setScene(next);
      setOpen(null);
      beatNow.current();
    },
    [world]
  );

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
      else if (p.kind === "station") setOpen({ kind: "train" });
      else if (p.kind === "indoor") enterIndoor(p.what);
      else if (p.kind === "counter") setOpen({ kind: "shop" });
      else if (p.kind === "desk") setOpen({ kind: "desks" });
      else if (p.kind === "leave") leave();
      else void enterHouse(p.id);
    },
    [enterArena, enterHouse, enterIndoor, leave]
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
      // A shortcut (⌘A, Ctrl+S…) isn't a step — and on a Mac the letter's
      // release never arrives while ⌘ is down, which left me walking.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = map[e.code];
      if (dir) {
        e.preventDefault();
        keys.current.add(dir);
      } else if (e.code === "KeyG") {
        // Guard while held (duels).
        keys.current.add("guard");
      } else if (e.code === "KeyH") {
        // A swing (duels). Holding the key doesn't repeat it.
        if (!e.repeat) swingRef.current();
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
      else if (e.code === "KeyG") keys.current.delete("guard");
      // Any key let go under ⌘ never said so (above): start clean.
      else if (e.key === "Meta") keys.current.clear();
    };
    const blur = () => keys.current.clear();
    const hidden = () => document.visibilityState === "hidden" && keys.current.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("visibilitychange", hidden);
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
    // In a duel: still during the countdown; after that, taps walk you about
    // the ring like the keys do (the loop keeps you inside it).
    const fight = fightRef.current;
    if (fight && serverNow(skewRef.current) < fight.startsAt) return;
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

  /** Someone's village, if it isn't this one: their house is a train ride away. */
  function awayIn(id: string): string | null {
    const r = residentOf.get(id);
    return r && villageOf(r.plot) !== v ? villageInfo(villageOf(r.plot)).name : null;
  }

  function visitHouse(id: string) {
    const away = awayIn(id);
    const r = residentOf.get(id);
    if (away) return toast(`${r ? `${r.name}'s` : "Their"} house is in ${away}. Take the train from the station.`);
    const plot = plotOf.get(id);
    if (!plot) return;
    // Anyone's house can be seen; only companions go in (village-actions, loadInterior).
    if (r && !r.known) return toast(`That's ${r.name}'s house. Only their companions go in.`);
    walkTo(world, player.current!, plot.door.x, plot.door.y, () => void enterHouse(id));
  }

  /* ---------------------------------------------------------- moving */

  const [moving, setMoving] = useState(false);
  async function moveTo(plot: number) {
    const r = await moveHouse(plot).catch(() => ({ ok: false as const, error: "Couldn't move just now." }));
    if (!r.ok) return toast(r.error);
    setMoving(false);
    const all = await loadResidents().catch(() => null);
    if (all) setResidents(all);
    toast("Moved in. Your rooms came with you.");
  }

  function goToHall() {
    if (scene.kind !== "out") return setOpen({ kind: "hall" });
    walkTo(world, player.current!, world.hall.door.x, world.hall.door.y + 1, () => setOpen({ kind: "hall" }));
  }

  function goToArena() {
    walkTo(world, player.current!, world.arena.door.x, world.arena.door.y, () => enterArena());
  }

  /** Walk to the store's or library's door, then in. */
  function goInto(what: "store" | "library") {
    const door = world.landmarks.find((l) => l.kind === what)?.door;
    if (door) walkTo(world, player.current!, door.x, door.y, () => enterIndoor(what));
  }

  function goToStation() {
    walkTo(world, player.current!, world.station.door.x, world.station.door.y, () => setOpen({ kind: "train" }));
  }

  /* ---------------------------------------------------------- trains */

  // Aboard, on the way to village `ride`; arriving puts me on its platform.
  const [ride, setRide] = useState<number | null>(null);
  function board(to: number) {
    setOpen(null);
    if (to !== v) setRide(to);
  }
  const arrive = useCallback(() => {
    if (ride == null) return;
    // Every village's station is in the same place (world.ts).
    const door = world.station.door;
    const p = player.current!;
    p.path = [];
    p.goal = null;
    p.x = door.x * T + T / 2;
    p.y = door.y * T + T / 2 + 8;
    p.dir = 0;
    vRef.current = ride;
    setV(ride);
    setRide(null);
    placeRef.current = { kind: "square" };
    setPlace(placeRef.current);
    beatNow.current();
  }, [ride, world]);

  /* ------------------------------------------------------------- words */

  const statusOfId = (id: string) => statusOf(livePulse.presence[id], now);

  /** Their status, and where they are in it. */
  function whereIs(id: string): string {
    const status = statusOfId(id);
    const label = STATUS_LABEL[status];
    // Out of the village, a seat at a table is kept for them.
    const seat = seating.has(id) ? " · keeping their seat at the town hall" : "";
    if (status === "offline") {
      if (seat) return label + seat;
      const seen = livePulse.presence[id]?.seenAt;
      if (!seen) return `${label} · hasn't been to the village yet`;
      const mins = Math.round((now - seen) / 60000);
      return mins < 60 ? `${label} · here ${mins} min ago` : mins < 1440 ? `${label} · here ${Math.round(mins / 60)} h ago` : label;
    }
    if (status === "home") return label + seat;
    const { place: p, village } = livePulse.presence[id]!;
    // In a village: which one, by name.
    const named = `In ${villageInfo(village ?? 0).name}`;
    if (seating.has(id)) return `${named} · working at the town hall`;
    const whose = (host: string) => (host === me.id ? "your" : host === id ? "their" : `${byId.get(host)?.name ?? "someone"}'s`);
    if (p.kind === "hall") return `${named} · at the town hall`;
    if (p.kind === "arena") return `${named} · in the arena`;
    if (p.kind === "library") return `${named} · in the library`;
    if (p.kind === "store") return `${named} · in the store`;
    if (p.kind === "inside") return `${named} · inside ${whose(p.hostId)} house`;
    if (p.kind === "house") return `${named} · ${p.hostId === id ? "outside their house" : `at ${whose(p.hostId)} house`}`;
    return `${named} · out on the square`;
  }

  const S = scale;
  const promptLabel = (() => {
    if (!prompt) return null;
    switch (prompt.kind) {
      case "hall":
        return "Enter the town hall";
      case "station":
        return "Take the train";
      case "arena":
        return "Enter the arena";
      case "indoor":
        return prompt.what === "library" ? "Go into the library" : "Go into the store";
      case "counter":
        return "Browse the store";
      case "desk":
        return "Study at the desks";
      case "leave":
        return scene.kind === "arena" ? "Leave the arena" : "Go outside";
      case "house":
        return prompt.id === me.id ? "Go inside" : `Go into ${byId.get(prompt.id)?.name ?? ""}'s house`;
    }
  })();
  /** Companions in the village itself; "at home" ones are in the app elsewhere. */
  const onlineCount = neighbours.filter((n) => statusOfId(n.id) === "village").length;
  const unreadNotes = data.notes.filter((n) => !n.read).length;
  /** Anyone in the village or the app now: their chimneys smoke. */
  const about = useMemo(
    () => new Set([...(livePulse.outdoors ?? []).map((o) => o.villager.id), ...neighbours.filter((n) => online(n.id)).map((n) => n.id)]),
    [livePulse.outdoors, neighbours, online]
  );
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
          // A mouse (or pen) over the village is where I'm looking; a finger
          // only says where to walk.
          if (e.pointerType !== "touch") aimRef.current = { x: e.clientX, y: e.clientY };
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
              residentOf={residentOf}
              meId={me.id}
              seating={seating}
              about={about}
              insideCount={insideCount}
              mySession={!!livePulse.mySessionId}
              sessionsCount={livePulse.sessions.length}
              unreadNotes={unreadNotes}
              moving={moving}
              onHouse={visitHouse}
              onHall={goToHall}
              onArena={goToArena}
              onLot={(n) => void moveTo(n)}
              onEnter={goInto}
              onStation={goToStation}
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
          {scene.kind === "indoor" &&
            (scene.indoor.kind === "library" ? <LibraryView scene={scene.indoor} scale={S} /> : <StoreView scene={scene.indoor} scale={S} />)}

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
            ? outdoorPeople.map(({ villager: v, known, place: at }) => (
                <Walker
                  key={v.id}
                  sheet={sheets[v.id]}
                  scale={S}
                  label={v.name}
                  stranger={!known}
                  bubble={space === "hall" && at.kind === "hall" ? bubbles[v.id] : undefined}
                  bind={bindAgent("out", v.id)}
                  onTap={
                    known && byId.has(v.id)
                      ? () => setOpen({ kind: "house", id: v.id })
                      : seating.has(v.id)
                        ? () => setOpen({ kind: "hall" })
                        : undefined
                  }
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
                  attack={scene.kind === "arena" ? attacks[p.villager.id] : undefined}
                  bind={bindAgent("room", p.villager.id)}
                  onTap={
                    p.known
                      ? () => setOpen(scene.kind === "arena" ? { kind: "duelist", id: p.villager.id } : { kind: "house", id: p.villager.id })
                      : undefined
                  }
                />
              ))}
          {scene.kind !== "out" &&
            deskSitters.map((d) => (
              <Walker
                key={d.villager.id}
                sheet={sheets[d.villager.id]}
                scale={S}
                label={d.villager.name}
                stranger={!d.known}
                bind={bindAgent("room", d.villager.id)}
                onTap={() => setOpen({ kind: "desks" })}
              />
            ))}
          <Walker
            sheet={sheets[me.id]}
            scale={S}
            label={null}
            bubble={space ? bubbles[me.id] : undefined}
            bar={bars[me.id]}
            hit={hits[me.id]}
            attack={scene.kind === "arena" ? attacks[me.id] : undefined}
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
            {scene.kind === "out"
              ? world.name
              : scene.kind === "arena"
                ? `${world.name} arena`
                : scene.kind === "indoor"
                  ? `${world.name} ${scene.indoor.kind === "library" ? "library" : "store"}`
                  : `${hostName} ${roomTier}`}
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
              <button onClick={goToStation} className="panel rounded-lg px-3 py-1.5 text-xs font-semibold text-mud-700 hover:text-grass-700">
                Station
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
            live={live.connected}
            onHit={swing}
            onGuard={(on) => (on ? keys.current.add("guard") : keys.current.delete("guard"))}
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
            others={scene.kind === "out" ? outdoorPeople.filter((o) => o.known && o.place.kind === "hall").length : roomPeople.length}
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

      {ride != null && <TrainRide to={villageInfo(ride).name} onDone={arrive} />}

      {(toasts.length > 0 || elsewhere || moving) && (
        <div className="absolute inset-x-0 top-14 z-[70000] flex flex-col items-center gap-2 px-3">
          {moving && (
            <div role="status" className="panel flex max-w-md items-center gap-3 rounded-xl px-3 py-2 text-sm text-mud-800 shadow-lg">
              <span className="min-w-0 flex-1">Pick an empty lot to move your house to.</span>
              <button onClick={() => setMoving(false)} className="shrink-0 rounded-md bg-mud-100 px-2 py-1 text-xs font-semibold text-mud-700">
                Cancel
              </button>
            </div>
          )}
          {elsewhere && (
            <p role="status" className="panel max-w-md rounded-xl px-3 py-2 text-center text-xs text-mud-700 shadow-lg">
              You&apos;re in the app on another device too. Your companions see you where that one has you until it&apos;s
              closed.
            </p>
          )}
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
        <MyHousePanel
          me={me}
          notes={data.notes}
          onLook={(look) => {
            setMe((m) => ({ ...m, house: look }));
            setResidents((rs) => rs.map((r) => (r.id === me.id ? { ...r, house: look } : r)));
          }}
          onMove={() => {
            // The lots are outside: step out to choose one.
            setOpen(null);
            if (sceneRef.current.kind !== "out") leave();
            setMoving(true);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {!deco && open?.kind === "hall" && <HallPanel sessions={livePulse.sessions} sheets={sheets} me={me} onClose={() => setOpen(null)} />}
      {!deco && open?.kind === "people" && (
        <PeoplePanel
          people={neighbours.map((n) => ({ n, status: statusOfId(n.id), where: whereIs(n.id) }))}
          sheets={sheets}
          onGo={(id) => {
            setOpen(null);
            const p = livePulse.presence[id]?.place;
            // About in another village: that's a train ride.
            const theirs = livePulse.presence[id]?.village ?? 0;
            if (statusOfId(id) === "village" && theirs !== v) {
              toast(`${byId.get(id)?.name ?? "They"} ${byId.get(id) ? "is" : "are"} in ${villageInfo(theirs).name}. Take the train from the station.`);
              return goToStation();
            }
            // Out in this village: walk to where they're standing.
            const there = agents.current.get(id);
            if (scene.kind === "out" && there && statusOfId(id) === "village" && p && p.kind !== "inside" && p.kind !== "arena")
              walkTo(world, player.current!, Math.floor(there.x / T), Math.floor((there.y - 8) / T));
            else if (seating.has(id)) goToHall();
            else if (online(id) && p?.kind === "arena") goToArena();
            else if (online(id) && p?.kind === "inside") visitHouse(p.hostId);
            else visitHouse(id);
          }}
          onClose={() => setOpen(null)}
        />
      )}
      {!deco && open?.kind === "train" && (
        <Panel title={`${world.name} station`} sub="Trains to every village, whenever you like" onClose={() => setOpen(null)}>
          <ul className="space-y-1.5">
            {Array.from({ length: villages }, (_, n) => {
              const info = villageInfo(n);
              const houses = residents.filter((r) => villageOf(r.plot) === n);
              const friends = houses.filter((r) => r.known && r.id !== me.id).length;
              const mine = houses.some((r) => r.id === me.id);
              return (
                <li key={n}>
                  <button
                    disabled={n === v}
                    onClick={() => board(n)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ring-mud-200 hover:bg-mud-100 disabled:bg-grass-100/60 disabled:ring-grass-300"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-mud-900">
                        {info.name}
                        {mine && <span className="ml-1.5 text-xs font-normal text-mud-500">· your house</span>}
                      </span>
                      <span className="block text-xs text-mud-500">
                        {info.theme[0].toUpperCase() + info.theme.slice(1)} · {houses.length} of {PLOTS_PER_VILLAGE} houses
                        {friends ? ` · ${friends} companion${friends === 1 ? "" : "s"}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-grass-700">{n === v ? "You're here" : "Board ›"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-mud-500">A new village opens when the last one fills up.</p>
        </Panel>
      )}
      {!deco && open?.kind === "shop" && <ShopPanel onClose={() => setOpen(null)} />}
      {!deco && open?.kind === "desks" && (
        <HallPanel sessions={livePulse.sessions} sheets={sheets} me={me} spot="library" onClose={() => setOpen(null)} />
      )}
      {!deco && open?.kind === "duelist" && byId.get(open.id) && (
        <DuelistCard
          n={byId.get(open.id)!}
          // One duel at a time in the arena: a fight going on, or my own
          // challenge waiting, closes it.
          busy={livePulse.duels.some((d) => d.status === "active") || myDuel?.status === "pending"}
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

/* ------------------------------------------------------------ outdoors */

function Outdoors({
  world,
  S,
  residentOf,
  meId,
  seating,
  about,
  insideCount,
  mySession,
  sessionsCount,
  unreadNotes,
  moving,
  onHouse,
  onHall,
  onArena,
  onLot,
  onEnter,
  onStation,
}: {
  world: World;
  S: number;
  residentOf: Map<string, Resident>;
  meId: string;
  seating: Map<string, unknown>;
  /** Who's in the village or the app right now: their chimneys smoke. */
  about: Set<string>;
  insideCount: Map<string, number>;
  mySession: boolean;
  sessionsCount: number;
  unreadNotes: number;
  /** Choosing a lot to move my house to: the empty ones can be picked. */
  moving: boolean;
  onHouse: (id: string) => void;
  onHall: () => void;
  onArena: () => void;
  onLot: (plot: number) => void;
  /** Walk into the store or the library. */
  onEnter: (what: "store" | "library") => void;
  onStation: () => void;
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
              filter: TREE_TINT[world.theme],
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

      {/* Landmarks: the store, the library, the bakery, parks and gardens */}
      {world.landmarks.map((l, i) => {
        const at = (r: { x: number; y: number; w: number; h: number }, z: number) => ({
          left: r.x * T * S,
          top: r.y * T * S,
          width: r.w * T * S,
          height: r.h * T * S,
          zIndex: z,
        });
        if (l.kind === "park" || l.kind === "garden")
          return (
            <div key={i}>
              <div aria-hidden className="pointer-events-none absolute" style={at(l.area, 1)}>
                {l.kind === "park" ? <ParkGround /> : <GardenGround />}
              </div>
              {/* The fountain or well stands up off the ground, sorted with the walkers. */}
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: l.body.x * T * S,
                  top: (l.body.y * T - 24) * S,
                  width: l.body.w * T * S,
                  height: 56 * S,
                  zIndex: (l.body.y + 1) * T,
                }}
              >
                {l.kind === "park" ? <Fountain /> : <Well />}
              </div>
            </div>
          );
        const Building = l.kind === "store" ? Store : l.kind === "library" ? Library : Bakery;
        const what = l.kind === "store" || l.kind === "library" ? l.kind : null;
        return what ? (
          <button
            key={i}
            onPointerDown={(e) => {
              e.stopPropagation();
              onEnter(what);
            }}
            aria-label={what === "store" ? "Go into the general store" : "Go into the library"}
            className="absolute"
            style={at(l.body, (l.body.y + l.body.h) * T)}
          >
            <Building />
          </button>
        ) : (
          <div key={i} aria-hidden className="pointer-events-none absolute" style={at(l.body, (l.body.y + l.body.h) * T)}>
            <Building />
          </div>
        );
      })}

      {/* Hedges round the shops and the arena, sorted with the walkers */}
      {world.hedges.map((h) => (
        <div
          key={`hedge-${h.x}-${h.y}`}
          aria-hidden
          className="pointer-events-none absolute"
          style={{ left: h.x * T * S, top: (h.y * T - 8) * S, width: T * S, height: 40 * S, zIndex: (h.y + 1) * T, filter: TREE_TINT[world.theme] }}
        >
          <Hedge />
        </div>
      ))}

      {/* The station, at the foot of the road */}
      <button
        onPointerDown={(e) => {
          e.stopPropagation();
          onStation();
        }}
        aria-label={`${world.name} station`}
        className="absolute"
        style={{
          left: world.station.body.x * T * S,
          top: world.station.body.y * T * S,
          width: world.station.body.w * T * S,
          height: world.station.body.h * T * S,
          zIndex: (world.station.body.y + world.station.body.h) * T,
        }}
      >
        <Station name={world.name} />
      </button>

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

      {/* Empty lots, while I'm choosing where to move */}
      {moving &&
        world.plots.map((p) =>
          p.owner ? null : (
            <button
              key={`lot-${p.n}`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onLot(p.n);
              }}
              aria-label="Move here"
              className="absolute grid place-items-center rounded-lg border-4 border-dashed border-white/90 bg-white/20 font-display text-sm font-bold text-white drop-shadow hover:bg-white/35"
              style={{ left: p.x * T * S, top: p.y * T * S, width: 8 * T * S, height: 7 * T * S, zIndex: 60000 }}
            >
              Move here
            </button>
          )
        )}

      {/* Empty lots: a signpost where a house's name would be */}
      {world.plots.map((p) =>
        p.owner ? null : (
          <div
            key={`sign-${p.n}`}
            aria-hidden
            className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-full flex-col items-center"
            style={{ left: (p.x + 0.5) * T * S, top: (p.y + 7) * T * S - 4 * S, zIndex: (p.y + 7) * T }}
          >
            <div className="rounded-[3px] border-2 border-[#5a3e28] bg-[#d8bb8a] px-1.5 py-0.5 text-center leading-tight shadow-[0_2px_0_#5a3e28]">
              <p className="whitespace-nowrap font-display text-[10px] font-bold text-[#5a3e28]">Empty lot</p>
            </div>
            <div className="bg-[#6b4a2b]" style={{ width: 3 * S, height: 12 * S }} />
          </div>
        )
      )}

      {/* Houses, each with a signpost: everyone's, friends or not */}
      {world.plots.map((p) => {
        if (!p.owner) return null;
        const n = residentOf.get(p.owner);
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
              aria-label={isMe ? "Go into your house" : n.known ? `Go into ${n.name}'s house` : `${n.name}'s house`}
              className="absolute [&>svg]:h-full [&>svg]:w-full"
              style={{ left: p.x * T * S, top: p.y * T * S, width: 8 * T * S, height: 7 * T * S, zIndex: (p.y + 6) * T }}
            >
              <House
                tier={tier.tier}
                look={n.house}
                bloom={bloomFor(n.streak)}
                lit={seating.has(n.id) || (isMe && mySession) || inside > 0}
                smoke={isMe || about.has(n.id)}
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
        {busy ? "The arena's in use — one duel at a time" : sending ? "Challenging…" : `⚔ Challenge ${n.name}`}
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
  attack,
  bind,
  onTap,
}: {
  sheet: string | undefined;
  scale: number;
  label: string | null;
  stranger?: boolean;
  bubble?: string;
  bar?: { hp: number; max: number };
  hit?: { dmg: number; blocked?: boolean; key: number };
  /** Their duel animation, in the arena: shown instead of walking while they swing or guard. */
  attack?: AttackSheet;
  bind: (el: HTMLDivElement | null) => void;
  onTap?: () => void;
}) {
  return (
    <div
      ref={bind}
      className="absolute left-0 top-0"
      // Hidden until the loop first places it (engine.ts paint).
      style={{ width: 64 * scale, height: 64 * scale, willChange: "transform", visibility: "hidden" }}
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
      {/* The duel sheet: bigger frames for long blades, centred on the
          knight. Shown by the loop (engine.ts paint) while swinging or
          guarding; always second, which is how paint finds it. */}
      <div
        className={hit && hit.dmg > 0 ? "walker-hit" : undefined}
        key={`a${hit?.key ?? ""}`}
        data-cols={attack?.cols ?? 0}
        data-frame={attack?.frame ?? 64}
        aria-hidden
        style={{
          position: "absolute",
          left: (-((attack?.frame ?? 64) - 64) / 2) * scale,
          top: (-((attack?.frame ?? 64) - 64) / 2) * scale,
          width: (attack?.frame ?? 64) * scale,
          height: (attack?.frame ?? 64) * scale,
          backgroundImage: attack ? `url(${attack.url})` : undefined,
          backgroundSize: attack ? `${attack.cols * attack.frame * scale}px ${4 * attack.frame * scale}px` : undefined,
          imageRendering: "pixelated",
          pointerEvents: "none",
          visibility: "hidden",
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
        {hit?.blocked && (
          <span key={hit.key} className="damage-pop text-xs font-black text-sky-700 drop-shadow-[0_1px_0_white]">
            Blocked!
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
