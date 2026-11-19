import { Box3, Color, Group, Mesh, MeshLambertMaterial, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const FIT_SIZE = 0.8;
/** Above every label and ring, so the model is the last thing drawn and its matrices are the last uploaded. */
const DRAW_LAST = 100;
const BRASS = '#B8905A';

/** The lesson's model on its plinth. An unreadable or mesh-less file leaves the plinth bare. */
export class ModelStage {
  readonly pivot = new Group();
  private fileId: string | null = null;

  /** Loads the model for `fileId` once and calls `onLoaded` when it is on the plinth. */
  show(fileId: string | null, onLoaded: () => void): void {
    if (fileId === this.fileId) return;
    this.fileId = fileId;
    this.pivot.clear();
    if (!fileId) return;
    new GLTFLoader().load(
      `/api/files/${fileId}`,
      (gltf) => {
        if (this.fileId !== fileId) return;
        const box = new Box3().setFromObject(gltf.scene);
        if (box.isEmpty()) return;
        const size = box.getSize(new Vector3());
        const centre = box.getCenter(new Vector3());
        const scale = FIT_SIZE / Math.max(size.x, size.y, size.z);
        gltf.scene.scale.setScalar(scale);
        gltf.scene.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
        gltf.scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const original: unknown = object.material;
          const color = original instanceof MeshStandardMaterial ? original.color : new Color(BRASS);
          object.material = new MeshLambertMaterial({ color, flatShading: true, transparent: true });
          object.renderOrder = DRAW_LAST;
        });
        this.pivot.add(gltf.scene);
        onLoaded();
      },
      undefined,
      () => undefined,
    );
  }
}
