import { describe, expect, test } from "bun:test";
import { createLocalSession, type MatchInput } from "@openturn/core";

import {
  endRound,
  modernArt,
  type AuctionType,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "./index";

type ModernArtMatch = MatchInput<typeof modernArt.playerIDs>;
type Session = ReturnType<typeof createLocalSession<typeof modernArt, ModernArtMatch>>;

function fresh(playerCount: 3 | 4 | 5 = 3, seed = "modern-art-test"): Session {
  const players = modernArt.playerIDs.slice(0, playerCount) as readonly [
    ModernArtPlayerID,
    ...ModernArtPlayerID[],
  ];
  return createLocalSession(modernArt, { match: { players }, seed }) as Session;
}

function view(session: Session, playerID: ModernArtPlayerID): ModernArtPlayerView {
  return session.getPlayerView(playerID) as ModernArtPlayerView;
}

function sessionWithCard(type: AuctionType): { cardID: string; session: Session } {
  for (let i = 0; i < 200; i += 1) {
    const session = fresh(3, `type-${type}-${i}`);
    const v = view(session, "0");
    const cardID = v.myHand.find((id) => v.cards[id]?.type === type);
    if (cardID !== undefined) return { cardID, session };
  }
  throw new Error(`unable to find ${type} in opening hand`);
}

describe("modern art setup and views", () => {
  test("deals by player count and hides private state", () => {
    expect(view(fresh(3), "0").myHand).toHaveLength(10);
    expect(view(fresh(4), "0").myHand).toHaveLength(9);
    expect(view(fresh(5), "0").myHand).toHaveLength(8);

    const session = fresh(3);
    const p0 = view(session, "0");
    const p1 = view(session, "1");
    expect(p0.players["1"].money).toBeNull();
    expect(p1.players["0"].money).toBeNull();
    expect(session.getPublicView().myHand).toEqual([]);
    expect(p0.myMoney).toBe(100);
  });

  test("only hammer can start the auction", () => {
    const session = fresh(3);
    const cardID = view(session, "1").myHand[0]!;
    const rejected = session.applyEvent("1", "playPainting", { cardID });
    expect(rejected.ok).toBe(false);
    expect(session.getState().derived.activePlayers).toEqual(["0"]);
  });
});

describe("modern art auctions", () => {
  test("open auction sells to the high bidder after others pass", () => {
    const { session, cardID } = sessionWithCard("open");
    expect(session.applyEvent("0", "playPainting", { cardID }).ok).toBe(true);
    expect(session.getState().position.name).toBe("openAuction");
    expect(session.applyEvent("1", "raiseOpenBid", { amount: 12 }).ok).toBe(true);
    expect(session.applyEvent("0", "passOpenBid", undefined).ok).toBe(true);
    expect(session.applyEvent("2", "passOpenBid", undefined).ok).toBe(true);
    const v = view(session, "1");
    expect(v.players["1"].gallery).toContain(cardID);
    expect(v.players["1"].money).toBe(88);
  });

  test("fixed price can be accepted by the next player", () => {
    const { session, cardID } = sessionWithCard("fixed");
    expect(session.applyEvent("0", "playPainting", { cardID }).ok).toBe(true);
    expect(session.getState().position.name).toBe("fixedPriceSet");
    expect(session.applyEvent("0", "setFixedPrice", { amount: 15 }).ok).toBe(true);
    expect(session.applyEvent("1", "respondFixedPrice", { accept: true }).ok).toBe(true);
    const v0 = view(session, "0");
    const v1 = view(session, "1");
    expect(v1.players["1"].gallery).toContain(cardID);
    expect(v0.myMoney).toBe(115);
    expect(v1.myMoney).toBe(85);
  });

  test("hidden auction hides bid amounts and uses auctioneer-favored tie break", () => {
    const { session, cardID } = sessionWithCard("hidden");
    expect(session.applyEvent("0", "playPainting", { cardID }).ok).toBe(true);
    expect(session.applyEvent("1", "submitHiddenBid", { amount: 10 }).ok).toBe(true);
    expect(view(session, "0").lot?.hiddenBidPlayers).toEqual(["1"]);
    expect(view(session, "0").myHiddenBid).toBeNull();
    expect(session.applyEvent("2", "submitHiddenBid", { amount: 10 }).ok).toBe(true);
    expect(session.applyEvent("0", "submitHiddenBid", { amount: 10 }).ok).toBe(true);
    const v0 = view(session, "0");
    expect(v0.players["0"].gallery).toContain(cardID);
    expect(v0.myMoney).toBe(90);
  });

  test("one-offer auction resolves after each seat acts once", () => {
    const { session, cardID } = sessionWithCard("oneOffer");
    expect(session.applyEvent("0", "playPainting", { cardID }).ok).toBe(true);
    expect(session.applyEvent("1", "submitOneOffer", { amount: 9 }).ok).toBe(true);
    expect(session.applyEvent("2", "submitOneOffer", { amount: null }).ok).toBe(true);
    expect(session.applyEvent("0", "submitOneOffer", { amount: 11 }).ok).toBe(true);
    const v0 = view(session, "0");
    expect(v0.players["0"].gallery).toContain(cardID);
    expect(v0.myMoney).toBe(89);
  });

  test("double auction can transfer auctioneer to the player adding the second card", () => {
    for (let i = 0; i < 500; i += 1) {
      const session = fresh(3, `double-${i}`);
      const v0 = view(session, "0");
      const firstID = v0.myHand.find((id) => v0.cards[id]?.type === "double");
      if (firstID === undefined) continue;
      expect(session.applyEvent("0", "playPainting", { cardID: firstID }).ok).toBe(true);
      const first = view(session, "1").cards[firstID]!;
      const secondID = view(session, "1").myHand.find((id) => {
        const card = view(session, "1").cards[id]!;
        return card.artist === first.artist && card.type !== "double";
      });
      if (secondID === undefined) continue;
      expect(session.applyEvent("0", "offerDouble", { cardID: null }).ok).toBe(true);
      expect(session.applyEvent("1", "offerDouble", { cardID: secondID }).ok).toBe(true);
      expect(view(session, "1").lot?.auctioneer).toBe("1");
      return;
    }
    throw new Error("unable to find double transfer fixture");
  });
});

describe("modern art scoring", () => {
  test("round payout ranks artists and pays owned galleries", () => {
    const session = fresh(3, "round-close");
    const state = session.getState().G;
    const handCard = view(session, "0").myHand[0]!;
    const artist = view(session, "0").cards[handCard]!.artist;
    const outcome = endRound({
      ...state,
      offeredCounts: { ...state.offeredCounts, [artist]: 5 },
      players: {
        ...state.players,
        "0": { ...state.players["0"], gallery: [handCard] },
      },
    }, "0", "test payout");
    expect(outcome.result).toBeNull();
    expect(outcome.state.round).toBe(2);
    expect(outcome.state.roundSummary?.rankedArtists[0]).toBe(artist);
    expect(outcome.state.valueTiles[artist]).toContain(30);
    expect(outcome.state.players["0"].money).toBe(130);
  });
});
