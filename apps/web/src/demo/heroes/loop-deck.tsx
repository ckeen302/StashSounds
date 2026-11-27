import { getEngine, usePlayerState } from "@stash/audio";
import type { ItemRow } from "@stash/contracts";
import { formatKey } from "@stash/contracts/format";
import { UiLink } from "@stash/ui";
import { nowPlaying } from "../../app/_shell/now-playing";
import { Scope } from "../live/live";
import { daily } from "./daily";

/**
 * The Loops page's hero: today's loop on a deck of its own, with a big spectrum screen that comes
 * alive when anything plays, its tempo and key as readouts, and one big play key.
 */
export function LoopDeckHero({ rows }: { rows: ItemRow[] }) {
  const row = daily(rows, 2);
  const engine = getEngine();
  const currentId = usePlayerState((s) => s.current?.id ?? null);
  const status = usePlayerState((s) => s.status);
  if (!row) return null;
  const mine = currentId === row.id;
  const state = mine ? (status === "playing" ? "playing" : status === "loading" ? "loading" : "paused") : "idle";
  return (
    <div className="sp-panel-dark sp-hero-deck flex flex-col gap-3 p-3 tablet:p-4">
      <div className="sp-lcd sp-hero-spectrum">
        <Scope variant="bars" className="block h-full w-full" />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="sp-key sp-key-hot sp-hero-play"
          data-play-state={state}
          aria-label={state === "playing" ? `Pause ${row.title}` : `Play ${row.title}`}
          onPointerEnter={() => engine.preload(row.playable)}
          onClick={() => void nowPlaying().playFrom(engine, [row], 0)}
        >
          <span aria-hidden="true">{state === "playing" ? "❚❚" : "▶"}</span>
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="sp-label sp-label-dark">Loop of the day</span>
          <UiLink href={row.href} className="sp-hero-name truncate">
            {row.title}
          </UiLink>
          <span className="truncate text-small text-text-muted">@{row.owner.handle}</span>
        </div>
      </div>
      <dl className="sp-hero-readouts">
        <div>
          <dt>BPM</dt>
          <dd>{row.bpm ?? "--"}</dd>
        </div>
        <div>
          <dt>KEY</dt>
          <dd>{row.key ? formatKey(row.key) : "--"}</dd>
        </div>
        <div>
          <dt>BARS</dt>
          <dd>{row.length?.unit === "bars" ? row.length.value : "--"}</dd>
        </div>
      </dl>
    </div>
  );
}
