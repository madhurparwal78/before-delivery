import { useEffect, useRef } from "react";
import { STRIKE_CHAPTERS } from "../../../shared/domain.js";
import { navigate, usePlace } from "../router.js";
import { consumeFocus, holds, releaseHold } from "../state/hold.js";
import { useChapter } from "../state/story.js";
import { useStore } from "../state/store.js";
import { Button, Status } from "../ui.js";
import { BurningMatch } from "./BurningMatch.js";
import { LABELS } from "./copy.js";
import { useExtent } from "./layout.js";
import "../styles/hold.css";

const MS = 1000;

/** The server's time left as MM:SS, rounded up. */
const clock = (remainingMs: number): string => {
  const seconds = Math.max(0, Math.ceil(remainingMs / MS));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

/** The hold bar, docked to the bottom edge: what the server last said about this browser's one hold. */
export const HoldBar = () => {
  const state = useStore(holds);
  const dock = useExtent("dock");
  const actions = useRef<HTMLDivElement>(null);
  const { pathname } = usePlace();
  const chapter = useChapter();
  /** One primary action per view: checkout's own submit, or the matchbox in a chapter where a match can be struck. */
  const leadsTheView = pathname !== "/checkout" && !((pathname === "/" || pathname === "/shelf") && STRIKE_CHAPTERS.includes(chapter));
  const request = state.focus;

  useEffect(() => {
    if (request?.target !== "checkout") return;
    actions.current?.querySelector("button")?.focus();
    consumeFocus();
  }, [request]);

  return (
    <section aria-label={LABELS.hold.bar} className="hold-bar" ref={dock}>
      <Status label={LABELS.hold.status} className={`hold-bar__status${state.failed ? " error" : ""}`}>
        {state.message || LABELS.hold.none}
      </Status>
      <div className="hold-bar__count">
        <Status label={LABELS.hold.count} className="hold-bar__numeral">
          <span data-motion="count" key={state.live ? 1 : 0}>{state.live ? 1 : 0}</span>
        </Status>
        <span aria-hidden="true" className="hold-bar__caption">held</span>
      </div>
      {state.live ? (
        <>
          <div className="hold-bar__clock">
            <BurningMatch share={state.holdMs > 0 ? state.remainingMs / state.holdMs : 0} />
            <div role="timer" aria-label={LABELS.hold.timer} className="hold-bar__timer">{clock(state.remainingMs)}</div>
          </div>
          <div className="hold-bar__actions" ref={actions}>
            <Button variant={leadsTheView ? "primary" : "ghost"} onClick={() => navigate("/checkout")}>{LABELS.hold.checkout}</Button>
            <Button variant="ghost" onClick={() => void releaseHold()}>{LABELS.hold.putBack}</Button>
          </div>
        </>
      ) : null}
    </section>
  );
};
