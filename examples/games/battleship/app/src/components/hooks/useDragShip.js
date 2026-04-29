import { useCallback, useEffect, useState } from "react";
export function useDragShip() {
    const [current, setCurrent] = useState(null);
    const startDrag = useCallback((state) => {
        setCurrent(state);
    }, []);
    const endDrag = useCallback(() => {
        setCurrent(null);
    }, []);
    const rotate = useCallback(() => {
        setCurrent((state) => state === null
            ? state
            : { ...state, orientation: state.orientation === "horizontal" ? "vertical" : "horizontal" });
    }, []);
    useEffect(() => {
        if (current === null)
            return;
        const handler = (event) => {
            if (event.key === "r" || event.key === "R") {
                event.preventDefault();
                rotate();
            }
            else if (event.key === "Escape") {
                setCurrent(null);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [current, rotate]);
    return { current, startDrag, endDrag, rotate, setCurrent };
}
