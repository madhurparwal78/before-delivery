import { useState } from "react";

/** The `Copy` pill that sits beside a truncated id. */
export function CopyId({ value }: { value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button type="button" className="pill pill--outline pill--small" aria-label={`Copy ${value}`}
      onClick={() => navigator.clipboard.writeText(value).then(() => setState("copied"), () => setState("failed"))}>
      {state === "idle" ? "Copy" : state === "copied" ? "Copied" : "Copy failed"}
    </button>
  );
}
