import NAMES from "./artist-names.json" with { type: "json" };

/**
 * One spelling per artist. The libraries were gathered from different sources, so the same act
 * shows up as "JAY Z", "Jay Z" and "JAY-Z", or "ASAP Rocky" and "A$AP Rocky". scripts/demo-artist-names.py
 * writes the table (each variant to the spelling the catalog uses most, or the artist's own); this
 * maps every name in a credit through it and keeps the joins ("feat.", "&", ",") as they were.
 */

const TABLE = NAMES as Record<string, string>;
const JOIN = /(\s+(?:feat\.?|featuring|ft\.?|with|x|and|&)\s+|,\s*)/i;

export function canonArtist(credit: string): string {
  const whole = TABLE[credit.trim()];
  if (whole) return whole;
  return credit
    .split(JOIN)
    .map((part, i) => (i % 2 ? part : (TABLE[part.trim()] ?? part)))
    .join("");
}
