import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "openturn:theme";
const THEME_CHANGE_EVENT = "openturn:theme-change";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return systemPrefersDark() ? "dark" : "light";
  return theme;
}

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const list = document.documentElement.classList;
  if (resolved === "dark") list.add("dark");
  else list.remove("dark");
}

export function useTheme(): {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
} {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredTheme()),
  );

  useEffect(() => {
    const next = resolveTheme(theme);
    setResolvedTheme(next);
    applyResolvedTheme(next);
  }, [theme]);

  // When in "system" mode, follow OS-level changes live.
  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = mql.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  // Cross-tab sync via storage events.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const next = isTheme(event.newValue) ? event.newValue : "system";
      setThemeState(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Same-tab sync for independent useTheme() callers. localStorage "storage"
  // events are only delivered to other documents, so the shell broadcaster
  // needs an explicit signal when the inline toggle changes theme.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ theme?: unknown }>).detail;
      setThemeState(isTheme(detail?.theme) ? detail.theme : readStoredTheme());
    };
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
        window.dispatchEvent(
          new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: next } }),
        );
      }
    } catch {
      // localStorage may be unavailable (private mode, disabled cookies).
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: next } }),
        );
      }
    }
  }, []);

  return { theme, resolvedTheme, setTheme };
}

/**
 * Returns an inline-script body that applies the persisted theme to
 * `<html>` before React mounts, preventing a light→dark flash on load.
 * Embed inside a `<script>` tag in the document head.
 */
export function getInitialThemeScript(): string {
  return (
    `(function(){try{` +
    `var k=${JSON.stringify(THEME_STORAGE_KEY)};` +
    `var v=localStorage.getItem(k);` +
    `var t=(v==="light"||v==="dark"||v==="system")?v:"system";` +
    `var d=t==="dark"||(t==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);` +
    `var c=document.documentElement.classList;d?c.add("dark"):c.remove("dark");` +
    `}catch(e){}})();`
  );
}

export function ThemeToggle({
  className,
}: {
  className?: string;
}) {
  const { theme, setTheme } = useTheme();
  const options: { id: Theme; label: string; icon: React.ReactNode }[] = [
    { id: "light", label: "Light", icon: <SunIcon /> },
    { id: "system", label: "System", icon: <SystemIcon /> },
    { id: "dark", label: "Dark", icon: <MoonIcon /> },
  ];
  return (
    <span
      role="group"
      aria-label="Theme"
      className={
        className ??
        "inline-flex overflow-hidden rounded-md border border-slate-200 text-xs dark:border-slate-700"
      }
    >
      {options.map((opt) => {
        const active = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            aria-label={opt.label}
            title={opt.label}
            onClick={() => setTheme(opt.id)}
            className={
              active
                ? "bg-slate-900 px-2 py-1 text-white dark:bg-slate-100 dark:text-slate-900"
                : "px-2 py-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            }
          >
            {opt.icon}
          </button>
        );
      })}
    </span>
  );
}

function SunIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}
