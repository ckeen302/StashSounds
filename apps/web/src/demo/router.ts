import { useSyncExternalStore } from "react";

/**
 * The demo's router. The demo runs as one static page inside a frame that keeps only a plain
 * `#name` in its address, so app paths map to hash names: "/" is "#home", a loop page is
 * "#loop-<publicId>", and the other screens are their first segment ("#browse", "#upload"...).
 * The path stays the app's own, so the real shell and pages read it unchanged.
 */

const listeners = new Set<() => void>();
let current = "/";

/** The hash name for an app path. Only letters, digits and hyphens, so the frame keeps it. */
export function nameFor(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? "/";
  const loop = /^\/loop\/(?:.*-)?([a-z0-9]+)$/.exec(clean);
  if (loop) return `loop-${loop[1]}`;
  const midi = /^\/midi\/(?:.*-)?([a-z0-9]+)$/.exec(clean);
  if (midi) return `midi-${midi[1]}`;
  const kit = /^\/kit\/([a-z0-9]+)$/.exec(clean);
  if (kit) return `kit-${kit[1]}`;
  const first = clean.split("/").filter(Boolean)[0];
  if (!first) return "home";
  if (first === "u") {
    const handle = clean.split("/")[2];
    return handle && /^[a-z0-9_]+$/i.test(handle) ? `u-${handle.toLowerCase().replace(/_/g, "--")}` : "profile";
  }
  return /^[a-z0-9-]+$/.test(first) ? first : "home";
}

/** The app path for a hash name; `loopHref` resolves a loop's public id to its full path. */
export function pathFor(name: string, loopHref: (publicId: string) => string | null, midiHref: (publicId: string) => string | null = () => null): string {
  if (!name || name === "home") return "/";
  if (name.startsWith("loop-")) return loopHref(name.slice(5)) ?? "/not-found";
  if (name.startsWith("midi-")) return midiHref(name.slice(5)) ?? "/not-found";
  if (name === "browse") return "/browse/loops";
  if (name === "kit-upload") return "/kit-upload";
  if (name.startsWith("kit-")) return `/kit/${name.slice(4)}`;
  if (name === "profile") return "/login";
  if (name.startsWith("u-")) return `/u/${name.slice(2).replace(/--/g, "_")}`;
  return `/${name}`;
}

let resolveLoop: (publicId: string) => string | null = () => null;
let resolveMidi: (publicId: string) => string | null = () => null;

function readHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}

/** Starts the router: reads the hash now and on every change. */
export function startRouter(loopHref: (publicId: string) => string | null, midiHref?: (publicId: string) => string | null) {
  resolveLoop = loopHref;
  if (midiHref) resolveMidi = midiHref;
  current = pathFor(readHash(), resolveLoop, resolveMidi);
  window.addEventListener("hashchange", () => {
    const next = pathFor(readHash(), resolveLoop, resolveMidi);
    if (next !== current) {
      current = next;
      emit();
    }
  });
}

function emit() {
  for (const l of listeners) l();
  document.getElementById("content")?.scrollTo({ top: 0 });
}

/** Goes to an app path. The hash is set when the frame allows it; navigation works either way. */
export function navigate(path: string, opts: { replace?: boolean } = {}) {
  const target = path.split(/[?#]/)[0] || "/";
  if (target === current) return;
  current = target;
  const name = nameFor(target);
  try {
    if (opts.replace) window.history.replaceState(window.history.state, "", `#${name}`);
    else window.location.hash = name;
  } catch {
    // The frame refused: the in-page route still changes.
  }
  emit();
}

export function usePath(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => "/",
  );
}
