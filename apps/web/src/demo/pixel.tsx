/**
 * Pixel art for the Console look. Each sprite is rows of palette keys ("." is empty), drawn as crisp
 * SVG squares. Colors come from the --px-* custom properties in demo.css, so no raw colors live here.
 */

const KEYS: Record<string, string> = {
  K: "var(--px-k)",
  W: "var(--px-white)",
  G: "var(--px-lgray)",
  D: "var(--px-dgray)",
  N: "var(--px-navy)",
  R: "var(--px-red)",
  O: "var(--px-orange)",
  Y: "var(--px-yellow)",
  L: "var(--px-green)",
  B: "var(--px-blue)",
  V: "var(--px-lav)",
  I: "var(--px-pink)",
  S: "var(--px-peach)",
  H: "var(--px-brown)",
};

export const SPRITES = {
  logo: [
    "..KKKKKKKKKK..",
    ".KYYYYYYYYYYK.",
    "KYYKKKKKKKKYYK",
    "KYKRRRKKBBBKYK",
    "KYKRRRKKBBBKYK",
    "KYKKKKKKKKKKYK",
    "KYKLLLKKIIIKYK",
    "KYKLLLKKIIIKYK",
    "KYKKKKKKKKKKYK",
    "KYYYYYYYYYYYYK",
    ".KYYYYYYYYYYK.",
    "..KKKKKKKKKK..",
  ],
  producer: [
    ".....KKKKKK.....",
    "....KHHHHHHK....",
    "...KHHHHHHHHK...",
    "..KKKKKKKKKKKK..",
    "..KDKSSSSSSKDK..",
    ".KDDKSKSSKSKDDK.",
    ".KDDKSSSSSSKDDK.",
    "..KDKSSKKSSKDK..",
    "....KSSSSSSK....",
    "...KKKSSSSKKK...",
    "..KRRRKKKKRRRK..",
    ".KRRRRRRRRRRRRK.",
    ".KRRKRRRRRRKRRK.",
    ".KSSKRRRRRRKSSK.",
    "..KKKBBBBBBKKK..",
    "....KBBKKBBK....",
  ],
  sampler: [
    "KKKKKKKKKKKKKKKKKKKK",
    "KGGGGGGGGGGGGGGGGGGK",
    "KGKKKKKKKKKGGDGDGDGK",
    "KGKLLLLLLLKGGGGGGGGK",
    "KGKLKLLKLLKGDKGDKGDK",
    "KGKKKKKKKKKGGGGGGGGK",
    "KGGGGGGGGGGGGGGGGGGK",
    "KGRRKOOKYYKIIKGGGGGK",
    "KGRRKOOKYYKIIKGDDDGK",
    "KGGGGGGGGGGGGGGGGGGK",
    "KGBBKDDKDDKLLKGDDDGK",
    "KGBBKDDKDDKLLKGGGGGK",
    "KGGGGGGGGGGGGGGGGGGK",
    "KDDDDDDDDDDDDDDDDDDK",
    "KKKKKKKKKKKKKKKKKKKK",
  ],
  speaker: [
    "KKKKKKKK",
    "KDDDDDDK",
    "KDKKKKDK",
    "KKGGGGKK",
    "KKGKKGKK",
    "KKGGGGKK",
    "KDKKKKDK",
    "KDDDDDDK",
    "KDKKKKDK",
    "KKKGGKKK",
    "KKGKKGKK",
    "KKGKKGKK",
    "KKKGGKKK",
    "KKKKKKKK",
  ],
  keys: [
    "KKKKKKKKKKKK",
    "KRKOKYKLKBKK",
    "KKKKKKKKKKKK",
    "KWKKWKKKWKWK",
    "KWKKWKKKWKWK",
    "KWWKWWKWWKWK",
    "KWWKWWKWWKWK",
    "KKKKKKKKKKKK",
  ],
  flute: [
    "..........KK",
    ".........KYK",
    "........KYK.",
    ".......KYK..",
    "......KYKK..",
    ".....KYK....",
    "....KYKK....",
    "...KYK......",
    "..KYKK......",
    ".KYK........",
    "KYK.........",
    "KK..........",
  ],
  bell: [
    ".....KK.....",
    "....KYYK....",
    "...KYYYYK...",
    "..KYYWYYYK..",
    "..KYWYYYYK..",
    "..KYYYYYYK..",
    ".KYYYYYYYYK.",
    "KYYYYYYYYYYK",
    "KKKKKKKKKKKK",
    "....KOOK....",
    ".....KK.....",
  ],
  wave: [
    "............",
    "..K.........",
    ".KBK....K...",
    ".KBK...KBK..",
    "KBKBK..KBK.K",
    "KBKBK.KBKBKB",
    "KBKBKKKBKBKB",
    "K.KBKBKBK.KB",
    "...KBKBK...K",
    "....KBK.....",
    ".....K......",
    "............",
  ],
  bass: [
    "....KKKK....",
    "..KKDDDDKK..",
    ".KDDGGGGDDK.",
    ".KDGKKKKGDK.",
    "KDGKDDDDKGDK",
    "KDGKDKKDKGDK",
    "KDGKDKKDKGDK",
    "KDGKDDDDKGDK",
    ".KDGKKKKGDK.",
    ".KDDGGGGDDK.",
    "..KKDDDDKK..",
    "....KKKK....",
  ],
  guitar: [
    "..........KK",
    ".........KGK",
    "........KGK.",
    ".......KGK..",
    "...KKKKGK...",
    "..KOOOKK....",
    ".KOOKOOK....",
    "KOOKKKOK....",
    "KOOOKOOK....",
    ".KOOOOK.....",
    "..KKKK......",
    "............",
  ],
  pad: [
    "KKKKKKKKKKKK",
    "KIIIIIIIIIIK",
    "KIVVIIIIVVIK",
    "KIIIIVVIIIIK",
    "KVIIIIIIIIVK",
    "KIIVVIIVVIIK",
    "KIIIIIIIIIIK",
    "KVVIIVVIIVVK",
    "KIIIIIIIIIIK",
    "KKKKKKKKKKKK",
  ],
  coin: [
    "...KKKK...",
    "..KYYYYK..",
    ".KYYWYYYK.",
    "KYYWYKKYYK",
    "KYYWYKYYYK",
    "KYYYYKYYYK",
    "KYYYYKYYYK",
    ".KYYKKKYK.",
    "..KYYYYK..",
    "...KKKK...",
  ],
} as const;

