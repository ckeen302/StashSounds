import { CrateMenu } from "../explore";
import { CONFIDENCE, presetParts, type PresetEntry } from "./data";
import { Meter, partOf, TONE_TEXT } from "./page";
import { slugify, type Song } from "./songs";

/** One sound on a song's page: what part it plays, the plugin, the preset in big type, how sure, and the source behind a tap. */
export function SoundRow({ e, n, song }: { e: PresetEntry; n: number; song: Song }) {
  const { name, note } = presetParts(e.preset);
  const short = CONFIDENCE[e.confidence].label.split(" · ")[1] ?? CONFIDENCE[e.confidence].label;
  return (
    <li className="flex flex-col rounded-panel border border-border bg-surface">
      <div className="flex items-center gap-4 p-4">
        <span className="hidden w-6 shrink-0 font-mono text-numeric tabular text-text-muted tablet:block">{String(n).padStart(2, "0")}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-control border border-border-strong px-2 py-0.5 text-label text-label-caps text-text">{partOf(e.role)}</span>
            <span className="min-w-0 truncate text-small text-text-muted">{e.plugin}</span>
          </span>
          <span className="st-hero-title text-title break-words text-accent">{name}</span>
          {note && <span className="text-small text-text-muted">{note}</span>}
        </span>
        <span className="hidden shrink-0 items-center gap-2 tablet:flex" title={CONFIDENCE[e.confidence].blurb}>
          <Meter c={e.confidence} />
          <span className={`text-small ${TONE_TEXT[e.confidence]}`}>{short}</span>
        </span>
        <CrateMenu
          itemId={`preset:${song.slug}:${slugify(`${e.plugin} ${e.preset ?? e.role}`)}`}
          title={`${name} · ${song.song}`}
          kind="Preset"
          href={`/song/${song.slug}`}
          by={e.plugin}
          size="sm"
        />
      </div>
      <details className="st-details border-t border-border px-4 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-small text-text-muted ui-hover:text-text">
          <span className="tablet:hidden">
            <Meter c={e.confidence} />
          </span>
          <span className={`tablet:hidden ${TONE_TEXT[e.confidence]}`}>{short}</span>
          <span className="tablet:hidden" aria-hidden="true">·</span>
          <span>{e.source.label ? "Source" : "Details"}</span>
        </summary>
        <div className="flex flex-col gap-2 pt-2 pb-2">
          {e.path && <span className="text-small text-text-muted">{`Find it in: ${e.path.split(/\s*›\s*|\s*>\s*/).join(" › ")}`}</span>}
          {e.quote && (
            <blockquote className="border-l-2 border-accent pl-3 text-body text-text">
              “{e.quote}”{e.quoteBy && <span className="text-text-muted"> — {e.quoteBy}</span>}
            </blockquote>
          )}
          {!e.source.label ? null : e.source.url ? (
            <a href={e.source.url} target="_blank" rel="noreferrer" className="self-start text-small break-words text-text-muted underline underline-offset-2 ui-hover:text-text">
              {e.source.label}
            </a>
          ) : (
            <span className="text-small break-words text-text-muted">{e.source.label}</span>
          )}
          <span className="text-small text-text-muted">{CONFIDENCE[e.confidence].blurb}</span>
        </div>
      </details>
    </li>
  );
}
