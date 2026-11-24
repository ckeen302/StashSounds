/**
 * Saving a file from the demo. On the published page the browser's own download is blocked, so the
 * file goes through the page's `downloads` capability, which takes zip but not mp3 or wav: audio is
 * wrapped in a zip there. Anywhere else (a local build) it is a plain browser download.
 */

type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<{ status: string }> };
type Host = { use?: (name: "downloads") => Promise<Downloads | null> };

let host: Promise<Downloads | null> | null = null;
function downloads(): Promise<Downloads | null> {
  const claude = (globalThis as { claude?: Host }).claude;
  if (!claude?.use) return Promise.resolve(null);
  host ??= claude.use("downloads").catch(() => null);
  return host;
}

// Start asking as soon as the page loads, so the first click does not wait on it.
void downloads();

export type SaveOutcome = "saved" | "declined" | "failed";

/** Saves `files` (one audio file, or a whole kit) as `zipName`.zip on the published page. */
export async function saveFiles(zipName: string, files: { name: string; data: Blob }[]): Promise<SaveOutcome> {
  const d = await downloads();
  if (d) {
    try {
      const zip = await makeZip(files);
      await d.save({ filename: `${zipName}.zip`, data: zip });
      return "saved";
    } catch (err) {
      return (err as { code?: string }).code === "declined" ? "declined" : "failed";
    }
  }
  // A local build: the browser saves each file itself.
  for (const f of files) {
    const url = URL.createObjectURL(f.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "saved";
}

/** True on the published page, where saves come as a zip. */
export async function savesAsZip(): Promise<boolean> {
  return (await downloads()) !== null;
}

// ---------------------------------------------------------------------------------------------
// A stored (uncompressed) zip: audio does not compress, and stored entries need only a CRC.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export async function makeZip(files: { name: string; data: Blob }[]): Promise<Blob> {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name.replace(/[\\:*?"<>|]/g, " ").replace(/^\/+|\/{2,}/g, "").trim() || "file";
    for (let i = 2; used.has(name); i++) name = name.replace(/(\.[^.]*)?$/, ` ${i}$1`);
    used.add(name);
    const nameBytes = new Uint8Array(enc.encode(name));
    const data = new Uint8Array(await f.data.arrayBuffer());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local.buffer, nameBytes, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    const c = new Uint8Array(46 + nameBytes.length);
    c.set(new Uint8Array(entry.buffer), 0);
    c.set(nameBytes, 46);
    central.push(c);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: "application/zip" });
}

/** Fetches a published file and saves it under `fileName` (inside `<name>.zip` on the published page). */
export async function saveFetched(url: string, fileName: string): Promise<SaveOutcome> {
  const res = await fetch(url);
  if (!res.ok) return "failed";
  return saveFiles(fileName.replace(/\.[^.]+$/, ""), [{ name: fileName, data: await res.blob() }]);
}

/** 16-bit PCM wav. */
export function wav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels;
  const len = buf.length * ch * 2;
  const view = new DataView(new ArrayBuffer(44 + len));
  const str = (o: number, s: string) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  view.setUint32(4, 36 + len, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, len, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, data[c]![i]!));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: "audio/wav" });
}
