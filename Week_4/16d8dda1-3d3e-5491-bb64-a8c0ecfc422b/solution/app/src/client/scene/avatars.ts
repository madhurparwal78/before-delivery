import { CapsuleGeometry, Color, Group, Mesh, MeshLambertMaterial, SphereGeometry, Vector3 } from 'three';
import { HAND_LIFT_MS, WALK_MS } from './geometry';
import { Label } from './labels';
import { Transition } from './tween';

const TINTS = ['#8FA89B', '#B59C7C', '#9CA7B9', '#B89A9A', '#A9B38C', '#B7A2BF', '#8DAFB3', '#C2A988'];
const ARM_DOWN = 0.14;
const ARM_UP = 2.85;

function tintOf(learnerId: string): string {
  let hash = 0;
  for (const character of learnerId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length] ?? TINTS[0] ?? '#8FA89B';
}

/** A learner in the room: a rounded body, a sphere head, a raisable arm and a floating display name. */
export class Avatar {
  readonly group = new Group();
  readonly label = new Label('name');
  /** The table this avatar was dealt to in the last snapshot, or null while at the home seat. */
  breakoutTable: string | null = null;
  private readonly arm = new Group();
  private readonly lift = new Transition(0);
  private readonly walk = new Transition(1);
  private readonly from = new Vector3();
  private readonly to = new Vector3();

  constructor(readonly learnerId: string, displayName: string) {
    const material = new MeshLambertMaterial({ color: tintOf(learnerId), flatShading: true });
    const body = new Mesh(new CapsuleGeometry(0.19, 0.3, 3, 8), material);
    body.position.y = 0.72;
    const head = new Mesh(new SphereGeometry(0.17, 12, 9), new MeshLambertMaterial({ color: new Color(tintOf(learnerId)).lerp(new Color('#FFF3DC'), 0.28), flatShading: true }));
    head.position.y = 1.2;
    this.arm.position.set(0.24, 0.96, 0);
    const raisedArm = new Mesh(new CapsuleGeometry(0.05, 0.2, 2, 6), material);
    raisedArm.position.y = -0.16;
    this.arm.add(raisedArm);
    const restingArm = new Mesh(new CapsuleGeometry(0.05, 0.2, 2, 6), material);
    restingArm.position.set(-0.24, 0.8, 0);
    this.group.add(body, head, this.arm, restingArm);
    this.label.setText(displayName);
    this.label.sprite.position.y = 1.8;
    this.group.add(this.label.sprite);
    this.arm.rotation.z = ARM_DOWN;
  }

  get destination(): Vector3 {
    return this.to;
  }

  placeAt(position: Vector3): void {
    this.from.copy(position);
    this.to.copy(position);
    this.walk.value = 1;
    this.walk.retarget(1, 0, 0);
    this.group.position.copy(position);
  }

  walkTo(position: Vector3, now: number, delay = 0): void {
    this.from.copy(this.group.position);
    this.from.y = 0;
    this.to.copy(position);
    this.walk.value = 0;
    this.walk.retarget(1, now, WALK_MS, delay);
  }

  setHand(raised: boolean, now: number, animate: boolean): void {
    this.lift.retarget(raised ? 1 : 0, now, animate ? HAND_LIFT_MS : 0);
    this.arm.rotation.z = ARM_DOWN + (ARM_UP - ARM_DOWN) * this.lift.value;
  }

  get handGoal(): number {
    return this.lift.goal;
  }

  /** Advances the walk and the arm to `now`; true while either is still moving. */
  step(now: number): boolean {
    const walking = this.walk.step(now);
    const lifting = this.lift.step(now);
    const progress = this.walk.value;
    this.group.position.lerpVectors(this.from, this.to, progress);
    this.group.position.y = walking && progress > 0 ? Math.abs(Math.sin(progress * Math.PI * 4)) * 0.05 : 0;
    this.arm.rotation.z = ARM_DOWN + (ARM_UP - ARM_DOWN) * this.lift.value;
    return walking || lifting;
  }
}
