import { useRef } from "react";
import { chooseSound, sound } from "../state/sound.js";
import { useStore } from "../state/store.js";
import { Button } from "../ui.js";
import { LABELS } from "./copy.js";
import type { View } from "./routes.js";
import { useDialog } from "./useDialog.js";

const Question = () => {
  const root = useRef<HTMLDivElement>(null);
  const onKeyDown = useDialog(root, { onEscape: () => chooseSound("off") });
  return (
    <div className="scrim" onKeyDown={onKeyDown}>
      <div ref={root} role="dialog" aria-modal="true" aria-label={LABELS.sound.dialog} className="dialog dialog--ground">
        <h2>{LABELS.sound.dialog}</h2>
        <p>The tale can be read to you as you go. Choose once; the page will remember.</p>
        <div className="dialog__actions">
          <Button variant="primary" onClick={() => chooseSound("on")}>{LABELS.sound.on}</Button>
          <Button variant="ghost" onClick={() => chooseSound("off")}>{LABELS.sound.off}</Button>
          <Button variant="ghost" onClick={() => chooseSound("off")}>{LABELS.sound.skip}</Button>
        </div>
      </div>
    </div>
  );
};

/** The sound question: first on the story, the shelf and the box pages, until the reader has answered. */
export const SoundGate = ({ view }: { view: View }) => {
  const choice = useStore(sound);
  const asks = view.kind === "story" || view.kind === "box";
  return choice === null && asks ? <Question /> : null;
};
