// The drawing pane. The Drawing screen passes the live store as `live`; the Review and view-link screens pass only a scene store.
//
// The pane renders `region "Drawing"` (tabindex 0) with data-revision, data-pending-ops, data-total-entities, data-snap-kind/x/y, data-zoom,
// data-pan-x/y; it fills its container (give the container a size and `position: relative`; chips sit on top of the pane with z-index).
// It tells the store its size (ResizeObserver), turns pointer, wheel, keyboard and touch events into store calls and draws the store's snapshot:
//   - entity elements (React elements built from the shared SvgNode trees) for `snapshot.dom`, `aria-selected` for selected ones;
//   - underlay `<image data-underlay-id>` below the geometry; a sheet layout (`store.showSheet(sheet)`) instead of the model;
//   - grips (data-grip, data-x, data-y), the selection window (data-window), remote crosshairs (data-colour, data-x, data-y, username text),
//     the snap marker, the rubber band, issue pins (data-issue-pin, `sheet-pin` animation for a new pin), markups (data-flag);
//   - compare layers (data-diff, data-swipe-divider, `compare-swipe` animation when `swipe` changes); ZOOMALL animates `[data-view-group]` as `zoom-all`.
// Keys handled on the pane when it has focus: arrows (1 unit, Shift 10) nudge the selection (live drawing only).
export { CanvasPane } from './CanvasPane.tsx';
export type { CompareLayers, IssuePin } from './types.ts';
