import { jsx as _jsx } from "react/jsx-runtime";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";
const badgeVariants = cva("inline-flex items-center gap-1 rounded-md px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors", {
    variants: {
        variant: {
            default: "bg-primary/10 text-primary ring-primary/20",
            secondary: "bg-secondary text-secondary-foreground ring-border",
            outline: "bg-background text-foreground ring-border",
            success: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20",
            warning: "bg-amber-500/10 text-amber-700 ring-amber-500/30",
            destructive: "bg-destructive/10 text-destructive ring-destructive/20",
        },
    },
    defaultVariants: { variant: "default" },
});
export function Badge({ className, variant, ...props }) {
    return _jsx("span", { className: cn(badgeVariants({ variant, className })), ...props });
}
export { badgeVariants };
