/**
 * Two-by-two grid of pads with one lit in the accent. Design spec: Logo direction.
 * Each pad is inset by half the 1 px stroke so the hairline sits inside the viewBox and stays crisp.
 */
export function LogoMark({ size = 16 }: { size?: number }) {
  const gap = size / 8;
  const pad = (size - gap) / 2;
  const inset = 0.5;
  const cells = [
    { x: 0, y: 0, lit: false },
    { x: pad + gap, y: 0, lit: true },
    { x: 0, y: pad + gap, lit: false },
    { x: pad + gap, y: pad + gap, lit: false },
  ];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x + inset}
          y={c.y + inset}
          width={pad - 2 * inset}
          height={pad - 2 * inset}
          rx={size / 16}
          className={c.lit ? "fill-accent" : "fill-raised stroke-border-strong"}
          strokeWidth={c.lit ? 0 : 1}
        />
      ))}
    </svg>
  );
}
