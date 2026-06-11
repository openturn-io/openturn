import * as React from "react";

import { type AuctionType } from "@openturn/example-modern-art-game";

interface IconProps {
  className?: string | undefined;
}

function Svg({ children, className }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      className={className ?? "icon"}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

/** Gavel — open auction / auctioneer. */
export function GavelIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 4.5 19 10M11 7l5.5 5.5M14.75 5.75 8.5 12l3 3 6.25-6.25z" />
      <path d="M9.5 14.5 4 20M3.5 21.5h9" />
    </Svg>
  );
}

/** Single raised finger — one-offer auction. */
export function OnceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21V7M12 7l-3.5 3.5M12 7l3.5 3.5" />
      <path d="M5 21h14" />
    </Svg>
  );
}

/** Sealed envelope — hidden auction. */
export function SealedIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="13" rx="1.5" width="18" x="3" y="5.5" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </Svg>
  );
}

/** Price tag — fixed price. */
export function TagIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11.6 3.4 3.9 11a2 2 0 0 0 0 2.9l6.2 6.2a2 2 0 0 0 2.9 0l7.6-7.7a2 2 0 0 0 .6-1.4V5a2 2 0 0 0-2-2h-5.9a2 2 0 0 0-1.7.4z" />
      <circle cx="16" cy="8" fill="currentColor" r="1.4" stroke="none" />
    </Svg>
  );
}

/** Two overlapping frames — double auction. */
export function DoubleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="12" rx="1.5" width="12" x="3.5" y="8.5" />
      <path d="M8.5 5.5v-1a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 20.5 4.5v9a1.5 1.5 0 0 1-1.5 1.5h-1" />
    </Svg>
  );
}

/** Banknotes — money. */
export function CashIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="11" rx="1.5" width="18" x="3" y="6.5" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5h.01M18 14.5h.01" />
    </Svg>
  );
}

/** Stacked deck — draw pile. */
export function DeckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect height="13" rx="1.5" width="10" x="4" y="7" />
      <path d="M9 4.5h9A1.5 1.5 0 0 1 19.5 6v11" />
    </Svg>
  );
}

/** Crown — winner. */
export function CrownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 8 3.5 4L12 6l4.5 6L20 8v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5z" />
    </Svg>
  );
}

/** Eye — spectator. */
export function EyeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </Svg>
  );
}

export function AuctionTypeIcon({ type, className }: IconProps & { type: AuctionType }) {
  if (type === "open") return <GavelIcon className={className} />;
  if (type === "oneOffer") return <OnceIcon className={className} />;
  if (type === "hidden") return <SealedIcon className={className} />;
  if (type === "fixed") return <TagIcon className={className} />;
  return <DoubleIcon className={className} />;
}
