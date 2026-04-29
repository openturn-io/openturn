import { useCallback, useMemo, useState } from "react";

import type { ReplayValue } from "@openturn/core";
import type { InspectorFrame, SnapshotDiffEntry } from "@openturn/inspector";
import { Check, Copy, X } from "lucide-react";

import { useInspector } from "../inspector-context";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { CodeBlock } from "./code-block";

type RightTab = "diff" | "state" | "transition" | "evaluations" | "control";

export function RightPanel() {
  const [activeTab, setActiveTab] = useState<RightTab>("diff");
  const { dispatch, currentFrame } = useInspector();

  const onClose = useCallback(() => {
    dispatch({ type: "TOGGLE_RIGHT_PANEL" });
  }, [dispatch]);

  const copyPayload = useMemo(
    () => buildTabCopyPayload(activeTab, currentFrame),
    [activeTab, currentFrame],
  );

  return (
    <div className="ot-inspector__panel ot-inspector__panel--right">
      <div className="ot-inspector__panel-header">
        <span>
          Inspector — Rev
          {" "}
          {currentFrame.revision}
        </span>
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

      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex h-auto w-full items-center justify-stretch border-b border-border bg-[var(--ot-bg)] px-2 py-1">
          {(
            [
              ["diff", "Diff"],
              ["state", "State"],
              ["transition", "Transition"],
              ["evaluations", "Evals"],
              ["control", "Control"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={cn(
                "min-w-0 flex-1 border-b-2 border-transparent px-2 py-1.5 font-sans text-[10px] font-semibold tracking-wide uppercase transition-colors",
                activeTab === value
                  ? "border-primary text-primary"
                  : "text-[var(--ot-text-dim)] hover:text-foreground",
              )}
              key={value}
              onClick={() => setActiveTab(value)}
              type="button"
            >
              {label}
            </button>
          ))}
          <CopyButton text={copyPayload} title={`Copy ${activeTab} as JSON`} />
        </div>

        <div className="mt-0 min-h-0 flex-1 overflow-auto">
          {activeTab === "diff" && <DiffView frame={currentFrame} />}
          {activeTab === "state" && <StateView frame={currentFrame} />}
          {activeTab === "transition" && <TransitionView frame={currentFrame} />}
          {activeTab === "evaluations" && <EvaluationsView frame={currentFrame} />}
          {activeTab === "control" && <ControlView frame={currentFrame} />}
        </div>
      </div>
    </div>
  );
}

function DiffView({ frame }: { frame: InspectorFrame }) {
  if (frame.diffs.length === 0) {
    return <div className="ot-inspector__empty">No changes at this revision.</div>;
  }

  return (
    <div className="ot-inspector__panel-section">
      {frame.diffs.map((diff, i) => (
        <DiffEntry diff={diff} key={i} />
      ))}
    </div>
  );
}

function DiffEntry({ diff }: { diff: SnapshotDiffEntry }) {
  return (
    <div className="ot-inspector__diff-entry">
      <span className="ot-inspector__diff-path">{diff.path}</span>
      <span className="ot-inspector__diff-before">{formatValue(diff.before)}</span>
      <span className="ot-inspector__diff-arrow">→</span>
      <span className="ot-inspector__diff-after">{formatValue(diff.after)}</span>
    </div>
  );
}

function StateView({ frame }: { frame: InspectorFrame }) {
  return (
    <div className="ot-inspector__panel-section">
      <div className="ot-inspector__panel-section-title">Snapshot (G)</div>
      <JsonTree value={frame.snapshot} />

      {frame.playerView !== null && (
        <>
          <div className="ot-inspector__panel-section-title mt-3">
            Player View
          </div>
          <JsonTree value={frame.playerView} />
        </>
      )}
    </div>
  );
}

function TransitionView({ frame }: { frame: InspectorFrame }) {
  if (frame.transition === null) {
    return <div className="ot-inspector__empty">No transition at this revision.</div>;
  }

  const t = frame.transition;

  return (
    <div className="ot-inspector__panel-section">
      <div className="ot-inspector__transition">
        <TransitionRow label="Event" value={t.event} />
        <TransitionRow label="From" value={t.from} />
        <TransitionRow label="To" value={t.to} />
        <TransitionRow label="Resolver" value={t.resolver ?? "—"} />
        {t.matchedFrom !== undefined && (
          <TransitionRow label="Matched" value={t.matchedFrom} />
        )}
      </div>

      {frame.payload !== null && (
        <>
          <div className="ot-inspector__panel-section-title mt-3">
            Payload
          </div>
          <JsonTree value={frame.payload} />
        </>
      )}

      {t.rng !== null && t.rng !== undefined && (
        <>
          <div className="ot-inspector__panel-section-title mt-3">
            RNG Trace
          </div>
          <JsonTree value={t.rng as unknown as ReplayValue} />
        </>
      )}
    </div>
  );
}

function TransitionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ot-inspector__transition-row">
      <span className="ot-inspector__transition-label">{label}</span>
      <span className="ot-inspector__transition-value">{value}</span>
    </div>
  );
}

