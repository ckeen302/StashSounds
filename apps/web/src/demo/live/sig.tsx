import { useState, useSyncExternalStore, type CSSProperties } from "react";
import { VIEWER } from "../midi/catalog";
import { cleanMessage, defaultSignature, parseSignature, SIG_COLORS, SIG_MAX, sigVar, type Signature, type SigColor } from "./signature";

/** The visitor's own signature, kept in this browser; everyone else's comes from their handle. */
const KEY = "stash.demo.signature.v1";
const listeners = new Set<() => void>();
let mine: Signature | null = null;
try {
  mine = parseSignature(window.localStorage.getItem(KEY));
} catch {
  // Storage blocked: the default until it is set this visit.
}

function setMine(s: Signature) {
  mine = s;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // This visit only.
  }
  for (const l of listeners) l();
}

export function signatureOf(handle: string): Signature {
  if (handle === VIEWER.handle && mine) return mine;
  return defaultSignature(handle);
}

/** A handle's signature, following the visitor's edits. */
export function useSignature(handle: string): Signature {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mine,
    () => null,
  );
  return signatureOf(handle);
}

/** Style that sets --sig to a handle's colour, for anything the CSS paints with it. */
export function useSigStyle(handle: string): CSSProperties {
  const s = useSignature(handle);
  return { ["--sig" as string]: sigVar(s.color) };
}

/** The small light in a producer's colour that sits by their name on everything they post. */
export function SigLed({ handle }: { handle: string }) {
  const style = useSigStyle(handle);
  return <span className="sp-sig-led" style={style} aria-hidden="true" />;
}

/** The producer's line on a screen, scrolling when it is longer than the screen is wide. */
export function SigMessage({ handle, className = "" }: { handle: string; className?: string }) {
  const s = useSignature(handle);
  if (!s.message) return null;
  return (
    <span className={`sp-sig-msg ${className}`} style={{ ["--sig" as string]: sigVar(s.color) }}>
      <span className="sr-only">{`${handle}'s line: `}</span>
      <span className="sp-sig-track" aria-hidden="true">
        <span>{s.message}</span>
        <span>{s.message}</span>
      </span>
      <span className="sr-only">{s.message}</span>
    </span>
  );
}

/** On the visitor's own profile: pick a pad colour and type a line. Saved as it changes. */
export function SigEditor() {
  const now = useSignature(VIEWER.handle);
  const [text, setText] = useState(now.message);
  const save = (patch: Partial<Signature>) => setMine({ ...now, ...patch });
  return (
    <section aria-labelledby="sig-edit" className="sp-panel-dark flex flex-col gap-4 p-4 tablet:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="sig-edit" className="sp-label sp-label-dark">
          Your signature
        </h2>
        <p className="m-0 text-small text-text-muted">Your pad colour and screen line. Everything you post carries them across Stash.</p>
      </div>
      <div role="radiogroup" aria-label="Pad colour" className="sp-sig-pads">
        {SIG_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={now.color === c.id}
            aria-label={c.name}
            className="sp-sig-pad"
            style={{ ["--sig" as string]: sigVar(c.id as SigColor) }}
            onClick={() => save({ color: c.id })}
          />
        ))}
      </div>
      <div className="sp-bezel">
        <form className="sp-lcd sp-lcd-search" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="sig-msg">LINE&gt;</label>
          <input
            id="sig-msg"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={SIG_MAX}
            value={text}
            placeholder="TAG ME IF YOU FLIP IT"
            onChange={(e) => {
              const v = cleanMessage(e.target.value);
              setText(v);
              save({ message: v.trim() });
            }}
          />
          <kbd aria-hidden="true">{`${text.length}/${SIG_MAX}`}</kbd>
        </form>
      </div>
    </section>
  );
}
