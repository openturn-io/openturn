import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { BridgeHost } from "./host";
import {
  BRIDGE_CAPABILITY_PRESETS,
  type BridgeCapabilityDescriptor,
  type BridgeCapabilityPreset,
} from "./schema";

const DEFAULT_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-modals allow-clipboard-write allow-forms";
const DEFAULT_IFRAME_ALLOW = "clipboard-write";

export interface PlayShellProps {
  host: BridgeHost;
  gameName: string;
  toolbarLead?: ReactNode;
  toolbarTrail?: ReactNode;
  iframeTitle?: string;
  iframeSandbox?: string;
  iframeAllow?: string;
  className?: string;
  toolbarClassName?: string;
  /** Disable the ⌘K / Ctrl+K command palette shortcut. */
  disableCommandPalette?: boolean;
}

export function PlayShell({
  host,
  gameName,
  toolbarLead,
  toolbarTrail,
  iframeTitle,
  iframeSandbox,
  iframeAllow,
  className,
  toolbarClassName,
  disableCommandPalette,
}: PlayShellProps) {
  const capabilities = useBridgeCapabilities(host);
  const headerCaps = useMemo(
    () => capabilities.filter((c) => BRIDGE_CAPABILITY_PRESETS[c.preset].slot === "header"),
    [capabilities],
  );
  const menuCaps = useMemo(
    () => capabilities.filter((c) => BRIDGE_CAPABILITY_PRESETS[c.preset].slot === "menu"),
    [capabilities],
  );
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (disableCommandPalette === true) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disableCommandPalette]);

  const invoke = (preset: BridgeCapabilityPreset) => {
    void host.invoke(preset).catch(() => {});
  };

  return (
    <div
      className={
        className ??
        "flex h-dvh min-h-0 flex-col bg-white text-slate-900"
      }
    >
      <div
        className={
          toolbarClassName ??
          "flex flex-none flex-wrap items-center gap-3 border-b border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-600"
        }
      >
        <strong className="text-slate-900">{gameName}</strong>
        {toolbarLead}
        <div className="ml-auto flex items-center gap-1">
          <CapabilityHeaderButtons capabilities={headerCaps} onInvoke={invoke} />
          {toolbarTrail}
          <CapabilityOverflowMenu capabilities={menuCaps} onInvoke={invoke} />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <BridgeIframe
          host={host}
          title={iframeTitle ?? gameName}
          {...(iframeSandbox === undefined ? {} : { sandbox: iframeSandbox })}
          {...(iframeAllow === undefined ? {} : { allow: iframeAllow })}
        />
      </div>
      <CapabilityCommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        capabilities={menuCaps}
        onInvoke={(preset) => {
          setPaletteOpen(false);
          invoke(preset);
        }}
      />
    </div>
  );
}

export interface BridgeIframeProps {
  host: BridgeHost;
  title: string;
  sandbox?: string;
  allow?: string;
  className?: string;
}

export function BridgeIframe({
  host,
  title,
  sandbox,
  allow,
  className,
}: BridgeIframeProps) {
  return (
    <iframe
      title={title}
      src={host.src}
      sandbox={sandbox ?? DEFAULT_IFRAME_SANDBOX}
      allow={allow ?? DEFAULT_IFRAME_ALLOW}
      className={className ?? "block h-full w-full border-0"}
    />
  );
}

export function useBridgeCapabilities(
  host: BridgeHost,
): readonly BridgeCapabilityDescriptor[] {
  const [capabilities, setCapabilities] = useState<readonly BridgeCapabilityDescriptor[]>(
    () => host.capabilities,
  );
  useEffect(() => {
    setCapabilities(host.capabilities);
    return host.on("capability-changed", (e) => setCapabilities(e.capabilities));
  }, [host]);
  return capabilities;
}

export interface CapabilityHeaderButtonsProps {
  capabilities: readonly BridgeCapabilityDescriptor[];
  onInvoke: (preset: BridgeCapabilityPreset) => void;
  className?: string;
}

export function CapabilityHeaderButtons({
  capabilities,
  onInvoke,
  className,
}: CapabilityHeaderButtonsProps) {
  if (capabilities.length === 0) return null;
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`.trim()}>
      {capabilities.map((cap) => {
        const meta = BRIDGE_CAPABILITY_PRESETS[cap.preset];
        return (
          <button
            key={cap.preset}
            type="button"
            disabled={cap.disabled === true}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            onClick={() => onInvoke(cap.preset)}
            title={meta.label}
          >
            <span>{meta.label}</span>
            {cap.badge !== undefined ? (
              <span className="text-slate-500">({cap.badge})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export interface CapabilityOverflowMenuProps {
  capabilities: readonly BridgeCapabilityDescriptor[];
  onInvoke: (preset: BridgeCapabilityPreset) => void;
  className?: string;
}

export function CapabilityOverflowMenu({
  capabilities,
  onInvoke,
  className,
}: CapabilityOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (containerRef.current === null) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (capabilities.length === 0) return null;

  return (
    <div ref={containerRef} className={`relative ${className ?? ""}`.trim()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
      >
        <span aria-hidden>⋯</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-md border border-slate-200 bg-white p-1 text-sm shadow-lg"
        >
          {capabilities.map((cap) => {
            const meta = BRIDGE_CAPABILITY_PRESETS[cap.preset];
            return (
              <button
                key={cap.preset}
                type="button"
                role="menuitem"
                disabled={cap.disabled === true}
                onClick={() => {
                  setOpen(false);
                  onInvoke(cap.preset);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
              >
                <span className="flex-1">{meta.label}</span>
                {cap.badge !== undefined ? (
                  <span className="text-xs text-slate-500">{cap.badge}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export interface CapabilityCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  capabilities: readonly BridgeCapabilityDescriptor[];
  onInvoke: (preset: BridgeCapabilityPreset) => void;
}

export function CapabilityCommandPalette({
  open,
  onClose,
  capabilities,
  onInvoke,
}: CapabilityCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return capabilities;
    return capabilities.filter((c) =>
      BRIDGE_CAPABILITY_PRESETS[c.preset].label.toLowerCase().includes(normalized),
    );
  }, [capabilities, query]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);

  useEffect(() => {
    if (selected >= filtered.length) {
      setSelected(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selected]);

  if (!open) return null;

  const commit = () => {
    const cap = filtered[selected];
    if (cap === undefined) return;
    onInvoke(cap.preset);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(filtered.length - 1, s + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(0, s - 1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="Run a game action…"
          className="w-full border-b border-slate-200 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-slate-400"
        />
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-slate-500">
            No matching actions.
          </div>
        ) : (
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.map((cap, i) => {
              const meta = BRIDGE_CAPABILITY_PRESETS[cap.preset];
              return (
                <li
                  key={cap.preset}
                  role="option"
                  aria-selected={i === selected}
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => onInvoke(cap.preset)}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm text-slate-700 ${
                    i === selected ? "bg-slate-100" : ""
                  }`}
                >
                  <span>{meta.label}</span>
                  {cap.badge !== undefined ? (
                    <span className="text-xs text-slate-500">{cap.badge}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
