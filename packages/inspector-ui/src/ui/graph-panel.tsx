import { useCallback, useMemo, useState } from "react";

import dagre from "dagre";
import { AlertTriangle, Maximize2, Minimize2, X } from "lucide-react";
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  type EdgeProps,
  type EdgeTypes,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";

import type {
  GameControlSummary,
  GameGraph,
  GameGraphEdge,
  GameGraphNode,
} from "@openturn/core";
import type { InspectorControlHandoff, InspectorGraphHighlight } from "@openturn/inspector";

import { useInspector } from "../inspector-context";
import { Button } from "../components/ui/button";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 86;
const COMPOUND_PADDING_X = 32;
const COMPOUND_PADDING_TOP = 40;
const COMPOUND_PADDING_BOTTOM = 24;
const DAGRE_RANK_SEPARATION = 240;
const DAGRE_NODE_SEPARATION = 150;
const PARALLEL_EDGE_LANE_GAP = 32;
const SELF_LOOP_LANE_GAP = 28;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

interface StateNodeData extends Record<string, unknown> {
  id: string;
  isCurrent: boolean;
  isInitial: boolean;
  isPending: boolean;
  kind: GameGraphNode["kind"];
  pathLabel: string;
  warnings: readonly string[];
  hasSelfLoop: boolean;
  outgoingCount: number;
  incomingCount: number;
  activePlayers: readonly string[];
  ownershipTone: "single" | "shared" | "none" | "unknown";
}

interface CompoundNodeData extends Record<string, unknown> {
  id: string;
  isCurrent: boolean;
  isPending: boolean;
  nodeWidth: number;
  nodeHeight: number;
  hasEdges: boolean;
  hasSelfLoop: boolean;
  outgoingCount: number;
  incomingCount: number;
}

type StateFlowNode = Node<StateNodeData, "state">;
type CompoundFlowNode = Node<CompoundNodeData, "compound">;
type AnyFlowNode = StateFlowNode | CompoundFlowNode;

interface NodeInfo {
  type: "node";
  nodeId: string;
  kind: string;
  path: string;
  isCurrent: boolean;
  isPending: boolean;
  isInitial: boolean;
  warnings: readonly string[];
  label: string | null;
  activePlayers: readonly string[];
  ownershipSummary: string;
}

interface EdgeInfo {
  type: "edge";
  event: string;
  from: string;
  to: string;
  resolver: string | null;
  turn: string;
  isTraversed: boolean;
  isMatchedBranch: boolean;
  isInHistory: boolean;
  handoff: InspectorControlHandoff | null;
}

interface HistoryEdge {
  from: string;
  to: string;
  matchedBranch: string | null;
}

type GraphSelection = NodeInfo | EdgeInfo | null;

const NODE_TYPES: NodeTypes = {
  state: StateNode,
  compound: CompoundNode,
};

const EDGE_TYPES: EdgeTypes = {
  state: StateEdge,
  selfLoop: SelfLoopEdge,
};

interface BuildFlowGraphResult {
  nodes: AnyFlowNode[];
  edges: Edge[];
  edgeDataMap: Map<string, { edge: GameGraphEdge; isTraversed: boolean; isMatchedBranch: boolean; isInHistory: boolean; handoff: InspectorControlHandoff | null }>;
}

interface GraphEdgeRenderData extends Record<string, unknown> {
  labelT: number;
  laneOffset: number;
  selfLoopLane: number;
}

// ---------------------------------------------------------------------------
// GraphPanel
// ---------------------------------------------------------------------------

