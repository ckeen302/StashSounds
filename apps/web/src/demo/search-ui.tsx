import { FilterChip, SearchInput, TagChip } from "@stash/ui";
import { useMemo } from "react";
import { parseQuery, withoutToken, type Query } from "./smart-search";

/**
 * The search box producers type into, with what it understood shown underneath as chips (tap one to
 * drop it) and example searches when it is empty.
 */

const KIND_LABEL = { style: "Style", genre: "Genre", sound: "Sound", mood: "Mood", bpm: "Tempo", key: "Key", word: "Word" } as const;

export function useQuery(text: string): Query {
  return useMemo(() => parseQuery(text), [text]);
}

export function SmartSearch({
  value,
  onChange,
  examples,
  label = "Search by sound, tempo, key, genre or producer",
  placeholder = "Try: dark piano 140 like metro",
}: {
  value: string;
  onChange: (v: string) => void;
  examples: string[];
  label?: string;
  placeholder?: string;
}) {
  const q = useQuery(value);
  return (
    <div className="flex flex-col gap-2">
      <SearchInput label={label} hideLabel placeholder={placeholder} shortcut="" value={value} onChange={(e) => onChange(e.target.value)} onClear={() => onChange("")} />
      {q.empty ? (
        examples.length > 0 && <div className="flex flex-wrap items-center gap-2">
          <span className="text-label text-label-caps text-text-muted">Try</span>
          {examples.map((x) => (
            <TagChip key={x} onClick={() => onChange(x)}>
              {x}
            </TagChip>
          ))}
        </div>
      ) : (
        <div role="group" aria-label="What the search understood" className="flex flex-wrap items-center gap-2">
          <span className="text-label text-label-caps text-text-muted">Searching for</span>
          {q.tokens.map((t) => (
            <FilterChip key={`${t.kind}-${t.raw}`} selected onRemove={() => onChange(withoutToken(value, t))} aria-label={`${KIND_LABEL[t.kind]}: ${t.label}. Remove`}>
              {t.label}
            </FilterChip>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Matches: 140 BPM · Piano · Metro Boomin style", under a result. */
export function Why({ why }: { why: string[] }) {
  if (!why.length) return null;
  return <p className="text-small text-accent">{`Matches ${why.join(" · ")}`}</p>;
}
