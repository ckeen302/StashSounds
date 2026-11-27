import type { ReactNode } from "react";
import { useQuery } from "./search-ui";
import { withoutToken } from "./smart-search";

/**
 * The library pages' header in the Sampler look: the page is a bank on the machine, so its name, a
 * one-line note and its own search sit on the green screen (sampler.css: .sp-bezel, .sp-lcd).
 * Actions (an upload key, the filters key) sit on the panel beside the screen.
 */
export function BankHead({
  kicker,
  title,
  blurb,
  search,
  actions,
  hero,
}: {
  kicker: string;
  title: string;
  blurb?: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
  /** The page's one big moment (heroes/): an instrument to play, beside the screen. */
  hero?: ReactNode;
}) {
  if (hero)
    return (
      <header className="sp-hero">
        <div className="sp-bezel sp-hero-screen min-w-0">
          <div className="sp-lcd flex h-full flex-col gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="sp-lcd-small">{kicker}</span>
              <h1 className="sp-lcd-title sp-hero-title break-words">{title}</h1>
              {blurb && <p className="sp-lcd-small m-0">{blurb}</p>}
            </div>
            {search && (
              <div className="mt-auto flex flex-col gap-3">
                <hr className="sp-lcd-rule" />
                {search}
              </div>
            )}
          </div>
        </div>
        <div className="sp-hero-stage min-w-0">{hero}</div>
        {actions && <div className="sp-hero-actions flex flex-wrap gap-2">{actions}</div>}
      </header>
    );
  return (
    <header className="flex flex-col gap-3 tablet:flex-row tablet:items-stretch">
      <div className="sp-bezel min-w-0 flex-1">
        <div className="sp-lcd flex flex-col gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="sp-lcd-small">{kicker}</span>
            <h1 className="sp-lcd-title break-words">{title}</h1>
            {blurb && <p className="sp-lcd-small m-0">{blurb}</p>}
          </div>
          {search && (
            <>
              <hr className="sp-lcd-rule" />
              {search}
            </>
          )}
        </div>
      </div>
      {actions && (
        <div className="lib-head-actions flex flex-wrap items-end gap-2 tablet:w-48 tablet:flex-col tablet:items-stretch">
          <span aria-hidden="true" className="sp-grille hidden min-h-12 flex-1 tablet:block" />
          {actions}
        </div>
      )}
    </header>
  );
}

/** The page's own search, typed on the screen after a SEARCH&gt; prompt. */
export function LcdSearch({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <form role="search" className="sp-lcd-search" onSubmit={(e) => e.preventDefault()}>
      <label htmlFor={id} aria-hidden="true">
        SEARCH&gt;
      </label>
      <input
        id={id}
        type="search"
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </form>
  );
}

/** The smart search on the screen: what it understood shows underneath, and tapping a word drops it. */
export function LcdSmartSearch({
  id,
  value,
  onChange,
  placeholder,
  label = "Search by sound, tempo, key, genre or producer",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label?: string;
}) {
  const q = useQuery(value);
  return (
    <div className="flex flex-col gap-2">
      <LcdSearch id={id} label={label} placeholder={placeholder} value={value} onChange={onChange} />
      {!q.empty && (
        <div role="group" aria-label="What the search understood" className="flex flex-wrap items-center gap-2">
          <span className="sp-lcd-small">READS&gt;</span>
          {q.tokens.map((t) => (
            <button key={`${t.kind}-${t.raw}`} type="button" className="sp-lcd-row" data-on aria-label={`${t.label}. Remove`} onClick={() => onChange(withoutToken(value, t))}>
              {`${t.label} ×`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
