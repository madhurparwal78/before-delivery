// What the pane draws inside the world group (entities, underlays, a sheet layout, compare layers) and over it in screen space.
import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { config } from '../../config.ts';
import { animateWithId } from '../../ui/index.ts';
import { domEntities, renderDefs, renderEntity, screenToWorld, sheetNode } from '../../../shared/geometry/index.ts';
import type { DiffState, Scene, SceneEntity, Size, View } from '../../../shared/geometry/index.ts';
import type { Sheet, Underlay } from '../../../shared/types.ts';
import { useStoreSlice } from '../../store/hooks.tsx';
import type { DrawingStore } from '../../store/drawingStore.ts';
import type { SceneStore } from '../../store/sceneStore.ts';
import { cameraTransform } from './cameraTransform.ts';
import { svgElement } from './svgNode.ts';
import type { CompareLayers } from './types.ts';

const NO_SELECTION: ReadonlySet<string> = new Set();
/// the far edges of a compare clip, in world units
const CLIP_REACH = 1e7;

interface EntityNodeProps { scene: Scene; entity: SceneEntity; selected: boolean; diff: DiffState | undefined }

/** One entity element; rebuilt only when the scene entity object (replaced on any change), its selection or its diff mark changes. */
const EntityNode = memo(
  function EntityNode({ scene, entity, selected, diff }: EntityNodeProps) {
    return svgElement(renderEntity(scene, entity, { selected, diff }), entity.id);
  },
  (before, after) => before.entity === after.entity && before.selected === after.selected && before.diff === after.diff,
);

function SceneDefs({ scene }: { scene: Scene }): ReactElement {
  return useMemo(() => svgElement(renderDefs(scene)), [scene, scene.version]);
}

/** The entities that have a DOM element, in entity list order. */
function Entities({ store }: { store: SceneStore }) {
  const dom = useStoreSlice(store, (snapshot) => snapshot.dom);
  const selection = useStoreSlice(store, (snapshot) => snapshot.selection);
  const { scene } = store.getSnapshot();
  return <>{dom.map((entity) => <EntityNode key={entity.id} scene={scene} entity={entity} selected={selection.has(entity.id)} diff={undefined} />)}</>;
}

/** A sheet layout: the paper in millimetres with Y down, drawn flipped inside the Y-up world group so one camera serves both. */
function SheetLayout({ store, sheet }: { store: SceneStore; sheet: Sheet }) {
  useStoreSlice(store, (snapshot) => snapshot.scene.version);
  const { scene } = store.getSnapshot();
  const node = useMemo(() => svgElement(sheetNode(sheet, scene)), [sheet, scene, scene.version]);
  return <g transform="scale(1 -1)">{node}</g>;
}

function Underlays({ live }: { live: DrawingStore }) {
  const underlays = useStoreSlice(live, (snapshot) => snapshot.state.underlays);
  return <>{underlays.map((underlay) => <UnderlayImage key={underlay.id} drawingId={live.drawingId} underlay={underlay} />)}</>;
}

/** The image spans its two world corners; flipped back upright inside the Y-up world group. */
function UnderlayImage({ drawingId, underlay }: { drawingId: string; underlay: Underlay }) {
  const x = Math.min(underlay.x1, underlay.x2);
  const top = Math.max(underlay.y1, underlay.y2);
  return (
    <image
      data-underlay-id={underlay.id}
      href={`/api/drawings/${drawingId}/underlays/${underlay.id}`}
      x={x} y={-top} width={Math.abs(underlay.x2 - underlay.x1)} height={Math.abs(underlay.y2 - underlay.y1)}
      transform="scale(1 -1)" preserveAspectRatio="none"
    />
  );
}

interface CompareProps { compare: CompareLayers; view: View; pane: Size; onActivate: ((id: string) => void) | undefined }

/** One version of the compare view: its visible entities with their diff marks, kept to `clip` unless both versions show in full. */
function CompareVersion({ scene, compare, view, pane, onActivate, clip }: CompareProps & { scene: Scene; clip: string | null }) {
  const entities = useMemo(
    () => domEntities(scene, view, pane, config.domMarginPx, config.domCeiling, NO_SELECTION),
    [scene, scene.version, view, pane],
  );
  return (
    <g clipPath={clip ? `url(#${clip})` : undefined}>
      {entities.map((entity) => {
        const diff = compare.diff.get(entity.id) ?? 'same';
        const node = <EntityNode key={entity.id} scene={scene} entity={entity} selected={false} diff={diff} />;
        if (diff === 'same' || !onActivate) return node;
        return (
          <g key={entity.id} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onActivate(entity.id); }}>{node}</g>
        );
      })}
    </g>
  );
}

/** Delta swipe: the later version left of the divider, the earlier right of it; with the overlay both show in full. */
function CompareLayer(props: CompareProps) {
  const { compare, view, pane } = props;
  const [dividerWorld] = screenToWorld(view, [(pane.width * compare.swipe) / 100, 0]);
  const clipped = !compare.overlay;
  return (
    <>
      <SceneDefs scene={compare.earlier} />
      <SceneDefs scene={compare.later} />
      {clipped && (
        <>
          <clipPath id="swipe-later"><rect x={-CLIP_REACH} y={-CLIP_REACH} width={CLIP_REACH + dividerWorld} height={2 * CLIP_REACH} /></clipPath>
          <clipPath id="swipe-earlier"><rect x={dividerWorld} y={-CLIP_REACH} width={CLIP_REACH} height={2 * CLIP_REACH} /></clipPath>
        </>
      )}
      <CompareVersion {...props} scene={compare.earlier} clip={clipped ? 'swipe-earlier' : null} />
      <CompareVersion {...props} scene={compare.later} clip={clipped ? 'swipe-later' : null} />
    </>
  );
}

interface WorldProps {
  store: SceneStore;
  live: DrawingStore | undefined;
  compare: CompareLayers | null;
  onEntityActivate: ((id: string) => void) | undefined;
}

/** `<g data-view-group>`: everything in world units under the camera transform; ZOOMALL animates it. */
export const WorldGroup = memo(function WorldGroup({ store, live, compare, onEntityActivate }: WorldProps) {
  const view = useStoreSlice(store, (snapshot) => snapshot.view);
  const pane = useStoreSlice(store, (snapshot) => snapshot.pane);
  const sheet = useStoreSlice(store, (snapshot) => snapshot.sheet);
  const zoomAll = useStoreSlice(store, (snapshot) => snapshot.zoomAll);
  const group = useRef<SVGGElement>(null);
  const shown = useRef(zoomAll?.token);

  useLayoutEffect(() => {
    if (!zoomAll || zoomAll.token === shown.current || !group.current) return;
    shown.current = zoomAll.token;
    animateWithId(group.current, [{ transform: cameraTransform(zoomAll.from) }, { transform: cameraTransform(view) }], { id: 'zoom-all', duration: 320 });
  }, [zoomAll, view]);

  const { scene } = store.getSnapshot();
  return (
    <g ref={group} data-view-group="" style={{ transform: cameraTransform(view) }}>
      {live && !sheet && !compare && <Underlays live={live} />}
      {sheet ? <SheetLayout store={store} sheet={sheet} /> : compare ? <CompareLayer compare={compare} view={view} pane={pane} onActivate={onEntityActivate} /> : <Entities store={store} />}
      {!compare && <SceneDefs scene={scene} />}
    </g>
  );
});
