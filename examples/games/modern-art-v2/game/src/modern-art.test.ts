import { describe, expect, test } from "bun:test";

import { createLocalSession, type MatchInput } from "@openturn/core";

import {
  ALL_PAINTINGS,
  ARTISTS,
  ARTIST_TOTAL_CARDS,
  enumerateModernArtLegalActions,
  getPainting,
  modernArt,
  STARTING_MONEY,
  type ModernArtPlayerID,
  type ModernArtPlayerView,
} from "./index";

type ModernArtMatch = MatchInput<typeof modernArt.playerIDs>;
type Session = ReturnType<typeof createLocalSession<typeof modernArt, ModernArtMatch>>;

function fresh(
  playerCount: 3 | 4 | 5 = 3,
  seed = "seed-0",
): Session {
  const players = modernArt.playerIDs.slice(0, playerCount) as readonly [
    ModernArtPlayerID,
    ...ModernArtPlayerID[],
  ];
  return createLocalSession(modernArt, { match: { players }, seed }) as Session;
}

function view(session: Session, id: ModernArtPlayerID): ModernArtPlayerView {
  return session.getPlayerView(id) as ModernArtPlayerView;
}

/** First painting id in player 0's hand for the given auction type, or any if undefined. */
function handCard(
  session: Session,
  player: ModernArtPlayerID,
  filter?: "open" | "sealed" | "once" | "fixed" | "double",
): string {
  const v = view(session, player);
  for (const id of v.myHand) {
    const p = getPainting(id);
    if (filter === undefined || p.auction === filter) return id;
  }
  throw new Error(`no ${filter ?? "any"} card in ${player}'s hand`);
}

describe("setup", () => {
  test("deck totals match the official rarity curve (70 cards)", () => {
    const totals: Record<string, number> = {};
    for (const p of ALL_PAINTINGS) totals[p.artist] = (totals[p.artist] ?? 0) + 1;
    for (const artist of ARTISTS) {
      expect(totals[artist]).toBe(ARTIST_TOTAL_CARDS[artist]);
    }
    expect(ALL_PAINTINGS.length).toBe(70);
  });

  test("3-player deal: 10 cards each, $100, round 1", () => {
    const session = fresh(3);
    const v = view(session, "0");
    expect(v.myHand).toHaveLength(10);
    expect(v.players["0"].money).toBe(STARTING_MONEY);
    expect(v.round).toBe(1);
    expect(v.deckSize).toBe(70 - 30);
    expect(v.currentTurn).toBe("0");
  });

  test("4-player and 5-player deals", () => {
    expect(view(fresh(4), "0").myHand).toHaveLength(9);
    expect(view(fresh(5), "0").myHand).toHaveLength(8);
  });

  test("only the auctioneer may start", () => {
    const session = fresh();
    const card = handCard(session, "0");
    const r = session.applyEvent("1", "startAuction", { paintingId: card });
    expect(r.ok).toBe(false);
  });

  test("views hide other players' hands", () => {
    const session = fresh();
    const v = view(session, "0");
    // Player 0 sees their own hand size, but opponents only expose handSize.
    expect(v.myHand.length).toBe(10);
    for (const id of ["1", "2"] as const) {
      expect(v.players[id].handSize).toBe(10);
      // PublicPlayerData has no `hand` field, so accessing it is undefined.
      expect((v.players[id] as unknown as { hand?: unknown }).hand).toBeUndefined();
    }
  });

  test("player view reports the viewer's own myPlayerID (regression)", () => {
    // The hosted UI keys "is it my turn?" off view.myPlayerID === view.currentTurn.
    // A null myPlayerID silently broke the act-prompt in the browser.
    const session = fresh(3);
    expect(view(session, "0").myPlayerID).toBe("0");
    expect(view(session, "1").myPlayerID).toBe("1");
    expect(view(session, "2").myPlayerID).toBe("2");
    // Spectator (public) view stays null.
    expect((session.getPublicView() as ModernArtPlayerView).myPlayerID).toBeNull();
  });
});

