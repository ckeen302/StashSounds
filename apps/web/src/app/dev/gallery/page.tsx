import type { Metadata } from "next";
import { color, radius, space, text, type ColorToken, type TextStyle } from "@stash/ui/tokens";
import { ComponentGallery } from "./component-gallery";

export const metadata: Metadata = { title: "Gallery", robots: { index: false, follow: false } };

/**
 * Every component in every state. Not linked, not indexed. The tokens first, then each component
 * from packages/ui with its default, hover, focus, active, disabled, loading, empty and error states
 * (ticket 131). Hover, focus and pressed are frozen with data attributes; overlays show a frozen
 * picture next to a live control.
 */
const swatchClass: Record<ColorToken, string> = {
  bg: "bg-bg",
  surface: "bg-surface",
  raised: "bg-raised",
  border: "bg-border",
  "border-strong": "bg-border-strong",
  text: "bg-text",
  "text-muted": "bg-text-muted",
  accent: "bg-accent",
  "type-loop": "bg-type-loop",
  "type-oneshot": "bg-type-oneshot",
  "type-kit": "bg-type-kit",
  "type-midi": "bg-type-midi",
  "type-preset": "bg-type-preset",
};

const textClass: Record<TextStyle, string> = {
  display: "text-display",
  title: "text-title",
  "body-strong": "text-body-strong",
  body: "text-body",
  small: "text-small",
  numeric: "text-numeric font-mono tabular",
  label: "text-label text-label-caps text-text-muted",
};

const spaceClass: Record<number, string> = {
  0: "w-0", 4: "w-1", 8: "w-2", 12: "w-3", 16: "w-4", 24: "w-6", 32: "w-8", 48: "w-12", 64: "w-16",
};

export default function GalleryPage() {
  return (
    <main className="mx-auto flex max-w-content flex-col gap-12 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">Dev</span>
        <h1 className="text-title">Gallery</h1>
      </header>

      <section aria-labelledby="colors" className="flex flex-col gap-4">
        <h2 id="colors" className="text-label text-label-caps text-text-muted">Color</h2>
        <ul className="grid grid-cols-2 gap-2 tablet:grid-cols-4 desktop:grid-cols-7">
          {(Object.keys(color) as ColorToken[]).map((name) => (
            <li key={name} className="flex flex-col gap-2 rounded-panel border border-border bg-surface p-2">
              <div className={`h-12 rounded-control border border-border ${swatchClass[name]}`} />
              <span className="text-small">{name}</span>
              <span className="text-numeric font-mono text-text-muted">{color[name]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="type" className="flex flex-col gap-4">
        <h2 id="type" className="text-label text-label-caps text-text-muted">Type</h2>
        <ul className="flex flex-col gap-3">
          {(Object.keys(text) as TextStyle[]).map((name) => (
            <li key={name} className="flex items-baseline gap-4 border-b border-border pb-3">
              <span className="w-24 shrink-0 text-label tablet:w-32 text-label-caps text-text-muted">{name}</span>
              <span className={textClass[name]}>{name === "numeric" ? "140 BPM  F#m  4 BARS  0:07" : "Dark keys over dusty drums"}</span>
              <span className="ml-auto text-numeric font-mono text-text-muted">
                {text[name].size}/{text[name].line} {text[name].weight}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="spacing" className="flex flex-col gap-4">
        <h2 id="spacing" className="text-label text-label-caps text-text-muted">Spacing</h2>
        <ul className="flex flex-col gap-2">
          {space.map((px) => (
            <li key={px} className="flex items-center gap-4">
              <span className="w-12 text-numeric font-mono text-text-muted">{px}</span>
              <div className={`h-2 rounded-full bg-accent ${spaceClass[px]}`} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="radius" className="flex flex-col gap-4">
        <h2 id="radius" className="text-label text-label-caps text-text-muted">Radius</h2>
        <div className="flex gap-4">
          <div className="flex h-16 w-32 items-center justify-center rounded-control border border-border-strong bg-surface text-small">
            control {radius.control}
          </div>
          <div className="flex h-16 w-32 items-center justify-center rounded-panel border border-border bg-surface text-small">
            panel {radius.panel}
          </div>
        </div>
      </section>

      <section aria-labelledby="treatments" className="flex flex-col gap-4">
        <h2 id="treatments" className="text-label text-label-caps text-text-muted">Treatments</h2>
        <div className="flex flex-wrap items-center gap-4">
          {/* Type chips: the type color at 16% behind the full color (CHIP_TINT_OPACITY). */}
          <span className="rounded-control bg-type-loop/16 px-2 py-1 text-label text-label-caps text-type-loop">Loop</span>
          <span className="rounded-control bg-type-oneshot/16 px-2 py-1 text-label text-label-caps text-type-oneshot">One-shot</span>
          <span className="rounded-control bg-type-kit/16 px-2 py-1 text-label text-label-caps text-type-kit">Kit</span>
          <span className="rounded-control bg-type-midi/16 px-2 py-1 text-label text-label-caps text-type-midi">MIDI</span>
          <span className="rounded-control bg-type-preset/16 px-2 py-1 text-label text-label-caps text-type-preset">Preset</span>
          {/* Waveform bars: played at full, unplayed at 35% (WAVEFORM_UNPLAYED_OPACITY). */}
          <span role="img" className="flex h-8 items-center gap-1" aria-label="Waveform played and unplayed">
            <span className="h-6 w-1 rounded-full bg-type-loop" />
            <span className="h-4 w-1 rounded-full bg-type-loop" />
            <span className="h-6 w-1 rounded-full bg-type-loop/35" />
            <span className="h-3 w-1 rounded-full bg-type-loop/35" />
          </span>
          {/* Focus ring: 2 px accent, 2 px offset. */}
          <span className="rounded-control border border-border-strong px-3 py-1 text-small outline-2 outline-offset-2 outline-accent outline-solid">
            Focus ring
          </span>
        </div>
      </section>

      <ComponentGallery />
    </main>
  );
}
