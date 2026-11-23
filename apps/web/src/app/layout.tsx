import type { Metadata, Viewport } from "next";
import { color } from "@stash/ui/tokens";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: { default: "Stash", template: "%s · Stash" },
  description: "Loops, one-shots, drum kits, MIDI and presets from producers. Hear any sound instantly.",
};

export const viewport: Viewport = { themeColor: color.bg, colorScheme: "dark" };

/**
 * Root layout. The app shell, the player bar and the audio engine mount here in ticket 132, outside
 * page content, so playback survives every navigation.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-bg text-text">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
