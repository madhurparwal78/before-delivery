import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Member, Part, Sketch, SketchEntity } from "../shared/types.js";
import { api, ApiError, KeyStore } from "./api.js";
import { display } from "../shared/units.js";
import { profileAreaOf } from "../shared/geometry.js";
import { countSteps, useReducedMotion } from "./motion.js";
import { saveStatusText } from "./copy.js";
import type { Mode, SaveFeedback } from "./Workspace.js";

/** Sketch mode: the canvas, the tools, constraints, dimensions and extrudes. */

type Tool = "select" | "line" | "circle" | "arc" | "point";

const CONSTRAINTS: { kind: string; label: string; key: string }[] = [
  { kind: "coincident", label: "Coincident", key: "C" },
  { kind: "horizontal", label: "Horizontal", key: "H" },
  { kind: "vertical", label: "Vertical", key: "V" },
  { kind: "parallel", label: "Parallel", key: "P" },
  { kind: "perpendicular", label: "Perpendicular", key: "R" },
  { kind: "equal", label: "Equal", key: "E" },
  { kind: "fix", label: "Fix", key: "F" },
  { kind: "distance", label: "Dimension", key: "D" }
];

export function SketchScreen(props: {
  member: Member;
  founder: boolean;
  part: Part | null;
  mode: Extract<Mode, { kind: "sketch" }>;
  setMode: (mode: Mode) => void;
  sayModel: (text: string) => void;
  handleError: (err: unknown) => void;
  saveFeedback: SaveFeedback;
  setSaveFeedback: (feedback: SaveFeedback) => void;
  updatePartInLists: (part: Part) => void;
  refreshLists: () => Promise<void>;
  keys: KeyStore;
  reducedMotion: boolean;
  afterPartChange: () => void;
  propertiesSheet: boolean;
  closeSheet: () => void;
}): JSX.Element {
  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selection, setSelection] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dimension, setDimension] = useState<{
    refs: string[];
    kind: string;
    value: string;
    tolerance: string;
    editingId: string | null;
  } | null>(null);
  const [pendingClicks, setPendingClicks] = useState<{ x: number; y: number }[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ ghostLabel: string; existingLabel: string } | null>(null);
  const [slackShown, setSlackShown] = useState<number | null>(null);
  const [ink, setInk] = useState(false);
  const [extrudeForm, setExtrudeForm] = useState<{
    depth: string;
    operation: "new" | "join" | "cut" | "intersect";
    direction: "normal" | "reverse" | "symmetric";
    pending: boolean;
    error: string | null;
  } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reducedMotion = useReducedMotion();

  useEffect(() => {
    void api
      .sketch(props.mode.sketchId)
      .then((reply) => {
        setSketch(reply.sketch);
        setSlackShown(reply.sketch.slack);
        setInk(reply.sketch.fully_held);
      })
      .catch(props.handleError);
  }, [props.mode.sketchId, props.handleError]);

  // The slack readout counts to the new total only after the rings settle.
  const applySlackMotion = useCallback(
    (from: number, to: number) => {
      if (from === to) {
        setSlackShown(to);
        return;
      }
      setSlackShown(from);
      window.setTimeout(() => {
        countSteps(from, to, 330, (value) => setSlackShown(value), reducedMotion);
      }, reducedMotion ? 0 : 220);
      if (to === 0) {
        window.setTimeout(() => setInk(true), reducedMotion ? 220 : 550);
      } else {
        setInk(false);
      }
    },
    [reducedMotion]
  );

  const acceptSketch = useCallback(
    (next: Sketch, part: Part, message: string) => {
      const previous = sketch;
      setSketch(next);
      props.updatePartInLists(part);
      if (previous) applySlackMotion(previous.slack, next.slack);
      if (message) props.sayModel(message);
    },
    [sketch, props, applySlackMotion]
  );

  const sendSketchChange = useCallback(
    async <T extends { sketch: Sketch; part: Part }>(
      action: () => Promise<T>
    ): Promise<T | null> => {
      if (!sketch) return null;
      setConflict(null);
      props.setSaveFeedback({ status: "saving" });
      try {
        const reply = await action();
        acceptSketch(reply.sketch, reply.part, "");
        props.setSaveFeedback(
          reply.part.body.status === "stored"
            ? { status: "stored" }
            : reply.part.body.status === "none"
              ? { status: "no_body" }
              : { status: "not_stored" }
        );
        props.afterPartChange();
        return reply;
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.status === 412) {
            props.setSaveFeedback({ status: "idle" });
            props.handleError(err);
            return null;
          }
          if (err.code === "over_constrained") {
            const refused = err as ApiError & {
              refused_label?: string;
              conflicts_with?: { label: string };
            };
            setConflict({
              ghostLabel: refused.refused_label ?? "Distance",
              existingLabel: refused.conflicts_with?.label ?? ""
            });
            props.sayModel(err.message);
            props.setSaveFeedback({ status: "idle" });
            return null;
          }
          if (err.fields) {
            setFieldErrors(err.fields);
            props.setSaveFeedback({ status: "idle" });
            return null;
          }
          props.sayModel(err.message);
          if (err.status === 503) props.setSaveFeedback({ status: "not_stored" });
          else props.setSaveFeedback({ status: "idle" });
          return null;
        }
        props.sayModel("No answer from the server. Your change was not confirmed.");
        props.setSaveFeedback({ status: "idle" });
        return null;
      }
    },
    [sketch, props, acceptSketch]
  );

  const clearConflict = useCallback(() => {
    setConflict(null);
  }, []);

  // ---- Canvas drawing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sketch) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    drawGrid(context, width, height, zoom, pan);
    drawSketch(context, sketch, zoom, pan, selection, ink, conflict, width, height);
    drawRings(context, sketch, zoom, pan, slackShown === null ? sketch.slack : slackShown);
  }, [sketch, zoom, pan, selection, ink, conflict, slackShown]);

  // ---- Keyboard shortcuts across the sketch workspace ----
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement;
      const inField =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.getAttribute("role") === "spinbutton";
      const dialogOpen = document.querySelector('[role="dialog"]') !== null;
      if (dialogOpen) return;
      // Escape always cancels the open form, even from inside a field.
      if (event.key === "Escape") {
        if (extrudeForm) {
          event.preventDefault();
          setExtrudeForm(null);
          groupRef.current?.focus();
          return;
        }
        if (dimension) {
          event.preventDefault();
          setDimension(null);
          setFieldErrors({});
          groupRef.current?.focus();
          return;
        }
      }
      if (inField) return;
      const key = event.key.toLowerCase();
      const toolKeys: Record<string, Tool> = {
        l: "line",
        o: "circle",
        a: "arc",
        k: "point"
      };
      if (toolKeys[key]) {
        setTool(toolKeys[key]!);
        event.preventDefault();
        return;
      }
      if (key === "escape") {
        if (selection.length > 0) {
          setSelection([]);
          event.preventDefault();
        } else if (extrudeForm) {
          setExtrudeForm(null);
          event.preventDefault();
        } else if (dimension) {
          setDimension(null);
          event.preventDefault();
        } else {
          setTool("select");
          event.preventDefault();
        }
        return;
      }
      if (key === "x" && props.founder) {
        openExtrude();
        event.preventDefault();
        return;
      }
      const constraint = CONSTRAINTS.find((c) => c.key.toLowerCase() === key);
      if (constraint) {
        void applyConstraint(constraint.kind);
        event.preventDefault();
        return;
      }
      if (key === "delete" || key === "backspace") {
        void deleteSelection();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ---- Actions ----
  const pointPosition = useCallback(
    (ref: string): { x: number; y: number } | null => {
      if (!sketch) return null;
      if (ref === "origin") return { x: 0, y: 0 };
      const point = sketch.points.find((p) => p.ref === ref);
      return point ? { x: point.x, y: point.y } : null;
    },
    [sketch]
  );

  const measuredValue = useCallback((): number | null => {
    if (!sketch || selection.length === 0) return null;
    if (selection.length === 1) {
      const entity = sketch.entities.find((e) => e.id === selection[0]);
      if (!entity) return null;
      if (entity.type === "line") return Math.hypot(entity.end.x - entity.start.x, entity.end.y - entity.start.y);
      if (entity.type === "circle") return entity.radius * 2;
      if (entity.type === "arc") return entity.radius;
      return null;
    }
    const a = pointPosition(selection[0]!);
    const b = pointPosition(selection[1]!);
    if (a && b) return Math.hypot(a.x - b.x, a.y - b.y);
    return null;
  }, [sketch, selection, pointPosition]);

  const dimensionKindFor = useCallback((): { kind: string; refs: string[] } | null => {
    if (!sketch || selection.length === 0) return null;
    if (selection.length === 1) {
      const entity = sketch.entities.find((e) => e.id === selection[0]);
      if (!entity) return null;
      if (entity.type === "line") return { kind: "distance", refs: [entity.id] };
      if (entity.type === "circle") return { kind: "diameter", refs: [entity.id] };
      if (entity.type === "arc") return { kind: "radius", refs: [entity.id] };
      return null;
    }
    if (selection.length === 2) {
      const a = pointPosition(selection[0]!);
      const b = pointPosition(selection[1]!);
      if (a && b) return { kind: "distance", refs: selection.slice(0, 2) };
      const first = sketch.entities.find((e) => e.id === selection[0]);
      const second = sketch.entities.find((e) => e.id === selection[1]);
      if (first?.type === "line" && second?.type === "line") {
        return { kind: "distance", refs: [first.id] };
      }
    }
    return null;
  }, [sketch, selection, pointPosition]);

  const applyConstraint = useCallback(
    async (kind: string): Promise<void> => {
      if (!sketch || selection.length === 0) return;
      clearConflict();
      if (kind === "distance") {
        const target = dimensionKindFor();
        if (!target) return;
        const current = measuredValue();
        setDimension({
          refs: target.refs,
          kind: target.kind,
          value: current !== null ? String(Math.round(current * 1000) / 1000) : "",
          tolerance: "",
          editingId: null
        });
        window.setTimeout(() => {
          document.getElementById("dimension-value")?.focus();
        }, 30);
        return;
      }
      const reply = await sendSketchChange(() =>
        api.postConstraint(sketch.id, {
          base_revision: sketch.revision,
          kind,
          refs: selection
        })
      );
      if (reply) {
        const label = reply.constraint?.label ?? constraintLabel(kind, sketch);
        props.sayModel(
          reply.sketch.fully_held
            ? `${label} added. Fully held.`
            : `${label} added. Slack ${reply.sketch.slack}.`
        );
      }
    },
    [sketch, selection, sendSketchChange, clearConflict, dimensionKindFor, measuredValue, props]
  );

  const deleteSelection = useCallback(async (): Promise<void> => {
    if (!sketch || selection.length === 0) return;
    const entityId = selection.find((ref) => !ref.includes("."));
    if (!entityId) return;
    await sendSketchChange(() => api.deleteEntity(sketch.id, entityId, sketch.revision));
    setSelection([]);
  }, [sketch, selection, sendSketchChange]);

  // The Line tool prefills a 20 mm horizontal line beside the last entity.
  useEffect(() => {
    if (tool !== "line" && tool !== "circle" && tool !== "arc" && tool !== "point") return;
    if (Object.keys(formValues).length > 0 || !sketch) return;
    const last = sketch.entities[sketch.entities.length - 1];
    let baseX = 0;
    let baseY = 0;
    for (const e of sketch.entities) {
      if (e.type === "line") {
        baseX = Math.max(baseX, e.start.x, e.end.x);
        baseY = Math.max(baseY, e.start.y, e.end.y);
      } else if (e.type === "point") {
        baseX = Math.max(baseX, e.x);
        baseY = Math.max(baseY, e.y);
      } else {
        baseX = Math.max(baseX, e.center.x + e.radius);
        baseY = Math.max(baseY, e.center.y);
      }
    }
    void last;
    if (tool === "line") {
      setFormValues({
        lineStartX: String(baseX),
        lineStartY: String(baseY),
        lineEndX: String(baseX + 20),
        lineEndY: String(baseY)
      });
    } else if (tool === "circle") {
      setFormValues({ circleCx: String(baseX + 20), circleCy: String(baseY), circleD: "10" });
    } else if (tool === "point") {
      setFormValues({ pointX: String(baseX + 20), pointY: String(baseY) });
    }
  }, [tool, sketch]);

  const placeEntity = useCallback(
    async (entity: Record<string, unknown>): Promise<void> => {
      if (!sketch) return;
      const reply = await sendSketchChange(() =>
        api.postEntity(sketch.id, { base_revision: sketch.revision, entity })
      );
      setFormValues({});
      setTool("select");
      groupRef.current?.focus();
      if (reply) {
        const label = reply.sketch.entities[reply.sketch.entities.length - 1]?.label ?? "Entity";
        props.sayModel(`${label} added. Slack ${reply.sketch.slack}.`);
      }
    },
    [sketch, sendSketchChange, props]
  );

  const openExtrude = useCallback((): void => {
    if (!sketch || !props.part) return;
    const isFirst = props.part.features.length === 0;
    setExtrudeForm({
      depth: "",
      operation: isFirst ? "new" : "join",
      direction: "normal",
      pending: false,
      error: null
    });
    window.setTimeout(() => {
      document.getElementById("extrude-depth")?.focus();
    }, 30);
  }, [sketch, props.part]);

  const confirmExtrude = useCallback(async (): Promise<void> => {
    if (!sketch || !extrudeForm || !props.part) return;
    const key = props.keys.keyFor(`extrude:${sketch.id}`);
    setExtrudeForm({ ...extrudeForm, pending: true, error: null });
    props.setSaveFeedback({ status: "saving" });
    try {
      const reply = await api.createFeature(props.part.id, key, {
        base_revision: props.part.revision,
        sketch_id: sketch.id,
        operation: extrudeForm.operation,
        depth: extrudeForm.depth,
        direction: extrudeForm.direction
      });
      props.updatePartInLists(reply.part);
      props.setSaveFeedback(
        reply.part.body.status === "stored"
          ? { status: "stored" }
          : reply.part.body.status === "none"
            ? { status: "no_body" }
            : { status: "not_stored" }
      );
      props.sayModel(`${reply.feature?.name ?? "Extrude"} added.`);
      props.keys.clear(`extrude:${sketch.id}`);
      setExtrudeForm(null);
      props.afterPartChange();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fields?.depth) {
          setExtrudeForm({ ...extrudeForm, pending: false, error: err.fields.depth });
          props.setSaveFeedback({ status: "idle" });
          return;
        }
        props.sayModel(err.message);
      } else {
        props.sayModel("No answer from the server. Your change was not confirmed.");
      }
      props.setSaveFeedback({ status: "idle" });
      setExtrudeForm((form) => (form ? { ...form, pending: false } : null));
    }
  }, [sketch, extrudeForm, props]);

  if (!sketch || !props.part) return <div />;

  const toScreen = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: p.x * zoom + pan.x,
    y: -p.y * zoom + pan.y
  });
  const toWorld = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: (p.x - pan.x) / zoom,
    y: (p.y - pan.y) / zoom
  });

  const rovingOrder = useMemo(() => {
    const order: { ref: string; label: string; kind: "origin" | "entity" | "point"; position: { x: number; y: number } | null }[] = [
      { ref: "origin", label: "Origin", kind: "origin", position: { x: 0, y: 0 } }
    ];
    for (const entity of sketch.entities) {
      order.push({
        ref: entity.id,
        label: entity.label,
        kind: "entity",
        position: entityPosition(entity)
      });
      for (const point of sketch.points) {
        if (point.ref.startsWith(`${entity.id}.`)) {
          order.push({ ref: point.ref, label: point.name, kind: "point", position: { x: point.x, y: point.y } });
        }
      }
    }
    return order;
  }, [sketch]);

  const canvasKeyDown = (event: React.KeyboardEvent): void => {
    if (["ArrowRight", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      setHighlight((h) => Math.min(rovingOrder.length - 1, h + 1));
    } else if (["ArrowLeft", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const item = rovingOrder[highlight];
      if (item) {
        setSelection((prev) =>
          prev.includes(item.ref) ? prev.filter((r) => r !== item.ref) : [...prev, item.ref]
        );
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSelection([]);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setZoom((z) => Math.min(20, z * 1.15));
    } else if (event.key === "-") {
      event.preventDefault();
      setZoom((z) => Math.max(0.05, z / 1.15));
    }
  };

  const canvasPointer = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (tool === "select") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const world = toWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    const next = [...pendingClicks, world];
    const needed = tool === "line" ? 2 : tool === "circle" ? 2 : tool === "arc" ? 3 : 1;
    if (next.length >= needed) {
      if (tool === "point") {
        void placeEntity({ type: "point", x: next[0]!.x, y: next[0]!.y });
      } else if (tool === "line" && next.length >= 2) {
        void placeEntity({
          type: "line",
          start: { x: next[0]!.x, y: next[0]!.y },
          end: { x: next[1]!.x, y: next[1]!.y }
        });
      } else if (tool === "circle" && next.length >= 2) {
        const radius = Math.hypot(next[1]!.x - next[0]!.x, next[1]!.y - next[0]!.y);
        void placeEntity({ type: "circle", center: { x: next[0]!.x, y: next[0]!.y }, radius });
      } else if (tool === "arc" && next.length >= 3) {
        const radius = Math.hypot(next[1]!.x - next[0]!.x, next[1]!.y - next[0]!.y);
        const startAngle =
          (Math.atan2(next[1]!.y - next[0]!.y, next[1]!.x - next[0]!.x) * 180) / Math.PI;
        const endAngle =
          (Math.atan2(next[2]!.y - next[0]!.y, next[2]!.x - next[0]!.x) * 180) / Math.PI;
        void placeEntity({
          type: "arc",
          center: { x: next[0]!.x, y: next[0]!.y },
          radius,
          start_angle_deg: startAngle,
          end_angle_deg: endAngle
        });
      }
      setPendingClicks([]);
      setTool("select");
    } else {
      setPendingClicks(next);
    }
  };

  const toolForm = (): JSX.Element | null => {
    if (tool === "line") {
      return (
        <div role="group" aria-label="Line" className="tool-form">
          <div className="two-col">
            <LabeledNumber label="Start X" value={formValues.lineStartX ?? ""} onChange={(v) => setFormValues({ ...formValues, lineStartX: v })} />
            <LabeledNumber label="Start Y" value={formValues.lineStartY ?? ""} onChange={(v) => setFormValues({ ...formValues, lineStartY: v })} />
            <LabeledNumber label="End X" value={formValues.lineEndX ?? ""} onChange={(v) => setFormValues({ ...formValues, lineEndX: v })} />
            <LabeledNumber label="End Y" value={formValues.lineEndY ?? ""} onChange={(v) => setFormValues({ ...formValues, lineEndY: v })} />
          </div>
          <button
            onClick={() => {
              void placeEntity({
                type: "line",
                start: { x: formValues.lineStartX ?? "0", y: formValues.lineStartY ?? "0" },
                end: { x: formValues.lineEndX ?? "20", y: formValues.lineEndY ?? "0" }
              });
              setFormValues({});
            }}
          >
            Place line
          </button>
        </div>
      );
    }
    if (tool === "circle") {
      return (
        <div role="group" aria-label="Circle" className="tool-form">
          <LabeledNumber label="Centre X" value={formValues.circleCx ?? ""} onChange={(v) => setFormValues({ ...formValues, circleCx: v })} />
          <LabeledNumber label="Centre Y" value={formValues.circleCy ?? ""} onChange={(v) => setFormValues({ ...formValues, circleCy: v })} />
          <LabeledNumber label="Diameter" value={formValues.circleD ?? ""} onChange={(v) => setFormValues({ ...formValues, circleD: v })} />
          <button
            onClick={() => {
              const diameter = parseLengthLocal(formValues.circleD ?? "10", props.member.units);
              if (diameter === null) return;
              void placeEntity({
                type: "circle",
                center: { x: formValues.circleCx ?? "0", y: formValues.circleCy ?? "0" },
                radius: diameter / 2
              });
            }}
          >
            Place circle
          </button>
        </div>
      );
    }
    if (tool === "arc") {
      return (
        <div role="group" aria-label="Arc" className="tool-form">
          <LabeledNumber label="Centre X" value={formValues.arcCx ?? ""} onChange={(v) => setFormValues({ ...formValues, arcCx: v })} />
          <LabeledNumber label="Centre Y" value={formValues.arcCy ?? ""} onChange={(v) => setFormValues({ ...formValues, arcCy: v })} />
          <LabeledNumber label="Radius" value={formValues.arcR ?? ""} onChange={(v) => setFormValues({ ...formValues, arcR: v })} />
          <LabeledNumber label="Start angle" value={formValues.arcStart ?? ""} onChange={(v) => setFormValues({ ...formValues, arcStart: v })} />
          <LabeledNumber label="End angle" value={formValues.arcEnd ?? ""} onChange={(v) => setFormValues({ ...formValues, arcEnd: v })} />
          <button
            onClick={() => {
              void placeEntity({
                type: "arc",
                center: { x: formValues.arcCx ?? "0", y: formValues.arcCy ?? "0" },
                radius: formValues.arcR ?? "10",
                start_angle_deg: Number(formValues.arcStart ?? 0),
                end_angle_deg: Number(formValues.arcEnd ?? 90)
              });
            }}
          >
            Place arc
          </button>
        </div>
      );
    }
    if (tool === "point") {
      return (
        <div role="group" aria-label="Point" className="tool-form">
          <LabeledNumber label="X" value={formValues.pointX ?? ""} onChange={(v) => setFormValues({ ...formValues, pointX: v })} />
          <LabeledNumber label="Y" value={formValues.pointY ?? ""} onChange={(v) => setFormValues({ ...formValues, pointY: v })} />
          <button
            onClick={() => {
              void placeEntity({ type: "point", x: formValues.pointX ?? "0", y: formValues.pointY ?? "0" });
              setFormValues({});
            }}
          >
            Place point
          </button>
        </div>
      );
    }
    return null;
  };

  const constraintApplies = (kind: string): boolean => {
    if (selection.length === 0) return false;
    const kinds = selection.map((ref) => {
      const entity = sketch.entities.find((e) => ref === e.id || ref.startsWith(`${e.id}.`));
      if (!entity) return "point";
      return entity.type;
    });
    const allPoints = selection.every(
      (ref) => ref === "origin" || sketch.points.some((p) => p.ref === ref)
    );
    switch (kind) {
      case "coincident":
        return selection.length === 2 && allPoints;
      case "horizontal":
      case "vertical":
        return selection.length === 1 && kinds[0] === "line";
      case "parallel":
      case "perpendicular":
        return selection.length === 2 && kinds.every((k) => k === "line");
      case "equal":
        return (
          (selection.length === 2 && kinds.every((k) => k === "line")) ||
          (selection.length === 2 && kinds.every((k) => k === "circle" || k === "arc"))
        );
      case "fix":
        return selection.length === 1 && allPoints;
      case "distance":
        return (
          (selection.length === 1 && ["line", "circle", "arc"].includes(kinds[0]!)) ||
          (selection.length === 2 && allPoints)
        );
      case "horizontal_distance":
      case "vertical_distance":
        return selection.length === 2 && allPoints;
      default:
        return false;
    }
  };

  const previewFigures = useMemo(() => {
    if (!extrudeForm || !props.part) return null;
    const area = profileAreaOf(sketch.entities);
    const parsed = parseLengthLocal(extrudeForm.depth, props.member.units);
    if (parsed === null) return { volume: null, mass: null };
    const confirmed = props.part.confirmed?.volume_mm3 ?? 0;
    const delta = area * parsed;
    const volume =
      extrudeForm.operation === "cut" ? Math.max(0, confirmed - delta) : confirmed + delta;
    const mass = (volume * props.part.material.density_g_cm3) / 1000;
    return {
      volume: extrudeForm.operation === "intersect" ? null : volume,
      mass: extrudeForm.operation === "intersect" ? null : mass
    };
  }, [extrudeForm, sketch, props.part, props.member.units]);

  const currentSlack = slackShown ?? sketch.slack;

  return (
    <>
      <div
        ref={groupRef}
        role="group"
        aria-label="Sketch canvas"
        tabIndex={0}
        className="sketch-canvas-wrap"
        onKeyDown={canvasKeyDown}
        onWheel={(event) => {
          event.preventDefault();
          setZoom((z) => Math.max(0.05, Math.min(20, z * (event.deltaY < 0 ? 1.1 : 0.9))));
        }}
      >
        <canvas
          ref={canvasRef}
          className="canvas-fill"
          style={{ cursor: tool === "select" ? "default" : "crosshair" }}
          onPointerDown={(event) => {
            clearConflict();
            canvasPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.buttons === 1 && tool === "select") {
              setPan((prev) => ({ x: prev.x + event.movementX, y: prev.y + event.movementY }));
            }
          }}
        />
        {rovingOrder.map((item, index) => {
          if (!item.position) return null;
          const screen = toScreen(item.position);
          return (
            <button
              key={item.ref}
              className="canvas-activator"
              aria-label={item.label}
              aria-pressed={selection.includes(item.ref)}
              data-highlight={highlight === index ? "true" : "false"}
              style={{ left: screen.x - 22, top: screen.y - 22, width: 44, height: 44 }}
              onClick={(event) => {
                setHighlight(index);
                if (event.shiftKey) {
                  setSelection((prev) =>
                    prev.includes(item.ref) ? prev.filter((r) => r !== item.ref) : [...prev, item.ref]
                  );
                } else {
                  setSelection([item.ref]);
                }
              }}
            />
          );
        })}
        {sketch.constraints.map((constraint) => {
          const mid = constraintMidpoint(sketch, constraint.refs);
          if (!mid) return null;
          const screen = toScreen(mid);
          return (
            <div
              key={constraint.id}
              role="img"
              aria-label={constraint.label}
              style={{
                position: "absolute",
                left: screen.x + 6,
                top: screen.y - 18,
                fontSize: 10,
                color: "var(--ink)",
                background: "var(--panel)",
                padding: "0 3px",
                border: `1px solid ${conflict && (conflict.existingLabel === constraint.label || conflict.ghostLabel === constraint.label) ? "var(--conflict)" : "var(--rule)"}`,
                pointerEvents: "none",
                borderRadius: 2
              }}
              className={conflict && (conflict.existingLabel === constraint.label || conflict.ghostLabel === constraint.label) && !reducedMotion ? "flash" : undefined}
            >
              {constraint.value_mm !== undefined
                ? `${constraint.label} ${display.toleranceText(constraint.value_mm, constraint.tolerance ?? null, props.member.units, props.member.precision).replace(/ (mm|in)$/, "")}`
                : constraint.label}
            </div>
          );
        })}
        {conflict ? (
          <div
            role="img"
            aria-label={conflict.ghostLabel}
            style={{
              position: "absolute",
              left: "50%",
              top: "40%",
              fontSize: 10,
              color: reducedMotion ? "var(--conflict)" : "var(--conflict)",
              border: `1px solid var(--conflict)`,
              background: "var(--panel)",
              padding: "0 3px",
              borderRadius: 2,
              pointerEvents: "none"
            }}
            className={reducedMotion ? undefined : "flash"}
          >
            {conflict.ghostLabel}
          </div>
        ) : null}
        {sketch.points
          .filter((point) => point.freedom > 0)
          .map((point) => {
            const screen = toScreen({ x: point.x, y: point.y });
            return (
              <div
                key={point.ref}
                role="img"
                aria-label={`Slack ring at ${point.name}`}
                style={{
                  position: "absolute",
                  left: screen.x - point.freedom * 6,
                  top: screen.y - point.freedom * 6,
                  width: point.freedom * 12,
                  height: point.freedom * 12,
                  borderRadius: "50%",
                  border: `2px solid var(--slack)`,
                  pointerEvents: "none"
                }}
              />
            );
          })}
      </div>

      {createPortal(
        <>
          <div className="group" role="toolbar" aria-label="Tools">
            {(
              [
                ["select", "Select"],
                ["line", "Line"],
                ["circle", "Circle"],
                ["arc", "Arc"],
                ["point", "Point"],
                ...(props.founder ? [["extrude" as const, "Extrude"] as [Tool | "extrude", string]] : [])
              ] as [Tool | "extrude", string][]
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={value === "extrude" ? !!extrudeForm : tool === value}
                onClick={() => {
                  if (value === "extrude") openExtrude();
                  else setTool(value);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div
            className="slack-readout"
            role="status"
            aria-label="Slack"
            data-tone={currentSlack === 0 ? "held" : "slack"}
          >
            {currentSlack === 0 ? "Fully held" : `Slack ${currentSlack}`}
          </div>
        </>,
        commandSlot()
      )}

      <div className="panel properties-panel" role={props.propertiesSheet ? "dialog" : "complementary"} aria-label="Properties">
        <div className="sheet-title">
          <h3>{sketch.name}</h3>
          {props.propertiesSheet ? <button onClick={props.closeSheet}>Close</button> : null}
        </div>
        <div role="status" aria-label="Save status" className="status-line">
          {props.saveFeedback.status === "idle" ? "" : saveStatusText[props.saveFeedback.status]}
        </div>
        {toolForm()}
        {tool === "select" ? (
          <>
            <div role="group" aria-label="Constrain selection" className="constraint-buttons">
              {CONSTRAINTS.map((c) => (
                <button
                  key={c.kind}
                  disabled={!constraintApplies(c.kind)}
                  onClick={() => void applyConstraint(c.kind)}
                >
                  {c.kind === "distance" ? "Dimension" : c.label}
                </button>
              ))}
              <button
                disabled={!constraintApplies("horizontal_distance")}
                onClick={() => void applyConstraint("horizontal_distance")}
              >
                Horizontal distance
              </button>
              <button
                disabled={!constraintApplies("vertical_distance")}
                onClick={() => void applyConstraint("vertical_distance")}
              >
                Vertical distance
              </button>
            </div>

            {dimension ? (
              <div className="tool-form">
                <LabeledNumber
                  label="Dimension value"
                  id="dimension-value"
                  value={dimension.value}
                  onChange={(value) => setDimension({ ...dimension, value })}
                  error={fieldErrors.value}
                />
                <LabeledNumber
                  label="Tolerance"
                  value={dimension.tolerance}
                  onChange={(value) => setDimension({ ...dimension, tolerance: value })}
                  error={fieldErrors.tolerance}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button
                    onClick={() => {
                      const payload: {
                        base_revision: number;
                        kind: string;
                        refs: string[];
                        value: string;
                        tolerance?: string;
                      } = {
                        base_revision: sketch.revision,
                        kind: dimension.kind,
                        refs: dimension.refs,
                        value: dimension.value
                      };
                      if (dimension.tolerance.trim() !== "") {
                        payload.tolerance = dimension.tolerance;
                      }
                      void (async () => {
                        const reply = await sendSketchChange(() =>
                          api.postConstraint(sketch.id, payload)
                        );
                        if (reply) {
                          setDimension(null);
                          setFieldErrors({});
                          const label = reply.constraint?.label ?? constraintLabel(dimension.kind, sketch);
                          props.sayModel(
                            reply.sketch.fully_held
                              ? `${label} added. Fully held.`
                              : `${label} added. Slack ${reply.sketch.slack}.`
                          );
                        }
                      })();
                    }}
                  >
                    Apply dimension
                  </button>
                  <button
                    onClick={() => {
                      setDimension(null);
                      setFieldErrors({});
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            <ul className="constraint-list" aria-label="Constraints">
              {sketch.constraints.map((constraint) => (
                <li key={constraint.id}>
                  <span>{constraint.label}</span>
                  {constraint.value_mm !== undefined ? (
                    <span className="value num">
                      {display.toleranceText(
                        constraint.value_mm,
                        constraint.tolerance ?? null,
                        props.member.units,
                        props.member.precision
                      )}
                    </span>
                  ) : null}
                  {constraint.redundant ? <span className="redundant-tag">redundant</span> : null}
                  {constraint.value_mm !== undefined ? (
                    <button
                      aria-label={`Edit ${constraint.label}`}
                      onClick={() => {
                        setDimension({
                          refs: constraint.refs,
                          kind: constraint.kind,
                          value: String(constraint.value_mm ?? ""),
                          tolerance: toleranceTextOf(constraint.tolerance ?? null),
                          editingId: constraint.id
                        });
                        window.setTimeout(() => {
                          document.getElementById("dimension-value")?.focus();
                        }, 30);
                      }}
                      style={{ minHeight: 30 }}
                    >
                      Edit
                    </button>
                  ) : null}
                  <button
                    aria-label={`Delete ${constraint.label}`}
                    onClick={() => {
                      void (async () => {
                        const reply = await sendSketchChange(() =>
                          api.deleteConstraint(sketch.id, constraint.id, sketch.revision)
                        );
                        if (reply) {
                          props.sayModel(
                            `${constraint.label} deleted. Slack ${reply.sketch.slack}.`
                          );
                        }
                      })();
                    }}
                    style={{ minHeight: 30 }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <button onClick={() => void deleteSelection()} disabled={selection.length === 0}>
                Delete selection
              </button>
              <button onClick={() => props.setMode({ kind: "part", partId: props.mode.partId, editingFeatureId: null })}>
                Close sketch
              </button>
            </div>
          </>
        ) : null}

        {extrudeForm ? (
          <form
            aria-label="Extrude"
            className="tool-form"
            onSubmit={(event) => {
              event.preventDefault();
              void confirmExtrude();
            }}
          >
            <LabeledNumber
              label="Depth"
              id="extrude-depth"
              value={extrudeForm.depth}
              onChange={(value) => setExtrudeForm({ ...extrudeForm, depth: value })}
              error={extrudeForm.error ?? undefined}
            />
            <fieldset style={{ border: "none", padding: 0, margin: "8px 0" }}>
              <legend>Operation</legend>
              {(["new", "join", "cut", "intersect"] as const).map((operation) => (
                <label key={operation} style={{ display: "flex", gap: 6, margin: "4px 0", textTransform: "capitalize" }}>
                  <input
                    type="radio"
                    name="extrude-operation"
                    checked={extrudeForm.operation === operation}
                    onChange={() => setExtrudeForm({ ...extrudeForm, operation })}
                  />
                  {operation === "new" ? "New body" : operation === "join" ? "Join" : operation === "cut" ? "Cut" : "Intersect"}
                </label>
              ))}
            </fieldset>
            <fieldset style={{ border: "none", padding: 0, margin: "8px 0" }}>
              <legend>Direction</legend>
              {(["normal", "reverse", "symmetric"] as const).map((direction) => (
                <label key={direction} style={{ display: "flex", gap: 6, margin: "4px 0", textTransform: "capitalize" }}>
                  <input
                    type="radio"
                    name="extrude-direction"
                    checked={extrudeForm.direction === direction}
                    onChange={() => setExtrudeForm({ ...extrudeForm, direction })}
                  />
                  {direction === "normal" ? "Normal" : direction === "reverse" ? "Reverse" : "Symmetric"}
                </label>
              ))}
            </fieldset>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="submit" disabled={extrudeForm.pending}>
                {extrudeForm.pending ? "Extruding…" : "Confirm extrude"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExtrudeForm(null);
                  groupRef.current?.focus();
                }}
              >
                Cancel
              </button>
            </div>
            {previewFigures ? (
              <div role="status" aria-label="Measurements" style={{ marginTop: 10 }}>
                <div className="measure-heading">Preview</div>
                <dl className="prop-rows">
                  <dt>Volume</dt>
                  <dd>
                    {previewFigures.volume === null
                      ? "—"
                      : display.volume(previewFigures.volume, props.member.units, props.member.precision)}
                  </dd>
                  <dt>Mass</dt>
                  <dd>
                    {previewFigures.mass === null
                      ? "—"
                      : display.mass(previewFigures.mass)}
                  </dd>
                </dl>
              </div>
            ) : null}
          </form>
        ) : null}
      </div>
    </>
  );
}

function LabeledNumber(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  id?: string;
  error?: string;
}): JSX.Element {
  const id = props.id ?? `field-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.error ? "true" : undefined}
        aria-describedby={props.error ? `${id}-error` : undefined}
      />
      {props.error ? (
        <div id={`${id}-error`} className="field-error">
          {props.error}
        </div>
      ) : null}
    </div>
  );
}

function entityPosition(entity: SketchEntity): { x: number; y: number } | null {
  switch (entity.type) {
    case "point":
      return { x: entity.x, y: entity.y };
    case "line":
      return { x: (entity.start.x + entity.end.x) / 2, y: (entity.start.y + entity.end.y) / 2 };
    case "circle":
    case "arc":
      return { x: entity.center.x, y: entity.center.y };
  }
}

function constraintMidpoint(
  sketch: Sketch,
  refs: string[]
): { x: number; y: number } | null {
  for (const ref of refs) {
    if (ref === "origin") return { x: 0, y: 0 };
    const entity = sketch.entities.find((e) => ref === e.id || ref.startsWith(`${e.id}.`));
    if (entity) {
      const position = entityPosition(entity);
      if (position) return position;
    }
  }
  return null;
}

function constraintLabel(kind: string, sketch: Sketch): string {
  const word = CONSTRAINTS.find((c) => c.kind === kind)?.label ?? kind;
  const count = sketch.constraints.filter((c) => c.kind === kind).length;
  return `${word} ${count + 1}`;
}

function toleranceTextOf(tolerance: { kind: string; plus_mm: number; minus_mm: number } | null): string {
  if (!tolerance) return "";
  if (tolerance.kind === "symmetric") return `±${tolerance.plus_mm}`;
  return `+${tolerance.plus_mm}/${tolerance.minus_mm}`;
}

function commandSlot(): HTMLElement {
  const existing = document.getElementById("command-strip-slot");
  if (existing) return existing;
  const slot = document.createElement("div");
  slot.id = "command-strip-slot";
  slot.className = "group";
  return slot;
}

function parseLengthLocal(text: string, units: "mm" | "in"): number | null {
  const trimmed = text.trim();
  const match = /^(-?[0-9]+(?:\.[0-9]*)?|-?\.[0-9]+)\s*(mm|in)?$/i.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  if (match[2]?.toLowerCase() === "in") return value * 25.4;
  if (units === "in" && match[2] === undefined) return value * 25.4;
  return value;
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: number,
  pan: { x: number; y: number }
): void {
  const px = window.devicePixelRatio > 1 ? 0.5 : 1;
  context.lineWidth = px;
  const step = 10 * zoom;
  const startX = pan.x % step;
  const startY = pan.y % step;
  let i = 0;
  for (let x = startX; x < width; x += step) {
    context.strokeStyle = i % 10 === 0 ? "rgba(160,150,130,0.38)" : "rgba(160,150,130,0.22)";
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
    i++;
  }
  i = 0;
  for (let y = startY; y < height; y += step) {
    context.strokeStyle = i % 10 === 0 ? "rgba(160,150,130,0.38)" : "rgba(160,150,130,0.22)";
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    i++;
  }
}

function drawSketch(
  context: CanvasRenderingContext2D,
  sketch: Sketch,
  zoom: number,
  pan: { x: number; y: number },
  selection: string[],
  ink: boolean,
  conflict: { ghostLabel: string; existingLabel: string } | null,
  width: number,
  height: number
): void {
  const toScreen = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: p.x * zoom + pan.x,
    y: -p.y * zoom + pan.y
  });
  context.lineCap = "round";
  const stroke = ink ? "#22252b" : "#1e56c8";
  for (const entity of sketch.entities) {
    const selected = selection.includes(entity.id);
    context.lineWidth = selected ? 4 : 2;
    if (selected) {
      context.strokeStyle = "#fbf8f0";
      const halo = 6;
      const screen = toScreen(entityPosition(entity) ?? { x: 0, y: 0 });
      context.beginPath();
      context.arc(screen.x, screen.y, halo + (selected ? 4 : 0), 0, Math.PI * 2);
      context.stroke();
    }
    context.strokeStyle = stroke;
    if (entity.type === "point") {
      const s = toScreen({ x: entity.x, y: entity.y });
      context.beginPath();
      context.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
      context.fill();
    } else if (entity.type === "line") {
      const a = toScreen(entity.start);
      const b = toScreen(entity.end);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    } else if (entity.type === "circle") {
      const c = toScreen(entity.center);
      context.beginPath();
      context.arc(c.x, c.y, entity.radius * zoom, 0, Math.PI * 2);
      context.stroke();
    } else if (entity.type === "arc") {
      const c = toScreen(entity.center);
      const start = (entity.start_angle_deg * Math.PI) / 180;
      let span = (entity.end_angle_deg - entity.start_angle_deg) % 360;
      if (span <= 0) span += 360;
      context.beginPath();
      context.arc(c.x, c.y, entity.radius * zoom, -start, -(start + (span * Math.PI) / 180), true);
      context.stroke();
    }
  }
  const origin = toScreen({ x: 0, y: 0 });
  context.strokeStyle = "#22252b";
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(origin.x - 7, origin.y);
  context.lineTo(origin.x + 7, origin.y);
  context.moveTo(origin.x, origin.y - 7);
  context.lineTo(origin.x, origin.y + 7);
  context.stroke();
  void conflict;
  void width;
  void height;
}

function drawRings(
  context: CanvasRenderingContext2D,
  sketch: Sketch,
  zoom: number,
  pan: { x: number; y: number },
  _slack: number
): void {
  const toScreen = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: p.x * zoom + pan.x,
    y: -p.y * zoom + pan.y
  });
  context.strokeStyle = "#1e56c8";
  context.lineWidth = 2;
  for (const point of sketch.points) {
    if (point.freedom <= 0) continue;
    const screen = toScreen({ x: point.x, y: point.y });
    context.beginPath();
    context.arc(screen.x, screen.y, point.freedom * 6, 0, Math.PI * 2);
    context.stroke();
  }
}
