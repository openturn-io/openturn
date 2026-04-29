import { useCallback, useMemo, useState } from "react";

import type { InspectorFrame } from "@openturn/inspector";
import { ChevronDown, ChevronRight, X } from "lucide-react";

import { useInspector } from "../inspector-context";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";

interface TurnGroupData {
  turn: number;
  frames: readonly InspectorFrame[];
  activePlayers: readonly string[];
  actionCount: number;
}

export function LeftPanel() {
  const { dispatch } = useInspector();

  const onClose = useCallback(() => {
    dispatch({ type: "TOGGLE_LEFT_PANEL" });
  }, [dispatch]);

  return (
    <div className="ot-inspector__panel ot-inspector__panel--left">
      <div className="ot-inspector__panel-header">
        <span>Event Log</span>
        <Button
          className="size-6 shrink-0 text-muted-foreground hover:bg-[var(--ot-bg-hover)] hover:text-foreground"
          onClick={onClose}
          type="button"
          variant="ghost"
          size="icon-sm"
        >
          <X data-icon="icon" />
        </Button>
      </div>

      <EventLog />
    </div>
  );
}

function EventLog() {
  const { timeline, effectiveRevision, dispatch } = useInspector();
  const [search, setSearch] = useState("");
  const [showActions, setShowActions] = useState(true);
  const [showInternal, setShowInternal] = useState(true);
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(new Set());

  const onSelect = useCallback(
    (revision: number) => () => dispatch({ type: "SELECT_REVISION", revision }),
    [dispatch],
  );

  const toggleTurn = useCallback((turn: number) => {
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(turn)) {
        next.delete(turn);
      } else {
        next.add(turn);
      }
      return next;
    });
  }, []);

  const turnGroups = useMemo(() => {
    const groups: TurnGroupData[] = [];
    let current: TurnGroupData | null = null;

    for (const frame of timeline.frames) {
      if (current === null || frame.turn !== current.turn) {
        const activePlayers = frame.controlSummary?.activePlayers ?? [];
        current = {
          turn: frame.turn,
          frames: [],
          activePlayers,
          actionCount: 0,
        };
        groups.push(current);
      }
      (current.frames as InspectorFrame[]).push(frame);
      if (frame.stepKind === "action") {
        current.actionCount += 1;
      }
    }

    return groups;
  }, [timeline.frames]);

  const filteredGroups = useMemo(() => {
    const lower = search.toLowerCase();

    return turnGroups
      .map((group) => {
        let frames = group.frames;

        if (!showActions || !showInternal) {
          frames = frames.filter((f) => {
            if (f.stepKind === "initial") return true;
            if (f.stepKind === "action") return showActions;
            return showInternal;
          });
        }

        if (search !== "") {
          frames = frames.filter(
            (f) =>
              (f.eventName?.toLowerCase().includes(lower) ?? false) ||
              f.stepKind.includes(lower) ||
              String(f.revision).includes(lower) ||
              (f.playerID?.toLowerCase().includes(lower) ?? false) ||
              (f.transition?.from.toLowerCase().includes(lower) ?? false) ||
              (f.transition?.to.toLowerCase().includes(lower) ?? false),
          );
        }

        if (frames.length === 0) return null;
        return { ...group, frames };
      })
      .filter((g): g is TurnGroupData => g !== null);
  }, [turnGroups, search, showActions, showInternal]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EventLogToolbar
        search={search}
        onSearchChange={setSearch}
        showActions={showActions}
        onToggleActions={() => setShowActions((v) => !v)}
        showInternal={showInternal}
        onToggleInternal={() => setShowInternal((v) => !v)}
      />

      <ul className="ot-inspector__frame-list">
        {filteredGroups.length === 0 && (
          <div className="ot-inspector__empty">No matching events.</div>
        )}
        {filteredGroups.map((group) => (
          <TurnGroup
            key={group.turn}
            group={group}
            collapsed={collapsedTurns.has(group.turn)}
            onToggle={() => toggleTurn(group.turn)}
            effectiveRevision={effectiveRevision}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function EventLogToolbar({
  search,
  onSearchChange,
  showActions,
  onToggleActions,
  showInternal,
  onToggleInternal,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  showActions: boolean;
  onToggleActions: () => void;
  showInternal: boolean;
  onToggleInternal: () => void;
}) {
  return (
    <div className="ot-inspector__event-log-toolbar">
      <Input
        className="h-[26px] min-w-0 flex-1 rounded-[var(--ot-radius)] border-border bg-[var(--ot-bg-surface)] font-sans text-[11px] text-[var(--ot-text)] placeholder:text-[var(--ot-text-dim)] focus-visible:border-[var(--ot-accent-dim)]"
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search events…"
        type="text"
        value={search}
      />
      <div className="flex shrink-0 items-center gap-1">
        <button
          className={cn(
            "ot-inspector__filter-chip",
            showActions && "ot-inspector__filter-chip--active",
          )}
          onClick={onToggleActions}
          type="button"
        >
          action
        </button>
        <button
          className={cn(
            "ot-inspector__filter-chip",
            showInternal && "ot-inspector__filter-chip--active",
          )}
          onClick={onToggleInternal}
          type="button"
        >
          internal
        </button>
      </div>
    </div>
  );
}

function TurnGroup({
  group,
  collapsed,
  onToggle,
  effectiveRevision,
  onSelect,
}: {
  group: TurnGroupData;
  collapsed: boolean;
  onToggle: () => void;
  effectiveRevision: number;
  onSelect: (revision: number) => () => void;
}) {
  const isSetup = group.frames.length > 0 && group.frames[0]!.stepKind === "initial";
  const hasSelectedFrame = group.frames.some((f) => f.revision === effectiveRevision);

  const playerLabel = group.activePlayers.length > 0
    ? group.activePlayers.map((p) => `P${p}`).join(", ")
    : null;

  const summary = isSetup
    ? "Setup"
    : playerLabel !== null
      ? `${playerLabel}'s turn`
      : "No active players";

  const countLabel = isSetup
    ? null
    : group.actionCount === 1
      ? "1 action"
      : `${group.actionCount} actions`;

  return (
    <li className="ot-inspector__turn-group">
      <button
        className={cn(
          "ot-inspector__turn-header",
          hasSelectedFrame && "ot-inspector__turn-header--active",
        )}
        onClick={onToggle}
        type="button"
      >
        {collapsed
          ? <ChevronRight className="size-3 shrink-0 text-[var(--ot-text-dim)]" />
          : <ChevronDown className="size-3 shrink-0 text-[var(--ot-text-dim)]" />}
        <span className="ot-inspector__turn-header-label">
          Turn {group.turn}
        </span>
        <span className="ot-inspector__turn-header-summary">
          {summary}
        </span>
        {countLabel !== null && (
          <span className="ot-inspector__turn-header-count">
            {countLabel}
          </span>
        )}
      </button>

      {!collapsed && (
        <ul className="ot-inspector__turn-frames">
          {group.frames.map((frame) => (
            <FrameRow
              key={frame.revision}
              frame={frame}
              isSelected={frame.revision === effectiveRevision}
              onSelect={onSelect(frame.revision)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function FrameRow({
  frame,
  isSelected,
  onSelect,
}: {
  frame: InspectorFrame;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const isInternal = frame.stepKind === "internal";

  return (
    <li
      className={cn(
        "ot-inspector__frame-item",
        isSelected && "ot-inspector__frame-item--selected",
        isInternal && "ot-inspector__frame-item--internal",
      )}
      onClick={onSelect}
    >
      <span className="ot-inspector__frame-rev">{frame.revision}</span>
      <StepBadge stepKind={frame.stepKind} />

      {frame.stepKind === "initial" && (
        <span className="ot-inspector__frame-event">initial</span>
      )}

      {frame.stepKind === "action" && (
        <>
          <span className="ot-inspector__frame-event">
            {frame.eventName ?? "—"}
          </span>
          {frame.playerID !== null && (
            <span className="ot-inspector__frame-player">P{frame.playerID}</span>
          )}
        </>
      )}

      {frame.stepKind === "internal" && (
        <>
          <span className="ot-inspector__frame-event ot-inspector__frame-event--internal">
            {frame.eventName ?? "—"}
          </span>
          {frame.transition !== null && (
            <span className="ot-inspector__frame-edge">
              {frame.transition.from} → {frame.transition.to}
            </span>
          )}
        </>
      )}

      {frame.diffs.length > 0 && (
        <span className="ot-inspector__diff-count">
          +{frame.diffs.length}
        </span>
      )}
    </li>
  );
}

function StepBadge({ stepKind }: { stepKind: InspectorFrame["stepKind"] }) {
  return (
    <Badge
      className={cn(
        "h-4 border-transparent px-1 py-0 font-sans text-[9px] font-semibold tracking-wide uppercase",
        stepKind === "action" && "bg-[rgba(108,140,255,0.18)] text-[var(--ot-accent)]",
        stepKind === "internal" && "bg-[rgba(251,191,36,0.18)] text-[var(--ot-yellow)]",
        stepKind === "initial" && "bg-[rgba(52,211,153,0.18)] text-[var(--ot-green)]",
      )}
      variant="outline"
    >
      {stepKind}
    </Badge>
  );
}
