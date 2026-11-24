// Bare test page for the engine (tickets 121, 122). Imports engine.ts directly: index.ts also exports the
// React binding, and this page has no bundler to resolve React.
import { getEngine } from "../src/engine.ts";
import type { Playable } from "../src/types.ts";

const engine = getEngine();
(globalThis as { stashEngine?: typeof engine }).stashEngine = engine; // for scripted browser checks

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const select = $<HTMLSelectElement>("fixture");
const seek = $<HTMLInputElement>("seek");
const position = $<HTMLOutputElement>("position");
const stateOut = $<HTMLPreElement>("state");

// Built by serve.mjs and checked there with playableSchema.parse from @stash/contracts.
type LoopPlayable = Extract<Playable, { kind: "loop" }>;
const loops: LoopPlayable[] = await (await fetch("/fixtures.json")).json();
for (const l of loops) select.add(new Option(`${l.id} (${l.bpm} BPM)`, l.id));
// ?loop=<file> preselects a fixture without the change event, so nothing is preloaded (first-sound runs).
const wanted = new URLSearchParams(location.search).get("loop");
if (wanted && loops.some((l) => l.id === wanted)) select.value = wanted;

const chosen = () => loops.find((l) => l.id === select.value);
const tempo = $<HTMLInputElement>("tempo");
const showBpm = () => {
  const l = chosen();
  if (l?.bpm) tempo.value = String(l.bpm);
};
showBpm();
select.addEventListener("change", showBpm);
// Tempo and key apply live; the first change loads the stretch.
tempo.addEventListener("input", () => engine.setTempo(Number(tempo.value)));
$<HTMLInputElement>("transpose").addEventListener("input", (e) => engine.setTranspose(Number((e.target as HTMLInputElement).value)));

// Preload on hover and focus, as list rows will: bytes are fetched before the first gesture.
select.addEventListener("change", () => {
  const l = chosen();
  if (l) engine.preload(l);
});
$("play").addEventListener("pointerenter", () => {
  const l = chosen();
  if (l) engine.preload(l);
});

$("play").addEventListener("click", () => {
  const l = chosen();
  void engine.unlock();
  if (l) void engine.play(l);
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
