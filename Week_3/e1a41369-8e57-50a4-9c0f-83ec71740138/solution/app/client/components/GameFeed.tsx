import { useEffect, useRef } from "react";
import { registerFeed } from "../feed";

export function GameFeed() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    registerFeed(ref.current);
    return () => registerFeed(null);
  }, []);
  return <div className="feed" role="status" aria-label="Game feed" ref={ref} />;
}
