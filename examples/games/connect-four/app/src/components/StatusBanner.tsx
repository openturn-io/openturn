export type StatusBannerProps = {
  text: string;
};

export function StatusBanner({ text }: StatusBannerProps): React.ReactElement {
  return (
    <p
      role="status"
      aria-live="polite"
      className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 text-center min-h-5 mb-2"
    >
      {text}
    </p>
  );
}
