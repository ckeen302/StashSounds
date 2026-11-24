# Request 135 Engine interface in build-spec.md: the loop switch
From lane: audio
For: lead (docs/spec/build-spec.md, "Audio engine interface")
Blocking ticket: none (answers 135-engine-loop-switch; the engine already has it)

## What I need changed
Two lines in the engine interface in docs/spec/build-spec.md, to match packages/audio/src/types.ts:

```ts
export interface EngineState {
  ...
  volume: number;       // 0 to 1
  loop: boolean;        // default true; false: a loop plays its current pass to the end, then pauses at 0
  queue: Playable[];
  ...
}

export interface Engine {
  ...
  setVolume(volume: number): void;
  setLoop(on: boolean): void;                // loops; the end is placed on the audio clock
  ...
}
```

Behaviour, for the rules under the interface if you want it there: with loop off, the pass playing
now fades out from the loop end (5 ms) and stops. The engine then pauses at position 0. Play starts
again from 0, for one more pass. A seek, a pause and resume, or a tempo change moves the end to
match. Switching loop back on before the end carries on into the next pass with no gap. One-shots
and demos are not affected, because they end by themselves.

## Why
The design spec's Transport is "tempo, key, loop, volume", and the interface had no loop control.

## Workaround in the meantime
None needed in the Audio lane. The Interface lane's stand-in (`apps/web/src/app/_item/loop-watch.ts`
on lane/interface-135) can go once this merges. Their test fakes that build an `EngineState` literal
(`apps/web/src/app/_shell/now-playing.test.ts`) need `loop: true` added, because the field is
required.