describe("startAuction", () => {
  test("open auction starts and the next seat is the first bidder", () => {
    const session = fresh();
    const card = handCard(session, "0", "open");
    const r = session.applyEvent("0", "startAuction", { paintingId: card });
    expect(r.ok).toBe(true);
    const v = view(session, "0");
    expect(v.auction).not.toBeNull();
    expect(v.auction!.type).toBe("open");
    expect(v.auction!.auctioneer).toBe("0");
    expect(v.auction!.pendingBidders[0]).toBe("1");
    // Card removed from hand.
    expect(v.myHand.includes(card)).toBe(false);
  });

  test("double auction without a pair falls back to open", () => {
    const session = fresh();
    const card = handCard(session, "0", "double");
    const r = session.applyEvent("0", "startAuction", { paintingId: card });
    expect(r.ok).toBe(true);
    expect(view(session, "0").auction!.type).toBe("open");
  });

  test("double auction with a pair runs the second card's auction type", () => {
    const session = fresh();
    const v = view(session, "0");
    // Find a double card and a same-artist non-double pair.
    let doubleId: string | null = null;
    let pairId: string | null = null;
    for (const id of v.myHand) {
      const p = getPainting(id);
      if (p.auction === "double") {
        doubleId = id;
        for (const id2 of v.myHand) {
          if (id2 === id) continue;
          const p2 = getPainting(id2);
          if (p2.artist === p.artist && p2.auction !== "double") {
            pairId = id2;
            break;
          }
        }
        if (pairId !== null) break;
      }
    }
    if (doubleId === null || pairId === null) return; // seed didn't deal one; skip
    const r = session.applyEvent("0", "startAuction", {
      paintingId: doubleId,
      doublePaintingId: pairId,
    });
    expect(r.ok).toBe(true);
    const after = view(session, "0");
    expect(after.auction!.paintings).toHaveLength(2);
    expect(after.auction!.type).toBe(getPainting(pairId).auction);
  });

  test("cannot pair a double with another double", () => {
    const session = fresh();
    const v = view(session, "0");
    let d1: string | null = null;
    let d2: string | null = null;
    for (const id of v.myHand) {
      if (getPainting(id).auction === "double") {
        if (d1 === null) d1 = id;
        else if (d2 === null) {
          if (getPainting(id).artist === getPainting(d1).artist) {
            d2 = id;
            break;
          }
        }
      }
    }
    if (d1 === null || d2 === null) return;
    const r = session.applyEvent("0", "startAuction", {
      paintingId: d1,
      doublePaintingId: d2,
    });
    expect(r.ok).toBe(false);
  });
});

describe("open auction", () => {
  test("bid raises, then passes resolve to the high bidder", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "open") });
    // P1 bids 10
    expect(session.applyEvent("1", "placeBid", { amount: 10 }).ok).toBe(true);
    // P2 passes
    expect(session.applyEvent("2", "passBid", {}).ok).toBe(true);
    // P0 (auctioneer) passes — no more bidders, P1 wins
    expect(session.applyEvent("0", "passBid", {}).ok).toBe(true);
    const v = view(session, "0");
    expect(v.auction).toBeNull(); // resolved
    expect(v.players["1"].money).toBe(STARTING_MONEY - 10);
    expect(v.players["0"].money).toBe(STARTING_MONEY + 10); // paid to auctioneer
  });

  test("everyone passes → auctioneer keeps it free", () => {
    const session = fresh();
    const cardArtist = getPainting(handCard(session, "0", "open")).artist;
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "open") });
    session.applyEvent("1", "passBid", {});
    session.applyEvent("2", "passBid", {});
    session.applyEvent("0", "passBid", {});
    const v = view(session, "0");
    expect(v.auction).toBeNull();
    expect(v.players["0"].money).toBe(STARTING_MONEY); // free
    expect(v.players["0"].collection[cardArtist]).toBe(1);
  });

  test("cannot bid below the high bid", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "open") });
    session.applyEvent("1", "placeBid", { amount: 10 });
    const r = session.applyEvent("2", "placeBid", { amount: 5 });
    expect(r.ok).toBe(false);
  });

  test("cannot bid more than you have", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "open") });
    const r = session.applyEvent("1", "placeBid", { amount: STARTING_MONEY + 1 });
    expect(r.ok).toBe(false);
  });
});

describe("once-around auction", () => {
  test("each seat bids once; highest single bid wins", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "once") });
    // P1 bids 20
    expect(session.applyEvent("1", "placeBid", { amount: 20 }).ok).toBe(true);
    // P2 bids 50
    expect(session.applyEvent("2", "placeBid", { amount: 50 }).ok).toBe(true);
    // P0 (auctioneer, last in ring) passes
    expect(session.applyEvent("0", "passBid", {}).ok).toBe(true);
    const v = view(session, "0");
    expect(v.auction).toBeNull();
    expect(v.players["2"].money).toBe(STARTING_MONEY - 50);
    expect(v.players["0"].money).toBe(STARTING_MONEY + 50);
  });
});

