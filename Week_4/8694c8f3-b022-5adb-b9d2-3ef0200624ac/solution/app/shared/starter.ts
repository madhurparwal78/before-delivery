import { createLayer } from "./layers.ts";
import type { GraphDoc, LayerDoc } from "./types.ts";

export const BLANK_STAGE_BPM = 120;
export const STARTER_SHADER =
  "#version 300 es\n" +
  "precision highp float;\n" +
  "uniform float u_beat;\n" +
  "uniform vec2 u_resolution;\n" +
  "out vec4 fragColor;\n" +
  "void main() {\n" +
  "  vec2 uv = gl_FragCoord.xy / u_resolution;\n" +
  "  float pulse = 0.5 + 0.5 * sin(u_beat * 6.2831853);\n" +
  "  fragColor = vec4(uv * pulse, 0.5, 1.0);\n" +
  "}\n";

interface BlankStage {
  layers: LayerDoc[];
  graph: GraphDoc;
  activeCameraId: string;
}

export function blankStage(newId: () => string): BlankStage {
  const stage = createLayer({ id: newId(), parent_id: null, index: 0, name: "Stage", kind: "group" });
  const camera = createLayer({
    id: newId(), parent_id: stage.id, index: 0, name: "Main camera", kind: "camera", position: [0, 2, 8],
  });
  const light = createLayer({
    id: newId(), parent_id: stage.id, index: 1, name: "Key light", kind: "light", position: [4, 6, 4],
  });
  const floor = createLayer({
    id: newId(), parent_id: stage.id, index: 2, name: "Floor", kind: "plane", scale: [10, 1, 10],
  });
  return {
    layers: [stage, camera, light, floor],
    graph: { version: 1, nodes: [{ node_id: newId(), type: "Beat clock", params: {}, x: 40, y: 40 }], wires: [] },
    activeCameraId: camera.id,
  };
}
