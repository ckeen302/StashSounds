/**
 * The name a downloaded file is saved as: built from the item's title (and a kit sample's name),
 * with the extension of the stored original. Never from a path or anything the request sends.
 */

/** In code points, so a cap never splits a surrogate pair (encodeURIComponent throws on one). */
const MAX_BASE = 100;

function clean(text: string): string {
  return text
    .normalize("NFC")
    // C0 and C1 controls (CR, LF, NUL), format characters (bidi overrides such as U+202E, zero
    // widths, BOM) and the line and paragraph separators.
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ")
    .replace(/[/\\";:*?<>|]/g, " ") // path separators and characters file systems or headers reject
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, ""); // no leading dots (hidden or relative names), no trailing dots
}

/** The stored original's extension, lowercased; "" when it has none. */
function extensionOf(path: string): string {
  const last = path.split("/").pop() ?? "";
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(last);
  return m ? m[1]!.toLowerCase() : "";
}

export function downloadFileName(title: string, originalPath: string, sampleName?: string): string {
  const parts = [clean(title), sampleName === undefined ? "" : clean(sampleName)].filter(Boolean);
  const base = Array.from(parts.join(" - ") || "download")
    .slice(0, MAX_BASE)
    .join("")
    .replace(/[.\s]+$/, "");
  const ext = extensionOf(originalPath);
  return ext ? `${base}.${ext}` : base;
}

/** RFC 6266 attachment with an ASCII fallback and the UTF-8 name (RFC 5987). */
export function contentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]|["\\']/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
