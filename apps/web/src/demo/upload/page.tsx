import { BankHead } from "../bank-head";
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
import { GENRES } from "../explore";
import { Dropdown } from "../presets/page";
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

const KINDS: { id: Kind; name: string }[] = [
  { id: "loop", name: "Loop" },
  { id: "oneshot", name: "One-shot" },
  { id: "midi", name: "MIDI" },
  { id: "kit", name: "Drum kit" },
];

const LICENSES: { id: License; name: string }[] = [
  { id: "royalty_free", name: "Royalty free" },
  { id: "credit_required", name: "Credit required" },
];

const INSTRUMENTS = ["Piano", "Keys", "Synth", "Bells", "Pad", "Strings", "Guitar", "Flute", "Brass", "Vocal", "808", "Bass", "Drums", "Other"];
const DAWS = ["FL Studio", "Ableton Live", "Logic Pro", "Pro Tools", "Studio One", "Reason", "Cubase", "BandLab", "Other"];
const NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const KEYS: [string, string][] = [["", "None"]];
for (const n of NOTES) KEYS.push([`${n} minor`, `${n} minor`], [`${n} major`, `${n} major`]);

/** One line under the type picker: what files this kind takes. */
function specOf(kind: Kind): string {
  const list = (f: readonly string[]) => f.map((x) => x.toUpperCase()).join(", ");
  switch (kind) {
    case "loop":
      return `${list(limits.loop.formats)} · up to ${mb(limits.loop.maxBytes)} · up to ${secondsText(limits.loop.maxDurationMs)}`;
    case "oneshot":
      return `${list(limits.oneshot.formats)} · up to ${mb(limits.oneshot.maxBytes)} each · up to ${secondsText(limits.oneshot.maxDurationMs)}`;
    case "midi":
      return `${list(limits.midi.formats)} · up to ${mb(limits.midi.maxBytes)}`;
    case "kit":
      return "A folder of WAV, AIFF, MP3, OGG or FLAC one-shots";
  }
}

const ICON = { pass: CircleCheck, warn: TriangleExclamationPoint, fail: CircleExclamationPoint } as const;
const TONE = { pass: "text-type-preset", warn: "text-type-oneshot", fail: "text-type-kit" } as const;

