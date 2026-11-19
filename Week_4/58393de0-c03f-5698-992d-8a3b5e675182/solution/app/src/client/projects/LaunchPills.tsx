import { Blocks, Box, CircuitBoard } from "lucide-react";
import { Link } from "../lib/router";
import "./projects.css";

const LAUNCHERS = [
  { kind: "3d", label: "New 3D design", tone: "pill--3d", Icon: Box },
  { kind: "circuit", label: "New circuit", tone: "pill--circuit", Icon: CircuitBoard },
  { kind: "blocks", label: "New block program", tone: "pill--blocks", Icon: Blocks },
] as const;

type LaunchKind = (typeof LAUNCHERS)[number]["kind"];

/** The editor launch pills, each in its editor's field colour; `kinds` limits the row to some of them. */
export function LaunchPills({ centered = false, kinds }: { centered?: boolean; kinds?: readonly LaunchKind[] }) {
  const shown = kinds ? LAUNCHERS.filter(({ kind }) => kinds.includes(kind)) : LAUNCHERS;
  return (
    <div className={`pill-row launch-pills${centered ? " launch-pills--centered" : ""}`}>
      {shown.map(({ kind, label, tone, Icon }) => (
        <Link key={kind} className={`pill ${tone}`} to={`/editor/new?kind=${kind}`}>
          <Icon size={20} aria-hidden="true" />
          {label}
        </Link>
      ))}
    </div>
  );
}
