import { useEffect, useMemo, useRef, useState } from "react";
import { formatLength } from "../../shared/units";
import { get } from "../api";
import { prefersReducedMotion, useLayout } from "../layout";
import { setQuery } from "../router";
import { SceneView, type SceneHandle } from "../scene/SceneView";
import { isFailure } from "../store";
import { SkipLink } from "../ui/Shell";
import type { Snapshot, View } from "../types";

const HEADINGS = {
  404: "This preview link isn't valid.",
  410: "This preview has been withdrawn by the museum.",
  503: "This preview can't be shown right now. Please try again later.",
} as const;

/** The read-only lender page, rendered from the lender's frozen snapshot. */
export function LenderPage({ token }: { token: string }) {
  const layout = useLayout();
  const reduced = useMemo(prefersReducedMotion, []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [problem, setProblem] = useState<keyof typeof HEADINGS | null>(null);
  const [view, setView] = useState<View>(() => (new URLSearchParams(location.search).get("view") === "wall" ? "wall" : "plan"));
  const scene = useRef<SceneHandle>(null);

  useEffect(() => {
    get<Snapshot>(`/api/p/${encodeURIComponent(token)}`)
      .then(setSnapshot)
      .catch((e) => setProblem(isFailure(e, 410) ? 410 : isFailure(e, 404) ? 404 : 503));
  }, [token]);

  const order = snapshot?.walls.map((w) => w.name) ?? [];
  const works = useMemo(
    () =>
      [...(snapshot?.works ?? [])].sort((a, b) => order.indexOf(a.wallName) - order.indexOf(b.wallName) || a.offsetMm - b.offsetMm),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot],
  );
  const walls = useMemo(() => (snapshot?.walls ?? []).map((w) => ({ ...w, plannedLux: 0 })), [snapshot]);
  const sceneWorks = useMemo(
    () =>
      works.map((w, i) => ({
        id: `work-${i}`,
        title: w.title,
        wallId: walls.find((x) => x.name === w.wallName)?.id ?? "",
        offsetMm: w.offsetMm,
        centreHeightMm: w.centreHeightMm,
        widthMm: w.widthMm,
        heightMm: w.heightMm,
        luxStatus: "within" as const,
      })),
    [works, walls],
  );
  const facing = sceneWorks[0]?.wallId ?? null;

  useEffect(() => {
    if (snapshot && view === "wall") scene.current?.restore("wall", true);
    // restored once, when the snapshot arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  const choose = (next: View) => {
    if (next === view) return;
    setView(next);
    scene.current?.setView(next);
    setQuery({ view: next === "wall" ? "wall" : null });
  };

  return (
    <>
      <SkipLink />
      <header className="masthead masthead-lender">
        <span className="product">Hangline</span>
        <span className="masthead-note">Lender preview</span>
      </header>
      <main id="main" tabIndex={-1} className={`lender layout-${layout}`}>
        {problem && <h1>{HEADINGS[problem]}</h1>}
        {!problem && !snapshot && (
          <h1>
            <span className="skeleton-text">Loading the preview</span>
          </h1>
        )}
        {snapshot && (
          <>
            <h1 className="display">{snapshot.exhibition.title}</h1>
            <p className="lender-for">{`Prepared for ${snapshot.lender.name}`}</p>
            <p className="muted">{`Published ${snapshot.publishedAtDisplay}`}</p>
            <div className="lender-body">
              <section aria-label="Preview scene" className="lender-scene">
                <div role="group" aria-label="View" className="view-group">
                  {(["plan", "wall"] as View[]).map((v) => (
                    <button key={v} type="button" className="view-button" aria-pressed={view === v} onClick={() => choose(v)}>
                      {v === "plan" ? "Plan" : "Wall"}
                    </button>
                  ))}
                </div>
                <SceneView ref={scene} label="Gallery drawing" walls={walls} works={sceneWorks} selectedId={null} facingWallId={facing} reduced={reduced} hooks={{}} />
              </section>
              <section className="lender-list" aria-labelledby="your-works">
                <h2 id="your-works">Your works in place</h2>
                <ul aria-label="Your works" className="lender-works">
                  {works.map((w, i) => (
                    <li key={i}>
                      <h3>{w.title}</h3>
                      <p className="muted">{w.objectNumber}</p>
                      <p>{w.wallName}</p>
                      <p className="num">{`Offset ${formatLength(w.offsetMm, "cm")} from the left end`}</p>
                      <p className="num">{`Centre ${formatLength(w.centreHeightMm, "cm")} from the floor`}</p>
                      <p className="num">{`${formatLength(w.widthMm, "cm")} × ${formatLength(w.heightMm, "cm")}`}</p>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}
