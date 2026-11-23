import type { ItemStatus, OwnItem } from "@stash/contracts";
import type {} from "./css-vars.ts";
import { cx } from "./cx.ts";
import { Check, CircleExclamationPoint, Flag, Icon } from "./icon.tsx";
import { Spinner } from "./spinner.tsx";

/** Where an upload card is. Design spec: Upload (uploading, analyzing, ready) plus flagged. */
export type UploadStep = "uploading" | "analyzing" | "ready" | "flagged";
export type StepStatus = "active" | "done" | "failed";

/**
 * Where an upload card is, from the item's status and its processing job (contracts OwnItem). Null
 * for a removed item, which has no upload card. Before the worker has a job, the file is still on
 * its way up; a failed job fails the analyze step.
 */
export function uploadStepFor(status: ItemStatus, job: OwnItem["job"]): { step: UploadStep; status: StepStatus } | null {
  switch (status) {
    case "draft":
      if (!job) return { step: "uploading", status: "active" };
      return { step: "analyzing", status: job.status === "failed" ? "failed" : "active" };
    case "processing":
      return { step: "analyzing", status: job?.status === "failed" ? "failed" : "active" };
    case "ready":
    case "published":
      return { step: "ready", status: "done" };
    case "flagged":
      return { step: "flagged", status: "done" };
    case "removed":
      return null;
  }
}

type StepView = { key: string; label: string; state: "pending" | "active" | "done" | "failed" | "flagged" };

const ORDER = ["uploading", "analyzing", "ready"] as const;
const LABELS = { uploading: "Upload", analyzing: "Analyze", ready: "Ready", flagged: "Flagged" } as const;

function views(step: UploadStep, status: StepStatus): StepView[] {
  if (step === "flagged") {
    return [
      { key: "uploading", label: LABELS.uploading, state: "done" },
      { key: "analyzing", label: LABELS.analyzing, state: "done" },
      { key: "flagged", label: LABELS.flagged, state: "flagged" },
    ];
  }
  const at = ORDER.indexOf(step);
  return ORDER.map((key, i) => ({
    key,
    label: LABELS[key],
    state: i < at ? "done" : i > at ? "pending" : step === "ready" && status !== "failed" ? "done" : status,
  }));
}

const STATUS_TEXT: Record<StepView["state"], string> = {
  pending: "not started",
  active: "in progress",
  done: "done",
  failed: "failed",
  flagged: "needs review",
};

function Marker({ state }: { state: StepView["state"] }) {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full border";
  if (state === "active") return <span className={cx(base, "border-transparent text-text")}><Spinner size={20} /></span>;
  if (state === "done") return <span className={cx(base, "border-type-preset text-type-preset")}><Icon icon={Check} /></span>;
  if (state === "failed") return <span className={cx(base, "border-type-kit text-type-kit")}><Icon icon={CircleExclamationPoint} /></span>;
  // Flagged is a review, not a failure: neutral, with the flag and the words carrying it.
  if (state === "flagged") return <span className={cx(base, "border-border-strong text-text")}><Icon icon={Flag} /></span>;
  return <span className={cx(base, "border-border-strong")} />;
}

/**
 * Three visible steps an upload card moves through. The upload step carries a progress bar; a
 * failed or flagged step says why in `detail`, in plain words.
 */
export function ProgressSteps({
  step,
  status = "active",
  progress,
  detail,
  className,
}: {
  step: UploadStep;
  status?: StepStatus;
  /** 0 to 1 while uploading. */
  progress?: number;
  /** One line under the steps: detected values while analyzing, the reason when failed or flagged. */
  detail?: string;
  className?: string;
}) {
  const items = views(step, status);
  const uploading = step === "uploading" && status === "active" && progress !== undefined;
  const fraction = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress ?? 0)) : 0;
  const pct = Math.round(fraction * 100);
  const failed = status === "failed";
  return (
    <div className={cx("flex min-w-0 flex-col gap-3", className)}>
      <ol aria-label="Upload progress" className="flex items-center gap-3">
        {items.map((s, i) => (
          <li key={s.key} aria-current={s.state === "active" || s.state === "failed" || s.state === "flagged" ? "step" : undefined} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <Marker state={s.state} />
            <span className={cx("text-label text-label-caps", s.state === "pending" ? "text-text-muted" : "text-text")}>{s.label}</span>
            <span className="sr-only">, {STATUS_TEXT[s.state]}</span>
            {i < items.length - 1 && <span aria-hidden="true" className={cx("h-px min-w-4 flex-1", s.state === "done" ? "bg-border-strong" : "bg-border")} />}
          </li>
        ))}
      </ol>
      {uploading && (
        <div className="flex items-center gap-3">
          <div role="progressbar" aria-label="Uploading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 flex-1 overflow-hidden rounded-full bg-raised">
            <div style={{ "--progress": fraction }} className="h-full w-progress rounded-full bg-text transition-all duration-control" />
          </div>
          <span className="w-10 text-right font-mono text-numeric tabular text-text-muted">{pct}%</span>
        </div>
      )}
      {detail && <p className={cx("text-small", failed ? "text-type-kit" : "text-text-muted")}>{detail}</p>}
    </div>
  );
}
