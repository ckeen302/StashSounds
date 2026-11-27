import { SongPage } from "./page";
import { songAllBySlug, songFromPreset, songFromSample } from "./data";

/** The three addresses a song answers at: its own, and the Presets and Samples ones it had before. */
export function SongRoute({ slug }: { slug: string }) {
  return <SongPage song={songAllBySlug(slug)} />;
}

export function PresetSongRoute({ slug }: { slug: string }) {
  return <SongPage song={songFromPreset(slug) ?? songAllBySlug(slug)} back={{ href: "/presets", label: "Presets" }} />;
}

export function SampleSongRoute({ slug }: { slug: string }) {
  return <SongPage song={songFromSample(slug) ?? songAllBySlug(slug)} back={{ href: "/samples", label: "Samples" }} />;
}
