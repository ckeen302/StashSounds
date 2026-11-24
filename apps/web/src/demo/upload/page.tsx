import { limits } from "@stash/contracts";
import {
  Button,
  CircleCheck,
  CircleExclamationPoint,
  FilterChip,
  IconButton,
  PlayButton,
  TextInput,
  Trash,
  TriangleExclamationPoint,
  Upload,
  useToast,
  X,
} from "@stash/ui";
import { useState } from "react";
import { KitUploadPage } from "../kits/pages";
import { categoryOf, cleanName, play } from "../kits/store";
import { UploadPage as MidiUpload } from "../midi/pages";
import { postShots } from "../oneshots/store";
import { navigate } from "../router";
import { checkAudio, mb, readTags, secondsText, sizeText, type AudioKind, type AudioReport, type Check } from "./checks";
import { asSound, postLoop, removeLoop, useMyLoops, type License } from "./store";

/**
 * The Upload tab: pick what you're posting (a loop, a one-shot, MIDI or a drum kit), see exactly
 * what's taken, drop files in, and every file is checked against the shared limits. Files that
 * fail are rejected with the reason; files that pass go on to the details and the post.
 */

type Kind = AudioKind | "midi" | "kit";

const KINDS: { id: Kind; name: string; blurb: string; t: string }[] = [
  { id: "loop", name: "Loop", blurb: "A melody, chords or drums that repeat", t: "loop" },
  { id: "oneshot", name: "One-shot", blurb: "A single hit: kick, 808, snare, vox", t: "oneshot" },
  { id: "midi", name: "MIDI", blurb: "Chords, melodies or drum patterns", t: "midi" },
  { id: "kit", name: "Drum kit", blurb: "A folder of one-shots, sorted by type", t: "kit" },
];

const LICENSES: { id: License; name: string; blurb: string }[] = [
  { id: "royalty_free", name: "Royalty free", blurb: "Anyone can use it in a released song, no credit needed." },
  { id: "credit_required", name: "Credit required", blurb: "Free to use; a release must credit you." },
];

function specOf(kind: Kind): [string, string][] {
  const list = (f: readonly string[]) => f.map((x) => `.${x}`).join(", ");
  switch (kind) {
    case "loop":
      return [
        ["Formats", list(limits.loop.formats)],
        ["Size", `Up to ${mb(limits.loop.maxBytes)}`],
        ["Length", `1 to ${secondsText(limits.loop.maxDurationMs)}, cut to whole bars`],
        ["Needs", `A title, the BPM (${limits.bpm.min} to ${limits.bpm.max}), 1 to ${limits.tags.perItem} tags and a license. Key if it has one.`],
        ["Tip", "Put the BPM and key in the file name (dark_keys_140_Cm.wav) and they fill in for you."],
      ];
    case "oneshot":
      return [
        ["Formats", `${list(limits.oneshot.formats)} (lossless only, no MP3)`],
        ["Size", `Up to ${mb(limits.oneshot.maxBytes)} each`],
        ["Length", `Up to ${secondsText(limits.oneshot.maxDurationMs)}`],
        ["Needs", "A name. The type (kick, 808, snare...) is read from the file name."],
        ["Tip", "Trim the silence before the hit so it lands on the grid."],
      ];
    case "midi":
      return [
        ["Formats", list(limits.midi.formats)],
        ["Size", `Up to ${mb(limits.midi.maxBytes)}`],
        ["Length", `Up to ${secondsText(limits.midi.maxDurationMs)} and ${limits.midi.maxNotes.toLocaleString("en")} notes`],
        ["Needs", "A title and the BPM. Key, bars and kind are read from the file."],
        ["Timing", "Beat (PPQ) timing. SMPTE-timed files are turned back with how to fix them."],
      ];
    case "kit":
      return [
        ["Formats", "A folder or a set of wav, aiff, mp3, ogg or flac one-shots"],
        ["Size", "Up to 8 MB and 15 s per sound, 64 sounds per kit in the demo"],
        ["Needs", "A kit name and genre. Each sound is sorted by its file name; fix any that land wrong."],
        ["On Stash", `Kits arrive as a .zip up to ${mb(limits.kit.maxBytes)} and ${limits.kit.maxFiles} files, checked for nested archives and zip bombs.`],
      ];
  }
}

