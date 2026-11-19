import {
  AlignHorizontalJustifyCenter, Box, Circle, Cylinder, Grid3x3, Group, RotateCcw, SquareDashed, Square, Trash2, Ungroup,
} from "lucide-react";
import type { ReactNode } from "react";
import { membersOf } from "./model";
import type { WorkshopState, WorkshopStore } from "./store";

interface ToolButtonProps {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  shortcut?: string;
  pressed?: boolean;
  /** Dimmed and inert, but still focusable so the keyboard shortcuts keep reaching the editor. */
  disabled?: boolean;
  primary?: boolean;
}

export function ToolButton({ label, icon, onClick, shortcut, pressed, disabled, primary }: ToolButtonProps) {
  const classes = `pill ${primary ? "pill--3d" : "pill--tool"}`;
  return (
    <button
      type="button"
      className={classes}
      aria-pressed={pressed}
      aria-disabled={disabled ? true : undefined}
      aria-keyshortcuts={shortcut}
      onClick={disabled ? undefined : onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

interface ShapeButtonsProps {
  store: WorkshopStore;
  state: WorkshopState;
  /** Called after a shape is added, so a bottom sheet can close. */
  added?: () => void;
}

/** The `Shapes` toolbar: Box, Cylinder, Sphere. */
export function ShapeButtons({ store, state, added }: ShapeButtonsProps) {
  const blocked = store.readOnly || state.grouping;
  const add = (kind: "box" | "cylinder" | "sphere") => () => {
    store.addShape(kind);
    added?.();
  };
  return (
    <div role="toolbar" aria-label="Shapes" className="tool-row tool-row--shapes">
      <ToolButton primary label="Box" shortcut="B" icon={<Box size={22} aria-hidden="true" />} disabled={blocked} onClick={add("box")} />
      <ToolButton primary label="Cylinder" shortcut="C" icon={<Cylinder size={22} aria-hidden="true" />} disabled={blocked} onClick={add("cylinder")} />
      <ToolButton primary label="Sphere" shortcut="S" icon={<Circle size={22} aria-hidden="true" />} disabled={blocked} onClick={add("sphere")} />
    </div>
  );
}

/** Solid and Hole, grouping, Align, the Workplane tool and Delete, grouped by what they act on. */
export function EditTools({ store, state }: { store: WorkshopStore; state: WorkshopState }) {
  const chosen = membersOf(state.design, state.selected);
  const none = chosen.length === 0;
  const frozen = store.readOnly || state.grouping;
  const allSolid = !none && chosen.every((object) => object.mode === "solid");
  const allHole = !none && chosen.every((object) => object.mode === "hole");
  const hasGroup = chosen.some((object) => object.kind === "group");
  return (
    <>
      <div className="tool-section" role="group" aria-labelledby="tools-edit">
        <h3 id="tools-edit" className="tool-heading">Edit</h3>
        <div className="tool-row tool-row--duo">
          <ToolButton label="Solid" shortcut="H" pressed={allSolid} disabled={frozen || none} icon={<Square size={20} aria-hidden="true" />} onClick={() => store.setSelectionMode("solid")} />
          <ToolButton label="Hole" shortcut="H" pressed={allHole} disabled={frozen || none} icon={<SquareDashed size={20} aria-hidden="true" />} onClick={() => store.setSelectionMode("hole")} />
          <ToolButton label="Delete" shortcut="Delete" disabled={frozen || none} icon={<Trash2 size={20} aria-hidden="true" />} onClick={() => store.deleteSelection()} />
        </div>
      </div>
      <div className="tool-section" role="group" aria-labelledby="tools-arrange">
        <h3 id="tools-arrange" className="tool-heading">Arrange</h3>
        <div className="tool-row tool-row--duo">
          <ToolButton label="Group" shortcut="Control+G" disabled={frozen} icon={<Group size={20} aria-hidden="true" />} onClick={() => void store.group()} />
          <ToolButton label="Ungroup" shortcut="Control+Shift+G" disabled={frozen || !hasGroup} icon={<Ungroup size={20} aria-hidden="true" />} onClick={() => store.ungroupSelection()} />
          <ToolButton label="Align" shortcut="L" disabled={frozen} icon={<AlignHorizontalJustifyCenter size={20} aria-hidden="true" />} onClick={() => store.requestAlign()} />
        </div>
      </div>
      <div className="tool-section" role="group" aria-labelledby="tools-workplane">
        <h3 id="tools-workplane" className="tool-heading">Workplane</h3>
        <div className="tool-row">
          <ToolButton label="Workplane" shortcut="W" pressed={state.mode === "pickFace"} disabled={frozen} icon={<Grid3x3 size={20} aria-hidden="true" />} onClick={() => store.beginFacePick()} />
          <ToolButton label="Reset workplane" disabled={frozen} icon={<RotateCcw size={20} aria-hidden="true" />} onClick={() => store.resetWorkplane()} />
        </div>
      </div>
    </>
  );
}
