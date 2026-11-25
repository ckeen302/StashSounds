import type { ButtonHTMLAttributes, Ref } from "react";
import { cx, type PreviewState } from "./cx.ts";
import { Icon, Pause, Play, RotateCw } from "./icon.tsx";
import { Spinner } from "./spinner.tsx";

export type PlayState = "paused" | "loading" | "playing" | "error";

export type PlayButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> &
  PreviewState & {
    /** What plays, for the accessible name: "Play Dusty soul chops". */
    title: string;
    state?: PlayState;
    /** row is 40 px, hero is 64 px. */
    size?: "row" | "hero";
    ref?: Ref<HTMLButtonElement>;
  };

const labels: Record<PlayState, (t: string) => string> = {
  paused: (t) => `Play ${t}`,
  loading: (t) => `Loading ${t}`,
  playing: (t) => `Pause ${t}`,
  error: (t) => `Could not play ${t}. Retry`,
};

const faces: Record<PlayState, string> = {
  paused: "border-border-strong bg-bg text-text ui-hover:bg-raised ui-active:bg-surface",
  loading: "border-border-strong bg-bg text-text",
  // The one lit thing: the ring closes and lights in 160 ms.
  playing: "border-accent bg-accent text-bg ui-hover:bg-accent/85 ui-active:bg-accent/70",
  error: "border-type-kit bg-bg text-type-kit ui-hover:bg-raised ui-active:bg-surface",
};

/** The pad-shaped play control. Design spec: Components (Play button) and The result row. */
export function PlayButton({ title, state = "paused", size = "row", className, type = "button", ref, ...rest }: PlayButtonProps) {
  const hero = size === "hero";
  return (
    <button
      ref={ref}
      type={type}
      aria-label={labels[state](title)}
      aria-busy={state === "loading" || undefined}
      data-play-state={state}
      className={cx(
        "relative inline-flex shrink-0 items-center justify-center border transition-colors duration-160 ease-out",
        hero ? "size-16 rounded-panel" : "size-10 rounded-control",
        faces[state],
        "disabled:cursor-not-allowed disabled:border-border disabled:text-border-strong",
        className,
      )}
      {...rest}
    >
      {state === "loading" ? (
        <Spinner size={hero ? 32 : 20} />
      ) : (
        <Icon icon={state === "playing" ? Pause : state === "error" ? RotateCw : Play} size={hero ? 20 : 16} />
      )}
    </button>
  );
}
