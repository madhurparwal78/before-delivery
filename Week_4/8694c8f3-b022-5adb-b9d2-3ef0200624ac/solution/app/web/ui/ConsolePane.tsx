import { useEffect, useRef } from "react";
import type { EditorStore } from "../store/editor.ts";

export function ConsolePane({ store }: { store: EditorStore }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (end.current) end.current.scrollTop = end.current.scrollHeight;
  }, [store.consoleLines.length]);
  return (
    <div ref={end} role="log" aria-label="Console" className="console" tabIndex={0}>
      {store.consoleLines.map((line, index) => (
        <div key={index} className={/stopped|line \d+:/.test(line) ? "console-line bad" : "console-line"}>{line}</div>
      ))}
    </div>
  );
}
