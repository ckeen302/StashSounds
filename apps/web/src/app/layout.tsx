import type { Metadata, Viewport } from "next";
import { color } from "@stash/ui/tokens";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "./_shell/app-shell";
import { getSession } from "@/server";
import { viewerFrom, type Viewer } from "./_auth/viewer";

export const metadata: Metadata = {
  title: { default: "Stash", template: "%s · Stash" },
  description: "Loops, one-shots, drum kits, MIDI and presets from producers. Hear any sound instantly.",
};

export const viewport: Viewport = { themeColor: color.bg, colorScheme: "dark" };

/**
 * Who the shell draws for. An auth outage draws the signed-out frame rather than failing every
 * page; screens that need a user check again with requireUser.
 */
async function shellViewer(): Promise<Viewer> {
  try {
    return viewerFrom(await getSession());
  } catch {
    return { status: "signed_out" };
  }
}

/**
 * Root layout. The app shell and the player bar mount here, outside page content, and the engine is
 * one instance for the session, so playback survives every client navigation.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-dvh overflow-hidden bg-bg text-text">
        <Providers viewer={await shellViewer()}>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
