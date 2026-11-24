"use client";

import { LICENSE_LABELS as LICENSES } from "@stash/contracts/format";
import { CircleCheck, Icon } from "@stash/ui";
import type { DownloadResult, ItemActions } from "./actions";

/** Saves a download: follows a signed attachment URL, or fetches a local file into a blob first. */
export async function saveFile(how: ItemActions["save"], url: string, fileName: string): Promise<void> {
  let href = url;
  let revoke: string | null = null;
  if (how === "blob") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    href = revoke = URL.createObjectURL(await res.blob());
  }
  const a = document.createElement("a");
  a.href = href;
  a.download = fileName;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 10_000);
}

/** The license the visitor now holds, drawn from the record requestDownload returned. */
export default function LicenseRecord({ record }: { record: DownloadResult }) {
  return (
    <div role="status" data-license-record className="flex items-start gap-3 rounded-control border border-border bg-bg p-3">
      <Icon icon={CircleCheck} className="text-type-preset" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body-strong text-text">
          Downloaded under {LICENSES[record.license].label} {record.licenseVersion}
        </p>
        <p className="truncate font-mono text-numeric tabular text-text-muted">{record.fileName}</p>
        <p className="text-small text-text-muted">The license record is kept in your library under Downloads.</p>
      </div>
    </div>
  );
}

