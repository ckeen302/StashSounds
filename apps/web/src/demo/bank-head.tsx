import type { ReactNode } from "react";
import { useQuery } from "./search-ui";
import { withoutToken } from "./smart-search";

/**
 * The library pages' header in the Sampler look. The page's name is printed on the panel, calm, the
 * way a machine labels its sections; the only screen in it is the search, a slim strip of green.
 * Hardware is kept for the frame and for the page's one hero (heroes/), so the sounds stand out.
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
  /** The page's one big moment (heroes/): an instrument to play, beside the name. */
  hero?: ReactNode;
}) {
  if (hero)
    return (
      <header className="sp-hero">
        <Plate kicker={kicker} title={title} blurb={blurb} search={search} className="sp-hero-screen" big />
        <div className="sp-hero-stage min-w-0">{hero}</div>
        {actions && <div className="sp-hero-actions flex flex-wrap gap-2">{actions}</div>}
      </header>
    );
  return (
    <header className="flex flex-col gap-3 tablet:flex-row tablet:items-end">
      <Plate kicker={kicker} title={title} blurb={blurb} search={search} className="flex-1" />
      {actions && <div className="lib-head-actions flex flex-wrap items-end gap-2 tablet:w-48 tablet:flex-col tablet:items-stretch">{actions}</div>}
    </header>
  );
}

/**
 * A page's name printed on the panel: a small stencil label with the one orange light, the name in
 * the wordmark's type, a quiet line, and, when there is one, the search on a slim screen.
 */
export function Plate({
  kicker,
  title,
  blurb,
  search,
  className = "",
  big = false,
  children,
}: {
  kicker: ReactNode;
  title: ReactNode;
  blurb?: ReactNode;
  search?: ReactNode;
  className?: string;
  big?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={`sp-plate min-w-0 ${className}`}>
      <span className="sp-label sp-plate-kicker">
        <span className="sp-plate-led sp-beat" aria-hidden="true" />
        {kicker}
      </span>
      <h1 className={`sp-plate-title break-words ${big ? "sp-plate-title-big" : ""}`}>{title}</h1>
      {blurb && <p className="sp-plate-blurb">{blurb}</p>}
      {children}
      {search && <LcdStrip>{search}</LcdStrip>}
    </div>
  );
}

/** A slim screen: one line of green on the dark bezel, for a search or a short readout. */
export function LcdStrip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`sp-bezel sp-strip ${className}`}>
      <div className="sp-lcd sp-strip-lcd">{children}</div>
    </div>
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
