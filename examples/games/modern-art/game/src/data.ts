import {
  ARTISTS,
  type Artist,
  type ArtistID,
  type AuctionType,
  type PaintingCard,
} from "./state";

export const ARTIST_DATA: readonly Artist[] = [
  { id: "liteMetal", name: "Lite Metal", shortName: "Lite", color: "#a7c7d9" },
  { id: "yoko", name: "Yoko", shortName: "Yoko", color: "#f3be4f" },
  { id: "christinP", name: "Christin P.", shortName: "Christin", color: "#d95c5c" },
  { id: "karlGitter", name: "Karl Gitter", shortName: "Gitter", color: "#72b276" },
  { id: "krypto", name: "Krypto", shortName: "Krypto", color: "#8c6bd8" },
] as const;

const AUCTION_COUNTS: Record<ArtistID, Record<AuctionType, number>> = {
  christinP: { double: 2, fixed: 3, hidden: 3, oneOffer: 3, open: 3 },
  karlGitter: { double: 3, fixed: 3, hidden: 3, oneOffer: 3, open: 3 },
  krypto: { double: 3, fixed: 3, hidden: 3, oneOffer: 3, open: 4 },
  liteMetal: { double: 2, fixed: 3, hidden: 2, oneOffer: 3, open: 2 },
  yoko: { double: 2, fixed: 3, hidden: 3, oneOffer: 2, open: 3 },
};

const AUCTION_ORDER: readonly AuctionType[] = ["open", "oneOffer", "hidden", "fixed", "double"];

function buildCards(): PaintingCard[] {
  const cards: PaintingCard[] = [];
  for (const artist of ARTISTS) {
    let index = 1;
    for (const type of AUCTION_ORDER) {
      const count = AUCTION_COUNTS[artist][type];
      for (let i = 0; i < count; i += 1) {
        cards.push({
          artist,
          id: `${artist}-${type}-${i + 1}`,
          index,
          title: `${ARTIST_DATA.find((a) => a.id === artist)!.shortName} No. ${index}`,
          type,
        });
        index += 1;
      }
    }
  }
  return cards;
}

export const CARDS = buildCards();
export const CARD_BY_ID: Record<string, PaintingCard> = Object.fromEntries(
  CARDS.map((card) => [card.id, card]),
);

export function getCard(cardID: string): PaintingCard {
  const card = CARD_BY_ID[cardID];
  if (card === undefined) {
    throw new Error(`unknown Modern Art card: ${cardID}`);
  }
  return card;
}

export function getArtist(artistID: ArtistID): Artist {
  const artist = ARTIST_DATA.find((candidate) => candidate.id === artistID);
  if (artist === undefined) {
    throw new Error(`unknown Modern Art artist: ${artistID}`);
  }
  return artist;
}
