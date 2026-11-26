import { PRODUCERS, SAMPLE_SONGS } from "./data";

/**
 * The slice of the Samples catalog the rest of the demo needs as it starts: who produced each song
 * (for producer pages and their counts) and the Samples tab's producer slugs. The full catalog
 * (./data, about a third of the demo's script) then loads only with the Samples tab or a producer's
 * sampled songs. The demo build (scripts/build-demo-app.mjs) swaps this module for its computed
 * values, so the bundle carries the credits without the catalog behind them.
 */
export type SampleCredit = { /** The song's place in SAMPLE_SONGS. */ index: number; producers: string[] };

export const SAMPLE_CREDITS: SampleCredit[] = SAMPLE_SONGS.flatMap((s, index) => (s.producers.length > 0 ? [{ index, producers: s.producers }] : []));

/** The Samples tab's producer slugs, to the name they stand for. */
export const SAMPLE_PRODUCER_NAMES: Record<string, string> = Object.fromEntries(PRODUCERS.map((p) => [p.slug, p.name]));
