import type { MetadataRoute } from "next";

/* --------------------------------------------------------------------------
   What makes the site installable: its name, icons and colours, and that it
   opens in a window of its own rather than a browser tab.

   The colours match the page: the splash screen is the paper background, and
   the title bar the top of its gradient, so launching the app doesn't flash
   a colour the page isn't. Icons come from scripts/make-icons.mjs.

   Shortcuts appear on a long-press of the icon on Android, and in the
   right-click menu on Windows and Mac. iOS doesn't support them.
   -------------------------------------------------------------------------- */

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "HabitKnight",
    short_name: "HabitKnight",
    description: "A todo list that levels you up.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#eee6d2",
    theme_color: "#f6f0e2",
    categories: ["productivity", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "New quest",
        url: "/?new=1",
        icons: [{ src: "/icons/shortcut-new.png", sizes: "96x96", type: "image/png" }],
      },
      {
        name: "Habits",
        url: "/habits",
        icons: [{ src: "/icons/shortcut-habits.png", sizes: "96x96", type: "image/png" }],
      },
    ],
  };
}
