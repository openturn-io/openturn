import { describe, expect, test } from "bun:test";

import { draftProfile, updateProfile } from "./profile-draft";
import { applyProfileDelta, profile } from "./profile";

describe("draftProfile — op detection", () => {
  test("assignment emits `set`", () => {
    const ops = draftProfile({ wins: 2 } as { wins: number }, (p) => {
      p.wins = 10;
    });
    expect(ops).toEqual([{ op: "set", path: ["wins"], value: 10 }]);
  });

  test("`+=` on a numeric field emits `set` (not `inc`) — the Proxy sees assignment", () => {
    const ops = draftProfile({ wins: 2 } as { wins: number }, (p) => {
      p.wins += 1;
    });
    expect(ops).toEqual([{ op: "set", path: ["wins"], value: 3 }]);
  });

  test("`$inc` emits `inc` (retry-safe counter)", () => {
    const ops = draftProfile({ wins: 2 } as { wins: number }, (p) => {
      p.$inc("wins", 5);
    });
    expect(ops).toEqual([{ op: "inc", path: ["wins"], value: 5 }]);
  });

  test("`delete` emits `remove`", () => {
    const ops = draftProfile(
      { a: 1, b: 2 } as { a: number; b: number },
      (p) => {
        delete (p as { a?: number; b?: number }).a;
      },
    );
    expect(ops).toEqual([{ op: "remove", path: ["a"] }]);
  });

  test("`$remove` emits `remove`", () => {
    const ops = draftProfile(
      { a: 1, b: 2 } as { a: number; b: number },
      (p) => {
        p.$remove("a");
      },
    );
    expect(ops).toEqual([{ op: "remove", path: ["a"] }]);
  });

  test("multiple mutations compose in author order", () => {
    const ops = draftProfile(
      { wins: 0, seen: [] as string[] } as { wins: number; seen: string[] },
      (p) => {
        p.$inc("wins", 1);
        p.seen.push("dragon");
        p.wins = 42;
      },
    );
    expect(ops).toEqual([
      { op: "inc", path: ["wins"], value: 1 },
      { op: "push", path: ["seen"], value: "dragon" },
      { op: "set", path: ["wins"], value: 42 },
    ]);
  });
});

