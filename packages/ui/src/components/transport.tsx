"use client";

import type { MusicalKey } from "@stash/contracts";
import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { IconButton } from "./icon-button.tsx";
import { Repeat, RotateCcw, Volume2, VolumeX } from "./icon.tsx";
import { Kbd } from "./kbd.tsx";
import { Slider, volumeText } from "./slider.tsx";
import { Stepper } from "./stepper.tsx";
import { Tooltip } from "./tooltip.tsx";
import { keyShiftText, semitoneText, tempoRange, TRANSPOSE_LIMIT, transposedKey } from "./transport-math.ts";

export type TransportProps = {
  /** What the controls act on, for the group's accessible name. */
  title: string;
  /** Loops and MIDI. Without it the tempo control is disabled. */
  tempo?: { bpm: number; baseBpm: number; onChange: (bpm: number) => void };
  /** Loops, MIDI, one-shots. Without it the key control is disabled. */
  keyShift?: { semitones: number; baseKey: MusicalKey | null; onChange: (semitones: number) => void };
  /** Loops. Without it the loop switch is disabled. */
  loop?: { on: boolean; onChange: (on: boolean) => void };
  volume?: { value: number; muted: boolean; onChange: (v: number) => void; onMuteChange: (muted: boolean) => void };
  /** Show the computer-key hints beside each label (pages with the shared keys). */
  hints?: boolean;
  className?: string;
};

function Section({
  name,
  label,
  hint,
  disabled,
  children,
  className,
}: {
  name: string;
  label: string;
  hint?: string;
  disabled: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div data-section={name} data-disabled={disabled || undefined} className={cx("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex h-5 items-center gap-2">
        <span className={cx("text-label text-label-caps", disabled ? "text-border-strong" : "text-text-muted")}>{label}</span>
        {hint && !disabled && (
          // Kbd's own inline-flex would win over a plain `hidden`; the wrapper decides display.
          <span className="hidden desktop:contents">
            <Kbd>{hint}</Kbd>
          </span>
        )}
      </div>
      <div className="flex h-10 items-center gap-3">{children}</div>
    </div>
  );
}

const readout = "font-mono text-numeric tabular";

/**
 * Tempo, key, loop and volume under engraved labels. Design spec: Transport, "disabled for types that
 * lack a control". Presentational: the page binds each section to the engine.
 */
export function Transport({ title, tempo, keyShift, loop, volume, hints = false, className }: TransportProps) {
  const range = tempo ? tempoRange(tempo.baseBpm) : { min: 0, max: 1 };
  const bpm = tempo ? Math.round(tempo.bpm) : null;
  const semis = keyShift?.semitones ?? 0;
  const keyName = keyShift ? transposedKey(keyShift.baseKey, semis) : null;
  const changed = (tempo && Math.round(tempo.bpm) !== Math.round(tempo.baseBpm)) || (keyShift && semis !== 0);
  const muted = volume?.muted ?? false;

  return (
    <section aria-label={`Transport for ${title}`} className={cx("@container rounded-panel border border-border bg-surface p-4", className)}>
      {/* Laid out by its own width: stacked when narrow, two by two from 40rem, one row from 44rem
          (tempo takes twice the volume's share; key and loop take what they need). */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 cq-lg:flex">
      <Section name="tempo" label="Tempo" hint={hints ? "- =" : undefined} disabled={!tempo} className="col-span-2 cq-md:col-span-1 cq-lg:flex-2">
        <span className="flex w-20 shrink-0 items-baseline gap-1">
          <span data-tempo-readout className={cx(readout, tempo ? "text-text" : "text-border-strong")}>
            {bpm ?? "—"}
          </span>
          <span className="text-label text-label-caps text-text-muted">BPM</span>
        </span>
        <Slider
          label="Tempo"
          value={bpm ?? 0}
          min={range.min}
          max={range.max}
          step={1}
          disabled={!tempo}
          onValueChange={tempo?.onChange}
          valueText={(v) => `${Math.round(v)} BPM`}
          className="min-w-0 flex-1"
        />
      </Section>

      <Section name="key" label="Key" hint={hints ? "[ ]" : undefined} disabled={!keyShift} className="col-span-2 cq-md:col-span-1 cq-lg:flex-none">
        <span data-key-readout className={cx(readout, "w-8 shrink-0", keyShift ? "text-text" : "text-border-strong")}>
          {keyShift ? (keyName ?? semitoneText(semis)) : "—"}
        </span>
        <Stepper
          label="Key shift"
          value={semis}
          min={-TRANSPOSE_LIMIT}
          max={TRANSPOSE_LIMIT}
          format={semitoneText}
          valueText={keyShiftText(keyName, semis)}
          onChange={keyShift?.onChange}
        />
        <Tooltip content="Back to the original tempo and key">
          <IconButton
            icon={RotateCcw}
            label="Reset tempo and key"
            disabled={!changed}
            onClick={() => {
              if (tempo) tempo.onChange(tempo.baseBpm);
              keyShift?.onChange(0);
            }}
          />
        </Tooltip>
      </Section>

      <Section name="loop" label="Loop" disabled={!loop} className="col-span-1 cq-lg:flex-none">
        <IconButton
          icon={Repeat}
          label="Loop"
          size="md"
          on={loop?.on ?? false}
          disabled={!loop}
          onClick={() => loop?.onChange(!loop.on)}
          className="aria-pressed:border-border-strong aria-pressed:text-text"
        />
        {loop && (
          // The pressed state is the button's; this repeats it in words for the eye, not the ear.
          <span aria-hidden="true" data-loop-readout className={cx(readout, "w-8", loop.on ? "text-text" : "text-text-muted")}>
            {loop.on ? "ON" : "OFF"}
          </span>
        )}
      </Section>

      <Section name="volume" label="Volume" disabled={!volume} className="col-span-1 cq-lg:flex-1">
        <Tooltip content={muted ? "Unmute" : "Mute"}>
          <IconButton
            icon={muted || (volume?.value ?? 0) === 0 ? VolumeX : Volume2}
            label={muted ? "Unmute" : "Mute"}
            on={muted}
            disabled={!volume}
            onClick={() => volume?.onMuteChange(!muted)}
          />
        </Tooltip>
        <Slider
          label="Volume"
          value={muted ? 0 : (volume?.value ?? 0)}
          disabled={!volume}
          onValueChange={volume?.onChange}
          valueText={volumeText}
          className="min-w-0 flex-1"
        />
      </Section>
      </div>
    </section>
  );
}