export function GraphPanel() {
  const { dispatch, timeline, currentFrame, effectiveRevision } = useInspector();
  const highlight = currentFrame.graphHighlight;
  const controlHandoff = currentFrame.controlHandoff;
  const [selection, setSelection] = useState<GraphSelection>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Current frame's transition, in edge form. Sourced from `frame.transition`
  // rather than `graphHighlight.lastTraversedEdge` because hosted replays do
  // not populate `graphHighlight` (no controlSummary on hosted batches).
  const currentTransitionEdge = useMemo<HistoryEdge | null>(() => {
    const t = currentFrame.transition;
    if (t === null) return null;
    return { from: t.from, to: t.to, matchedBranch: t.resolver };
  }, [currentFrame.transition]);

  // Every prior transition in the replay history — used to highlight the trail
  // of edges we've traversed to reach the current snapshot. Excludes the
  // current frame's transition since that is styled as "current" separately.
  const historyEdges = useMemo<readonly HistoryEdge[]>(() => {
    const out: HistoryEdge[] = [];
    const end = Math.min(effectiveRevision, timeline.frames.length);
    for (let i = 0; i < end; i++) {
      const t = timeline.frames[i]?.transition;
      if (t === null || t === undefined) continue;
      out.push({ from: t.from, to: t.to, matchedBranch: t.resolver });
    }
    return out;
  }, [timeline.frames, effectiveRevision]);

  const onClose = useCallback(() => {
    dispatch({ type: "TOGGLE_GRAPH_PANEL" });
  }, [dispatch]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const diagnosticsByNode = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const d of timeline.validationReport.diagnostics) {
      const nodeId = d.state ?? d.from ?? d.to;
      if (nodeId !== undefined) {
        let arr = map.get(nodeId);
        if (arr === undefined) {
          arr = [];
          map.set(nodeId, arr);
        }
        arr.push(d.message);
      }
    }
    return map;
  }, [timeline.validationReport]);

  const { nodes, edges, edgeDataMap } = useMemo(
    () => buildFlowGraph(timeline.graph, highlight, currentTransitionEdge, currentFrame.controlSummary, diagnosticsByNode, historyEdges),
    [highlight, currentTransitionEdge, timeline.graph, currentFrame.controlSummary, diagnosticsByNode, historyEdges],
  );

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: AnyFlowNode) => {
      const graphNode = timeline.graph.nodes.find((n) => n.id === node.id);
      if (graphNode === undefined) return;

      const cs = currentFrame.controlSummary;
      const currentHighlightNode = highlight?.currentNode ?? currentTransitionEdge?.to ?? null;
      const isCurrent = currentHighlightNode === node.id;
      const isPending = highlight?.pendingTargets.includes(node.id) ?? false;

      setSelection({
        type: "node",
        nodeId: node.id,
        kind: graphNode.kind,
        path: graphNode.path.length > 0 ? graphNode.path.join(" / ") : node.id,
        isCurrent,
        isPending,
        isInitial: timeline.graph.initial === node.id,
        warnings: diagnosticsByNode.get(node.id) ?? [],
        label: isCurrent ? (cs?.current.meta.label ?? null) : null,
        activePlayers: isCurrent ? (cs?.activePlayers ?? []) : [],
        ownershipSummary: isCurrent ? describeOwnership(cs?.activePlayers ?? []) : isPending ? "Pending target" : "No live ownership data",
      });
    },
    [timeline.graph, highlight, currentTransitionEdge, currentFrame.controlSummary, diagnosticsByNode],
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      const data = edgeDataMap.get(edge.id);
      if (data === undefined) return;

      setSelection({
        type: "edge",
        event: data.edge.event,
        from: data.edge.from,
        to: data.edge.to,
        resolver: data.edge.resolver,
        turn: data.edge.turn,
        isTraversed: data.isTraversed,
        isMatchedBranch: data.isMatchedBranch,
        isInHistory: data.isInHistory,
        handoff: data.handoff,
      });
    },
    [edgeDataMap],
  );

  const onPaneClick = useCallback(() => {
    setSelection(null);
  }, []);

  const panelClass = [
    "ot-inspector__panel",
    "ot-inspector__panel--right",
    "ot-inspector__panel--graph",
    isExpanded ? "ot-inspector__panel--graph-expanded" : "",
  ].join(" ");

  return (
    <div className={panelClass}>
      <div className="ot-inspector__panel-header">
        <span>Game Graph</span>
        <div className="ot-inspector__panel-header-actions">
          <Button
            className="size-6 text-muted-foreground hover:bg-[var(--ot-bg-hover)] hover:text-foreground"
            onClick={toggleExpand}
            title={isExpanded ? "Collapse" : "Expand"}
            type="button"
            variant="ghost"
            size="icon-sm"
          >
            {isExpanded
              ? <Minimize2 data-icon="icon" />
              : <Maximize2 data-icon="icon" />}
          </Button>
          <Button
            className="size-6 text-muted-foreground hover:bg-[var(--ot-bg-hover)] hover:text-foreground"
            onClick={onClose}
            type="button"
            variant="ghost"
            size="icon-sm"
          >
            <X data-icon="icon" />
          </Button>
        </div>
      </div>

      <HandoffStrip handoff={controlHandoff} turn={currentFrame.turn} />

      {selection !== null && <InfoCard selection={selection} onDismiss={() => setSelection(null)} />}

      <div className="ot-inspector__graph-panel-body">
        <ReactFlowProvider>
          <div className="ot-inspector__graph-canvas ot-inspector__graph-canvas--panel" data-testid="graph-canvas">
            <ReactFlow<AnyFlowNode, Edge>
              attributionPosition="bottom-left"
              defaultEdgeOptions={{ type: "state" }}
              edgeTypes={EDGE_TYPES}
              edges={edges}
              fitView
              fitViewOptions={{ maxZoom: 0.95, padding: 0.22 }}
              maxZoom={2}
              minZoom={0.2}
              nodeOrigin={[0.5, 0.5]}
              nodes={nodes}
              nodeTypes={NODE_TYPES}
              nodesConnectable={false}
              nodesDraggable={false}
              onEdgeClick={onEdgeClick}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              panOnDrag
              proOptions={{ hideAttribution: true }}
              selectionOnDrag={false}
            >
              <Background
                color="rgba(108, 140, 255, 0.12)"
                gap={20}
                size={1}
                variant={BackgroundVariant.Dots}
              />
              <Controls
                className="ot-graph-controls"
                fitViewOptions={{ maxZoom: 0.95, padding: 0.22 }}
                showInteractive={false}
              />
            </ReactFlow>
          </div>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InfoCard
// ---------------------------------------------------------------------------

function InfoCard({ selection, onDismiss }: { selection: NodeInfo | EdgeInfo; onDismiss: () => void }) {
  if (selection.type === "node") {
    return (
      <div className="ot-graph-info">
        <div className="ot-graph-info__header">
          <span className="ot-graph-info__title">{selection.nodeId}</span>
          <Button
            className="size-6 text-muted-foreground hover:bg-[var(--ot-bg-hover)] hover:text-foreground"
            onClick={onDismiss}
            type="button"
            variant="ghost"
            size="icon-sm"
          >
            <X data-icon="icon" />
          </Button>
        </div>
        <div className="ot-graph-info__rows">
          <InfoRow label="Kind" value={selection.kind} />
          <InfoRow label="Path" value={selection.path} />
          {selection.isCurrent && <InfoRow label="Status" value="Current" accent="blue" />}
          {selection.isPending && <InfoRow label="Status" value="Pending" accent="yellow" />}
          {selection.isInitial && <InfoRow label="Initial" value="Yes" accent="green" />}
          {selection.label !== null && <InfoRow label="Label" value={selection.label} />}
          <InfoRow label="Ownership" value={selection.ownershipSummary} />
          {selection.activePlayers.length > 0 && (
            <InfoRow label="Active" value={formatPlayerList(selection.activePlayers)} />
          )}
          {selection.warnings.length > 0 && selection.warnings.map((w, i) => (
            <InfoRow key={i} label="Warning" value={w} accent="red" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="ot-graph-info">
      <div className="ot-graph-info__header">
        <span className="ot-graph-info__title">{selection.from} → {selection.to}</span>
        <Button
          className="size-6 text-muted-foreground hover:bg-[var(--ot-bg-hover)] hover:text-foreground"
          onClick={onDismiss}
          type="button"
          variant="ghost"
          size="icon-sm"
        >
          <X data-icon="icon" />
        </Button>
      </div>
      <div className="ot-graph-info__rows">
        <InfoRow label="Event" value={selection.event} />
        {selection.resolver !== null && <InfoRow label="Resolver" value={selection.resolver} />}
        {selection.handoff !== null && <InfoRow label="Control" value={selection.handoff.summary} accent="blue" />}
        {selection.handoff !== null && <InfoRow label="Handoff" value={selection.handoff.handoffLabel} />}
        <InfoRow label="Turn effect" value={selection.turn} />
        {selection.isTraversed && <InfoRow label="Traversed" value="Yes" accent="blue" />}
        {selection.isMatchedBranch && <InfoRow label="Matched" value="Yes" accent="green" />}
        {!selection.isTraversed && selection.isInHistory && <InfoRow label="In history" value="Yes" accent="blue" />}
      </div>
    </div>
  );
}

function HandoffStrip({ handoff, turn }: { handoff: InspectorControlHandoff | null; turn: number }) {
  return (
    <div className="ot-graph-handoff" data-testid="graph-handoff-strip">
      <HandoffMetric label="Turn" value={String(turn)} />
      <HandoffMetric label="Before" value={handoff === null ? "none" : formatPlayerList(handoff.beforeActivePlayers)} />
      <HandoffMetric label="After" value={handoff === null ? "none" : formatPlayerList(handoff.afterActivePlayers)} />
      <HandoffMetric label="Handoff" value={handoff?.handoffLabel ?? "unknown"} accent={handoff?.handoffKind ?? "unknown"} />
    </div>
  );
}

function HandoffMetric(
  { label, value, accent }: { label: string; value: string; accent?: "same" | "pass" | "shared" | "terminal" | "unknown" },
) {
  return (
    <div className="ot-graph-handoff__metric">
      <span className="ot-graph-handoff__label">{label}</span>
      <span className={`ot-graph-handoff__value${accent !== undefined ? ` ot-graph-handoff__value--${accent}` : ""}`}>{value}</span>
    </div>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: string; accent?: "blue" | "green" | "yellow" | "red" }) {
  return (
    <div className="ot-graph-info__row">
      <span className="ot-graph-info__label">{label}</span>
      <span className={`ot-graph-info__value${accent ? ` ot-graph-info__value--${accent}` : ""}`}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node components
// ---------------------------------------------------------------------------

function spreadPosition(index: number, total: number): number {
  if (total <= 1) return 50;
  const margin = 22;
  return margin + (index / (total - 1)) * (100 - 2 * margin);
}

function SpreadHandles({ type, count, position }: { type: "source" | "target"; count: number; position: Position }) {
  const prefix = type === "source" ? "out" : "in";
  return (
    <>
      {Array.from({ length: Math.max(count, 1) }, (_, i) => (
        <Handle
          key={`${prefix}-${i}`}
          id={`${prefix}-${i}`}
          type={type}
          position={position}
          style={{ left: `${spreadPosition(i, Math.max(count, 1))}%` }}
        />
      ))}
    </>
  );
}

function CompoundNode({ data }: NodeProps<CompoundFlowNode>) {
  return (
    <div
      className={`ot-graph-compound${data.isCurrent ? " ot-graph-compound--current" : ""}${data.isPending ? " ot-graph-compound--pending" : ""}`}
      style={{ width: data.nodeWidth, height: data.nodeHeight }}
    >
      <div className="ot-graph-compound__label">{data.id}</div>
      <SpreadHandles type="target" count={data.incomingCount} position={Position.Top} />
      <SpreadHandles type="source" count={data.outgoingCount} position={Position.Bottom} />
      {data.hasSelfLoop && (
        <>
          <Handle id="self-right" type="source" position={Position.Right} />
          <Handle id="self-left" type="target" position={Position.Left} />
        </>
      )}
    </div>
  );
}

function StateNode({ data }: NodeProps<StateFlowNode>) {
  const badges = [
    data.isCurrent ? "Current" : null,
    data.isPending ? "Pending" : null,
    data.isInitial ? "Initial" : null,
  ].filter((badge): badge is string => badge !== null);

  let className = "ot-graph-node";
  if (data.isCurrent) className += " ot-graph-node--current";
  else if (data.isPending) className += " ot-graph-node--pending";
  if (data.isInitial) className += " ot-graph-node--initial";
  if (data.warnings.length > 0) className += " ot-graph-node--warning";
  className += ` ot-graph-node--ownership-${data.ownershipTone}`;

  return (
    <div className={className}>
      <SpreadHandles type="target" count={data.incomingCount} position={Position.Top} />
      <SpreadHandles type="source" count={data.outgoingCount} position={Position.Bottom} />
      {data.hasSelfLoop && (
        <>
          <Handle id="self-right" type="source" position={Position.Right} />
          <Handle id="self-left" type="target" position={Position.Left} />
        </>
      )}

      <div className="ot-graph-node__eyebrow">
        <span>{data.kind}</span>
        <span className="ot-graph-node__badges">
          {data.warnings.length > 0 && (
            <span
              className="ot-graph-node__badge ot-graph-node__badge--warning inline-flex items-center gap-0.5"
              title={data.warnings.join("; ")}
            >
              <AlertTriangle className="size-2.5" />
            </span>
          )}
          {badges.map((badge) => (
            <span className="ot-graph-node__badge" key={badge}>{badge}</span>
          ))}
        </span>
      </div>
      <div className="ot-graph-node__title">{data.id}</div>
      {data.activePlayers.length > 0 && (
        <div className="ot-graph-node__players">
          {data.activePlayers.map((playerID) => (
            <span className="ot-graph-node__player-chip" key={playerID}>{formatPlayerChip(playerID)}</span>
          ))}
        </div>
      )}
      {data.isCurrent && data.activePlayers.length === 0 && (
        <div className="ot-graph-node__ownership-note">No active players</div>
      )}
      <div className="ot-graph-node__path">{data.pathLabel}</div>
    </div>
  );
}

function StateEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  markerEnd,
  style,
  data,
}: EdgeProps<Edge>) {
  const renderData = data as GraphEdgeRenderData | undefined;
  const laneOffset = renderData?.laneOffset ?? 0;
  const edgePath = buildLanePath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    laneOffset,
  });

  // Distribute labels of parallel edges along the path rather than all at the
  // midpoint, which otherwise causes label overlap for multi-edge transitions.
  const labelT = renderData?.labelT ?? 0.5;
  const labelPoint = cubicPoint(
    sourceX,
    sourceY,
    edgePath.control1X,
    edgePath.control1Y,
    edgePath.control2X,
    edgePath.control2Y,
    targetX,
    targetY,
    labelT,
  );

  const labelProps = label !== undefined ? {
    label,
    labelX: labelPoint.x,
    labelY: labelPoint.y,
    ...(labelStyle !== undefined ? { labelStyle } : {}),
    ...(labelBgStyle !== undefined ? { labelBgStyle } : {}),
    ...(labelBgPadding !== undefined ? { labelBgPadding } : {}),
    ...(labelBgBorderRadius !== undefined ? { labelBgBorderRadius } : {}),
  } : {};

  const edgeProps = {
    path: edgePath.path,
    interactionWidth: 30,
    ...(markerEnd !== undefined ? { markerEnd } : {}),
    ...(style !== undefined ? { style } : {}),
  };

  return (
    <BaseEdge
      {...edgeProps}
      {...labelProps}
    />
  );
}

function SelfLoopEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  markerEnd,
  style,
  data,
}: EdgeProps<Edge>) {
  // Orthogonal loop above the node: right handle → out → up → across → down → left handle.
  const renderData = data as GraphEdgeRenderData | undefined;
  const lane = renderData?.selfLoopLane ?? 0;
  const extendX = 52 + lane * 12;
  const liftY = 86 + lane * SELF_LOOP_LANE_GAP;
  const y = sourceY;
  const topY = y - liftY;
  const xRight = sourceX + extendX;
  const xLeft = targetX - extendX;

  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${xRight} ${y}`,
    `L ${xRight} ${topY}`,
    `L ${xLeft} ${topY}`,
    `L ${xLeft} ${targetY}`,
    `L ${targetX} ${targetY}`,
  ].join(" ");

  const midX = (sourceX + targetX) / 2;

  const labelProps = label !== undefined ? {
    label,
    labelX: midX,
    labelY: topY - 12,
    ...(labelStyle !== undefined ? { labelStyle } : {}),
    ...(labelBgStyle !== undefined ? { labelBgStyle } : {}),
    ...(labelBgPadding !== undefined ? { labelBgPadding } : {}),
    ...(labelBgBorderRadius !== undefined ? { labelBgBorderRadius } : {}),
  } : {};

  const edgeProps = {
    path,
    interactionWidth: 32,
    ...(markerEnd !== undefined ? { markerEnd } : {}),
    ...(style !== undefined ? { style } : {}),
  };

  return (
    <BaseEdge
      {...edgeProps}
      {...labelProps}
    />
  );
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

function buildFlowGraph(
  graph: GameGraph,
  highlight: InspectorGraphHighlight | null,
  currentTransitionEdge: HistoryEdge | null,
  controlSummary: GameControlSummary | null,
  diagnosticsByNode: Map<string, string[]>,
  historyEdges: readonly HistoryEdge[],
): BuildFlowGraphResult {
  // Identify self-loop and compound-edge nodes
  const selfLoopNodes = new Set<string>();
  const compoundEdgeNodes = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) selfLoopNodes.add(edge.from);
    const fromNode = graph.nodes.find((n) => n.id === edge.from);
    const toNode = graph.nodes.find((n) => n.id === edge.to);
    if (fromNode?.kind === "compound") compoundEdgeNodes.add(edge.from);
    if (toNode?.kind === "compound") compoundEdgeNodes.add(edge.to);
  }

  // Build parent-child hierarchy
  const childrenOf = new Map<string, GameGraphNode[]>();
  for (const node of graph.nodes) {
    if (node.parent !== null) {
      let arr = childrenOf.get(node.parent);
      if (arr === undefined) {
        arr = [];
        childrenOf.set(node.parent, arr);
      }
      arr.push(node);
    }
  }

  const leafNodes = graph.nodes.filter((n) => n.kind === "leaf");
  const compoundNodes = graph.nodes.filter((n) => n.kind === "compound");

  // --- Dagre layout ---
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: "TB",
    ranksep: DAGRE_RANK_SEPARATION,
    nodesep: DAGRE_NODE_SEPARATION,
  });

  for (const node of graph.nodes) {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  for (const edge of graph.edges) {
    if (edge.from !== edge.to) {
      dagreGraph.setEdge(edge.from, edge.to);
    }
  }

  dagre.layout(dagreGraph);

  const absolutePositions = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const node of graph.nodes) {
    const pos = dagreGraph.node(node.id) as { x: number; y: number } | undefined;
    absolutePositions.set(node.id, {
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  // --- Compute edge-handle spread assignments ---
  // Group non-self-loop edges by source and target for handle spreading
  const outgoingGroups = new Map<string, Array<{ edge: GameGraphEdge; index: number }>>();
  const incomingGroups = new Map<string, Array<{ edge: GameGraphEdge; index: number }>>();

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!;
    if (edge.from === edge.to) continue;

    let outArr = outgoingGroups.get(edge.from);
    if (outArr === undefined) { outArr = []; outgoingGroups.set(edge.from, outArr); }
    outArr.push({ edge, index: i });

    let inArr = incomingGroups.get(edge.to);
    if (inArr === undefined) { inArr = []; incomingGroups.set(edge.to, inArr); }
    inArr.push({ edge, index: i });
  }

  // Sort outgoing edges by target X position so left targets use left handles
  for (const [, group] of outgoingGroups) {
    group.sort((a, b) => {
      const ax = absolutePositions.get(a.edge.to)?.x ?? 0;
      const bx = absolutePositions.get(b.edge.to)?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return a.index - b.index;
    });
  }

  // Sort incoming edges by source X position
  for (const [, group] of incomingGroups) {
    group.sort((a, b) => {
      const ax = absolutePositions.get(a.edge.from)?.x ?? 0;
      const bx = absolutePositions.get(b.edge.from)?.x ?? 0;
      if (ax !== bx) return ax - bx;
      return a.index - b.index;
    });
  }

  // Build handle assignment map: edge index -> { sourceHandle, targetHandle }
  const handleAssignments = new Map<number, { sourceHandle: string; targetHandle: string }>();

  for (const [, group] of outgoingGroups) {
    for (let i = 0; i < group.length; i++) {
      const entry = group[i]!;
      const existing = handleAssignments.get(entry.index);
      handleAssignments.set(entry.index, {
        sourceHandle: `out-${i}`,
        targetHandle: existing?.targetHandle ?? "in-0",
      });
    }
  }

  for (const [, group] of incomingGroups) {
    for (let i = 0; i < group.length; i++) {
      const entry = group[i]!;
      const existing = handleAssignments.get(entry.index);
      handleAssignments.set(entry.index, {
        sourceHandle: existing?.sourceHandle ?? "out-0",
        targetHandle: `in-${i}`,
      });
    }
  }

  // Distribute label positions along each edge for parallel edges (same from→to).
  // Without this, multiple labels collapse onto the same midpoint and overlap.
  const labelTByIndex = new Map<number, number>();
  const laneOffsetByIndex = new Map<number, number>();
  const pairGroups = new Map<string, number[]>();
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!;
    if (e.from === e.to) continue;
    const key = `${e.from}→${e.to}`;
    let arr = pairGroups.get(key);
    if (arr === undefined) {
      arr = [];
      pairGroups.set(key, arr);
    }
    arr.push(i);
  }
  for (const group of pairGroups.values()) {
    const n = group.length;
    for (let k = 0; k < n; k++) {
      const index = group[k]!;
      const t = n === 1 ? 0.5 : 0.24 + (k / (n - 1)) * 0.52;
      labelTByIndex.set(index, t);
      laneOffsetByIndex.set(index, (k - (n - 1) / 2) * PARALLEL_EDGE_LANE_GAP);
    }
  }

  const selfLoopLaneByIndex = new Map<number, number>();
  const selfLoopGroups = new Map<string, number[]>();
  for (let i = 0; i < graph.edges.length; i++) {
    const e = graph.edges[i]!;
    if (e.from !== e.to) continue;
    let arr = selfLoopGroups.get(e.from);
    if (arr === undefined) {
      arr = [];
      selfLoopGroups.set(e.from, arr);
    }
    arr.push(i);
  }
  for (const group of selfLoopGroups.values()) {
    for (let k = 0; k < group.length; k++) {
      const index = group[k]!;
      selfLoopLaneByIndex.set(index, k);
      labelTByIndex.set(index, 0.5);
    }
  }

  // --- Compound bounding boxes ---
  const compoundBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
  const compoundsByDepth = sortByDepth(compoundNodes, graph.nodes);

  for (const compound of compoundsByDepth) {
    const children = childrenOf.get(compound.id) ?? [];
    if (children.length === 0) continue;

    const childRects = children.map((child) => {
      const existing = compoundBounds.get(child.id);
      if (existing !== undefined) return existing;
      return absolutePositions.get(child.id)!;
    });

    const minX = Math.min(...childRects.map((r) => r.x - r.width / 2));
    const maxX = Math.max(...childRects.map((r) => r.x + r.width / 2));
    const minY = Math.min(...childRects.map((r) => r.y - r.height / 2));
    const maxY = Math.max(...childRects.map((r) => r.y + r.height / 2));

    const width = maxX - minX + COMPOUND_PADDING_X * 2;
    const height = maxY - minY + COMPOUND_PADDING_TOP + COMPOUND_PADDING_BOTTOM;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2 + (COMPOUND_PADDING_TOP - COMPOUND_PADDING_BOTTOM) / 2;

    compoundBounds.set(compound.id, { x: cx, y: cy, width, height });
  }

  // --- Build React Flow nodes ---
  const flowNodes: AnyFlowNode[] = [];
  const currentActivePlayers = controlSummary?.activePlayers ?? [];
  const currentNodeId = controlSummary?.current.node ?? null;
  // Hosted replays have no controlSummary / graphHighlight — fall back to the
  // transition's target node so the "current" state still lights up.
  const currentHighlightNode = highlight?.currentNode ?? currentTransitionEdge?.to ?? null;
  const pendingTargets = highlight?.pendingTargets ?? [];

  for (const compound of compoundsByDepth) {
    const bounds = compoundBounds.get(compound.id);
    if (bounds === undefined) continue;

    const parentCompound = compound.parent !== null ? compoundBounds.get(compound.parent) : null;
    let position: { x: number; y: number };

    if (parentCompound !== null && parentCompound !== undefined) {
      const parentTopLeftX = parentCompound.x - parentCompound.width / 2;
      const parentTopLeftY = parentCompound.y - parentCompound.height / 2;
      position = {
        x: bounds.x - parentTopLeftX,
        y: bounds.y - parentTopLeftY,
      };
    } else {
      position = { x: bounds.x, y: bounds.y };
    }

    flowNodes.push({
      id: compound.id,
      type: "compound",
      position,
      data: {
        id: compound.id,
        isCurrent: currentHighlightNode === compound.id,
        isPending: pendingTargets.includes(compound.id),
        nodeWidth: bounds.width,
        nodeHeight: bounds.height,
        hasEdges: compoundEdgeNodes.has(compound.id),
        hasSelfLoop: selfLoopNodes.has(compound.id),
        outgoingCount: outgoingGroups.get(compound.id)?.length ?? 0,
        incomingCount: incomingGroups.get(compound.id)?.length ?? 0,
      },
      ...(compound.parent !== null && compoundBounds.has(compound.parent)
        ? { parentId: compound.parent }
        : {}),
      style: { width: bounds.width, height: bounds.height },
    } satisfies CompoundFlowNode);
  }

  for (const node of leafNodes) {
    const abs = absolutePositions.get(node.id)!;
    const parentBounds = node.parent !== null ? compoundBounds.get(node.parent) : null;

    let position: { x: number; y: number };
    if (parentBounds !== null && parentBounds !== undefined) {
      const parentTopLeftX = parentBounds.x - parentBounds.width / 2;
      const parentTopLeftY = parentBounds.y - parentBounds.height / 2;
      position = {
        x: abs.x - parentTopLeftX,
        y: abs.y - parentTopLeftY,
      };
    } else {
      position = { x: abs.x, y: abs.y };
    }

    flowNodes.push({
      id: node.id,
      type: "state",
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      position,
      data: {
        id: node.id,
        isCurrent: currentHighlightNode === node.id,
        isInitial: graph.initial === node.id,
        isPending: pendingTargets.includes(node.id),
        kind: node.kind,
        pathLabel: node.path.length > 0 ? node.path.join(" / ") : node.id,
        warnings: diagnosticsByNode.get(node.id) ?? [],
        hasSelfLoop: selfLoopNodes.has(node.id),
        outgoingCount: outgoingGroups.get(node.id)?.length ?? 0,
        incomingCount: incomingGroups.get(node.id)?.length ?? 0,
        activePlayers: currentNodeId === node.id ? currentActivePlayers : [],
        ownershipTone: currentNodeId === node.id ? getOwnershipTone(currentActivePlayers) : "unknown",
      },
      ...(node.parent !== null && compoundBounds.has(node.parent)
        ? { parentId: node.parent }
        : {}),
    } satisfies StateFlowNode);
  }

  // --- Build React Flow edges ---
  const edgeDataMap = new Map<string, { edge: GameGraphEdge; isTraversed: boolean; isMatchedBranch: boolean; isInHistory: boolean; handoff: InspectorControlHandoff | null }>();

  const edges = graph.edges.map((edge, index): Edge => {
    const hasTraversedEndpoints =
      currentTransitionEdge !== null &&
      currentTransitionEdge.from === edge.from &&
      currentTransitionEdge.to === edge.to;

    const isMatchedBranch =
      hasTraversedEndpoints &&
      currentTransitionEdge.matchedBranch !== null &&
      edge.resolver === currentTransitionEdge.matchedBranch;

    const isTraversed =
      hasTraversedEndpoints &&
      (currentTransitionEdge.matchedBranch === null ||
        edge.resolver === currentTransitionEdge.matchedBranch);

    // Was this edge traversed by any prior frame in the replay history?
    // `matchedBranch === null` means the prior transition didn't target a
    // specific resolver so every edge between the endpoints counts.
    let isInHistory = false;
    let isHistoryMatched = false;
    for (const h of historyEdges) {
      if (h.from !== edge.from || h.to !== edge.to) continue;
      if (h.matchedBranch === null || h.matchedBranch === edge.resolver) {
        isInHistory = true;
        if (h.matchedBranch !== null && h.matchedBranch === edge.resolver) {
          isHistoryMatched = true;
        }
      }
    }

    const isSelfLoop = edge.from === edge.to;
    const edgeId = `${edge.from}:${edge.to}:${edge.event}:${index}`;
    const handoff = isTraversed ? (highlight?.controlHandoff ?? null) : null;

    edgeDataMap.set(edgeId, { edge, isTraversed, isMatchedBranch, isInHistory, handoff });

    const handles = isSelfLoop
      ? { sourceHandle: "self-right", targetHandle: "self-left" }
      : handleAssignments.get(index) ?? { sourceHandle: "out-0", targetHandle: "in-0" };

    const strokeColor = isMatchedBranch
      ? "#34d399"
      : isTraversed
        ? "#6c8cff"
        : isHistoryMatched
          ? "rgba(52, 211, 153, 0.62)"
          : isInHistory
            ? "rgba(108, 140, 255, 0.62)"
            : "rgba(126, 137, 163, 0.74)";

    const strokeWidth = isMatchedBranch
      ? 3.4
      : isTraversed
        ? 3
        : isInHistory
          ? 2.4
          : 1.8;

    return {
      id: edgeId,
      source: edge.from,
      target: edge.to,
      type: isSelfLoop ? "selfLoop" : "state",
      animated: isTraversed,
      label: formatEdgeLabel(edge, handoff),
      data: {
        labelT: labelTByIndex.get(index) ?? 0.5,
        laneOffset: laneOffsetByIndex.get(index) ?? 0,
        selfLoopLane: selfLoopLaneByIndex.get(index) ?? 0,
      } satisfies GraphEdgeRenderData,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: isTraversed ? 21 : 18,
        height: isTraversed ? 21 : 18,
        color: strokeColor,
      },
      style: {
        stroke: strokeColor,
        strokeWidth,
      },
      labelStyle: {
        fill: isMatchedBranch
          ? "#a7f3d0"
          : isTraversed
            ? "#e0e8ff"
            : isHistoryMatched
              ? "#c5ebd5"
              : isInHistory
                ? "#c9d4f0"
                : "#c2c8d8",
        fontFamily: "var(--ot-font)",
        fontSize: 11,
        fontWeight: isTraversed ? 700 : isInHistory ? 650 : 600,
      },
      labelBgStyle: {
        fill: isTraversed || isInHistory ? "rgba(15, 17, 23, 0.97)" : "rgba(15, 17, 23, 0.92)",
        stroke: isMatchedBranch
          ? "rgba(52, 211, 153, 0.6)"
          : isTraversed
            ? "rgba(108, 140, 255, 0.55)"
            : isHistoryMatched
              ? "rgba(52, 211, 153, 0.42)"
              : isInHistory
                ? "rgba(108, 140, 255, 0.42)"
                : "rgba(126, 137, 163, 0.34)",
        strokeWidth: isTraversed ? 1.5 : isInHistory ? 1.25 : 1,
        rx: 6,
        ry: 6,
      },
      labelBgPadding: [10, 5] as [number, number],
      labelBgBorderRadius: 6,
      className: isTraversed
        ? (isMatchedBranch ? "ot-graph-edge--matched" : "ot-graph-edge--traversed")
        : isInHistory
          ? (isHistoryMatched ? "ot-graph-edge--history-matched" : "ot-graph-edge--history")
          : "ot-graph-edge--idle",
    };
  });

  return { nodes: flowNodes, edges, edgeDataMap };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatEdgeLabel(edge: GameGraphEdge, handoff: InspectorControlHandoff | null): string {
  const outcome = formatResolverOutcome(edge.resolver);
  if (handoff !== null) {
    return `${edge.event} · ${handoff.handoffLabel}`;
  }
  const turnSuffix = edge.turn === "increment" ? " ↻" : "";
  if (outcome === null) return `${edge.event}${turnSuffix}`;
  return `${edge.event} · ${outcome}${turnSuffix}`;
}

function formatResolverOutcome(resolver: string | null): string | null {
  if (resolver === null) return null;

  const parts = resolver.split(":");
  const gotoIndex = parts.indexOf("goto");
  if (gotoIndex !== -1) {
    const target = parts[gotoIndex + 1];
    return target === undefined ? "goto" : `goto ${target}`;
  }

  const last = parts[parts.length - 1];
  if (last === "end_turn") return "end turn";
  if (last === "stay" || last === "finish") return last;
  return last ?? null;
}

function buildLanePath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  laneOffset,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourcePosition: Position;
  targetPosition: Position;
  laneOffset: number;
}): {
  path: string;
  control1X: number;
  control1Y: number;
  control2X: number;
  control2Y: number;
} {
  const verticalDistance = Math.abs(targetY - sourceY);
  const horizontalDistance = Math.abs(targetX - sourceX);
  const controlGap = Math.max(84, Math.min(210, verticalDistance * 0.48 + horizontalDistance * 0.16));
  const sourceDirection = positionDirection(sourcePosition);
  const targetDirection = positionDirection(targetPosition);
  const control1X = sourceX + sourceDirection.x * controlGap + laneOffset;
  const control1Y = sourceY + sourceDirection.y * controlGap;
  const control2X = targetX + targetDirection.x * controlGap + laneOffset;
  const control2Y = targetY + targetDirection.y * controlGap;

  return {
    path: `M ${sourceX},${sourceY} C ${control1X},${control1Y} ${control2X},${control2Y} ${targetX},${targetY}`,
    control1X,
    control1Y,
    control2X,
    control2Y,
  };
}

function positionDirection(position: Position): { x: number; y: number } {
  switch (position) {
    case Position.Left:
      return { x: -1, y: 0 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Bottom:
      return { x: 0, y: 1 };
  }
}

function cubicPoint(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  t: number,
): { x: number; y: number } {
  const clampedT = Math.max(0, Math.min(1, t));
  const mt = 1 - clampedT;
  const mt2 = mt * mt;
  const t2 = clampedT * clampedT;

  return {
    x: mt2 * mt * x0 + 3 * mt2 * clampedT * x1 + 3 * mt * t2 * x2 + t2 * clampedT * x3,
    y: mt2 * mt * y0 + 3 * mt2 * clampedT * y1 + 3 * mt * t2 * y2 + t2 * clampedT * y3,
  };
}

function getOwnershipTone(activePlayers: readonly string[]): "single" | "shared" | "none" | "unknown" {
  if (activePlayers.length === 0) return "none";
  if (activePlayers.length === 1) return "single";
  return "shared";
}

function describeOwnership(activePlayers: readonly string[]): string {
  if (activePlayers.length === 0) {
    return "No active players";
  }

  if (activePlayers.length === 1) {
    return `Controlled by ${formatPlayerChip(activePlayers[0]!)}`;
  }

  return `Shared by ${formatPlayerList(activePlayers)}`;
}

function formatPlayerChip(playerID: string): string {
  return `P${playerID}`;
}

function formatPlayerList(players: readonly string[]): string {
  if (players.length === 0) {
    return "none";
  }

  return players.map((playerID) => formatPlayerChip(playerID)).join(", ");
}

function sortByDepth(compoundNodes: GameGraphNode[], allNodes: readonly GameGraphNode[]): GameGraphNode[] {
  const nodeMap = new Map(allNodes.map((n) => [n.id, n]));

  function getDepth(node: GameGraphNode): number {
    let depth = 0;
    let current: GameGraphNode | undefined = node;
    while (current?.parent !== null && current?.parent !== undefined) {
      depth++;
      current = nodeMap.get(current.parent);
    }
    return depth;
  }

  return [...compoundNodes].sort((a, b) => getDepth(b) - getDepth(a));
}
