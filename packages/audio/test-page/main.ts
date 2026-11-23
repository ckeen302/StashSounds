// Bare test page for the engine (ticket 121). Imports engine.ts directly: index.ts also exports the
// React binding, and this page has no bundler to resolve React.
import { getEngine } from "../src/engine.ts";
import type { Playable } from "../src/types.ts";

interface FixtureLoop {
  name: string;
  bpm: number;
  loopSamples: number;
  sampleRate: number;
}

const engine = getEngine();
(globalThis as { stashEngine?: typeof engine }).stashEngine = engine; // for scripted browser checks

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>("fixture");
const seek = $<HTMLInputElement>("seek");
const position = $<HTMLOutputElement>("position");
const stateOut = $<HTMLPreElement>("state");

const loops: FixtureLoop[] = await (await fetch("/fixtures.json")).json();
for (const l of loops) select.add(new Option(`${l.name} (${l.bpm} BPM)`, l.name));

function playable(l: FixtureLoop): Playable {
  return {
    kind: "loop",
    id: l.name,
    previewUrl: new URL(`/fixtures/${encodeURIComponent(l.name)}`, location.href).href,
    loopSamples: l.loopSamples,
    sampleRate: l.sampleRate,
    bpm: l.bpm,
  };
}

const chosen = () => loops.find((l) => l.name === select.value);

// Preload on hover and focus, as list rows will: bytes are fetched before the first gesture.
select.addEventListener("change", () => {
  const l = chosen();
  if (l) engine.preload(playable(l));
});
$("play").addEventListener("pointerenter", () => {
  const l = chosen();
  if (l) engine.preload(playable(l));
});

$("play").addEventListener("click", () => {
  const l = chosen();
  void engine.unlock();
  if (l) void engine.play(playable(l));
});
$("pause").addEventListener("click", () => engine.pause());
$("retry").addEventListener("click", () => void engine.play());
seek.addEventListener("input", () => engine.seek((Number(seek.value) / 1000) * engine.getState().durationMs));
$<HTMLInputElement>("volume").addEventListener("input", (e) => engine.setVolume(Number((e.target as HTMLInputElement).value) / 100));

engine.subscribe((s) => {
  stateOut.textContent = JSON.stringify({ ...s, current: s.current?.id ?? null }, null, 2);
});
stateOut.textContent = JSON.stringify(engine.getState(), null, 2);

// Position is read every frame from the audio clock, never from state.
function frame() {
  const { durationMs } = engine.getState();
  const ms = engine.getPositionMs();
  position.textContent = `${Math.round(ms)} ms`;
  if (durationMs > 0 && document.activeElement !== seek) seek.value = String(Math.round((ms / durationMs) * 1000));
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
