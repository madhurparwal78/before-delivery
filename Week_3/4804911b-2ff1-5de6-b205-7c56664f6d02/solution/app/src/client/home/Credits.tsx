import { useLayoutEffect, useRef } from "preact/hooks";
import { COPY, countsLine } from "../../shared/copy";
import type { Counts } from "../../shared/types";
import { measure } from "../stage/paint";
import { followLink } from "../lib/router";

export function Credits({ counts }: { counts: Counts | null }) {
  const word = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = word.current;
      if (!el) return;
      const w = el.parentElement?.clientWidth ?? innerWidth;
      const unit = measure("VASANT TALKIES", "display", 100);
      el.style.fontSize = unit > 0 ? `${(w / unit) * 100 * 0.995}px` : "";
    };
    fit();
    addEventListener("resize", fit);
    document.fonts?.addEventListener("loadingdone", fit);
    void document.fonts?.ready.then(fit);
    return () => {
      removeEventListener("resize", fit);
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, []);
  return (
    <section id="end-credits" class="reel credits" aria-label="End Credits">
      <div class="credits-body">
        {counts && <p class="counts">{countsLine(counts)}</p>}
        <p class="legal">{COPY.legal}</p>
        <a class="rect-button" href="/sign-in" onClick={(e) => followLink(e, "/sign-in")}>
          Sign in
        </a>
      </div>
      <div class="wordmark" ref={word}>
        VASANT TALKIES
      </div>
    </section>
  );
}
