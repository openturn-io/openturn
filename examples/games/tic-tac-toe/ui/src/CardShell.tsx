import type { ReactNode } from "react";

export interface CardShellProps {
  eyebrow: ReactNode;
  title: ReactNode;
  message?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

export function CardShell({
  eyebrow,
  title,
  message,
  footer,
  children,
}: CardShellProps): ReactNode {
  return (
    <article className="flex max-w-[520px] flex-col items-center gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-col items-center gap-1 text-center">
        <p className="m-0 text-[0.72rem] font-medium uppercase tracking-[0.22em] text-slate-500">
          {eyebrow}
        </p>
        <h2 className="m-0 text-2xl font-semibold tracking-tight text-slate-950">
          {title}
        </h2>
        {message === undefined ? null : (
          <p aria-live="polite" className="m-0 min-h-5 text-sm text-slate-600">
            {message}
          </p>
        )}
      </header>

      {children}

      {footer === undefined ? null : (
        <footer className="flex flex-wrap items-center justify-center gap-3">
          {footer}
        </footer>
      )}
    </article>
  );
}
