import { Button, Share2, useToast } from "@stash/ui";
import { useState } from "react";
import { coverFor, coverTile } from "./presets/cover";
import { nameFor } from "./router";

/**
 * Sharing a page: a clean link to it, and a preview card (cover, title, what the page has) that goes
 * with the link wherever the share sheet sends it, so a group chat shows the song and not a bare URL.
 *
 * The demo is one static page inside an Artifact frame, so its pages have no address of their own
 * that a chat app can read a preview from. The link is the demo's public address plus the page's
 * name ("…#song-sicko-mode-travis-scott"), and the card travels as an image beside it.
 */

/** The demo's public address. Inside the Artifact frame the page can't read it, so it is named here. */
export const DEMO_HOME = "https://claude.ai/artifact/5VNc3hqdZG5WV18kVrCxRV";

/** The link to share for an app path. */
export function shareLink(path: string, here: Location = window.location): string {
  const local = /^(localhost|127\.|\[::1\])/.test(here.hostname) || here.protocol === "file:";
  const base = local ? `${here.origin}${here.pathname}` : DEMO_HOME;
  return `${base}#${nameFor(path)}`;
}

export type CardInfo = { kind: string; title: string; subtitle: string; line?: string; song?: { song: string; artist: string } };

const W = 1200;
const H = 630;

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Cuts text to fit `max` pixels on one line, with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** The title over up to two lines at the biggest size that fits. */
function titleLines(ctx: CanvasRenderingContext2D, text: string, max: number, font: (px: number) => string): { lines: string[]; px: number } {
  for (const px of [88, 76, 64, 54]) {
    ctx.font = font(px);
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= max) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= 2 && lines.every((l) => ctx.measureText(l).width <= max)) return { lines, px };
  }
  ctx.font = font(54);
  return { lines: [fit(ctx, text, max)], px: 54 };
}

/** The preview card as a 1200 × 630 PNG (the size chat apps and Twitter show link cards at). */
export async function shareCard(info: CardInfo): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const bg = token("bg");
  const surface = token("surface");
  const text = token("text");
  const muted = token("text-muted");
  const accent = token("accent");
  const display = getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const pad = 64;
  const art = 440;
  const cover = info.song ? coverFor(info.song.song, info.song.artist) : null;
  const tile = cover ? coverTile(cover.file) : null;
  const sheet = tile ? await loadImage(tile.sheet) : null;
  let x = pad;
  if (sheet && tile) {
    const size = sheet.naturalWidth / tile.grid;
    // The blurred cover behind everything, as on the song page.
    ctx.save();
    ctx.filter = "blur(48px) brightness(0.45)";
    ctx.drawImage(sheet, tile.col * size, tile.row * size, size, size, -100, -100, W + 200, W + 200);
    ctx.restore();
    ctx.drawImage(sheet, tile.col * size, tile.row * size, size, size, pad, (H - art) / 2, art, art);
    x = pad + art + 56;
  } else {
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, W, H);
  }
  const max = W - x - pad;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = accent;
  ctx.font = `700 26px ${display}`;
  ctx.fillText(info.kind.toUpperCase(), x, 150);
  const { lines, px } = titleLines(ctx, info.title, max, (n) => `800 ${n}px ${display}`);
  ctx.fillStyle = text;
  let y = 150 + 20 + px;
  for (const l of lines) {
    ctx.fillText(l, x, y);
    y += px * 1.05;
  }
  ctx.font = `600 36px ${display}`;
  ctx.fillStyle = text;
  ctx.fillText(fit(ctx, info.subtitle, max), x, y + 24);
  if (info.line) {
    ctx.font = `500 28px ${display}`;
    ctx.fillStyle = muted;
    ctx.fillText(fit(ctx, info.line, max), x, y + 76);
  }
  ctx.font = `800 34px ${display}`;
  ctx.fillStyle = text;
  ctx.fillText("stash", x, H - pad);
  ctx.fillStyle = accent;
  ctx.fillRect(x + ctx.measureText("stash").width + 10, H - pad - 10, 10, 10);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}

const fileName = (title: string) => `${title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "stash"}.png`;

/**
 * The share button: the phone's share sheet with the link and the card; on a computer, the link is
 * copied and the card saved, ready to paste into a chat or a post.
 */
export function ShareButton({ path, card, size = "sm", className }: { path: string; card: CardInfo; size?: "sm" | "md"; className?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const url = shareLink(path);
    const text = `${card.title} · ${card.subtitle} on Stash`;
    try {
      const blob = await shareCard(card).catch(() => null);
      const file = blob ? new File([blob], fileName(card.title), { type: "image/png" }) : null;
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) {
        const withCard: ShareData = file ? { files: [file], title: card.title, text: `${text}\n${url}`, url } : { title: card.title, text, url };
        try {
          await nav.share(nav.canShare?.(withCard) ? withCard : { title: card.title, text, url });
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
      }
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        copied = false;
      }
      if (file) {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      toast(
        copied
          ? { tone: "success", title: "Link copied", description: file ? "The preview card is saved too. Post it with the link." : url }
          : { tone: "error", title: "Could not copy the link", description: url },
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size={size} variant="secondary" icon={Share2} disabled={busy} className={className} onClick={() => void go()}>
      Share
    </Button>
  );
}