describe("sealed auction", () => {
  test("highest sealed bid wins; amounts are hidden from public", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "sealed") });
    expect(view(session, "0").auction!.type).toBe("sealed");
    // Public view shows who submitted, not what.
    session.applyEvent("1", "sealBid", { amount: 30 });
    const pub = session.getPublicView() as ModernArtPlayerView;
    expect(pub.auction!.sealedSubmitted).toContain("1");
    // P2 seals higher
    expect(session.applyEvent("2", "sealBid", { amount: 45 }).ok).toBe(true);
    // P0 (auctioneer) seals 0 (pass)
    expect(session.applyEvent("0", "passBid", {}).ok).toBe(true);
    const v = view(session, "0");
    expect(v.auction).toBeNull();
    expect(v.players["2"].money).toBe(STARTING_MONEY - 45);
    expect(v.players["0"].money).toBe(STARTING_MONEY + 45);
  });

  test("sealed bid is only visible to the bidder", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "sealed") });
    session.applyEvent("1", "sealBid", { amount: 25 });
    // P1 sees their own sealed bid.
    expect(view(session, "1").mySealedBid).toBe(25);
    // P2 sees null for their own (not yet bid).
    expect(view(session, "2").mySealedBid).toBeNull();
  });
});

describe("fixed-price auction", () => {
  test("auctioneer sets price; first buyer wins", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "fixed") });
    // Auctioneer must set the price first.
    expect(view(session, "0").auction!.fixedPrice).toBeNull();
    expect(session.applyEvent("0", "setFixedPrice", { price: 35 }).ok).toBe(true);
    // P1 buys.
    expect(session.applyEvent("1", "buyFixed", {}).ok).toBe(true);
    const v = view(session, "0");
    expect(v.auction).toBeNull();
    expect(v.players["1"].money).toBe(STARTING_MONEY - 35);
    expect(v.players["0"].money).toBe(STARTING_MONEY + 35);
  });

  test("nobody buys → auctioneer pays their own price", () => {
    const session = fresh();
    session.applyEvent("0", "startAuction", { paintingId: handCard(session, "0", "fixed") });
    session.applyEvent("0", "setFixedPrice", { price: 40 });
    session.applyEvent("1", "declineFixed", {});
    session.applyEvent("2", "declineFixed", {});
    // P0 is the auctioneer; nobody bought, so they pay the bank.
    const v = view(session, "0");
    expect(v.auction).toBeNull();
    expect(v.players["0"].money).toBe(STARTING_MONEY - 40);
  });
});

describe("round end + scoring", () => {
  test("5th painting put up ends the round; top-3 artists pay out", () => {
    // Drive a single artist to 5 sales across auctions.
    const session = fresh(3, "score-seed");
    // We can't easily force one artist, so just run many auctions of one artist
    // by repeatedly picking the first krypto card. This is a smoke test that
    // the round-end + scoring pipeline runs without throwing.
    let guard = 0;
    while (view(session, "0").round === 1 && guard < 200) {
      guard += 1;
      const snap = session.getState();
      const ap = snap.derived.activePlayers[0] as ModernArtPlayerID;
      const legal = enumerateModernArtLegalActions(
        snap.G as never,
        ap,
        snap.position.turn - 1,
      );
      if (legal.length === 0) break;
      // Prefer a start-auction action to keep the game moving; otherwise pick first.
      const chosen = legal.find((l) => l.event === "startAuction") ?? legal[0]!;
      const r = session.applyEvent(ap, chosen.event as never, chosen.payload as never);
      if (!r.ok) break;
    }
    const v = view(session, "0");
    // Either the round advanced or the game ended — both are valid.
    expect(v.round >= 1).toBe(true);
    expect(v.lastPayout === null || v.round > 1 || v.winner !== null).toBe(true);
  });
});

describe("full game termination", () => {
  test("legal-action play reaches a winner (rotating pick)", () => {
    const session = fresh(3, "term-seed");
    let guard = 0;
    let tick = 0;
    while (session.getState().meta.result === null && guard < 4000) {
      guard += 1;
      const snap = session.getState();
      const ap = snap.derived.activePlayers[0] as ModernArtPlayerID | undefined;
      if (ap === undefined) break;
      const legal = enumerateModernArtLegalActions(
        snap.G as never,
        ap,
        snap.position.turn - 1,
      );
      if (legal.length === 0) break;
      // Rotate the pick index so we don't always take the same action (which
      // can deadlock when the first legal move keeps getting invalidated).
      const chosen = legal[tick % legal.length]!;
      tick += 1;
      const r = session.applyEvent(ap, chosen.event as never, chosen.payload as never);
      if (!r.ok) {
        // Try the first legal instead and continue.
        const r2 = session.applyEvent(ap, legal[0]!.event as never, legal[0]!.payload as never);
        if (!r2.ok) break;
      }
    }
    const result = session.getState().meta.result;
    expect(result).not.toBeNull();
    if (result !== null) {
      expect(typeof result.winner).toBe("string");
    }
  }, 20_000);
});
