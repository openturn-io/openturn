import * as React from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";

import { cn } from "../../lib/utils";

export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, "children"> {
  icon: IconSvgElement;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ icon, size = 18, strokeWidth = 1.75, className, ...props }: IconProps) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}