export type SpriteId = keyof typeof SPRITES;

export function Sprite({
  id,
  size,
  className,
}: {
  id: SpriteId;
  size: number;
  className?: string;
}) {
  const rows = SPRITES[id];
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const cells: { x: number; y: number; fill: string }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const fill = KEYS[row[x]!];
      if (fill) cells.push({ x, y, fill });
    }
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={(size * h) / w}
      aria-hidden="true"
      className={`px-sprite ${className ?? ""}`}
      shapeRendering="crispEdges"
    >
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x}
          y={c.y}
          width={1.02}
          height={1.02}
          fill={c.fill}
        />
      ))}
    </svg>
  );
}

/** The sprite that best stands for a sound, from its role ("Intro organ", "Bass", "Flute melody"...). */
export function spriteForRole(role: string): SpriteId {
  const r = role.toLowerCase();
  if (/flute|whistle|horn|brass|sax|lead/.test(r)) return "flute";
  if (/bell|glock|celest|music box|pluck/.test(r)) return "bell";
  if (/bass|808|sub/.test(r)) return "bass";
  if (/guitar|string|harp/.test(r)) return "guitar";
  if (/pad|choir|vox|vocal|atmos/.test(r)) return "pad";
  if (/key|piano|organ|rhodes|chord|ep\b/.test(r)) return "keys";
  return "wave";
}
