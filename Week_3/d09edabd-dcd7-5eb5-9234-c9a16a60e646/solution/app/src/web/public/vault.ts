import { TOUR_VAULT } from '../../shared/starters';
import type { CuePoint, DrawPlacement, RoomDims } from '../three/roomView';

type VaultPlacement = DrawPlacement & { entry: boolean };

const [widthMm, depthMm, heightMm] = TOUR_VAULT.size;

export const VAULT_DIMS: RoomDims = { widthMm, depthMm, heightMm };

/** The Vault's placements as the stage draws them; as in a seeded room, the first door is the entry door. */
export const VAULT_PLACEMENTS: VaultPlacement[] = TOUR_VAULT.placements.map((placement, index) => ({
  id: `vault-placement-${index}`,
  kind: placement.kind,
  label: placement.label,
  propId: null,
  entry: placement.kind === 'door' && TOUR_VAULT.placements.findIndex((p) => p.kind === 'door') === index,
  xMm: placement.x,
  yMm: 0,
  zMm: placement.z,
  rotationDeg: placement.rotation ?? 0,
  widthMm: placement.w,
  depthMm: placement.d,
  heightMm: placement.h,
}));

/** The Vault's node titles in chain order. */
export const VAULT_CHAIN: string[] = TOUR_VAULT.nodes.map((node) => node.title);

const MARKER_LIFT_MM = 250;
const MARKER_STACK_MM = 220;

/** A node's marker floats above its linked placement (stacked when several share one); an unlinked node's is spaced along the room. */
function markerPositions(): Omit<CuePoint, 'lit'>[] {
  const unlinked = TOUR_VAULT.nodes.filter((node) => !node.placement).length;
  const perPlacement = new Map<string, number>();
  let unlinkedSoFar = 0;
  return TOUR_VAULT.nodes.map((node, index) => {
    const id = `vault-cue-${index}`;
    const target = VAULT_PLACEMENTS.find((placement) => placement.label === node.placement);
    if (!target) {
      unlinkedSoFar += 1;
      return { id, xMm: (widthMm * unlinkedSoFar) / (unlinked + 1), yMm: heightMm * 0.75, zMm: depthMm / 2 };
    }
    const stacked = perPlacement.get(target.id) ?? 0;
    perPlacement.set(target.id, stacked + 1);
    return { id, xMm: target.xMm, yMm: target.yMm + target.heightMm + MARKER_LIFT_MM + stacked * MARKER_STACK_MM, zMm: target.zMm };
  });
}

const MARKERS = markerPositions();

/** The first `lit` markers are lit, the rest muted. */
export const cuePoints = (lit: number): CuePoint[] => MARKERS.map((marker, index) => ({ ...marker, lit: index < lit }));
