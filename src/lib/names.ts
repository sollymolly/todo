/* --------------------------------------------------------------------------
   Names other people see — @usernames and display names — kept free of
   slurs and profanity. Used when a name is chosen (auth-actions.ts,
   actions.ts) and by scripts/clean-names.mjs for names chosen before.

   Plain TypeScript with no imports, so that script can load it as-is.

   Two kinds of word:
     anywhere   unmistakable even inside another word ("xXshitXx")
     alone      short or ordinary enough that they turn up inside innocent
                words (class, peacock, grapes, torpedo), so they only count
                as a word of their own: split on spaces, digits, _ and
                capitals ("Big_Ass", "bigAss", "ass99")
   Spelling tricks are undone first: 4→a, 3→e, 1/!→i, 0→o, 5/$→s, 7→t,
   @→a, and letters typed over and over ("fuuuck").
   -------------------------------------------------------------------------- */

const ANYWHERE = [
  "fuck", "fuk", "fvck", "phuck", "shit", "cunt", "bitch", "whore", "slut", "bastard", "asshole", "dumbass", "jackass",
  "dildo", "jizz", "penis", "vagina", "porn", "boobs", "twat", "wank", "nigg", "nigr", "faggot", "fagot", "retard",
  "tranny", "nazi", "hitler", "pedophil", "paedophil", "rapist", "molest", "kkk", "motherf", "dickhead", "dickwad",
  "cocksuck", "blowjob", "handjob", "pedo", "cuck",
];

/** Innocent words with one of those inside them, taken out before looking. */
const INNOCENT = ["shiitake", "therapist", "scunthorpe", "penistone", "cockburn", "dickens", "torpedo", "cuckoo"];

const ALONE = [
  "ass", "arse", "tit", "tits", "titty", "cum", "cock", "dick", "dicks", "pussy", "sex", "sexy", "anal", "anus", "piss",
  "hoe", "hoes", "fag", "fags", "rape", "raped", "kike", "spic", "chink", "coon", "gook", "wetback",
  "kys", "damn", "crap", "prick", "skank", "thot",
];

const LEET: Record<string, string> = { "4": "a", "@": "a", "3": "e", "1": "i", "!": "i", "0": "o", "5": "s", $: "s", "7": "t" };

const unleet = (s: string) => s.replace(/[4@31!05$7]/g, (c) => LEET[c]);
const squeeze = (s: string) => s.replace(/(.)\1+/g, "$1");

/** Whether a name has a word in it that shouldn't be in a name. */
export function badName(name: string): boolean {
  const plain = unleet(name.toLowerCase());
  const letters = INNOCENT.reduce((s, w) => s.split(w).join(" "), plain.replace(/[^a-z]/g, "")).replace(/ /g, "");
  // Stretched letters only for words with no double letters of their own,
  // or "nigg" would squeeze to "nig" and catch Nigel.
  const squeezed = squeeze(letters);
  if (ANYWHERE.some((w) => letters.includes(w) || (w === squeeze(w) && squeezed.includes(w)))) return true;
  // Words of their own: camelCase split before lowercasing, then on anything
  // that isn't a letter (after undoing the number tricks).
  const words = unleet(name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()).split(/[^a-z]+/);
  return words.some((w) => w && (ALONE.includes(w) || ALONE.includes(squeeze(w))));
}

/** What a display name becomes when it can't stay. */
export const DEFAULT_DISPLAY_NAME = "Adventurer";

/** A fresh @username for someone whose own can't stay: knight_ and six letters or digits. */
export function defaultUsername(): string {
  return `knight_${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
}

export const NAME_NOT_ALLOWED = "That name isn't allowed here. Pick another.";
