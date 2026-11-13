import '../../styles/drawing/chrome.css';
import type { ReactNode, Ref } from 'react';

interface PaneProps {
  paneRef: Ref<HTMLDivElement>;
  /** the `CanvasPane` */
  canvas: ReactNode;
  /** chips along the top edge */
  top: ReactNode;
  /** notices, Find and the compare controls, under the top chips */
  middle: ReactNode;
  /** chips along the bottom edge */
  bottom: ReactNode;
}

/** The drawing pane (`region "Drawing"`, full bleed) with flat chips in its corners. */
export function Pane({ paneRef, canvas, top, middle, bottom }: PaneProps) {
  return (
    <div className="pane" ref={paneRef}>
      {canvas}
      <div className="pane-overlay">
        <div className="pane-row">{top}</div>
        <div className="pane-middle">{middle}</div>
        <div className="pane-row pane-row--end">{bottom}</div>
      </div>
    </div>
  );
}