function CheckList({ checks }: { checks: Check[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {checks.filter((c) => c.verdict !== "pass").map((c) => {
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

type LoopForm = {
  title: string;
  bpm: string;
  key: string;
  instrument: string;
  genre: string;
  daw: string;
  tags: string;
  description: string;
  license: License;
  rights: boolean;
  tried: boolean;
};

/** "C minor" from what the file name gave ("Cm", "C min", "c minor"), or "" when it isn't one of the 24. */
function keyOption(k: string | null): string {
  const m = /^([A-G][#b]?)\s*(m|min|minor|maj|major)?$/i.exec((k ?? "").trim());
  if (!m) return "";
  const note = m[1]![0]!.toUpperCase() + m[1]!.slice(1);
  const v = `${note} ${m[2] && !/^maj/i.test(m[2]) ? "minor" : "major"}`;
  return KEYS.some(([x]) => x === v) ? v : "";
}

function LoopDetails({ r, onPosted, onDrop }: { r: AudioReport; onPosted: () => void; onDrop: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<LoopForm>({
    title: cleanName(r.fileName)
      .replace(/\b\d{2,3}\s*(bpm)?\b/gi, "")
      .replace(/\b[A-G][#b]?(m|min|minor|maj|major)\b/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    bpm: r.bpm ? String(r.bpm) : "",
    key: keyOption(r.key),
    instrument: "",
    genre: "",
    daw: "",
    tags: "",
    description: "",
    license: "royalty_free",
    rights: false,
    tried: false,
  });
  const [busy, setBusy] = useState(false);
  const bpm = Number(f.bpm);
  const errors = {
    title: !f.title.trim() ? "Add a title." : f.title.trim().length > limits.text.titleMax ? `Up to ${limits.text.titleMax} characters.` : undefined,
    bpm: !f.bpm ? "Add the BPM." : !Number.isFinite(bpm) || bpm < limits.bpm.min || bpm > limits.bpm.max ? `${limits.bpm.min} to ${limits.bpm.max}.` : undefined,
    tags: readTags(f.tags).error,
    rights: f.rights ? undefined : "Tick this to post.",
  };
  const ok = !Object.values(errors).some(Boolean);
  const show = (e: string | undefined) => (f.tried ? e : undefined);

  return (
    <form
      className="flex flex-col gap-4 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setF({ ...f, tried: true });
        if (!ok || !r.data) return;
        setBusy(true);
        const extra = [f.instrument, f.genre].filter(Boolean).map((t) => t.toLowerCase());
        const tags = [...new Set([...readTags(f.tags).tags, ...extra])].slice(0, limits.tags.perItem);
        void postLoop(
          {
            title: f.title.trim(),
            bpm,
            key: f.key || null,
            tags,
            license: f.license,
            durationMs: r.durationMs,
            ext: r.ext,
            instrument: f.instrument || null,
            genre: f.genre || null,
            daw: f.daw || null,
            description: f.description.trim() || null,
          },
          r.data,
        )
          .then((l) => {
            toast({ tone: "success", title: "Loop posted", description: l.title });
            onPosted();
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="grid grid-cols-1 gap-3 tablet:grid-cols-[1fr_8rem]">
        <TextInput label="Title" value={f.title} maxLength={limits.text.titleMax} error={show(errors.title)} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <TextInput label="BPM" inputMode="numeric" value={f.bpm} error={show(errors.bpm)} onChange={(e) => setF({ ...f, bpm: e.target.value.replace(/[^\d.]/g, "") })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Dropdown name="Key" value={f.key || "None"} selected={f.key} options={KEYS} active={!!f.key} onPick={(v) => setF({ ...f, key: v })} />
        <Dropdown name="Instrument" value={f.instrument || "Pick"} selected={f.instrument} options={INSTRUMENTS.map((x): [string, string] => [x, x])} active={!!f.instrument} onPick={(v) => setF({ ...f, instrument: v })} />
        <Dropdown name="Genre" value={f.genre || "Pick"} selected={f.genre} options={GENRES.map((g): [string, string] => [g.name, g.name])} active={!!f.genre} onPick={(v) => setF({ ...f, genre: v })} />
        <Dropdown name="DAW" value={f.daw || "Pick"} selected={f.daw} options={DAWS.map((x): [string, string] => [x, x])} active={!!f.daw} onPick={(v) => setF({ ...f, daw: v })} />
      </div>
      <TextInput label="Tags" placeholder="dark, piano, metro" value={f.tags} error={show(errors.tags)} onChange={(e) => setF({ ...f, tags: e.target.value })} />
      <label className="flex flex-col gap-2">
        <span className="text-small text-text-muted">Description</span>
        <textarea
          rows={3}
          maxLength={500}
          value={f.description}
          placeholder="Works for Future, Southside type beats"
          onChange={(e) => setF({ ...f, description: e.target.value })}
          className="rounded-control border border-border-strong bg-bg px-3 py-2 text-body text-text outline-none placeholder:text-text-muted ui-hover:border-text-muted focus:outline-2 focus:outline-offset-2 focus:outline-accent"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        {LICENSES.map((l) => (
          <FilterChip key={l.id} selected={f.license === l.id} onToggle={() => setF({ ...f, license: l.id })}>
            {l.name}
          </FilterChip>
        ))}
      </div>
      <label className="flex items-start gap-2 text-small text-text">
        <input type="checkbox" checked={f.rights} onChange={(e) => setF({ ...f, rights: e.target.checked })} className="mt-0.5 size-4 accent-accent" />
        <span>I made this and it has no uncleared samples.</span>
      </label>
      {show(errors.rights) && <p className="text-small text-type-kit">{errors.rights}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" icon={Upload} loading={busy}>
          Post loop
        </Button>
        <Button type="button" variant="ghost" onClick={onDrop}>
          Cancel
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

  const postHits = async () => {
    const n = await postShots(
      accepted
        .filter((r) => r.data)
        .map((r) => ({ name: cleanName(r.fileName), category: categoryOf(r.fileName), durationMs: r.durationMs, data: r.data!, ext: r.ext })),
    );
    toast({ tone: "success", title: n === 1 ? "One-shot posted" : `${n} one-shots posted` });
    setReports([]);
    navigate("/one-shots");
  };

  return (
    <main className="mx-auto flex w-full max-w-prose flex-col gap-6 px-3 py-5 tablet:px-4">
      <BankHead
        kicker="LOAD · RENDER TO STASH"
        title="Upload"
        blurb={audio ? specOf(kind) : "Pick what you're posting, then load the file."}
      />

      <section aria-label="Steps" className="flex flex-col gap-2">
        <div className="sp-steps" aria-hidden="true">
          <span className="sp-step" data-on="" />
          <span className="sp-step" data-on={reports.length > 0 || !audio ? "" : undefined} />
          <span className="sp-step" data-on={accepted.length > 0 ? "" : undefined} />
          <span className="sp-step" />
        </div>
        <div className="grid grid-cols-4 gap-2 sp-label" aria-hidden="true">
          <span>01 Pick</span>
          <span>02 Load</span>
          <span>03 Check</span>
          <span>04 Post</span>
        </div>
      </section>

      <div role="radiogroup" aria-label="What are you posting?" className="sp-pads sp-cols-4">
        {KINDS.map((k, i) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={kind === k.id}
            data-hot={kind === k.id || undefined}
            className="sp-pad"
            onClick={() => {
              setKind(k.id);
              setReports([]);
            }}
          >
            <span className="sp-pad-code">{`L0${i + 1}`}</span>
            <span className="sp-pad-label">{k.name}</span>
          </button>
        ))}
      </div>

      {kind === "midi" && <MidiUpload embedded />}
      {kind === "kit" && <KitUploadPage embedded />}

      {audio && (
        <>
          {(kind === "oneshot" || reports.length === 0) && (
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
              className="sp-bezel"
            >
              <div data-over={over || undefined} className="sp-lcd lib-drop">
              <p className="sp-lcd-text m-0">{checking ? "Checking…" : "Drop a file to post it"}</p>
              <p className="sp-lcd-small m-0">{kind === "loop" ? "WAV, AIFF, FLAC or MP3, or tap to choose" : "Drop your one-shots, or tap to choose"}</p>
              <label className="sp-key focus-within:outline-2 focus-within:outline-offset-2">
                Choose file
                <input
                  type="file"
                  multiple={kind === "oneshot"}
                  accept="audio/*,.wav,.aif,.aiff,.flac,.mp3"
                  className="sr-only"
                  onChange={(e) => {
                    void add([...(e.target.files ?? [])].slice(0, kind === "loop" ? 1 : 40));
                    e.target.value = "";
                  }}
                />
              </label>
              </div>
            </section>
          )}

          {reports.length > 0 && (
            <section aria-label="Your file" className="flex flex-col gap-3">
              {kind === "oneshot" && accepted.length > 0 && (
                <button type="button" className="sp-key sp-key-hot lib-post self-start" onClick={() => void postHits()}>
                  <Upload className="size-5" aria-hidden="true" />
                  {`Post ${accepted.length} ${accepted.length === 1 ? "one-shot" : "one-shots"}`}
                </button>
              )}
              <ul className="flex flex-col gap-3">
                {reports.map((r) => (
                  <li key={r.id} data-rejected={!r.accepted || undefined} className="lib-loop lib-report flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-3">
                      {r.accepted && r.data ? (
                        <PlayButton title={r.fileName} state="paused" onClick={() => void play({ name: r.fileName, category: "other", durationMs: r.durationMs, data: r.data! }, r.id)} />
                      ) : null}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body-strong text-text">{r.fileName}</span>
                        <span className="block text-small text-text-muted">{[r.durationMs ? secondsText(r.durationMs) : null, sizeText(r.bytes), kind === "oneshot" && r.accepted ? categoryOf(r.fileName) : null].filter(Boolean).join(" · ")}</span>
                      </span>
                      {!r.accepted && <Verdict accepted={false} />}
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
              <div className="sp-head">
                <h2 className="sp-label">Your loops</h2>
              </div>
              <ul className="lib-loops">
                {mine.map((l) => (
                  <li key={l.id} className="lib-row flex min-h-16 items-center gap-3 px-3 py-2">
                    <PlayButton title={l.title} state="paused" onClick={() => void play(asSound(l))} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-strong text-text">{l.title}</span>
                      <span className="block truncate text-small text-text-muted">{[`${l.bpm} BPM`, l.key, l.daw, l.tags.join(", ")].filter(Boolean).join(" · ")}</span>
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
