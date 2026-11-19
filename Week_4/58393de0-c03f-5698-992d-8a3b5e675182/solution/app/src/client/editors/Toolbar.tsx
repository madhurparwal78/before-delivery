import type { ReactNode, Ref } from "react";
import { Download, Redo2, Save, Undo2 } from "lucide-react";
import type { ProjectKind } from "../../shared/types";

const FIELD_PILL: Record<ProjectKind, string> = { "3d": "pill--3d", circuit: "pill--circuit", blocks: "pill--blocks" };

interface ToolbarProps {
  kind: ProjectKind;
  name: string;
  onName: (value: string) => void;
  onCommitName: () => void;
  indicator: string | null;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onExport: () => void;
  exportRef: Ref<HTMLButtonElement>;
  /** Present only for Students. */
  handIn: { onClick: () => void; countdown: string | null; buttonRef: Ref<HTMLButtonElement> } | null;
}

interface ActionProps {
  label: string;
  icon: ReactNode;
  className: string;
  disabled?: boolean;
  /** On narrow screens only the icon shows; the label stays as the accessible name. */
  collapse?: boolean;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}

function Action({ label, icon, className, disabled, collapse, onClick, buttonRef }: ActionProps) {
  return (
    <button type="button" ref={buttonRef} className={`pill ${className}${collapse ? " editor-collapse" : ""}`} disabled={disabled} onClick={onClick}>
      {icon}
      <span className={collapse ? "editor-label--collapse" : undefined}>{label}</span>
    </button>
  );
}

/** The top bar every editor shares: name, save indicator, undo and redo, save, export and (for Students) hand in. */
export function Toolbar(props: ToolbarProps) {
  const { handIn } = props;
  return (
    <div className="editor-toolbar" role="group" aria-label="Project">
      <input
        className="editor-name"
        type="text"
        aria-label="Project name"
        maxLength={60}
        value={props.name}
        readOnly={props.readOnly}
        onChange={(event) => props.onName(event.target.value)}
        onBlur={props.onCommitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.onCommitName();
          }
        }}
      />
      <span className="editor-indicator figures">{props.indicator}</span>
      <div className="editor-actions">
        <Action className="pill--outline" label="Undo" icon={<Undo2 size={20} aria-hidden="true" />} collapse disabled={props.readOnly || !props.canUndo} onClick={props.onUndo} />
        <Action className="pill--outline" label="Redo" icon={<Redo2 size={20} aria-hidden="true" />} collapse disabled={props.readOnly || !props.canRedo} onClick={props.onRedo} />
        <Action className={FIELD_PILL[props.kind]} label="Save" icon={<Save size={20} aria-hidden="true" />} disabled={props.readOnly} onClick={props.onSave} />
        <Action className="pill--outline" label="Export" icon={<Download size={20} aria-hidden="true" />} collapse buttonRef={props.exportRef} onClick={props.onExport} />
        {handIn ? (
          <button type="button" className="pill pill--outline" ref={handIn.buttonRef} disabled={props.readOnly} onClick={handIn.onClick}>
            Hand in
          </button>
        ) : null}
      </div>
      {handIn?.countdown ? <span className="editor-countdown figures">{handIn.countdown}</span> : null}
    </div>
  );
}
