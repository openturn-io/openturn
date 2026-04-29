import * as React from "react";
import { type IconSvgElement } from "@hugeicons/react";
export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, "children"> {
    icon: IconSvgElement;
    size?: number;
    strokeWidth?: number;
}
export declare function Icon({ icon, size, strokeWidth, className, ...props }: IconProps): import("react/jsx-runtime").JSX.Element;
