import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "../../lib/utils";
export const Separator = React.forwardRef(({ className, orientation = "horizontal", ...props }, ref) => (_jsx("div", { ref: ref, role: "separator", "aria-orientation": orientation, className: cn("bg-border", orientation === "horizontal" ? "h-px w-full" : "w-px h-full", className), ...props })));
Separator.displayName = "Separator";
