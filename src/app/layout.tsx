import type { Metadata, Viewport } from "next";
import PwaShell from "@/components/PwaShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "HabitKnight",
  description: "A todo list that levels you up.",
  applicationName: "HabitKnight",
  // Installed from Safari's "Add to Home Screen": open full-screen, under
  // this name. The icon is app/apple-icon.png.
  appleWebApp: { capable: true, title: "HabitKnight", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // The top of the paper background, so the browser's bar and an installed
  // app's title bar run straight into the page. Same as the manifest.
  themeColor: "#f6f0e2",
  // Edge to edge on notched phones; globals.css pads the body back in with
  // the safe-area insets, and the tab bar and sheets pad for the home bar.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <PwaShell>{children}</PwaShell>
      </body>
    </html>
  );
}
