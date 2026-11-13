import { useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "./api.js";
import { copy } from "../shared/copy.js";
import {
  colourNames,
  linetypeNames,
  lineweightNames,
  styleNames,
  blockLibrary,
} from "../shared/types.js";
import { formatAngle, formatArea, formatLength } from "../shared/format.js";
import type { DrawingObject, Units } from "../shared/types.js";
import type { DrawingResponse, IssuesResponse, MeResponse } from "./types.js";

type PanelName = "properties" | "layers" | "blocks" | "xrefs" | "traces" | "activity" | "issues";

const panelTabs: Array<{ key: PanelName; label: string }> = [
  { key: "properties", label: "Prop." },
  { key: "layers", label: "Layers" },
  { key: "blocks", label: "Blocks" },
  { key: "xrefs", label: "Xrefs" },
  { key: "traces", label: "Traces" },
  { key: "activity", label: "Activity" },
  { key: "issues", label: "Issues" },
];

export function EditorPanels(props: {
  drawing: DrawingResponse;
  selected: DrawingObject[];
  onSelection: (handles: string[]) => void;
  onCommand: (name: string, args: Record<string, unknown>) => void;
  onReload: () => Promise<void>;
  issues: IssuesResponse["issues"];
  activity: string[];
  traceActive: string | null;
  onTraceActive: (id: string | null) => void;
  onInsert: { block: string; scale: number; rotation: number } | null;
  me: MeResponse | null;
  linkToken: string | null;
}): JSX.Element {
  const [panel, setPanel] = useState<PanelName | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const announcedRef = useRef<string | null>(null);

  useEffect(() => {
    if (announcement !== announcedRef.current) {
      announcedRef.current = announcement;
      const region = document.getElementById("announcements");
      if (region && announcement) region.textContent = announcement;
    }
  }, [announcement]);

  return (
    <>
      <div className="editor-side">
        <div role="tablist" aria-label="Editor panels" style={{ display: "contents" }}>
          {panelTabs.map((tab) => (
            <button
              key={tab.key}
              className="side-tab"
              type="button"
              role="tab"
              aria-selected={panel === tab.key}
              onClick={() => setPanel(panel === tab.key ? null : tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {panel && (
        <div className="editor-panel" role="tabpanel">
          {panel === "properties" && (
            <PropertiesPanel
              drawing={props.drawing}
              selected={props.selected}
              onSelection={props.onSelection}
              onCommand={props.onCommand}
              onReload={props.onReload}
              setAnnouncement={setAnnouncement}
            />
          )}
          {panel === "layers" && (
            <LayersPanel drawing={props.drawing} onCommand={props.onCommand} onReload={props.onReload} setAnnouncement={setAnnouncement} />
          )}
          {panel === "blocks" && <BlocksPanel drawing={props.drawing} onCommand={props.onCommand} />}
          {panel === "xrefs" && <XrefsPanel drawing={props.drawing} onCommand={props.onCommand} onReload={props.onReload} />}
          {panel === "traces" && (
            <TracesPanel
              drawing={props.drawing}
              traceActive={props.traceActive}
              onTraceActive={props.onTraceActive}
              onReload={props.onReload}
              me={props.me}
              setAnnouncement={setAnnouncement}
              linkToken={props.linkToken}
            />
          )}
          {panel === "activity" && (
            <div className="list-panel">
              <h3>Activity</h3>
              <div className="activity-log" role="log" aria-label="Activity">
                {props.activity.map((entry, index) => (
                  <div key={index}>{entry}</div>
                ))}
              </div>
            </div>
          )}
          {panel === "issues" && (
            <IssuesPanel drawing={props.drawing} issues={props.issues} onReload={props.onReload} me={props.me} linkToken={props.linkToken} />
          )}
        </div>
      )}
    </>
  );
}

function PropertiesPanel(props: {
  drawing: DrawingResponse;
  selected: DrawingObject[];
  onSelection: (handles: string[]) => void;
  onCommand: (name: string, args: Record<string, unknown>) => void;
  onReload: () => Promise<void>;
  setAnnouncement: (text: string) => void;
}): JSX.Element {
  const { drawing, selected } = props;
  const [editing, setEditing] = useState<Record<string, string>>({});
  const units: Units = drawing.units;

  if (selected.length === 0) {
    const lockedLayer = drawing.layers.find((l) => l.current && l.locked);
    return (
      <div>
        <h3 aria-label="No selection">No selection</h3>
        <div className="prop-row">
          <span>Units</span>
          <select
            aria-label="Units"
            value={drawing.units}
            disabled={drawing.access === "view" || drawing.access === "markup"}
            onChange={(e) => {
              props.onCommand("PROPERTIES", { model: { units: e.target.value as Units } });
              props.setAnnouncement(copy.unitsChanged(e.target.value === "m" ? "Meters" : "Millimeters"));
            }}
          >
            <option value="mm">Millimeters</option>
            <option value="m">Meters</option>
          </select>
        </div>
        <div className="prop-row">
          <span>Plot style</span>
          <select
            aria-label="Plot style"
            value={drawing.plot_style}
            disabled={drawing.access === "view" || drawing.access === "markup"}
            onChange={(e) => props.onCommand("PROPERTIES", { model: { plot_style: e.target.value } })}
          >
            {["Monochrome", "Color", "Grayscale"].map((style) => (
              <option key={style} value={style}>{style}</option>
            ))}
          </select>
        </div>
        {lockedLayer && <p className="alert">{copy.onLockedLayer(lockedLayer.name)}</p>}
      </div>
    );
  }

  const first = selected[0];
  const locked = drawing.layers.find((l) => l.name === first.layer && l.locked);
  const heading =
    selected.length > 1
      ? copy.selectedN(selected.length)
      : first.type === "insert"
        ? "Block reference"
        : first.type === "mtext"
          ? "MText"
          : first.type === "dimension"
            ? "Dimension"
            : first.type.charAt(0).toUpperCase() + first.type.slice(1);

  const field = (label: string, value: string | number, editable = false, key?: string): JSX.Element => (
    <div className="prop-row" key={key}>
      <span>{label}</span>
      {editable ? (
        <input
          aria-label={label}
          value={editing[key ?? label] ?? String(value)}
          disabled={locked !== undefined || drawing.access === "view"}
          onChange={(e) => setEditing({ ...editing, [key ?? label]: e.target.value })}
          onBlur={() => saveField(key ?? label)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              void saveField(key ?? label);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      ) : (
        <span>{String(value)}</span>
      )}
    </div>
  );

  const saveField = async (name: string): Promise<void> => {
    const value = editing[name];
    if (value === undefined) return;
    const target = first as unknown as Record<string, unknown>;
    const numeric = ["Start X", "Start Y", "End X", "End Y", "Center X", "Center Y", "Radius", "Position X", "Position Y", "Scale", "Rotation", "Text height", "Width"];
    if (numeric.includes(name) && Number.isNaN(Number.parseFloat(value))) {
      props.setAnnouncement(copy.enterNumber);
      return;
    }
    const factor = units === "m" ? 1000 : 1;
    const set: Record<string, unknown> = {};
    switch (name) {
      case "Layer":
        set.layer = value;
        break;
      case "Color":
        set.color = value;
        break;
      case "Linetype":
        set.linetype = value;
        break;
      case "Lineweight":
        set.lineweight = value;
        break;
      case "Linetype scale":
        if (Number.parseFloat(value) < 0.01 || Number.parseFloat(value) > 1000) {
          props.setAnnouncement(copy.linetypeScaleRange);
          return;
        }
        set.linetype_scale = Number.parseFloat(value);
        break;
      case "Start X":
        set.start = [Number.parseFloat(value) * factor, (first as Extract<DrawingObject, { type: "line" }>).start[1]];
        break;
      case "Start Y":
        set.start = [(first as Extract<DrawingObject, { type: "line" }>).start[0], Number.parseFloat(value) * factor];
        break;
      case "End X":
        set.end = [Number.parseFloat(value) * factor, (first as Extract<DrawingObject, { type: "line" }>).end[1]];
        break;
      case "End Y":
        set.end = [(first as Extract<DrawingObject, { type: "line" }>).end[0], Number.parseFloat(value) * factor];
        break;
      case "Center X":
        set.center = [Number.parseFloat(value) * factor, (first as Extract<DrawingObject, { type: "circle" }>).center[1]];
        break;
      case "Center Y":
        set.center = [(first as Extract<DrawingObject, { type: "circle" }>).center[0], Number.parseFloat(value) * factor];
        break;
      case "Radius":
        set.radius = Number.parseFloat(value) * factor;
        break;
      case "Position X":
        set.position = [Number.parseFloat(value) * factor, ((first as { position: [number, number] }).position[1])];
        break;
      case "Position Y":
        set.position = [((first as { position: [number, number] }).position[0]), Number.parseFloat(value) * factor];
        break;
      case "Text height":
        set.height = Number.parseFloat(value) * factor;
        break;
      case "Width":
        set.width = Number.parseFloat(value) * factor;
        break;
      case "Scale":
        set.scale = Number.parseFloat(value);
        break;
      case "Rotation":
        set.rotation = Number.parseFloat(value);
        break;
      case "Contents":
        set.contents = value;
        break;
      case "Text override":
        set.text_override = value === "" ? null : value;
        break;
      default:
        return;
    }
    props.onCommand("PROPERTIES", {
      handles: selected.map((o) => o.handle),
      set,
    });
    await props.onReload();
    const updated = { ...editing };
    delete updated[name];
    setEditing(updated);
    void target;
  };

  const select = (label: string, options: string[], value: string, key: string): JSX.Element => (
    <div className="prop-row" key={key}>
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        disabled={locked !== undefined || drawing.access === "view"}
        onChange={(e) => {
          const set: Record<string, unknown> = {};
          set[key === "Layer" ? "layer" : key === "Color" ? "color" : key === "Linetype" ? "linetype" : key === "Lineweight" ? "lineweight" : key] = e.target.value;
          props.onCommand("PROPERTIES", { handles: selected.map((o) => o.handle), set });
          void props.onReload();
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div>
      <h3>{heading}</h3>
      {locked && <p className="alert">{copy.onLockedLayer(locked.name)}</p>}
      {select("Layer", drawing.layers.map((l) => l.name), first.layer, "Layer")}
      {select("Color", colourNames, first.color, "Color")}
      {select("Linetype", linetypeNames, first.linetype, "Linetype")}
      {field("Linetype scale", first.linetype_scale, true, "Linetype scale")}
      {select("Lineweight", [...lineweightNames], first.lineweight, "Lineweight")}
      {select("Dimension style", [...styleNames], first.dimension_style, "Dimension style")}
      {select("Text style", [...styleNames], first.text_style, "Text style")}
      {select("Multileader style", [...styleNames], first.multileader_style, "Multileader style")}
      {field("Handle", first.handle)}
      {first.type === "line" && (
        <>
          {field("Start X", formatLength(first.start[0], units), true, "Start X")}
          {field("Start Y", formatLength(first.start[1], units), true, "Start Y")}
          {field("End X", formatLength(first.end[0], units), true, "End X")}
          {field("End Y", formatLength(first.end[1], units), true, "End Y")}
          {field("Length", formatLength(first.length, units))}
          {field("Angle", formatAngle(first.angle))}
        </>
      )}
      {first.type === "polyline" && (
        <>
          {field("Vertices", first.vertices.length)}
          {field("Closed", first.closed ? "Yes" : "No")}
          {field("Length", formatLength(first.length, units))}
          {field("Area", first.area === null ? "—" : formatArea(first.area, units))}
        </>
      )}
      {first.type === "circle" && (
        <>
          {field("Center X", formatLength(first.center[0], units), true, "Center X")}
          {field("Center Y", formatLength(first.center[1], units), true, "Center Y")}
          {field("Radius", formatLength(first.radius, units), true, "Radius")}
          {field("Diameter", formatLength(first.diameter, units))}
          {field("Circumference", formatLength(first.circumference, units))}
          {field("Area", formatArea(first.area, units))}
        </>
      )}
      {first.type === "arc" && (
        <>
          {field("Radius", formatLength(first.radius, units))}
          {field("Start angle", formatAngle(first.start_angle))}
          {field("End angle", formatAngle(first.end_angle))}
          {field("Length", formatLength(first.length, units))}
        </>
      )}
      {first.type === "spline" && <>{field("Vertices", first.fit_points.length)}</>}
      {first.type === "mtext" && (
        <>
          {field("Contents", first.contents, true, "Contents")}
          {field("Text height", formatLength(first.height, units), true, "Text height")}
          {field("Width", formatLength(first.width, units), true, "Width")}
        </>
      )}
      {first.type === "dimension" && (
        <>
          {field("Measurement", first.type === "dimension" && first.kind === "angular" ? `${first.measurement.toFixed(2)}°` : formatLength(first.measurement, units))}
          {field("Text override", first.text_override ?? "", true, "Text override")}
        </>
      )}
      {first.type === "insert" && (
        <>
          {field("Block name", first.block)}
          {field("Position X", formatLength(first.position[0], units), true, "Position X")}
          {field("Position Y", formatLength(first.position[1], units), true, "Position Y")}
          {field("Scale", first.scale, true, "Scale")}
          {field("Rotation", first.rotation, true, "Rotation")}
        </>
      )}
      {first.type === "revcloud" && <>{field("Arcs", first.arcs)}</>}
    </div>
  );
}

export function LayersPanel(props: {
  drawing: DrawingResponse;
  onCommand: (name: string, args: Record<string, unknown>) => void;
  onReload: () => Promise<void>;
  setAnnouncement: (text: string) => void;
}): JSX.Element {
  const { drawing } = props;
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [focusName, setFocusName] = useState<string | null>(null);

  const runLayer = async (args: Record<string, unknown>): Promise<void> => {
    try {
      await api(`/api/drawings/${drawing.id}/commands`, {
        json: { base_version: drawing.version, command: "LAYER", args },
      });
      if (args.op === "rename" && typeof args.new_name === "string") {
        props.setAnnouncement(copy.layerRenamed(String(args.name), args.new_name));
      }
      await props.onReload();
      setError(null);
    } catch (err) {
      if (err instanceof ApiFailure) {
        const messages: Record<string, string> = {
          layer_zero: (args.op === "rename" ? copy.layerZeroRename : copy.layerZeroDelete),
          layer_current: args.op === "delete" ? copy.layerCurrentDelete(String(args.name)) : copy.layerCurrentFreeze(String(args.name)),
          layer_locked: copy.layerLockedDelete(String(args.name)),
          layer_in_use: copy.layerInUse(String(args.name), Number(err.extra.objects ?? 0)),
        };
        const message = messages[err.code] ?? Object.values(err.fields)[0] ?? err.code;
        setError(message);
        props.setAnnouncement(message);
      }
    }
  };

  return (
    <div>
      <h3 aria-label="Layer Properties Manager">Layers</h3>
      {error && <div className="alert" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <button className="btn btn-outline btn-small" type="button" onClick={() => void runLayer({ op: "new" })}>New layer</button>
        <button
          className="btn btn-outline btn-small"
          type="button"
          onClick={() => {
            if (focusName) void runLayer({ op: "delete", name: focusName });
          }}
        >
          Delete layer
        </button>
        <button
          className="btn btn-outline btn-small"
          type="button"
          onClick={() => {
            if (focusName) void runLayer({ op: "current", name: focusName });
          }}
        >
          Set current
        </button>
      </div>
      <table className="layers-grid" aria-label="Layers" role="grid">
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>On</th>
            <th>Freeze</th>
            <th>Lock</th>
            <th>Color</th>
            <th>Linetype</th>
            <th>Lineweight</th>
            <th>Objects</th>
          </tr>
        </thead>
        <tbody>
          {drawing.layers.map((layer) => (
            <tr
              key={layer.name}
              onFocus={() => setFocusName(layer.name)}
              tabIndex={-1}
            >
              <td>{layer.current ? "Current" : ""}</td>
              <td>
                {renaming === layer.name ? (
                  <input
                    className="cell"
                    autoFocus
                    aria-label="Layer name"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void runLayer({ op: "rename", name: layer.name, new_name: renameValue });
                        setRenaming(null);
                      } else if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => {
                      if (renameValue !== layer.name) void runLayer({ op: "rename", name: layer.name, new_name: renameValue });
                      setRenaming(null);
                    }}
                  />
                ) : (
                  <button
                    className="cell"
                    type="button"
                    onClick={() => undefined}
                    onKeyDown={(e) => {
                      if (e.key === "F2") {
                        e.preventDefault();
                        setRenaming(layer.name);
                        setRenameValue(layer.name);
                      }
                    }}
                    onDoubleClick={() => {
                      setRenaming(layer.name);
                      setRenameValue(layer.name);
                    }}
                  >
                    {layer.name}
                  </button>
                )}
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`On ${layer.name}`}
                  checked={layer.on}
                  onChange={(e) => {
                    props.setAnnouncement(e.target.checked ? copy.layerOn(layer.name) : copy.layerOff(layer.name));
                    void runLayer({ op: "set", name: layer.name, on: e.target.checked });
                  }}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Freeze ${layer.name}`}
                  checked={layer.frozen}
                  onChange={(e) => {
                    props.setAnnouncement(e.target.checked ? copy.layerFrozen(layer.name) : copy.layerThawed(layer.name));
                    void runLayer({ op: "set", name: layer.name, frozen: e.target.checked });
                  }}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`Lock ${layer.name}`}
                  checked={layer.locked}
                  onChange={(e) => {
                    props.setAnnouncement(e.target.checked ? copy.layerLocked(layer.name) : copy.layerUnlocked(layer.name));
                    void runLayer({ op: "set", name: layer.name, locked: e.target.checked });
                  }}
                />
              </td>
              <td>
                <select
                  className="cell"
                  aria-label={`Color ${layer.name}`}
                  value={layer.color}
                  onChange={(e) => {
                    props.setAnnouncement(copy.layerColor(layer.name, e.target.value));
                    void runLayer({ op: "set", name: layer.name, color: e.target.value });
                  }}
                >
                  {colourNames.filter((c) => c !== "ByLayer").map((colour) => (
                    <option key={colour} value={colour}>{colour}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="cell"
                  aria-label={`Linetype ${layer.name}`}
                  value={layer.linetype}
                  onChange={(e) => {
                    props.setAnnouncement(copy.layerLinetype(layer.name, e.target.value));
                    void runLayer({ op: "set", name: layer.name, linetype: e.target.value });
                  }}
                >
                  {linetypeNames.filter((l) => l !== "ByLayer").map((linetype) => (
                    <option key={linetype} value={linetype}>{linetype}</option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="cell"
                  aria-label={`Lineweight ${layer.name}`}
                  value={layer.lineweight}
                  onChange={(e) => {
                    props.setAnnouncement(copy.layerLineweight(layer.name, e.target.value));
                    void runLayer({ op: "set", name: layer.name, lineweight: e.target.value });
                  }}
                >
                  {lineweightNames.filter((l) => l !== "ByLayer").map((lineweight) => (
                    <option key={lineweight} value={lineweight}>{lineweight}</option>
                  ))}
                </select>
              </td>
              <td>{layer.objects}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BlocksPanel(props: { drawing: DrawingResponse; onCommand: (name: string, args: Record<string, unknown>) => void }): JSX.Element {
  const [scale, setScale] = useState<Record<string, number>>({});
  const [rotation, setRotation] = useState<Record<string, number>>({});
  return (
    <div className="list-panel">
      <h3>Blocks</h3>
      <ul aria-label="Block library">
        {blockLibrary.map((block) => (
          <li key={block.name} style={{ display: "grid", gap: 6 }}>
            <button
              className="btn btn-outline btn-small"
              type="button"
              aria-label={`Insert ${block.name}`}
              onClick={() => {
                const event = new CustomEvent("corbel-insert", {
                  detail: { block: block.name, scale: scale[block.name] ?? 1, rotation: rotation[block.name] ?? 0 },
                });
                window.dispatchEvent(event);
                setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Command"]')?.focus(), 0);
              }}
            >
              Insert {block.name}
            </button>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
              Scale
              <input
                type="number"
                aria-label="Scale"
                value={scale[block.name] ?? 1}
                step="0.1"
                onChange={(e) => setScale({ ...scale, [block.name]: Number.parseFloat(e.target.value) })}
                style={{ width: 70, background: "#0b0d0f", border: "1px solid #33383e", borderRadius: 2, minHeight: 28, padding: "2px 6px" }}
              />
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5 }}>
              Rotation
              <input
                type="number"
                aria-label="Rotation"
                value={rotation[block.name] ?? 0}
                step="15"
                onChange={(e) => setRotation({ ...rotation, [block.name]: Number.parseFloat(e.target.value) })}
                style={{ width: 70, background: "#0b0d0f", border: "1px solid #33383e", borderRadius: 2, minHeight: 28, padding: "2px 6px" }}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function XrefsPanel(props: { drawing: DrawingResponse; onCommand: (name: string, args: Record<string, unknown>) => void; onReload: () => Promise<void> }): JSX.Element {
  const [attachId, setAttachId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string }>>([]);
  useEffect(() => {
    void api<{ items: Array<{ id: string; name: string; kind: string }> }>("/api/folders/root?sort=name&order=asc")
      .then((r) => setCandidates(r.items.filter((i) => i.kind === "drawing")))
      .catch(() => undefined);
  }, []);
  return (
    <div className="list-panel">
      <h3>External references</h3>
      <button
        className="btn btn-outline btn-small"
        type="button"
        onClick={async () => {
          const list = await api<{ items: Array<{ id: string; name: string; kind: string }> }>("/api/folders/root?sort=name&order=asc");
          const drawings = list.items.filter((i) => i.kind === "drawing");
          setCandidates(drawings);
          setAttachId(drawings[0]?.id ?? null);
          document.getElementById("attach-dialog")?.setAttribute("open", "");
        }}
      >
        Attach drawing
      </button>
      <dialog id="attach-dialog" aria-label="Attach drawing">
        <div className="dialog-body">
          <h2>Attach drawing</h2>
          <div role="radiogroup" aria-label="Drawing">
            {candidates.map((item) => (
              <label key={item.id} style={{ display: "block", padding: 4 }}>
                <input
                  type="radio"
                  name="attach-drawing"
                  value={item.id}
                  checked={attachId === item.id}
                  onChange={() => setAttachId(item.id)}
                />{" "}
                {item.name}
              </label>
            ))}
          </div>
          <div className="dialog-actions">
            <button
              className="btn btn-outline"
              type="button"
              onClick={() => document.getElementById("attach-dialog")?.removeAttribute("open")}
            >
              Cancel
            </button>
            <button
              className="btn btn-filled"
              type="button"
              onClick={async () => {
                if (!attachId) return;
                props.onCommand("XREF", { op: "attach", drawing_id: attachId });
                await props.onReload();
                document.getElementById("attach-dialog")?.removeAttribute("open");
              }}
            >
              Attach
            </button>
          </div>
        </div>
      </dialog>
      <ul aria-label="External references" style={{ marginTop: 10 }}>
        {props.drawing.xrefs.map((xref) => (
          <li key={xref.id}>
            <span>{xref.name} · {xref.status.charAt(0).toUpperCase() + xref.status.slice(1)}</span>
            <span style={{ display: "flex", gap: 4 }}>
              <button className="btn btn-outline btn-small" type="button" onClick={() => { props.onCommand("XREF", { op: "unload", xref_id: xref.id }); void props.onReload(); }}>Unload {xref.name}</button>
              <button className="btn btn-outline btn-small" type="button" onClick={() => { props.onCommand("XREF", { op: "reload", xref_id: xref.id }); void props.onReload(); }}>Reload {xref.name}</button>
              <button className="btn btn-outline btn-small" type="button" onClick={() => { props.onCommand("XREF", { op: "detach", xref_id: xref.id }); void props.onReload(); }}>Detach {xref.name}</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TracesPanel(props: {
  drawing: DrawingResponse;
  traceActive: string | null;
  onTraceActive: (id: string | null) => void;
  onReload: () => Promise<void>;
  me: MeResponse | null;
  setAnnouncement: (text: string) => void;
  linkToken: string | null;
}): JSX.Element {
  const headers: Record<string, string> = props.linkToken ? { authorization: `Link ${props.linkToken}` } : {};
  const [newName, setNewName] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const isOwner = props.drawing.access === "owner";
  return (
    <div className="list-panel">
      <h3>Traces</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (newName.trim() === "") return;
          try {
            await api(`/api/drawings/${props.drawing.id}/traces`, { json: { name: newName.trim() }, headers });
            setNewName("");
            await props.onReload();
          } catch (err) {
            if (err instanceof ApiFailure) props.setAnnouncement(err.fields.name ?? err.code);
          }
        }}
      >
        <div className="field">
          <input
            aria-label="Trace name"
            placeholder="New trace name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <button className="btn btn-outline btn-small" type="submit">New trace</button>
      </form>
      <ul aria-label="Traces" style={{ marginTop: 12 }}>
        {props.drawing.traces.length === 0 && <li>{copy.noTraces}</li>}
        {props.drawing.traces.map((trace) => (
          <li key={trace.id}>
            <span>
              {trace.name} · {trace.state.charAt(0).toUpperCase() + trace.state.slice(1)}
              {trace.notice && ` · ${copy.traceItemNotice(trace.notice)}`}
            </span>
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button className="btn btn-outline btn-small" type="button" onClick={() => props.onTraceActive(props.traceActive === trace.id ? null : trace.id)}>
                Open trace {trace.name}
              </button>
              {trace.state === "open" && (
                <button
                  className="btn btn-outline btn-small"
                  type="button"
                  disabled={submitting === trace.id}
                  onClick={async () => {
                    setSubmitting(trace.id);
                    try {
                      await api(`/api/traces/${trace.id}/submit`, { method: "POST", headers });
                      await props.onReload();
                      props.setAnnouncement("Submitted");
                    } finally {
                      setSubmitting(null);
                    }
                  }}
                >
                  {submitting === trace.id ? copy.submitting : "Submit trace"}
                </button>
              )}
              {isOwner && trace.state === "submitted" && (
                <button
                  className="btn btn-outline btn-small"
                  type="button"
                  onClick={async () => {
                    await api(`/api/traces/${trace.id}/close`, { method: "POST", headers });
                    await props.onReload();
                  }}
                >
                  Close trace {trace.name}
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IssuesPanel(props: { drawing: DrawingResponse; issues: IssuesResponse["issues"]; onReload: () => Promise<void>; me: MeResponse | null; linkToken: string | null }): JSX.Element {
  const isOwner = props.drawing.access === "owner";
  return (
    <div className="list-panel">
      <h3>Issues</h3>
      <ul aria-label="Issues">
        {props.issues.length === 0 && <li>{copy.noIssues}</li>}
        {props.issues.map((issue) => (
          <li key={issue.number}>
            <span>
              #{issue.number} {issue.text} · {issue.status === "open" ? "Open" : "Resolved"}
            </span>
            {isOwner && issue.status === "open" && (
              <button
                className="btn btn-outline btn-small"
                type="button"
                onClick={async () => {
                  await api(`/api/drawings/${props.drawing.id}/issues/${issue.number}/resolve`, { method: "POST", headers: { ...(props.linkToken ? { authorization: `Link ${props.linkToken}` } : {}) } });
                  await props.onReload();
                }}
              >
                Resolve issue {issue.number}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
