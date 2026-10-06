"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/village/panels";
import { isPlanet, PLANET_LOOKS, PLOTS_PER_VILLAGE, villageInfo, villageOf, type PlanetLook } from "@/components/village/world";
import {
  answerPlanetInvite,
  cancelPlanetInvite,
  closePlanet,
  createPlanet,
  inviteToPlanet,
  joinPlanetByCode,
  leavePlanet,
  loadPlanets,
  newPlanetCode,
  removeFromPlanet,
  updatePlanet,
} from "@/lib/planet-actions";
import { MAX_MEMBERS, MAX_OWNED, PLANET_NAME_MAX, showCode, type Planets, type PlanetView } from "@/lib/planets";
import type { Resident } from "@/lib/village";

/* --------------------------------------------------------------------------
   The station: trains to every village, and rockets to the planets I'm on
   (src/lib/planets.ts). The rockets side is also where invitations are
   answered, codes are typed in, and planets are founded and looked after.
   -------------------------------------------------------------------------- */

const BTN =
  "rounded-lg border border-mud-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-mud-700 transition hover:border-grass-500 hover:text-grass-700 disabled:opacity-50";
const PRIMARY =
  "rounded-lg bg-grass-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-grass-500 disabled:opacity-50";
const DANGER =
  "rounded-lg border border-red-300 bg-white/80 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50";
const INPUT = "min-w-0 flex-1 rounded-lg border border-mud-300 bg-white px-2.5 py-1.5 text-sm text-mud-900 focus:border-grass-500 focus:outline-none";
const HEAD = "mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-mud-400";

type Done = Awaited<ReturnType<typeof createPlanet>>;

const swatchOf = (look: PlanetLook) => PLANET_LOOKS.find((l) => l.look === look)?.swatch ?? "#888";

function Swatch({ look, size = 28 }: { look: PlanetLook; size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full ring-1 ring-black/20"
      style={{ width: size, height: size, background: `radial-gradient(circle at 35% 30%, #ffffff66, ${swatchOf(look)} 50%, #00000066)` }}
    />
  );
}

