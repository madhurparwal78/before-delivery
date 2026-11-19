import { CylinderGeometry, Group, Mesh, PerspectiveCamera, type BufferGeometry } from "three";
import { TOY_COLOURS } from "../starters";
import { frameCamera, type Framing } from "./camera";
import { clamp01, easeInCubic, easeInOutCubic, easeOutBack, easeOutBounce, easeOutCubic, lerp } from "./ease";
import { drawScene } from "./gl";
import { createStage, circleShape, holeMaterial, prism, roundedRectShape, toyMaterial, withRoundHole, wedgeGeometry } from "./toys";
import { tint, token } from "./colour";

/** The three toys of the hero, in millimetre-like scene units. The SVG stills draw the same numbers. */
export const TOY_SIZES = {
  wedge: { run: 46, rise: 32, width: 34 },
  cylinder: { radius: 15, height: 44 },
  box: { width: 40, depth: 40, height: 28, corner: 5, holeRadius: 11 },
} as const;

/** Length of the build poster's loop (6 to 10 seconds) and the phase of its finished frame. */
export const BUILD_LOOP_MS = 8000;
export const BUILD_FINISHED_MS = 7000;

const STEP = {
  wedge: { at: 200, over: 900 },
  cylinder: { at: 1500, over: 1000 },
  box: { at: 2900, over: 700 },
  ghostIn: { at: 3900, over: 400 },
  ghostDown: { at: 4300, over: 1000 },
  carve: { at: 5300, over: 700 },
  exit: { at: 7500, over: 500 },
} as const;

/** Stripe repeats over the hole cylinder's UVs (once around, once along), so its diagonal stripes sit about 4 units apart. */
const GHOST_STRIPES = { around: 8, along: 5 } as const;

const progress = (step: { at: number; over: number }, ms: number): number => clamp01((ms - step.at) / step.over);

export interface ToyLayout {
  wedge: { x: number; y: number; turn: number };
  cylinder: { x: number; y: number };
  box: { x: number; y: number; turn: number };
}

interface Toy {
  root: Group;
  body: Group;
}

function toy(geometry: BufferGeometry, colour: string): Toy {
  const root = new Group();
  const body = new Group();
  const mesh = new Mesh(geometry, toyMaterial(colour));
  mesh.castShadow = true;
  body.add(mesh);
  root.add(body);
  return { root, body };
}

export interface ToyView {
  layout: ToyLayout;
  framing: Framing;
  /** Whether the workplane grid shows (the poster has one; the hero stands on its blueprint instead). */
  grid: boolean;
}

interface ToyRig {
  /** Draws the scene at a phase of the build loop; the hero always draws the finished frame. */
  draw: (canvas: HTMLCanvasElement, view: ToyView, ms: number) => void;
}

/** The hero scene: a green wedge, a purple cylinder and an orange box with a round hole through it, built from the app's own primitives. */
function createToyRig(): ToyRig {
  const stage = createStage({ centre: tint(token("--cobalt"), 0.62), line: tint(token("--cobalt"), 0.8) });
  const camera = new PerspectiveCamera();
  const { wedge: w, cylinder: c, box: b } = TOY_SIZES;

  const wedge = toy(wedgeGeometry(w.run, w.rise, w.width), TOY_COLOURS.green);
  const cylinder = toy(prism(circleShape(c.radius), c.height), TOY_COLOURS.purple);
  const solidBox = toy(prism(roundedRectShape(b.width, b.depth, b.corner), b.height), TOY_COLOURS.orange);
  const holedBox = toy(prism(withRoundHole(roundedRectShape(b.width, b.depth, b.corner), b.holeRadius), b.height), TOY_COLOURS.orange);
  const boxRoot = new Group();
  boxRoot.add(solidBox.root, holedBox.root);
  const ghostHeight = b.height + 16;
  const ghost = new Mesh(new CylinderGeometry(b.holeRadius, b.holeRadius, ghostHeight, 48).rotateX(Math.PI / 2), holeMaterial(GHOST_STRIPES));
  ghost.renderOrder = 2;
  const ghostRoot = new Group();
  ghostRoot.add(ghost);
  boxRoot.add(ghostRoot);
  stage.scene.add(wedge.root, cylinder.root, boxRoot);

  const pose = (ms: number) => {
    const exit = 1 - easeInCubic(progress(STEP.exit, ms));
    const drop = progress(STEP.wedge, ms);
    wedge.root.visible = drop > 0 && exit > 0;
    wedge.root.scale.setScalar(Math.max(exit, 0.001));
    wedge.body.position.z = (1 - easeOutBounce(drop)) * 80;

    const rise = progress(STEP.cylinder, ms);
    cylinder.root.visible = rise > 0 && exit > 0;
    cylinder.root.scale.set(exit, exit, Math.max(easeOutCubic(rise) * exit, 0.001));

    const pop = progress(STEP.box, ms);
    boxRoot.visible = pop > 0 && exit > 0;
    boxRoot.scale.setScalar(Math.max(easeOutBack(pop) * exit, 0.001));
    const carved = ms >= STEP.carve.at;
    solidBox.root.visible = !carved;
    holedBox.root.visible = carved;

    const appear = progress(STEP.ghostIn, ms);
    const sink = easeInOutCubic(progress(STEP.ghostDown, ms));
    const vanish = progress(STEP.carve, ms);
    ghostRoot.visible = appear > 0 && vanish < 1;
    ghostRoot.scale.setScalar(Math.max(easeOutBack(appear) * (1 - easeInCubic(vanish)), 0.001));
    ghostRoot.position.z = lerp(ghostHeight / 2 + b.height + 12, b.height / 2, sink);
  };

  return {
    draw(canvas, view, ms) {
      const { layout } = view;
      wedge.root.position.set(layout.wedge.x, layout.wedge.y, 0);
      wedge.root.rotation.z = layout.wedge.turn;
      cylinder.root.position.set(layout.cylinder.x, layout.cylinder.y, 0);
      boxRoot.position.set(layout.box.x, layout.box.y, 0);
      boxRoot.rotation.z = layout.box.turn;
      stage.grid.visible = view.grid;
      pose(ms);
      frameCamera(camera, canvas.width / canvas.height, view.framing);
      drawScene(canvas, stage.scene, camera);
    },
  };
}

let rig: ToyRig | undefined;

/** The one toy rig shared by the hero and the build poster, made on first use. */
export function sharedToyRig(): ToyRig {
  rig ??= createToyRig();
  return rig;
}
