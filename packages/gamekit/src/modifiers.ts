export interface Modifier<TValue, TContext = void> {
  apply(current: TValue, context: TContext): TValue;
  id: string;
  priority?: number;
  stage?: string;
}

export interface AppliedModifier {
  id: string;
  index: number;
  priority: number;
  stage: string;
}

export interface ModifierEvaluation<TValue> {
  applied: readonly AppliedModifier[];
  value: TValue;
}

export interface EvaluateValueOptions<TValue, TContext = void> {
  base: TValue;
  context: TContext;
  modifiers: readonly Modifier<TValue, TContext>[];
  stageOrder?: readonly string[];
}

export interface EvaluateNumberOptions<TContext = void>
  extends EvaluateValueOptions<number, TContext> {}

export function evaluateValue<TValue, TContext = void>(
  options: EvaluateValueOptions<TValue, TContext>,
): ModifierEvaluation<TValue> {
  const orderedModifiers = orderModifiers(options.modifiers, options.stageOrder);
  let value = options.base;

  for (const modifier of orderedModifiers) {
    value = modifier.apply(value, options.context);
  }

  return {
    applied: orderedModifiers.map((modifier) => ({
      id: modifier.id,
      index: modifier.index,
      priority: modifier.priority,
      stage: modifier.stage,
    })),
    value,
  };
}

export function evaluateNumber<TContext = void>(
  options: EvaluateNumberOptions<TContext>,
): ModifierEvaluation<number> {
  return evaluateValue(options);
}

function orderModifiers<TValue, TContext>(
  modifiers: readonly Modifier<TValue, TContext>[],
  stageOrder?: readonly string[],
): Array<Modifier<TValue, TContext> & { index: number; priority: number; stage: string }> {
  assertModifierInputs(modifiers, stageOrder);
  const seenStages = new Set<string>();
  const orderedStages = [...(stageOrder ?? [])];

  for (const modifier of modifiers) {
    const stage = modifier.stage ?? "default";

    if (!seenStages.has(stage) && !orderedStages.includes(stage)) {
      orderedStages.push(stage);
    }

    seenStages.add(stage);
  }

  return modifiers.map((modifier, index) => ({
    ...modifier,
    index,
    priority: modifier.priority ?? 0,
    stage: modifier.stage ?? "default",
  })).sort((left, right) => {
    const stageOrderDelta = orderedStages.indexOf(left.stage) - orderedStages.indexOf(right.stage);

    if (stageOrderDelta !== 0) {
      return stageOrderDelta;
    }

    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    return left.index - right.index;
  });
}

function assertModifierInputs<TValue, TContext>(
  modifiers: readonly Modifier<TValue, TContext>[],
  stageOrder?: readonly string[],
): void {
  const seenStages = new Set<string>();

  for (const stage of stageOrder ?? []) {
    if (stage.length === 0) {
      throw new Error("Modifier stageOrder entries must be non-empty strings.");
    }

    if (seenStages.has(stage)) {
      throw new Error(`Modifier stageOrder cannot contain duplicate stage "${stage}".`);
    }

    seenStages.add(stage);
  }

  for (const modifier of modifiers) {
    if (modifier.id.length === 0) {
      throw new Error("Modifiers require non-empty id values.");
    }
  }
}