function LookPicker({ look, onPick }: { look: PlanetLook; onPick: (l: PlanetLook) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PLANET_LOOKS.map((l) => (
        <button
          key={l.look}
          type="button"
          onClick={() => onPick(l.look)}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition ${look === l.look ? "bg-grass-100 text-grass-700 ring-1 ring-grass-300" : "bg-mud-100 text-mud-700"}`}
        >
          <Swatch look={l.look} size={14} />
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** A button that asks again before it does anything it can't take back. */
function Sure({ label, again, busy, onSure }: { label: string; again: string; busy: boolean; onSure: () => void }) {
  const [asked, setAsked] = useState(false);
  return asked ? (
    <span className="flex flex-wrap items-center gap-1.5">
      <button className={DANGER} disabled={busy} onClick={onSure}>
        {again}
      </button>
      <button className={BTN} onClick={() => setAsked(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button className={DANGER} onClick={() => setAsked(true)}>
      {label}
    </button>
  );
}

export default function StationPanel({
  v,
  name,
  villages,
  residents,
  meId,
  planets,
  friends,
  onPlanets,
  onBoard,
  onClose,
}: {
  /** Where I am now. */
  v: number;
  /** This station's village or planet. */
  name: string;
  /** How many public villages there are. */
  villages: number;
  residents: Resident[];
  meId: string;
  planets: Planets;
  /** My companions: whoever I can invite to a planet of mine. */
  friends: { id: string; name: string }[];
  /** The planets have changed (I joined one, left one, changed one…). */
  onPlanets: (p: Planets) => void;
  onBoard: (to: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"trains" | "rockets">(isPlanet(v) || planets.invites.length ? "rockets" : "trains");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<{ name: string; look: PlanetLook }>({ name: "", look: PLANET_LOOKS[0].look });

  // What the page has could be a while old: invitations come in any time.
  useEffect(() => {
    void loadPlanets()
      .then(onPlanets)
      .catch(() => {});
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Runs a change at the station; what it says if it worked, or why not. */
  async function run(act: () => Promise<Done>, done?: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNote(null);
    const r = await act().catch((): Done => ({ ok: false, error: "Couldn't reach the station just now. Try again." }));
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    onPlanets(r.planets);
    if (done) setNote(done);
    return true;
  }

  const owned = planets.planets.filter((p) => p.owner.id === meId).length;
  const onPlanet = isPlanet(v);

  return (
    <Panel title={`${name} station`} sub={onPlanet ? "Rockets back to the villages, and to your other planets" : "Trains to every village, rockets to your planets"} onClose={onClose}>
      <div className="mb-3 flex gap-1 rounded-lg bg-mud-100 p-1 text-xs font-semibold">
        {(["trains", "rockets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative flex-1 rounded-md px-2 py-1 transition ${tab === t ? "bg-white text-mud-900 shadow-sm" : "text-mud-500"}`}
          >
            {t === "trains" ? "Trains" : "Rockets"}
            {t === "rockets" && planets.invites.length > 0 && (
              <span className="ml-1.5 inline-grid size-4 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white">{planets.invites.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "trains" ? (
        <>
          <ul className="space-y-1.5">
            {Array.from({ length: villages }, (_, n) => {
              const info = villageInfo(n);
              const houses = residents.filter((r) => villageOf(r.plot) === n);
              const companions = houses.filter((r) => r.known && r.id !== meId).length;
              const mine = houses.some((r) => r.id === meId);
              return (
                <li key={n}>
                  <button
                    disabled={n === v}
                    onClick={() => onBoard(n)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ring-mud-200 hover:bg-mud-100 disabled:bg-grass-100/60 disabled:ring-grass-300"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-mud-900">
                        {info.name}
                        {mine && <span className="ml-1.5 text-xs font-normal text-mud-500">· your house</span>}
                      </span>
                      <span className="block text-xs text-mud-500">
                        {info.theme[0].toUpperCase() + info.theme.slice(1)} · {houses.length} of {PLOTS_PER_VILLAGE} houses
                        {companions ? ` · ${companions} companion${companions === 1 ? "" : "s"}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-grass-700">{n === v ? "You're here" : onPlanet ? "Fly back ›" : "Board ›"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-mud-500">
            {onPlanet ? "There are no rails out here: the way back to the villages is by rocket." : "A new village opens when the last one fills up."}
          </p>
        </>
      ) : (
        <div className="space-y-4">
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200">{error}</p>}
          {note && <p className="rounded-lg bg-grass-100/60 px-3 py-2 text-xs text-grass-800 ring-1 ring-grass-300">{note}</p>}

          {planets.invites.length > 0 && (
            <section>
              <p className={HEAD}>Invitations</p>
              <ul className="space-y-2">
                {planets.invites.map((i) => (
                  <li key={i.planetId} className="rounded-xl bg-mud-100 p-3 ring-1 ring-mud-200">
                    <div className="flex items-center gap-2.5">
                      <Swatch look={i.look} />
                      <p className="min-w-0 flex-1 text-sm text-mud-800">
                        <span className="font-semibold">{i.from}</span> invited you to <span className="font-semibold">{i.name}</span>
                        <span className="block text-xs text-mud-500">
                          {i.members} on it · a house of your own there
                        </span>
                      </p>
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      <button
                        className={PRIMARY}
                        disabled={busy}
                        onClick={() => void run(() => answerPlanetInvite(i.planetId, true), `You're on ${i.name}, with a house of your own. Launch when you're ready.`)}
                      >
                        Join
                      </button>
                      <button className={BTN} disabled={busy} onClick={() => void run(() => answerPlanetInvite(i.planetId, false))}>
                        No thanks
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <p className={HEAD}>Your planets</p>
            {planets.planets.length === 0 ? (
              <p className="text-sm text-mud-500">
                You&apos;re not on any planet yet. Planets are private: get invited by a companion, or type in a code someone gave you.
              </p>
            ) : (
              <ul className="space-y-2">
                {planets.planets.map((p) => (
                  <PlanetRow
                    key={p.id}
                    p={p}
                    here={p.v === v}
                    mine={p.owner.id === meId}
                    meId={meId}
                    friends={friends}
                    open={opened === p.id}
                    busy={busy}
                    onToggle={() => setOpened(opened === p.id ? null : p.id)}
                    onLaunch={() => onBoard(p.v)}
                    run={run}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <p className={HEAD}>Join with a code</p>
            <form
              className="flex gap-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => joinPlanetByCode(code), "You're on it, with a house of your own. Launch when you're ready.")) setCode("");
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCD-2345"
                aria-label="Planet code"
                maxLength={12}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className={`${INPUT} font-mono uppercase tracking-wider`}
              />
              <button className={PRIMARY} disabled={busy || !code.trim()}>
                Join
              </button>
            </form>
          </section>

          {planets.canFound && owned < MAX_OWNED && (
            <section>
              <p className={HEAD}>Found a planet</p>
              <form
                className="space-y-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const named = found.name.trim();
                  if (await run(() => createPlanet(named, found.look), `${named} is yours. Invite companions, or share its code.`))
                    setFound({ name: "", look: PLANET_LOOKS[0].look });
                }}
              >
                <input
                  value={found.name}
                  onChange={(e) => setFound({ ...found, name: e.target.value })}
                  placeholder="Its name"
                  aria-label="Planet name"
                  maxLength={PLANET_NAME_MAX}
                  className={`${INPUT} w-full`}
                />
                <LookPicker look={found.look} onPick={(look) => setFound({ ...found, look })} />
                <button className={PRIMARY} disabled={busy || !found.name.trim()}>
                  Found it
                </button>
                <p className="text-xs text-mud-500">
                  A private world for up to {MAX_MEMBERS}, each with a house of their own there. You can found {MAX_OWNED - owned} more.
                </p>
              </form>
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}

function PlanetRow({
  p,
  here,
  mine,
  meId,
  friends,
  open,
  busy,
  onToggle,
  onLaunch,
  run,
}: {
  p: PlanetView;
  here: boolean;
  mine: boolean;
  meId: string;
  friends: { id: string; name: string }[];
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onLaunch: () => void;
  run: (act: () => Promise<Done>, done?: string) => Promise<boolean>;
}) {
  const [edit, setEdit] = useState({ name: p.name, look: p.look });
  const [invitee, setInvitee] = useState("");
  const [copied, setCopied] = useState(false);
  const askable = friends.filter((f) => !p.members.some((m) => m.id === f.id) && !p.invited.some((i) => i.id === f.id));

  return (
    <li className={`rounded-xl p-3 ring-1 ${here ? "bg-grass-100/60 ring-grass-300" : "bg-mud-100 ring-mud-200"}`}>
      <div className="flex items-center gap-2.5">
        <Swatch look={p.look} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-mud-900">{p.name}</p>
          <p className="truncate text-xs text-mud-500">
            {mine ? "Yours" : `${p.owner.name}'s`} · {p.members.length} of {MAX_MEMBERS} on it
          </p>
        </div>
        <button className={PRIMARY} disabled={here} onClick={onLaunch}>
          {here ? "You're here" : "Launch ›"}
        </button>
      </div>
      <button onClick={onToggle} aria-expanded={open} className="mt-1.5 text-xs font-semibold text-grass-700 hover:text-grass-600">
        {open ? "Hide" : mine ? "Look after it" : "Who's on it"}
      </button>

      {open && (
        <div className="mt-2 space-y-3 border-t border-mud-200 pt-3">
          {mine && (
            <>
              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => updatePlanet(p.id, edit.name, edit.look), "Saved.");
                }}
              >
                <p className={HEAD}>Name and look</p>
                <input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                  aria-label="Planet name"
                  maxLength={PLANET_NAME_MAX}
                  className={`${INPUT} w-full`}
                />
                <LookPicker look={edit.look} onPick={(look) => setEdit({ ...edit, look })} />
                <button className={BTN} disabled={busy || !edit.name.trim() || (edit.name.trim() === p.name && edit.look === p.look)}>
                  Save
                </button>
              </form>

              {p.code && (
                <div>
                  <p className={HEAD}>Its code</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold tracking-wider text-mud-900 ring-1 ring-mud-300">
                      {showCode(p.code)}
                    </span>
                    <button
                      className={BTN}
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(showCode(p.code!))
                          .then(() => setCopied(true))
                          .catch(() => {});
                      }}
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                    <button className={BTN} disabled={busy} onClick={() => void run(() => newPlanetCode(p.id), "New code made. The old one no longer works.")}>
                      New code
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-mud-500">Anyone with it can join, companion or not. Make a new one if it gets out.</p>
                </div>
              )}

              <div>
                <p className={HEAD}>Invite a companion</p>
                {askable.length === 0 ? (
                  <p className="text-xs text-mud-500">Every companion of yours is on it or asked already.</p>
                ) : (
                  <form
                    className="flex gap-1.5"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const who = askable.find((f) => f.id === invitee);
                      if (who && (await run(() => inviteToPlanet(p.id, who.id), `Asked ${who.name}. They answer from any station.`))) setInvitee("");
                    }}
                  >
                    <select value={invitee} onChange={(e) => setInvitee(e.target.value)} aria-label="Companion to invite" className={INPUT}>
                      <option value="">Choose…</option>
                      {askable.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                    <button className={PRIMARY} disabled={busy || !invitee}>
                      Invite
                    </button>
                  </form>
                )}
                {p.invited.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {p.invited.map((i) => (
                      <li key={i.id} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-mud-700">
                          {i.name} <span className="text-xs text-mud-400">· asked</span>
                        </span>
                        <button className="text-[11px] font-semibold text-mud-500 hover:text-red-700" disabled={busy} onClick={() => void run(() => cancelPlanetInvite(p.id, i.id))}>
                          Withdraw
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <div>
            <p className={HEAD}>On it</p>
            <ul className="space-y-1">
              {p.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-mud-800">
                    {m.id === meId ? "You" : m.name}
                    {m.id === p.owner.id && <span className="ml-1 text-xs text-mud-400">· founder</span>}
                  </span>
                  {mine && m.id !== meId && (
                    <button
                      className="text-[11px] font-semibold text-mud-500 hover:text-red-700"
                      disabled={busy}
                      onClick={() => void run(() => removeFromPlanet(p.id, m.id), `${m.name} is off ${p.name}, and their house there is gone.`)}
                    >
                      Take off
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {mine ? (
            <Sure
              label="Close this planet"
              again="Close it: every house on it goes"
              busy={busy}
              onSure={() => void run(() => closePlanet(p.id), `${p.name} is closed.`)}
            />
          ) : (
            <Sure label="Leave this planet" again="Leave: your house there goes" busy={busy} onSure={() => void run(() => leavePlanet(p.id), `You've left ${p.name}.`)} />
          )}
        </div>
      )}
    </li>
  );
}