function EvaluationsView({ frame }: { frame: InspectorFrame }) {
  if (frame.evaluations.length === 0) {
    return <div className="ot-inspector__empty">No evaluations at this revision.</div>;
  }

  return (
    <div className="ot-inspector__panel-section">
      {frame.evaluations.map((family, fi) => (
        <div className="ot-inspector__eval-family" key={fi}>
          <div className="ot-inspector__eval-header">
            {family.event}
            {" "}
            @
            {" "}
            {family.from}
            {family.matchedTo !== null && ` → ${family.matchedTo}`}
          </div>
          {family.transitions.map((candidate, ci) => (
            <div
              className={`ot-inspector__eval-candidate ${
                candidate.matched ? "ot-inspector__eval-matched" : "ot-inspector__eval-skipped"
              }`}
              key={ci}
            >
              <span>{candidate.resolver ?? "anonymous"}</span>
              <span>
                →
                {" "}
                {candidate.to}
              </span>
              <span className="inline-flex items-center gap-1">
                {candidate.matched
                  ? (
                      <>
                        <Check className="size-3" />
                        matched
                      </>
                    )
                  : (
                      <>
                        <X className="size-3" />
                        skipped
                      </>
                    )}
              </span>
              {candidate.rejectedBy !== null && (
                <span className="opacity-60">
                  {" "}
                  (
                  {candidate.rejectedBy}
                  )
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ControlView({ frame }: { frame: InspectorFrame }) {
  if (frame.controlSummary === null) {
    return <div className="ot-inspector__empty">No control data at this revision.</div>;
  }

  const cs = frame.controlSummary;

  return (
    <div className="ot-inspector__panel-section">
      <div className="ot-inspector__panel-section-title">Current Node</div>
      <div className="ot-inspector__transition">
        <TransitionRow label="Node" value={cs.current.node} />
        <TransitionRow label="Path" value={cs.current.path.join(" → ")} />
        <TransitionRow label="Active" value={cs.activePlayers.join(", ") || "none"} />
        {cs.current.meta.label !== null && (
          <TransitionRow label="Label" value={cs.current.meta.label} />
        )}
      </div>

      {cs.control !== null && (
        <>
          <div className="ot-inspector__panel-section-title mt-3">
            Control State
          </div>
          <JsonTree value={cs.control} />
        </>
      )}

      {cs.pendingTargetDetails.length > 0 && (
        <>
          <div className="ot-inspector__panel-section-title mt-3">
            Pending Targets
          </div>
          {cs.pendingTargetDetails.map((target, i) => (
            <div className="ot-inspector__transition mb-1.5" key={i}>
              <TransitionRow label="Node" value={target.node} />
              <TransitionRow label="Path" value={target.path.join(" → ")} />
              {target.label !== null && <TransitionRow label="Label" value={target.label} />}
            </div>
          ))}
        </>
      )}

      {cs.current.meta.metadata.length > 0 && (
        <>
          <div className="ot-inspector__panel-section-title mt-3">
            Metadata
          </div>
          {cs.current.meta.metadata.map((entry, i) => (
            <div className="ot-inspector__transition-row" key={i}>
              <span className="ot-inspector__transition-label">{entry.key}</span>
              <span className="ot-inspector__transition-value">{formatValue(entry.value)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function formatValue(value: ReplayValue | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function JsonTree({ value }: { value: ReplayValue }) {
  return <CodeBlock code={JSON.stringify(value, null, 2)} language="json" />;
}

function buildTabCopyPayload(tab: RightTab, frame: InspectorFrame): string {
  const payload = (() => {
    switch (tab) {
      case "diff":
        return { revision: frame.revision, diffs: frame.diffs };
      case "state":
        return {
          revision: frame.revision,
          snapshot: frame.snapshot,
          playerView: frame.playerView,
        };
      case "transition":
        return {
          revision: frame.revision,
          transition: frame.transition,
          payload: frame.payload,
        };
      case "evaluations":
        return { revision: frame.revision, evaluations: frame.evaluations };
      case "control":
        return { revision: frame.revision, controlSummary: frame.controlSummary };
    }
  })();
  return JSON.stringify(payload, null, 2);
}

function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    const write = typeof navigator !== "undefined" && navigator.clipboard !== undefined
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error("clipboard unavailable"));

    write
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        // Fallback: select a hidden textarea and exec copy
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "absolute";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          // swallow
        }
      });
  }, [text]);

  return (
    <Button
      aria-label={title}
      className="ml-1 size-6 shrink-0 text-muted-foreground hover:bg-[var(--ot-bg-hover)] hover:text-foreground"
      onClick={onCopy}
      size="icon-sm"
      title={copied ? "Copied!" : title}
      type="button"
      variant="ghost"
    >
      {copied ? <Check data-icon="icon" /> : <Copy data-icon="icon" />}
    </Button>
  );
}
