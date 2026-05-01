import type { ReactNode } from "react";

import type { BridgeHost } from "./host";

// `allow-same-origin` is required: the bundle's dev server serves ES module
// imports (entry chunk, HMR client, refresh runtime) which the iframe has to
// fetch from its own origin. Without it, those module fetches fail CORS
// because the iframe's origin becomes the opaque `null`.
//
// The MDN warning about `allow-scripts` + `allow-same-origin` only applies
// when the iframe's document shares an origin with the parent — in that case
// the iframe could reach into the parent and strip its own sandbox. Openturn
// always serves the bundle from a different origin than the parent shell:
// `localhost:<bundle-port>` vs `localhost:<dev-port>` in CLI dev, and a
// deployment domain vs the play domain in cloud. The bridge host also
// enforces `expectOrigin` on every inbound postMessage.
//
// `allow-clipboard-write` was here historically — it is NOT a sandbox token
// (it's a Permissions Policy directive); browsers warn on it. Clipboard
// access is granted via the separate `allow` attribute below.
const DEFAULT_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-modals allow-forms";
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
}: PlayShellProps) {
  return (
    <div
      className={
        className ??
        "flex h-dvh min-h-0 flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100"
      }
    >
      <div
        className={
          toolbarClassName ??
          "flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white/80 px-4 py-2 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/80 dark:text-slate-400"
        }
      >
        <strong className="text-slate-900 dark:text-slate-100">{gameName}</strong>
        {toolbarLead}
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
          {toolbarTrail}
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
