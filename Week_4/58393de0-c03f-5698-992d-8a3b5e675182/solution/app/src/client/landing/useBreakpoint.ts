import { useEffect, useState } from "react";
import { breakpointOf, type Breakpoint } from "./views";

/** The current breakpoint of the page, updated as the window is resized. */
export function useBreakpoint(): Breakpoint {
  const [breakpoint, setBreakpoint] = useState(() => breakpointOf(window.innerWidth));
  useEffect(() => {
    const update = () => setBreakpoint(breakpointOf(window.innerWidth));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return breakpoint;
}
