import { createLocalSession } from "@openturn/core";
import { describe, expect, test } from "bun:test";

import {
  cardDiscoveryGame,
  type CardDiscoveryProfile,
} from "./index";

function freshSession(profiles?: Partial<Record<"0" | "1", CardDiscoveryProfile>>) {
  return createLocalSession(cardDiscoveryGame, {
    match: {
      players: cardDiscoveryGame.playerIDs,
      ...(profiles === undefined ? {} : { profiles: profiles as never }),
    },
  });
}

describe("card-discovery (mid-match profile mutation)", () => {
  test("first play of a card pushes it into profile.discovered", () => {
    const session = freshSession();
    const before = session.getState().meta.match.profiles;
    expect(before).toEqual({ "0": { discovered: [] }, "1": { discovered: [] } });

    const result = session.applyEvent("0", "play", { card: "dragon" });
    expect(result.ok).toBe(true);

    const after = session.getState().meta.match.profiles;
    expect(after).toEqual({
      "0": { discovered: ["dragon"] },
      "1": { discovered: [] },
    });
  });

  test("replaying a known card does NOT emit a delta", () => {
    const session = freshSession({
      "0": { discovered: ["dragon"] },
    });

    const result = session.applyEvent("0", "play", { card: "dragon" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No profile delta on the transition.
    expect(result.batch.steps[0]!.transition.profile).toBeUndefined();
    expect(session.getState().meta.match.profiles).toEqual({
      "0": { discovered: ["dragon"] },
      "1": { discovered: [] },
    });
  });

  test("discoveries accumulate across several moves in the same match", () => {
    const session = freshSession();
    session.applyEvent("0", "play", { card: "dragon" });
    session.applyEvent("0", "play", { card: "slime" });
    session.applyEvent("1", "play", { card: "knight" });

    expect(session.getState().meta.match.profiles).toEqual({
      "0": { discovered: ["dragon", "slime"] },
      "1": { discovered: ["knight"] },
    });
  });

  test("observed transition records the exact applied delta (for host persistence)", () => {
    const session = freshSession();
    const result = session.applyEvent("0", "play", { card: "wizard" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.batch.steps[0]!.transition.profile).toEqual({
      "0": [{ op: "push", path: ["discovered"], value: "wizard" }],
    });
  });
});
