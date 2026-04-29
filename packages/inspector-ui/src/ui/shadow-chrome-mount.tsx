import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface ShadowChromeMountProps {
  children: ReactNode;
  /** Full CSS text injected as a single shadow <style> (updates when this string changes). */
  shadowCss: string;
  /** Extra class names on the inner portal root (theme + layout). */
  rootClassName: string;
}

/**
 * Attaches an open shadow root, injects devtools CSS, and portals React children inside.
 */
export function ShadowChromeMount({
  children,
  shadowCss,
  rootClassName,
}: ShadowChromeMountProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });

    let styleEl = shadow.querySelector("style[data-ot-chrome]");
    if (styleEl === null) {
      styleEl = document.createElement("style");
      styleEl.setAttribute("data-ot-chrome", "true");
      shadow.appendChild(styleEl);
    }
    styleEl.textContent = shadowCss;

    let root = shadow.querySelector("[data-ot-chrome-root]") as HTMLElement | null;
    if (root === null) {
      root = document.createElement("div");
      root.setAttribute("data-ot-chrome-root", "true");
      shadow.appendChild(root);
    }
    root.className = rootClassName;
    setPortalTarget(root);
  }, [shadowCss, rootClassName]);

  return (
    <>
      <div className="ot-inspector-shadow-host" ref={hostRef} />
      {portalTarget !== null ? createPortal(children, portalTarget) : null}
    </>
  );
}
