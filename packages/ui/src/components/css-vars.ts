/**
 * The CSS variables components hand to the readers in components.css. The lint rule
 * stash/no-inline-style allows style={{ "--name": value }} and nothing else; this types those names.
 */
declare module "react" {
  interface CSSProperties {
    /** 0 to 1, read by w-progress. */
    "--progress"?: number;
    /** 0 to 1, read by left-playhead. */
    "--playhead"?: number;
    /** 0 to 1, read by left-pointer. */
    "--pointer"?: number;
  }
}

export {};