describe("draftProfile — array ops", () => {
  test("push emits push (one op per arg)", () => {
    const ops = draftProfile({ xs: [] as string[] } as { xs: string[] }, (p) => {
      p.xs.push("a", "b");
    });
    expect(ops).toEqual([
      { op: "push", path: ["xs"], value: "a" },
      { op: "push", path: ["xs"], value: "b" },
    ]);
  });

  test("pop emits remove at last index", () => {
    const ops = draftProfile(
      { xs: ["a", "b", "c"] as string[] } as { xs: string[] },
      (p) => {
        p.xs.pop();
      },
    );
    expect(ops).toEqual([{ op: "remove", path: ["xs", 2] }]);
  });

  test("shift emits remove at 0", () => {
    const ops = draftProfile(
      { xs: ["a", "b"] as string[] } as { xs: string[] },
      (p) => {
        p.xs.shift();
      },
    );
    expect(ops).toEqual([{ op: "remove", path: ["xs", 0] }]);
  });

  test("splice(i, n) emits n removes at index i (array shifts each time)", () => {
    const ops = draftProfile(
      { xs: ["a", "b", "c", "d"] as string[] } as { xs: string[] },
      (p) => {
        p.xs.splice(1, 2);
      },
    );
    expect(ops).toEqual([
      { op: "remove", path: ["xs", 1] },
      { op: "remove", path: ["xs", 1] },
    ]);
  });

  test("splice(i, 0, ...insert) throws", () => {
    expect(() =>
      draftProfile({ xs: [] as string[] } as { xs: string[] }, (p) => {
        (p.xs as unknown as { splice: (...a: unknown[]) => void })
          .splice(0, 0, "x");
      }),
    ).toThrow(/splice.*not supported/i);
  });

  test("$remove(index) emits remove at that index", () => {
    const ops = draftProfile(
      { xs: ["a", "b", "c"] as string[] } as { xs: string[] },
      (p) => {
        p.xs.$remove(1);
      },
    );
    expect(ops).toEqual([{ op: "remove", path: ["xs", 1] }]);
  });

  test("index assignment emits set", () => {
    const ops = draftProfile(
      { xs: ["a", "b", "c"] as string[] } as { xs: string[] },
      (p) => {
        p.xs[1] = "B";
      },
    );
    expect(ops).toEqual([{ op: "set", path: ["xs", 1], value: "B" }]);
  });

  test("whole-array reassign emits single set with full array", () => {
    const ops = draftProfile(
      { xs: ["a", "b"] as string[] } as { xs: string[] },
      (p) => {
        p.xs = ["c", "d", "e"];
      },
    );
    expect(ops).toEqual([
      { op: "set", path: ["xs"], value: ["c", "d", "e"] },
    ]);
  });

  test("sort / reverse / unshift / fill / copyWithin throw with rebuild guidance", () => {
    const recipes: readonly [string, (p: any) => void][] = [
      ["sort", (p) => p.xs.sort()],
      ["reverse", (p) => p.xs.reverse()],
      ["unshift", (p) => p.xs.unshift("z")],
      ["fill", (p) => p.xs.fill("z")],
      ["copyWithin", (p) => p.xs.copyWithin(0, 1)],
    ];
    for (const [name, recipe] of recipes) {
      expect(() =>
        draftProfile(
          { xs: ["a", "b"] as string[] } as { xs: string[] },
          recipe,
        ),
      ).toThrow(new RegExp(`${name}.*not supported`, "i"));
    }
  });

  test("read methods (includes, map, filter, iteration) do not record ops", () => {
    const ops = draftProfile(
      { xs: ["a", "b", "c"] as string[] } as { xs: string[] },
      (p) => {
        expect(p.xs.includes("b")).toBe(true);
        expect(p.xs.map((x) => x.toUpperCase())).toEqual(["A", "B", "C"]);
        expect(p.xs.filter((x) => x !== "b")).toEqual(["a", "c"]);
        expect([...p.xs]).toEqual(["a", "b", "c"]);
      },
    );
    expect(ops).toEqual([]);
  });
});

describe("draftProfile — nested paths", () => {
  test("nested object mutation accumulates path", () => {
    const ops = draftProfile(
      { meta: { name: "" as string | null } } as { meta: { name: string | null } },
      (p) => {
        p.meta.name = "alice";
      },
    );
    expect(ops).toEqual([
      { op: "set", path: ["meta", "name"], value: "alice" },
    ]);
  });

  test("nested array push within object", () => {
    const ops = draftProfile(
      { coll: { items: [] as number[] } } as { coll: { items: number[] } },
      (p) => {
        p.coll.items.push(7);
      },
    );
    expect(ops).toEqual([
      { op: "push", path: ["coll", "items"], value: 7 },
    ]);
  });

  test("$inc through a nested object uses the nested path", () => {
    const ops = draftProfile(
      { stats: { wins: 3 } } as { stats: { wins: number } },
      (p) => {
        p.stats.$inc("wins", 2);
      },
    );
    expect(ops).toEqual([
      { op: "inc", path: ["stats", "wins"], value: 2 },
    ]);
  });

  test("reads after writes reflect prior mutations (recorder keeps a live working copy)", () => {
    let seen: number | undefined;
    draftProfile({ wins: 1 } as { wins: number }, (p) => {
      p.wins = 5;
      seen = p.wins;
    });
    expect(seen).toBe(5);
  });
});

