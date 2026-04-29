export interface RngSnapshot {
  draws: number;
  seed: string;
  state: number;
}

export interface DeterministicRng {
  advantage(): number;
  bool(probability?: number): boolean;
  d4(): number;
  d6(): number;
  d8(): number;
  d10(): number;
  d12(): number;
  d20(): number;
  d100(): number;
  dice(count: number, sides: number): number;
  disadvantage(): number;
  getSnapshot(): RngSnapshot;
  int(maxExclusive: number): number;
  next(): number;
  pick<TValue>(values: readonly TValue[]): TValue;
}

export function createRng(seed: string, snapshot?: Omit<RngSnapshot, "seed"> | RngSnapshot): DeterministicRng {
  let state = snapshot?.state ?? hashSeed(seed);
  let draws = snapshot?.draws ?? 0;

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };

  const nextFloat = (): number => {
    draws += 1;
    return nextUint32() / 0x1_0000_0000;
  };

  const rollDie = (sides: number): number => Math.floor(nextFloat() * sides) + 1;

  return {
    advantage() {
      const first = rollDie(20);
      const second = rollDie(20);
      return first > second ? first : second;
    },
    bool(probability = 0.5) {
      if (!(probability >= 0 && probability <= 1)) {
        throw new Error("RNG probability must be between 0 and 1.");
      }

      return nextFloat() < probability;
    },
    d4() {
      return rollDie(4);
    },
    d6() {
      return rollDie(6);
    },
    d8() {
      return rollDie(8);
    },
    d10() {
      return rollDie(10);
    },
    d12() {
      return rollDie(12);
    },
    d20() {
      return rollDie(20);
    },
    d100() {
      return rollDie(100);
    },
    dice(count, sides) {
      if (!Number.isInteger(count) || count <= 0) {
        throw new Error("RNG dice count must be a positive integer.");
      }
      if (!Number.isInteger(sides) || sides <= 0) {
        throw new Error("RNG dice sides must be a positive integer.");
      }

      let total = 0;
      for (let index = 0; index < count; index += 1) {
        total += rollDie(sides);
      }
      return total;
    },
    disadvantage() {
      const first = rollDie(20);
      const second = rollDie(20);
      return first < second ? first : second;
    },
    getSnapshot() {
      return {
        draws,
        seed,
        state,
      };
    },
    int(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error("RNG maxExclusive must be a positive integer.");
      }

      return Math.floor(nextFloat() * maxExclusive);
    },
    next() {
      return nextFloat();
    },
    pick(values) {
      if (values.length === 0) {
        throw new Error("RNG pick requires at least one value.");
      }

      return values[this.int(values.length)]!;
    },
  };
}

export interface TimeContext {
  now: number;
}

export type TimeValue<TContext extends TimeContext = TimeContext> =
  | number
  | null
  | ((context: TContext) => number | null);

export function resolveTimeValue<TContext extends TimeContext>(
  value: TimeValue<TContext> | undefined,
  context: TContext,
): number | null | undefined {
  if (typeof value === "function") {
    return value(context);
  }

  return value;
}

export const deadline = {
  after<TContext extends TimeContext>(context: TContext, durationMs: number): number {
    return context.now + durationMs;
  },
};

export type TurnPlayers<TPlayerID extends string = string> = readonly [TPlayerID, ...TPlayerID[]];

export interface TurnContext<TPlayerID extends string = string> {
  currentPlayer: TPlayerID;
  index: number;
  players: readonly TPlayerID[];
  turn: number;
}

export function resolveRoundRobinTurn<TPlayerID extends string>(
  players: readonly [TPlayerID, ...TPlayerID[]],
  turnNumber: number,
): TurnContext<TPlayerID> {
  const index = ((turnNumber - 1) % players.length + players.length) % players.length;

  return {
    currentPlayer: players[index]!,
    index,
    players: [...players],
    turn: turnNumber,
  };
}

export const roundRobin = {
  activePlayers<TPlayerID extends string>(players: readonly [TPlayerID, ...TPlayerID[]], turnNumber: number): readonly [TPlayerID] {
    return [resolveRoundRobinTurn(players, turnNumber).currentPlayer];
  },
  currentPlayer<TPlayerID extends string>(players: readonly [TPlayerID, ...TPlayerID[]], turnNumber: number): TPlayerID {
    return resolveRoundRobinTurn(players, turnNumber).currentPlayer;
  },
  resolve: resolveRoundRobinTurn,
};

function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
