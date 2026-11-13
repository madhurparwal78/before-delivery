import { buildScene, modelInput } from '../../shared/geometry/index.ts';
import type { Scene } from '../../shared/geometry/index.ts';
import type { DimStyle, ModelSnapshot, Sheet } from '../../shared/types.ts';
import { SceneStore, initialSceneSnapshot } from './sceneStore.ts';
import type { SceneEnv } from './sceneStore.ts';

/** The read-only store of a published version (Review screen, view link, compare layers): the same camera, selection, Find and pointer as the live drawing. */
export class ReviewStore extends SceneStore {
  /** The sheet the version was published from; `showSheet(sheet)` draws its layout instead of the model. */
  readonly sheet: Sheet;

  /** `dimStyles` are the drawing's dimension styles; a snapshot does not store them, so without them only `Standard` is known. */
  constructor(model: ModelSnapshot, sheet: Sheet, env: SceneEnv, dimStyles?: Readonly<Record<string, DimStyle>>) {
    const scene: Scene = buildScene(modelInput(model, dimStyles));
    super(initialSceneSnapshot(scene, 'ready'), env);
    this.sheet = sheet;
  }
}
