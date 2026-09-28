/* --------------------------------------------------------------------------
   Notification settings, shared by the settings page and the
   server so both read and check them by the same rules.
   -------------------------------------------------------------------------- */

export type NotificationPrefs = {
  /** A reminder `leadMinutes` before each quest's deadline. */
  dueSoon: boolean;
  leadMinutes: number;
  /** One summary each morning at `morningMinutes` past local midnight. */
  morning: boolean;
  morningMinutes: number;
  /** A companion sent a message. */
  messages: boolean;
  /** Companions may nudge you at all — in the app and as a notification. */
  nudges: boolean;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  dueSoon: true,
  leadMinutes: 60,
  morning: true,
  morningMinutes: 8 * 60,
  messages: true,
  nudges: true,
};

export const LEAD_CHOICES: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 240, label: "4 hours before" },
  { minutes: 1440, label: "1 day before" },
];

/** Settings made safe to store: known lead times, a real time of day. */
export function cleanPrefs(raw: Partial<NotificationPrefs> | null | undefined): NotificationPrefs {
  const r = raw ?? {};
  const lead = Number(r.leadMinutes);
  const morning = Math.round(Number(r.morningMinutes));
  return {
    dueSoon: typeof r.dueSoon === "boolean" ? r.dueSoon : DEFAULT_PREFS.dueSoon,
    leadMinutes: LEAD_CHOICES.some((c) => c.minutes === lead) ? lead : DEFAULT_PREFS.leadMinutes,
    morning: typeof r.morning === "boolean" ? r.morning : DEFAULT_PREFS.morning,
    morningMinutes:
      Number.isFinite(morning) && morning >= 0 && morning < 1440 ? morning : DEFAULT_PREFS.morningMinutes,
    messages: typeof r.messages === "boolean" ? r.messages : DEFAULT_PREFS.messages,
    nudges: typeof r.nudges === "boolean" ? r.nudges : DEFAULT_PREFS.nudges,
  };
}

/**
 * The push services a browser can hand us an address at. Anything else is
 * refused: the server posts to whatever address it's given, and a made-up
 * "subscription" must not be able to aim it at somewhere else.
 */
const PUSH_HOSTS = [
  "fcm.googleapis.com", // Chrome, Edge on Android, Samsung Internet…
  ".push.apple.com", // Safari on iOS and macOS
  ".push.services.mozilla.com", // Firefox
  ".notify.windows.com", // Edge on Windows
];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:" || u.port) return false;
    return PUSH_HOSTS.some((h) => (h.startsWith(".") ? u.hostname.endsWith(h) : u.hostname === h));
  } catch {
    return false;
  }
}
