import type { Artist, AuctionType } from "@openturn/example-modern-art-v2-game";

export interface ArtistStyle {
  label: string;
  /** CSS color value for the artist's signature hue. */
  base: string;
  glow: string;
  ink: string;
}

export const ARTIST_STYLE: Record<Artist, ArtistStyle> = {
  liteMetal: { label: "Lite Metal", base: "var(--color-artist-liteMetal)", glow: "var(--color-artist-liteMetal-glow)", ink: "var(--color-artist-liteMetal-ink)" },
  yoko: { label: "Yoko", base: "var(--color-artist-yoko)", glow: "var(--color-artist-yoko-glow)", ink: "var(--color-artist-yoko-ink)" },
  cristinP: { label: "Cristin P.", base: "var(--color-artist-cristinP)", glow: "var(--color-artist-cristinP-glow)", ink: "var(--color-artist-cristinP-ink)" },
  karlGitter: { label: "Karl Gitter", base: "var(--color-artist-karlGitter)", glow: "var(--color-artist-karlGitter-glow)", ink: "var(--color-artist-karlGitter-ink)" },
  krypto: { label: "Krypto", base: "var(--color-artist-krypto)", glow: "var(--color-artist-krypto-glow)", ink: "var(--color-artist-krypto-ink)" },
};

export const AUCTION_LABEL: Record<AuctionType, string> = {
  open: "Open",
  sealed: "Sealed",
  once: "Once-Around",
  fixed: "Fixed Price",
  double: "Double",
};

export const AUCTION_GLYPH: Record<AuctionType, string> = {
  open: "○",
  sealed: "◇",
  once: "↻",
  fixed: "$",
  double: "⬥",
};

export function playerLabel(id: string, isMe: boolean): string {
  const n = Number.parseInt(id, 10);
  const name = `Collector ${Number.isFinite(n) ? n + 1 : id}`;
  return isMe ? `${name} (you)` : name;
}
