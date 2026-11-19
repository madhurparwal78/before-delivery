import { checkGlb } from '../../shared/glb';
import type { Part, Step } from '../../shared/types';
import { Stage, type StagePart } from './stage';

interface ModelGuide { model_id: string | null; model_scale: number; parts: Part[]; steps: Pick<Step, 'explode'>[] }

/** Fetches a guide's model from the app's own origin and puts it on the stage; rejects when storage cannot deliver it. */
export async function loadGuideModel(stage: Stage, guide: ModelGuide): Promise<void> {
  const response = await fetch(`/api/models/${guide.model_id}.glb`);
  if (!response.ok) throw new Error(String(response.status));
  const bytes = await response.arrayBuffer();
  const checked = checkGlb(new Uint8Array(bytes), { modelMaxBytes: Infinity, modelMaxParts: Infinity });
  if (!checked.ok) throw new Error('model');
  const scene = await Stage.parse(bytes);
  const parts: StagePart[] = guide.parts.map((p) => ({ id: p.id, nodePath: p.node_path, axis: p.axis, apart_mm: p.apart_mm }));
  stage.setModel(scene, parts, guide.model_scale, checked.model.bounds, Math.max(0, ...guide.steps.map((s) => s.explode)), false);
}
