import type { ReactNode } from "react";

/**
 * The machine's waiting and empty screens. Loading is the screen booting: a line of text typing out
 * and a row of step lights filling. Nothing found is the screen with no signal, and the keys under it
 * are the searches to try instead.
 */

export function BootScreen({ label = "LOADING" }: { label?: string }) {
  return (
    <div className="sp-boot mx-auto w-full max-w-content px-3 py-5 tablet:px-4 desktop:px-6" role="status" aria-live="polite">
      <div className="sp-bezel">
        <div className="sp-lcd sp-boot-screen flex flex-col gap-3">
          <span className="sp-lcd-small">SP-1 SOUND STATION</span>
          <span className="sp-lcd-title sp-boot-line">
            {label}
            <span className="sp-lcd-blink" aria-hidden="true">
              _
            </span>
          </span>
          <span className="sp-boot-steps" aria-hidden="true">
            {Array.from({ length: 16 }, (_, i) => (
              <span key={i} style={{ animationDelay: `${i * 70}ms` }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

export function NoSignal({
  title = "No signal",
  children,
  tries = [],
  onTry,
  onClear,
  more,
}: {
  title?: string;
  children?: ReactNode;
  /** Searches to try instead, as keys. */
  tries?: string[];
  onTry?: (q: string) => void;
  /** Shows a CLEAR key that empties the search. */
  onClear?: () => void;
  /** Anything else to offer: sounds close to what was asked for. */
  more?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4" aria-label={title}>
      <div className="sp-bezel">
        <div className="sp-lcd sp-nosignal flex flex-col gap-2">
          <span className="sp-nosignal-noise" aria-hidden="true" />
          <span className="sp-lcd-small">NO SIGNAL</span>
          <h2 className="sp-lcd-title m-0">{title}</h2>
          {children && <p className="sp-lcd-small m-0">{children}</p>}
          {((tries.length > 0 && onTry) || onClear) && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {tries.length > 0 && onTry && <span className="sp-lcd-small">TRY&gt;</span>}
              {onTry &&
                tries.map((t) => (
                  <button key={t} type="button" className="sp-nosignal-try" onClick={() => onTry(t)}>
                    {t.toUpperCase()}
                  </button>
                ))}
              {onClear && (
                <button type="button" className="sp-nosignal-try sp-nosignal-clear" onClick={onClear}>
                  CLEAR
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {more}
    </section>
  );
}
