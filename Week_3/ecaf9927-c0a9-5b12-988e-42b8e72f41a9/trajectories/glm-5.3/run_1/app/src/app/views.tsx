import { useEffect, useRef, useState } from "react";
import type { Bom, Member, MeshBody } from "../shared/types.js";
import { api } from "./api.js";
import { display } from "../shared/units.js";

/** Part and Assembly views: a still three-quarter view of stored bodies. */

interface BodyEntry {
  mesh: MeshBody | null;
  label: string;
}

export function BodyView(props: {
  name: string;
  kind: "part" | "assembly";
  partIds: { partId: string; label?: string }[];
  noBodyText: string;
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [entries, setEntries] = useState<BodyEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const bodies = await Promise.all(
        props.partIds.map(async (p) => ({
          mesh: await api.bodyObject(p.partId),
          label: p.label ?? ""
        }))
      );
      if (alive) {
        setEntries(bodies as BodyEntry[]);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [props.partIds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    drawGrid(context, width, height);
    const meshes = entries.map((e) => e.mesh).filter((m): m is MeshBody => m !== null);
    if (meshes.length === 0) {
      if (loaded) {
        context.fillStyle = "#4a4e57";
        context.font = "14px IBM Plex Sans";
        context.textAlign = "center";
        context.fillText(props.noBodyText, width / 2, height / 2);
      }
      return;
    }
    let offset = 0;
    for (const mesh of meshes) {
      offset += drawMeshThreeQuarter(context, mesh, width, height, offset);
    }
    entries.forEach((entry) => {
      if (!entry.label) return;
      context.fillStyle = "#22252b";
      context.font = "12px IBM Plex Mono";
      context.textAlign = "left";
      const slot = 24 + entries.indexOf(entry) * 160;
      context.fillText(entry.label, slot, height - 30);
    });
  }, [entries, loaded, props.noBodyText]);

  return (
    <div
      role="img"
      aria-label={`${props.kind === "part" ? "Part" : "Assembly"} view: ${props.name}`}
      style={{ position: "absolute", inset: 0 }}
    >
      <canvas ref={canvasRef} className="canvas-fill" />
    </div>
  );
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number): void {
  const step = 40;
  const dpr = window.devicePixelRatio > 1 ? 0.5 : 1;
  context.lineWidth = dpr;
  let i = 0;
  for (let x = 0; x <= width; x += step) {
    context.strokeStyle = i % 10 === 0 ? "rgba(160,150,130,0.38)" : "rgba(160,150,130,0.22)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    i++;
  }
  i = 0;
  for (let y = 0; y <= height; y += step) {
    context.strokeStyle = i % 10 === 0 ? "rgba(160,150,130,0.38)" : "rgba(160,150,130,0.22)";
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    i++;
  }
}

/** A fixed isometric projection with painter-sorted, flat-shaded triangles. */
function drawMeshThreeQuarter(
  context: CanvasRenderingContext2D,
  mesh: MeshBody,
  width: number,
  height: number,
  xOffset: number
): number {
  const vertices = mesh.vertices;
  if (vertices.length === 0) return 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of vertices) {
    minX = Math.min(minX, v[0]);
    minY = Math.min(minY, v[1]);
    minZ = Math.min(minZ, v[2]);
    maxX = Math.max(maxX, v[0]);
    maxY = Math.max(maxY, v[1]);
    maxZ = Math.max(maxZ, v[2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const slotWidth = width / Math.max(1, Math.min(4, Math.ceil(mesh.triangles.length / 2000) + 1));
  const scale = (Math.min(slotWidth, height) * 0.5) / span;
  const originX = 40 + xOffset + 60;
  const originY = height / 2;

  const project = (v: [number, number, number]): [number, number, number] => {
    const x = v[0] - cx;
    const y = v[1] - cy;
    const z = v[2] - cz;
    // Isometric: x to the right-down, y right-up, z up.
    const sx = (x - y) * 0.866 * scale + originX;
    const sy = originY - (z * 0.9 + (x + y) * 0.5 * 0.577) * scale;
    return [sx, sy, z];
  };

  const faces = mesh.triangles.map((tri) => {
    const a = project(vertices[tri[0]]!);
    const b = project(vertices[tri[1]]!);
    const c = project(vertices[tri[2]]!);
    const depth = (a[2] + b[2] + c[2]) / 3 - ((a[0] + b[0] + c[0]) / 3 - originX) / 400;
    return { a, b, c, depth };
  });
  faces.sort((f1, f2) => f1.depth - f2.depth);

  for (const face of faces) {
    const [ax, ay] = face.a;
    const [bx, by] = face.b;
    const [cx2, cy2] = face.c;
    const shade = 0.62 + Math.min(0.25, Math.max(0, (face.depth + span) / (span * 4)));
    const tone = shade > 0.72 ? "217,210,194" : "195,187,168";
    context.fillStyle = `rgb(${tone})`;
    context.strokeStyle = "rgba(34,37,43,0.55)";
    context.lineWidth = 0.6;
    context.beginPath();
    context.moveTo(ax, ay);
    context.lineTo(bx, by);
    context.lineTo(cx2, cy2);
    context.closePath();
    context.fill();
    context.stroke();
  }
  return Math.min(slotWidth, 150);
}

/** The bill of materials, as a table at 600px and stacked rows below. */
export function BomView(props: { bom: Bom; member: Member }): JSX.Element {
  void props.member;
  const cells = (line: (typeof props.bom.lines)[number]): [string, string][] => [
    ["Item", line.item.name + (line.body_status === "not_stored" ? " Not stored" : "")],
    ["Kind", line.kind === "made" ? "Made" : "Purchased"],
    ["Material", line.material ?? "—"],
    ["Qty", String(line.quantity)],
    ["Unit mass", line.unit_mass_g === null ? "—" : display.mass(line.unit_mass_g)],
    ["Line mass", line.line_mass_g === null ? "—" : display.mass(line.line_mass_g)]
  ];
  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", padding: "70px 24px 120px" }}>
      <table className="data-table bom-table" aria-label="Bill of materials">
        <thead>
          <tr>
            <th>Item</th>
            <th>Kind</th>
            <th>Material</th>
            <th>Qty</th>
            <th>Unit mass</th>
            <th>Line mass</th>
          </tr>
        </thead>
        <tbody>
          {props.bom.lines.map((line) => (
            <tr key={line.item.id}>
              {cells(line).map(([name, value]) => (
                <td key={name} className="num">
                  {value}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td colSpan={5} style={{ textAlign: "right", fontWeight: 500 }}>
              Total
            </td>
            <td className="num">{display.mass(props.bom.total_mass_g)}</td>
          </tr>
        </tbody>
      </table>
      <div className="bom-stacked">
        {props.bom.lines.map((line) => (
          <div
            key={line.item.id}
            className="stacked-row"
            role="row"
            aria-label={line.item.name}
          >
            {cells(line).map(([name, value]) => (
              <div key={name} className="stacked-cell">
                <span className="cell-name">{name}</span>
                <span className="num">{value}</span>
              </div>
            ))}
          </div>
        ))}
        <div className="stacked-row">
          <div className="stacked-cell">
            <span className="cell-name">Total</span>
            <span className="num">{display.mass(props.bom.total_mass_g)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
