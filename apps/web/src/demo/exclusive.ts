/**
 * One sound at a time. The loop engine and the MIDI player already pause each other; the one-shot,
 * kit and sound-effect players register here so that starting any player also cuts them off: a one-shot
 * or kit preview no longer keeps sounding under a loop or a chord progression started after it.
 */
const stoppers = new Set<() => void>();

/** Registers a player's stop. */
export function onSilence(stop: () => void): void {
  stoppers.add(stop);
}

/** Stops every registered player except `keep` (the one about to play). */
export function silenceOthers(keep?: () => void): void {
  for (const stop of stoppers) if (stop !== keep) stop();
}
