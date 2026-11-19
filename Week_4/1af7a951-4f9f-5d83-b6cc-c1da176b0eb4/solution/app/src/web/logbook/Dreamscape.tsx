import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { CATEGORIES, type Category, type Constellation } from "../../shared/api";
import { CATEGORY_LABEL, COPY } from "../copy";
import type { Layout } from "../layout";
import { Sky, SkyMiniature, type SkyPoints } from "../sky/Sky";
import type { SceneContent } from "../sky/scene";
import { Dialog } from "../ui/dialog";
import { CloseIcon, ExpandIcon } from "../ui/icons";
import { Status } from "../ui/Status";

/** The condensation step `region "Dreamscape"` publishes in `data-phase`. */
export type CondensationPhase = "idle" | "underline" | "flight" | "settle" | "refused";

interface DreamscapeProps {
  layout: Layout;
  ready: boolean;
  scene: SceneContent;
  constellations: readonly Constellation[];
  target: Category | null;
  reduced: boolean;
  phase: CondensationPhase;
  signsStatus: string;
  skyPoints: Ref<SkyPoints>;
  onDrill: (opener: HTMLButtonElement | null) => void;
}

/** The server's star count for a category; zero until the dreamscape has loaded. */
const starsOf = (constellations: readonly Constellation[], category: Category): number =>
  constellations.find((c) => c.category === category)?.stars ?? 0;

function Legend({ constellations, target }: { constellations: readonly Constellation[]; target: Category | null }) {
  return (
    <ul className="legend" aria-label="Dream-sign legend">
      {CATEGORIES.map((category) => (
        <li key={category}>
          <span>
            {CATEGORY_LABEL[category]}: <span className="count">{starsOf(constellations, category)}</span>
            {category === target ? <span className="target"> (drill target)</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DrillButton({ target, onDrill }: { target: Category | null; onDrill: (opener: HTMLButtonElement | null) => void }) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" className="button" disabled={target === null} onClick={() => onDrill(button.current)}>
        Reality check drill
      </button>
      {target === null ? <p className="drill-hint">{COPY.noTarget}</p> : null}
    </>
  );
}

/** The sky's accessible description: how many stars each constellation draws. */
const skyDescription = (constellations: readonly Constellation[]): string =>
  `Stars: ${CATEGORIES.map((category) => `${CATEGORY_LABEL[category].toLowerCase()} ${starsOf(constellations, category)}`).join(", ")}.`;

/**
 * The dreamscape: a pane (desktop), a pinned band (tablet), or on a phone a horizon strip that opens a full-screen
 * sheet. The collapsed sheet stays in the page, hidden and inert, so nothing in it is reachable.
 */
export function Dreamscape({ layout, ready, scene, constellations, target, reduced, phase, signsStatus, skyPoints, onDrill }: DreamscapeProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const sky = useRef<SkyPoints>(null);
  const miniature = useRef<SkyPoints>(null);
  const open = useRef(sheetOpen);
  open.current = sheetOpen;

  // The flight lands on the sky, or on the strip miniature while the phone's sheet is collapsed.
  useImperativeHandle(skyPoints, () => ({
    pointFor(category, starId) {
      const target = layout === "phone" && !open.current ? miniature.current : sky.current;
      return target?.pointFor(category, starId) ?? null;
    },
  }));

  const skyView = <Sky scene={scene} reduced={reduced} description={skyDescription(constellations)} points={sky} />;

  if (layout !== "phone") {
    return (
      <section className="dreamscape" aria-label="Dreamscape" data-phase={phase}>
        <div className="sky-frame">{skyView}</div>
        {/* Shown once the counts and target are read, so the bottom-pinned chip never changes height in place. */}
        {ready ? (
          <div className="legend-chip panel">
            <Legend constellations={constellations} target={target} />
            <DrillButton target={target} onDrill={onDrill} />
            <Status label="Dream signs">{signsStatus}</Status>
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <section className="dreamscape-strip" aria-label="Dreamscape" data-phase={phase}>
      <button ref={opener} type="button" className="horizon" aria-label="Open dreamscape" onClick={() => setSheetOpen(true)}>
        <SkyMiniature scene={scene} points={miniature} />
        <span className="horizon-label" aria-hidden="true">
          <ExpandIcon />
          Open dreamscape
        </span>
      </button>
      <Dialog persistent open={sheetOpen} title="Dreamscape" className="sheet" onDismiss={() => setSheetOpen(false)} returnFocus={() => opener.current}>
        <div className="sheet-bar">
          <button type="button" className="button quiet" onClick={() => setSheetOpen(false)}>
            <CloseIcon />
            Close dreamscape
          </button>
        </div>
        <div className="sky-frame">{skyView}</div>
        <div className="legend-chip panel">
          <Legend constellations={constellations} target={target} />
          <DrillButton target={target} onDrill={onDrill} />
        </div>
      </Dialog>
    </section>
  );
}
