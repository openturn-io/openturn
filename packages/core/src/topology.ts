import type { AnyGame, GameGraphNode, GameNodes } from "./types";

export interface GameTopologyNode<TNode extends string = string> {
  children: readonly TNode[];
  id: TNode;
  kind: "compound" | "leaf";
  parent: TNode | null;
  path: readonly TNode[];
}

export interface GameTopology<TNode extends string = string> {
  compoundNodes: readonly TNode[];
  leafNodes: readonly TNode[];
  nodes: Readonly<Record<TNode, GameTopologyNode<TNode>>>;
}

export function createGameTopology<TMachine extends AnyGame>(
  machine: TMachine,
): GameTopology<GameNodes<TMachine>> {
  const stateNames = Object.keys(machine.states) as GameNodes<TMachine>[];
  const childrenByParent = new Map<GameNodes<TMachine>, GameNodes<TMachine>[]>();
  const visitState = new Map<GameNodes<TMachine>, "active" | "done">();

  for (const stateName of stateNames) {
    const parent = machine.states[stateName]?.parent;

    if (parent === undefined) {
      continue;
    }

    if (!Object.hasOwn(machine.states, parent)) {
      throw new Error(`State "${stateName}" declares parent "${parent}" which is not declared.`);
    }

    const children = childrenByParent.get(parent) ?? [];
    children.push(stateName);
    childrenByParent.set(parent, children);
  }

  const pathCache = new Map<GameNodes<TMachine>, readonly GameNodes<TMachine>[]>();

  function getPath(stateName: GameNodes<TMachine>): readonly GameNodes<TMachine>[] {
    const cached = pathCache.get(stateName);

    if (cached !== undefined) {
      return cached;
    }

    const status = visitState.get(stateName);
    if (status === "active") {
      throw new Error(`State hierarchy contains a cycle at "${stateName}".`);
    }

    if (status === "done") {
      return pathCache.get(stateName) ?? [stateName];
    }

    visitState.set(stateName, "active");
    const parent = machine.states[stateName]?.parent;
    const path = parent === undefined
      ? [stateName]
      : [...getPath(parent as GameNodes<TMachine>), stateName];
    visitState.set(stateName, "done");
    pathCache.set(stateName, path);
    return path;
  }

  const nodes = Object.fromEntries(stateNames.map((stateName) => {
    const children = childrenByParent.get(stateName) ?? [];
    const parent = machine.states[stateName]?.parent ?? null;

    return [stateName, {
      children,
      id: stateName,
      kind: children.length === 0 ? "leaf" : "compound",
      parent,
      path: getPath(stateName),
    } satisfies GameTopologyNode<GameNodes<TMachine>>];
  })) as unknown as Record<GameNodes<TMachine>, GameTopologyNode<GameNodes<TMachine>>>;

  return {
    compoundNodes: stateNames.filter((stateName) => nodes[stateName].kind === "compound"),
    leafNodes: stateNames.filter((stateName) => nodes[stateName].kind === "leaf"),
    nodes,
  };
}

export function topologyNodeToGraphNode<TNode extends string>(
  node: GameTopologyNode<TNode>,
): GameGraphNode {
  return {
    id: node.id,
    kind: node.kind,
    parent: node.parent,
    path: [...node.path],
  };
}
