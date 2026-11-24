import type { Metadata, Viewport } from "next";
import { color } from "@stash/ui/tokens";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "./_shell/app-shell";

export const metadata: Metadata = {
  title: { default: "Stash", template: "%s · Stash" },
  description: "Loops, one-shots, drum kits, MIDI and presets from producers. Hear any sound instantly.",
};

export const viewport: Viewport = { themeColor: color.bg, colorScheme: "dark" };

/**
 * Root layout. The app shell and the player bar mount here, outside page content, and the engine is
 * one instance for the session, so playback survives every client navigation.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-dvh overflow-hidden bg-bg text-text">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
