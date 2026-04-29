import { jsx as _jsx } from "react/jsx-runtime";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "../../lib/utils";
export function Icon({ icon, size = 18, strokeWidth = 1.75, className, ...props }) {
    return (_jsx(HugeiconsIcon, { icon: icon, size: size, strokeWidth: strokeWidth, className: cn("shrink-0", className), ...props }));
}