const ICON = { pass: CircleCheck, warn: TriangleExclamationPoint, fail: CircleExclamationPoint } as const;
const TONE = { pass: "text-type-preset", warn: "text-type-oneshot", fail: "text-type-kit" } as const;

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {checks.map((c) => {
        const I = ICON[c.verdict];
        return (
          <li key={c.label} className="flex items-start gap-2 text-small">
            <I className={`mt-0.5 size-4 shrink-0 ${TONE[c.verdict]}`} aria-hidden="true" />
            <span className="w-20 shrink-0 text-text-muted">{c.label}</span>
            <span className="min-w-0 flex-1 text-text">
              <span className="sr-only">{c.verdict === "pass" ? "Passed: " : c.verdict === "warn" ? "Warning: " : "Rejected: "}</span>
              {c.detail}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Verdict({ accepted }: { accepted: boolean }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center rounded-control px-2.5 text-label text-label-caps ${accepted ? "bg-type-preset text-bg" : "bg-type-kit text-bg"}`}>
      {accepted ? "Accepted" : "Rejected"}
    </span>
  );
}

type LoopForm = { title: string; bpm: string; key: string; tags: string; license: License; rights: boolean; tried: boolean };

function LoopDetails({ r, onPosted, onDrop }: { r: AudioReport; onPosted: () => void; onDrop: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<LoopForm>({
    title: cleanName(r.fileName)
      .replace(/\b\d{2,3}\s*(bpm)?\b/gi, "")
      .replace(/\b[A-G][#b]?(m|min|minor|maj|major)\b/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    bpm: r.bpm ? String(r.bpm) : "",
    key: r.key ?? "",
    tags: "",
    license: "royalty_free",
    rights: false,
    tried: false,
  });
  const [busy, setBusy] = useState(false);
  const bpm = Number(f.bpm);
  const errors = {
    title: !f.title.trim() ? "Give it a title." : f.title.trim().length > limits.text.titleMax ? `Up to ${limits.text.titleMax} characters.` : undefined,
    bpm: !f.bpm ? "Enter the BPM." : !Number.isFinite(bpm) || bpm < limits.bpm.min || bpm > limits.bpm.max ? `Between ${limits.bpm.min} and ${limits.bpm.max}.` : undefined,
    key: f.key && !/^[A-G][#b]?\s*(major|minor|maj|min|m)?$/i.test(f.key.trim()) ? "Like “C minor” or “F# major”, or leave it empty." : undefined,
    tags: readTags(f.tags).error,
    rights: f.rights ? undefined : "Confirm you made it or have the rights to share it.",
  };
  const ok = !Object.values(errors).some(Boolean);
  const show = (e: string | undefined) => (f.tried ? e : undefined);
  const bars = Number.isFinite(bpm) && bpm > 0 ? (r.durationMs / 1000) * (bpm / 240) : null;

  return (
    <form
      className="flex flex-col gap-4 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setF({ ...f, tried: true });
        if (!ok || !r.data) return;
        setBusy(true);
        void postLoop(
          { title: f.title.trim(), bpm, key: f.key.trim() || null, tags: readTags(f.tags).tags, license: f.license, durationMs: r.durationMs, ext: r.ext },
          r.data,
        )
          .then((l) => {
            toast({ tone: "success", title: "Loop posted", description: `${l.title} is up, in this browser.` });
            onPosted();
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
        <TextInput label="Title" value={f.title} maxLength={limits.text.titleMax} error={show(errors.title)} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="grid grid-cols-2 gap-3">
          <TextInput
            label="BPM"
            inputMode="numeric"
            value={f.bpm}
            error={show(errors.bpm)}
            hint={bars && !errors.bpm ? `${bars.toFixed(bars % 1 < 0.02 || bars % 1 > 0.98 ? 0 : 2)} bars` : undefined}
            onChange={(e) => setF({ ...f, bpm: e.target.value.replace(/[^\d.]/g, "") })}
          />
          <TextInput label="Key (optional)" placeholder="C minor" value={f.key} error={show(errors.key)} onChange={(e) => setF({ ...f, key: e.target.value })} />
        </div>
        <TextInput
          label={`Tags, comma separated (1 to ${limits.tags.perItem})`}
          placeholder="dark, piano, trap"
          value={f.tags}
          error={show(errors.tags)}
          onChange={(e) => setF({ ...f, tags: e.target.value })}
          className="tablet:col-span-2"
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-small text-text-muted">License</legend>
        <div className="flex flex-wrap gap-2">
          {LICENSES.map((l) => (
            <FilterChip key={l.id} selected={f.license === l.id} onToggle={() => setF({ ...f, license: l.id })}>
              {l.name}
            </FilterChip>
          ))}
        </div>
        <p className="text-small text-text-muted">{LICENSES.find((l) => l.id === f.license)!.blurb}</p>
      </fieldset>
      <label className="flex items-start gap-2 text-small text-text">
        <input type="checkbox" checked={f.rights} onChange={(e) => setF({ ...f, rights: e.target.checked })} className="mt-0.5 size-4 accent-accent" />
        <span>I made this, or I have the rights to share it. No uncleared samples.</span>
      </label>
      {show(errors.rights) && <p className="text-small text-type-kit">{errors.rights}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" icon={Upload} loading={busy}>
          Post loop
        </Button>
        <Button type="button" variant="ghost" onClick={onDrop}>
          Not this one
        </Button>
      </div>
    </form>
  );
}

export function UploadHub() {
  const toast = useToast();
  const mine = useMyLoops();
  const [kind, setKind] = useState<Kind>("loop");
  const [reports, setReports] = useState<AudioReport[]>([]);
  const [checking, setChecking] = useState(false);
  const [over, setOver] = useState(false);
  const audio = kind === "loop" || kind === "oneshot";

  const add = async (files: File[]) => {
    if (!audio || files.length === 0) return;
    setChecking(true);
    try {
      const next: AudioReport[] = [];
      for (const f of files.slice(0, 40)) next.push(await checkAudio(f, kind));
      setReports((r) => [...next, ...r]);
    } finally {
      setChecking(false);
    }
  };
  const drop = (id: string) => setReports((r) => r.filter((x) => x.id !== id));
  const accepted = reports.filter((r) => r.accepted);
  const rejected = reports.length - accepted.length;

  const postHits = async () => {
    const n = await postShots(
      accepted
        .filter((r) => r.data)
        .map((r) => ({ name: cleanName(r.fileName), category: categoryOf(r.fileName), durationMs: r.durationMs, data: r.data!, ext: r.ext })),
    );
    toast({ tone: "success", title: n === 1 ? "One-shot posted" : `${n} one-shots posted`, description: "They're on the One-shots tab, in this browser." });
    setReports([]);
    navigate("/one-shots");
  };

  return (
    <main className="mx-auto flex w-full max-w-content flex-col gap-6 px-3 py-8 tablet:px-4 desktop:px-6">
      <header className="flex flex-col gap-1">
        <span className="text-label text-label-caps text-text-muted">Upload</span>
        <h1 className="text-display text-balance">Post your sounds</h1>
        <p className="max-w-prose text-body text-text-muted">
          Pick what you&apos;re posting. Every file is checked the moment you drop it: what passes goes on to the details, what doesn&apos;t is turned back with the
          reason and how to fix it. In the demo, posts stay in this browser.
        </p>
      </header>

      <div role="radiogroup" aria-label="What are you posting?" className="grid grid-cols-2 gap-3 desktop:grid-cols-4">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            data-t={k.t}
            onClick={() => {
              setKind(k.id);
              setReports([]);
            }}
            className="st-type flex flex-col items-start gap-1 rounded-panel border border-border bg-surface p-4 text-left ui-hover:border-border-strong aria-checked:border-accent aria-checked:bg-raised"
          >
            <span className="flex items-center gap-2">
              <span className="st-dot size-2.5 rounded-full" aria-hidden="true" />
              <span className="text-body-strong text-text">{k.name}</span>
            </span>
            <span className="text-small text-text-muted">{k.blurb}</span>
          </button>
        ))}
      </div>

      <section aria-label={`What a ${KINDS.find((k) => k.id === kind)!.name.toLowerCase()} needs`} className="rounded-panel border border-border bg-surface p-4 tablet:p-5">
        <h2 className="mb-3 text-body-strong text-text">{`What's taken: ${KINDS.find((k) => k.id === kind)!.name.toLowerCase()}s`}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 tablet:grid-cols-2 desktop:grid-cols-3">
          {specOf(kind).map(([k, v]) => (
            <div key={k} className="flex gap-3 tablet:flex-col tablet:gap-1">
              <dt className="w-20 shrink-0 text-label text-label-caps text-text-muted tablet:w-auto">{k}</dt>
              <dd className="min-w-0 text-small text-text">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {kind === "midi" && <MidiUpload embedded />}
      {kind === "kit" && <KitUploadPage embedded />}

      {audio && (
        <>
          <section
            aria-label="Add files"
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void add([...e.dataTransfer.files]);
            }}
            data-over={over || undefined}
            className="flex flex-col items-center gap-3 rounded-panel border-2 border-dashed border-border-strong bg-surface p-8 text-center data-over:border-accent data-over:bg-raised"
          >
            <Upload className="size-8 text-text-muted" aria-hidden="true" />
            <p className="text-body-strong text-text">{kind === "loop" ? "Drop your loops here" : "Drop your one-shots here"}</p>
            <p className="text-small text-text-muted">{checking ? "Checking…" : "Or pick them. Several at once is fine."}</p>
            <label className="cursor-pointer rounded-control border border-border-strong px-4 py-2 text-body-strong text-text ui-hover:border-text focus-within:outline-2 focus-within:outline-accent">
              Choose files
              <input
                type="file"
                multiple
                accept="audio/*,.wav,.aif,.aiff,.flac,.mp3"
                className="sr-only"
                onChange={(e) => {
                  void add([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </label>
          </section>

          {reports.length > 0 && (
            <section aria-label="Checked files" className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-title">{`${accepted.length} accepted${rejected ? `, ${rejected} rejected` : ""}`}</h2>
                <div className="flex flex-wrap gap-2">
                  {rejected > 0 && (
                    <Button variant="ghost" size="sm" icon={X} onClick={() => setReports((r) => r.filter((x) => x.accepted))}>
                      Clear rejected
                    </Button>
                  )}
                  {kind === "oneshot" && accepted.length > 0 && (
                    <Button variant="primary" icon={Upload} onClick={() => void postHits()}>
                      {`Post ${accepted.length} ${accepted.length === 1 ? "one-shot" : "one-shots"}`}
                    </Button>
                  )}
                </div>
              </div>
              <ul className="flex flex-col gap-3">
                {reports.map((r) => (
                  <li key={r.id} data-rejected={!r.accepted || undefined} className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-4 data-rejected:border-type-kit">
                    <div className="flex items-center gap-3">
                      {r.accepted && r.data ? (
                        <PlayButton title={r.fileName} state="paused" onClick={() => void play({ name: r.fileName, category: "other", durationMs: r.durationMs, data: r.data! }, r.id)} />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-strong text-text">{r.fileName}</span>
                        <span className="block text-small text-text-muted">{[r.durationMs ? secondsText(r.durationMs) : null, sizeText(r.bytes), kind === "oneshot" && r.accepted ? categoryOf(r.fileName) : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      <Verdict accepted={r.accepted} />
                      <IconButton icon={X} label={`Remove ${r.fileName}`} onClick={() => drop(r.id)} />
                    </div>
                    <CheckList checks={r.checks} />
                    {kind === "loop" && r.accepted && <LoopDetails r={r} onPosted={() => drop(r.id)} onDrop={() => drop(r.id)} />}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {kind === "loop" && mine.length > 0 && (
            <section aria-label="Your loops" className="flex flex-col gap-3">
              <h2 className="text-title">Your loops</h2>
              <ul className="overflow-hidden rounded-panel border border-border bg-surface">
                {mine.map((l) => (
                  <li key={l.id} className="flex min-h-16 items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
                    <PlayButton title={l.title} state="paused" onClick={() => void play(asSound(l))} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-strong text-text">{l.title}</span>
                      <span className="block truncate text-small text-text-muted">{[`${l.bpm} BPM`, l.key, l.tags.join(", "), LICENSES.find((x) => x.id === l.license)!.name].filter(Boolean).join(" · ")}</span>
                    </span>
                    <IconButton icon={Trash} label={`Remove ${l.title}`} onClick={() => removeLoop(l.id)} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
