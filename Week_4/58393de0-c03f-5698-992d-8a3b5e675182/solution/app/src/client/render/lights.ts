import { AmbientLight, DirectionalLight, Group, HemisphereLight } from "three";

/**
 * The landing poster's light rig for every toy-bright scene (z up), placed for a camera that looks from `view` (its
 * ground direction from the target): a white key from the camera's front left and high, a cool fill from the right,
 * so the top, left and right faces of a shape read as three tones.
 */
export function toyLights(view: { x: number; y: number }): Group {
  const length = Math.hypot(view.x, view.y) || 1;
  const front = { x: view.x / length, y: view.y / length };
  const left = { x: front.y, y: -front.x };
  const place = (light: DirectionalLight, ahead: number, aside: number, up: number) =>
    light.position.set(front.x * ahead + left.x * aside, front.y * ahead + left.y * aside, up);
  const lights = new Group();
  lights.add(new HemisphereLight(0xffffff, 0x9db4d6, 1), new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xffffff, 2.3);
  place(key, 60, 80, 200);
  const fill = new DirectionalLight(0xc4dcff, 0.8);
  place(fill, 90, -100, 60);
  lights.add(key, fill);
  return lights;
}
