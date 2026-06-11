import * as React from "react";

import { type PaintingCard } from "@openturn/example-modern-art-game";

/**
 * Deterministic generative artwork. Every painting renders a unique
 * composition derived purely from its card id, in one of five signature
 * styles — one per artist. Pure function of the card, so it is replay- and
 * SSR-safe (no Math.random / Date).
 */

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — tiny seeded PRNG, deterministic per card. */
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 100;
const H = 116;

interface ArtworkProps {
  card: PaintingCard;
}

/** Lite Metal — cool constructivist shards over a steel field. */
function LiteMetalArt({ rng }: { rng: () => number }) {
  const shards: React.ReactNode[] = [];
  const palette = ["#dce8f0", "#9fc0d4", "#5d8aa3", "#31596b", "#1d3947"];
  const count = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i += 1) {
    const cx = 10 + rng() * 80;
    const cy = 10 + rng() * 96;
    const len = 26 + rng() * 44;
    const wid = 7 + rng() * 16;
    const angle = -60 + rng() * 120;
    shards.push(
      <rect
        fill={palette[Math.floor(rng() * palette.length)]}
        height={wid}
        key={i}
        opacity={0.82 + rng() * 0.18}
        transform={`rotate(${angle} ${cx} ${cy})`}
        width={len}
        x={cx - len / 2}
        y={cy - wid / 2}
      />,
    );
  }
  const hx = 12 + rng() * 76;
  return (
    <g>
      <rect fill="#274b5c" height={H} width={W} />
      <rect fill="#9fc0d4" height={H} opacity="0.22" width={W / 2} x={rng() > 0.5 ? 0 : W / 2} />
      {shards}
      <line stroke="#f2f6f8" strokeWidth="1.6" x1={hx} x2={hx + 4} y1={0} y2={H} />
    </g>
  );
}

/** Yoko — warm minimalism: horizon bands and a low sun. */
function YokoArt({ rng }: { rng: () => number }) {
  const bands: React.ReactNode[] = [];
  const palette = ["#f7d77c", "#eda63a", "#c96f23", "#8a4518", "#5d2c12"];
  let y = 0;
  let i = 0;
  while (y < H) {
    const bh = 12 + rng() * 26;
    bands.push(<rect fill={palette[i % palette.length]} height={bh + 1} key={i} width={W} y={y} />);
    y += bh;
    i += 1;
  }
  const sunX = 22 + rng() * 56;
  const sunY = 22 + rng() * 50;
  const sunR = 11 + rng() * 9;
  return (
    <g>
      {bands}
      <circle cx={sunX} cy={sunY} fill="#fdf2cd" r={sunR} />
      <circle cx={sunX} cy={sunY} fill="none" opacity="0.55" r={sunR + 5} stroke="#fdf2cd" strokeWidth="1.4" />
      {rng() > 0.45 ? (
        <circle cx={W - sunX} cy={H - 18 - rng() * 20} fill="#41200d" r={5 + rng() * 5} />
      ) : null}
    </g>
  );
}

/** Christin P. — expressionist brush arcs in crimson and ink. */
function ChristinArt({ rng }: { rng: () => number }) {
  const strokes: React.ReactNode[] = [];
  const palette = ["#d95c5c", "#a92f3d", "#5e1726", "#23151a", "#e9a08c"];
  const count = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i += 1) {
    const x1 = rng() * W;
    const y1 = rng() * H;
    const x2 = rng() * W;
    const y2 = rng() * H;
    const cx = rng() * W;
    const cy = rng() * H;
    strokes.push(
      <path
        d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
        fill="none"
        key={i}
        opacity={0.78 + rng() * 0.22}
        stroke={palette[Math.floor(rng() * palette.length)]}
        strokeLinecap="round"
        strokeWidth={5 + rng() * 9}
      />,
    );
  }
  return (
    <g>
      <rect fill="#f3e4d3" height={H} width={W} />
      <circle cx={14 + rng() * 72} cy={14 + rng() * 88} fill="#d95c5c" opacity="0.85" r={7 + rng() * 8} />
      {strokes}
      <circle cx={10 + rng() * 80} cy={10 + rng() * 96} fill="#23151a" r={2.4 + rng() * 2} />
    </g>
  );
}

