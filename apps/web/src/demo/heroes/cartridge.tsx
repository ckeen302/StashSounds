import { UiLink } from "@stash/ui";
import { Cover, coverFor } from "../presets/cover";
import { ALL_SONGS, isUnknown, songHref } from "../presets/songs";
import { daily } from "./daily";

/**
 * The Presets page's hero: today's song as one big cartridge, its album cover in the bezel and the
 * patches behind it printed on the label, ready to pull up.
 */
const READY = ALL_SONGS.filter((s) => s.entries.some((e) => e.preset && !isUnknown(e.preset)) && coverFor(s.song, s.artist));

export function CartridgeHero() {
  const song = daily(READY, 5);
  if (!song) return null;
  const named = song.entries.filter((e) => e.preset && !isUnknown(e.preset)).slice(0, 3);
  return (
    <UiLink href={songHref(song.song, song.artist)} className="sp-cart sp-hero-cart group">
      <span className="sp-hero-cart-cover">
        <Cover song={song.song} artist={song.artist} size="fill" />
      </span>
      <span className="flex min-w-0 flex-col gap-2">
        <span className="sp-label sp-label-dark">Cartridge of the day</span>
        <span className="sp-hero-name group-hover:underline">{song.song}</span>
        <span className="truncate text-small text-text-muted">{song.artist}</span>
        <span className="sp-lcd sp-hero-patches">
          {named.map((e) => (
            <span key={`${e.plugin}-${e.preset}`} className="block truncate">
              {`> ${e.plugin.toUpperCase()} / ${e.preset!.toUpperCase()}`}
            </span>
          ))}
        </span>
      </span>
    </UiLink>
  );
}