describe("draftProfile — lifecycle and purity", () => {
  test("does not mutate the input", () => {
    const before = { wins: 1, seen: ["a"] as string[] };
    const snapshot = JSON.stringify(before);
    draftProfile(before, (p) => {
      p.wins = 99;
      p.seen.push("b");
    });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test("draft used after recipe returned throws", () => {
    let captured: { wins: number } | null = null;
    draftProfile({ wins: 1 } as { wins: number }, (p) => {
      captured = p as unknown as { wins: number };
    });
    expect(() => {
      (captured as unknown as { wins: number }).wins = 2;
    }).toThrow(/after recipe returned/);
  });

  test("recipe throws — exception propagates, draft becomes disposed", () => {
    let captured: { wins: number } | null = null;
    expect(() =>
      draftProfile({ wins: 1 } as { wins: number }, (p) => {
        captured = p as unknown as { wins: number };
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(() => {
      (captured as unknown as { wins: number }).wins = 2;
    }).toThrow(/after recipe returned/);
  });

  test("non-container root throws", () => {
    expect(() =>
      draftProfile(42 as unknown as { wins: number }, () => {}),
    ).toThrow(/object or array at the root/);
  });
});

describe("draftProfile — interop with applyProfileDelta", () => {
  test("round-trip: applying recorded ops to baseline reproduces final state", () => {
    const baseline = {
      wins: 2,
      seen: ["a"] as string[],
      meta: { name: "alice" },
    };
    const ops = draftProfile(baseline, (p) => {
      p.$inc("wins", 3);
      p.seen.push("b");
      p.meta.name = "bob";
    });
    const applied = applyProfileDelta(baseline, ops);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.data).toEqual({
      wins: 5,
      seen: ["a", "b"],
      meta: { name: "bob" },
    });
    // Baseline untouched.
    expect(baseline.wins).toBe(2);
    expect(baseline.seen).toEqual(["a"]);
  });
});

describe("updateProfile / profile.update", () => {
  test("returns a per-player commit map with the recipe's ops", () => {
    const profiles = {
      "0": { wins: 1 },
      "1": { wins: 4 },
    } as const;
    const map = updateProfile(
      profiles as unknown as Readonly<Record<string, { wins: number }>>,
      "0",
      (p) => {
        p.$inc("wins", 1);
      },
    );
    expect(map).toEqual({ "0": [{ op: "inc", path: ["wins"], value: 1 }] });
  });

  test("empty recipe produces an empty commit map (no-op is not a commit)", () => {
    const profiles = { "0": { wins: 0 } } as const;
    const map = profile.update(
      profiles as unknown as Readonly<Record<string, { wins: number }>>,
      "0",
      () => {},
    );
    expect(map).toEqual({});
  });

  test("throws if the playerID has no baseline profile", () => {
    const profiles = {} as Readonly<Record<string, { wins: number }>>;
    expect(() =>
      profile.update(profiles, "0", (p) => {
        p.wins = 1;
      }),
    ).toThrow(/no profile for playerID/);
  });
});

describe("profile.bind", () => {
  test("binds update to a hydrated profile map", () => {
    const helper = profile.bind({
      "0": { wins: 2 },
      "1": { wins: 4 },
    } as Record<"0" | "1", { wins: number }>);

    expect(helper.update("1", (p) => {
      p.$inc("wins", 1);
    })).toEqual({
      "1": [{ op: "inc", path: ["wins"], value: 1 }],
    });
  });

  test("offers direct helpers for common single-field mutations", () => {
    const helper = profile.bind({
      "0": { cards: [] as string[], name: "A", wins: 2 },
    } as Record<"0", { cards: string[]; name: string; wins: number }>);

    expect(helper.inc("0", "wins", 1)).toEqual({
      "0": [{ op: "inc", path: ["wins"], value: 1 }],
    });
    expect(helper.push("0", "cards", "dragon")).toEqual({
      "0": [{ op: "push", path: ["cards"], value: "dragon" }],
    });
    expect(helper.set("0", "name", "B")).toEqual({
      "0": [{ op: "set", path: ["name"], value: "B" }],
    });
    expect(helper.remove("0", "name")).toEqual({
      "0": [{ op: "remove", path: ["name"] }],
    });
  });
});
