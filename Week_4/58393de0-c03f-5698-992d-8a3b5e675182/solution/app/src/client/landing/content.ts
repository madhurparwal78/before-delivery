import type { EditorKind } from "./destinations";

interface EditorInfo {
  kind: EditorKind;
  name: string;
  /** The editor's field colour token and matching pill class. */
  field: string;
  pill: string;
  /** Anchor of the editor's feature row. */
  row: string;
  summary: string;
  headline: string;
  detail: string;
}

export const EDITORS: readonly EditorInfo[] = [
  {
    kind: "3d", name: "3D Workshop", field: "var(--azure)", pill: "pill--3d", row: "workshop-row",
    summary: "Drop in boxes, cylinders and spheres, size them in millimetres and turn any one into a hole. Group them into one part that is ready to print.",
    headline: "Shape it, carve it, print it",
    detail: "Every shape lands on the workplane at 20 millimetres. Resize it, turn it into a hole, group it with the others, and Quarkyard checks the result is a closed mesh before it saves an STL or OBJ file.",
  },
  {
    kind: "circuit", name: "Circuit Bench", field: "var(--circuit)", pill: "pill--circuit", row: "bench-row",
    summary: "Wire batteries, LEDs, resistors and switches, then press Start Simulation and watch the current settle.",
    headline: "Wire a night light and watch it glow",
    detail: "Put a resistor in series with the LED and the burn-out is gone. Change the resistance and the readout, the LED and its brightness all answer within one simulation tick.",
  },
  {
    kind: "blocks", name: "Block Lab", field: "var(--violet)", pill: "pill--blocks", row: "lab-row",
    summary: "Snap blocks into a program that builds 3D objects, one step at a time, right in front of the class.",
    headline: "Code a tower one block at a time",
    detail: "Build a program from palette blocks, nest steps inside a Repeat and press Play. The Block Lab runs one block per step, so every child can see what each block does.",
  },
];

export const STATS = [
  { figure: "12 to 20", label: "children in a typical class" },
  { figure: "10 weeks", label: "from the first session to hand-in" },
  { figure: "No email", label: "children join with a class code and a nickname" },
] as const;