/** Karl Gitter — lattice grids ("Gitter") with sage panes. */
function GitterArt({ rng }: { rng: () => number }) {
  const cells: React.ReactNode[] = [];
  const palette = ["#9ccb8f", "#72b276", "#3f7d52", "#1f4a33", "#e9f2dc"];
  const cols = [0, 14 + rng() * 24, 44 + rng() * 22, W];
  const rows = [0, 16 + rng() * 26, 52 + rng() * 26, H];
  for (let r = 0; r < rows.length - 1; r += 1) {
    for (let c = 0; c < cols.length - 1; c += 1) {
      cells.push(
        <rect
          fill={rng() > 0.3 ? palette[Math.floor(rng() * palette.length)] : "#f1f4e6"}
          height={rows[r + 1]! - rows[r]!}
          key={`${r}-${c}`}
          width={cols[c + 1]! - cols[c]!}
          x={cols[c]}
          y={rows[r]}
        />,
      );
    }
  }
  const lines: React.ReactNode[] = [];
  for (const x of cols.slice(1, -1)) {
    lines.push(<line key={`v${x}`} stroke="#16261c" strokeWidth="2.4" x1={x} x2={x} y1={0} y2={H} />);
  }
  for (const y of rows.slice(1, -1)) {
    lines.push(<line key={`h${y}`} stroke="#16261c" strokeWidth="2.4" x1={0} x2={W} y1={y} y2={y} />);
  }
  return (
    <g>
      {cells}
      {lines}
    </g>
  );
}

/** Krypto — cryptic constellation glyphs on a deep violet field. */
function KryptoArt({ rng }: { rng: () => number }) {
  const stars: React.ReactNode[] = [];
  const points: Array<[number, number]> = [];
  const count = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i += 1) {
    const x = 8 + rng() * 84;
    const y = 8 + rng() * 100;
    points.push([x, y]);
    stars.push(<circle cx={x} cy={y} fill={rng() > 0.6 ? "#eadcf9" : "#a98ee6"} key={i} r={1.6 + rng() * 2.6} />);
  }
  const path = points
    .slice(0, 4 + Math.floor(rng() * 3))
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  return (
    <g>
      <rect fill="#1c1336" height={H} width={W} />
      <circle cx={20 + rng() * 60} cy={20 + rng() * 70} fill="#8c6bd8" opacity="0.35" r={20 + rng() * 16} />
      <path d={path} fill="none" opacity="0.8" stroke="#cdb6f2" strokeWidth="0.9" />
      {stars}
      <rect
        fill="none"
        height={16 + rng() * 10}
        opacity="0.85"
        stroke="#eadcf9"
        strokeWidth="1.3"
        transform={`rotate(${-20 + rng() * 40} 50 58)`}
        width={16 + rng() * 10}
        x={28 + rng() * 36}
        y={36 + rng() * 36}
      />
    </g>
  );
}

export const Artwork = React.memo(function Artwork({ card }: ArtworkProps) {
  const rng = makeRng(hashString(card.id));
  let art: React.ReactNode;
  if (card.artist === "liteMetal") art = <LiteMetalArt rng={rng} />;
  else if (card.artist === "yoko") art = <YokoArt rng={rng} />;
  else if (card.artist === "christinP") art = <ChristinArt rng={rng} />;
  else if (card.artist === "karlGitter") art = <GitterArt rng={rng} />;
  else art = <KryptoArt rng={rng} />;

  return (
    <svg className="artwork-svg" preserveAspectRatio="xMidYMid slice" role="img" viewBox={`0 0 ${W} ${H}`}>
      <title>{card.title}</title>
      {art}
      {/* canvas grain + vignette */}
      <rect fill="url(#ma-vignette)" height={H} width={W} />
      <defs>
        <radialGradient id="ma-vignette">
          <stop offset="62%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(20,10,4,0.28)" />
        </radialGradient>
      </defs>
    </svg>
  );
});
