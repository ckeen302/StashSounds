import { Icon, type IconComponent } from "@stash/ui";
import type { ReactNode } from "react";

/**
 * The demo's page scaffolding: one width, one gutter, one header shape. Every tab builds on these,
 * so titles, counts and actions sit in the same place on every screen.
 */

export function PageFrame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`ds-page ${className}`}>{children}</main>;
}

/** Eyebrow, title, one line of context, a count, and the page's own actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  lede,
  count,
  actions,
  titleId,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
}) {
  return (
    <header className="ds-head">
      <div className="ds-head-text">
        {eyebrow && <span className="ds-eyebrow">{eyebrow}</span>}
        <h1 id={titleId} className="text-title">
          {title}
        </h1>
        {lede && <p>{lede}</p>}
        {count && <span className="ds-count">{count}</span>}
      </div>
      {actions && <div className="ds-head-actions">{actions}</div>}
    </header>
  );
}

/** A section title with an optional link out on the right. */
export function SectionTitle({ title, sub, action, id }: { title: string; sub?: string; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id={id} className="text-title">
          {title}
        </h2>
        {sub && <p className="text-small text-text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/** A filter rail item: a name, a count, and an optional color dot. */
export function RailItem({
  on,
  onClick,
  name,
  n,
  cat,
}: {
  on: boolean;
  onClick: () => void;
  name: string;
  n?: number;
  cat?: string;
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="ds-rail-item">
      {cat !== undefined && <span className="ds-rail-dot" data-cat={cat} style={cat ? undefined : { background: "var(--color-text-muted)" }} aria-hidden="true" />}
      <span className="truncate">{name}</span>
      {n !== undefined && <span className="ds-rail-n">{n.toLocaleString("en")}</span>}
    </button>
  );
}

/** A two-way (or more) switch: the views of one list. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="ds-seg">
      {options.map(([v, name]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {name}
        </button>
      ))}
    </div>
  );
}

/** An empty state that says what goes here and how to get it there. */
export function Empty({ icon, title, children, action }: { icon: IconComponent; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <span className="ds-empty-icon" aria-hidden="true">
        <Icon icon={icon} size={20} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-body-strong text-text">{title}</p>
        <p className="max-w-prose text-small text-text-muted">{children}</p>
      </div>
      {action}
    </div>
  );
}
