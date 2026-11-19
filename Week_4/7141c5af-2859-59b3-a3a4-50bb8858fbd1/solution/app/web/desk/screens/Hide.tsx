import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { PART_NAMES, PARTS, type PartName } from "../../../server/domain/placement.ts";
import { hideSvg } from "../../shared/dots.ts";
import { announce } from "../lib/announce.ts";
import { ApiFailure, api, get, post } from "../lib/api.ts";
import { Dialog, useDialog } from "../lib/dialog.tsx";
import { AsyncButton, Problems, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { isPhone } from "../lib/motion.ts";
import { BackToPiece, Heading, Loading, MainAction } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";
import { HideFigure } from "./hide/Figure.tsx";
import { boxOrigin, type Cause, durationOf, frameClip, liftMotion, moveTo, type View } from "./hide/stage.ts";

interface Flaw {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutPiece {
  name: PartName;
  x: number | null;
  y: number | null;
  rotation: number;
  state: "tray" | "placed";
}

interface Layout {
  version: number;
  hide: { widthCm: number; heightCm: number; areaSqFt: string };
  flaws: Flaw[];
  pieces: LayoutPiece[];
  usedSqFt: string;
  usedPercent: string;
  changedAt: string;
}

interface Lift {
  name: PartName;
  x: number;
  y: number;
  rotation: number;
  /** The version read when it was lifted; null after a 412, when the next try reads the newest. */
  version: number | null;
  home: LayoutPiece;
}

type Answer = { layout: Layout };

const GRAIN_ROTATIONS = (name: PartName): readonly number[] => PARTS[name].rotations;

function nextRotation(name: PartName, rotation: number): number {
  const rotations = GRAIN_ROTATIONS(name);
  return rotations[(rotations.indexOf(rotation) + 1) % rotations.length] as number;
}

function viewOf(piece: LayoutPiece, lift: Lift | null): View {
  if (lift?.name === piece.name) return { name: piece.name, state: "lifted", x: lift.x, y: lift.y, rotation: lift.rotation };
  return { name: piece.name, state: piece.state, x: piece.x, y: piece.y, rotation: piece.rotation };
}

function positionKey(view: View): string {
  return `${view.state === "tray" ? "tray" : `${view.x},${view.y}`}:${view.rotation}`;
}

function describe(view: View): string {
  if (view.state === "tray") return `${view.name}, in the tray`;
  return `${view.name}, ${view.state} at ${view.x}, ${view.y} cm, turned ${view.rotation}`;
}

/** A piece stepped past the fold brings the page with it. */
function keepInView(top: number, height: number): void {
  const above = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
  const bar = document.querySelector<HTMLElement>(".main-action");
  const below = bar && getComputedStyle(bar).position === "fixed" ? bar.getBoundingClientRect().top : innerHeight;
  if (top < above) scrollBy({ top: top - above - 8, behavior: "instant" });
  else if (top + height > below) scrollBy({ top: top + height - below + 8, behavior: "instant" });
}

function PatternPiece({ view, chosen, onPress }: { view: View; chosen: boolean; onPress: (event: PointerEvent, name: PartName) => void }): JSX.Element {
  const { width, height } = PARTS[view.name];
  const placedAt = view.x === null ? {} : { "data-x": String(view.x), "data-y": String(view.y) };
  return (
    <div
      id={`piece-${view.name.replace(" ", "-")}`}
      class="pattern-piece"
      role="img"
      aria-label={describe(view)}
      data-part="pattern-piece"
      data-piece={view.name}
      data-rotation={String(view.rotation)}
      data-state={view.state}
      data-chosen={chosen ? "true" : undefined}
      style={{ width: `calc(${width} * var(--cm))`, height: `calc(${height} * var(--cm))` }}
      onPointerDown={(event) => onPress(event, view.name)}
      {...placedAt}
    >
      <span class="piece-face" aria-hidden="true">
        <span class="piece-name" style={{ rotate: view.rotation >= 180 ? "-180deg" : "0deg" }}>
          {view.name}
        </span>
      </span>
    </div>
  );
}

function ClearDialog({ control, onClear }: { control: ReturnType<typeof useDialog>; onClear: () => Promise<void> }): JSX.Element {
  const form = useForm({ clear: "" });
  return (
    <Dialog control={control} title="Clear the hide">
      <Problems form={form} firstField="clear" />
      <p>Every piece goes back to the tray.</p>
      <AsyncButton
        id={form.ids.clear}
        label="Clear"
        primary
        onPress={async () => {
          if (!(await form.submit(onClear))) return;
          control.done();
          announce(copy("F-106"));
        }}
      />
    </Dialog>
  );
}

interface Drag {
  grabX: number;
  grabY: number;
}

export function HideScreen({ id }: ScreenProps): JSX.Element {
  const piece = useLive(() => get<{ piece: { title: string } }>(`/api/pieces/${id}`), [id]);
  const layout = useLive(() => get<Answer>(`/api/pieces/${id}/layout`), [id]);
  const clear = useDialog("Clear the hide");
  const [lift, setLiftState] = useState<Lift | null>(null);
  const [chosen, setChosen] = useState<PartName>("Seat");
  const liftRef = useRef<Lift | null>(null);
  const placing = useRef(false);
  const drag = useRef<Drag | null>(null);
  const causes = useRef(new Map<PartName, Cause>());
  const applied = useRef(new Map<PartName, string>());
  const degrees = useRef(new Map<PartName, number>());
  const stage = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const current = layout.data?.layout;
  const currentRef = useRef(current);
  currentRef.current = current;

  const setLift = useCallback((next: Lift | null) => {
    liftRef.current = next;
    setLiftState(next);
  }, []);

  /** Lays every piece out for the hide's present size; a piece whose place changed moves by its cause. */
  const arrange = useCallback(() => {
    const root = stage.current;
    const hide = surface.current;
    const shown = currentRef.current;
    if (!root || !hide || !shown) return;
    const box = hide.getBoundingClientRect();
    const perCm = box.width / shown.hide.widthCm;
    root.style.setProperty("--cm", `${perCm}px`);
    for (const piece of shown.pieces) {
      const view = viewOf(piece, liftRef.current);
      const element = hide.querySelector<HTMLElement>(`[data-piece="${view.name}"]`);
      if (!element) continue;
      const key = positionKey(view);
      const first = !applied.current.has(view.name);
      const changed = !first && applied.current.get(view.name) !== key;
      const cause = causes.current.get(view.name);
      causes.current.delete(view.name);
      const slot = root.querySelector<HTMLElement>(`[data-slot="${view.name}"]`);
      let to = { left: 0, top: 0 };
      if (view.state === "tray") {
        const rect = slot?.getBoundingClientRect();
        if (rect) to = { left: rect.left - box.left, top: rect.top - box.top };
      } else to = boxOrigin(view, perCm);
      const previous = degrees.current.get(view.name) ?? view.rotation;
      const turn = (((view.rotation - previous) % 360) + 360) % 360;
      const degree = first ? view.rotation : previous + turn;
      degrees.current.set(view.name, degree);
      element.style.clipPath = frameClip(view, perCm, shown.hide.widthCm, shown.hide.heightCm);
      if (first || changed) moveTo(element, to, degree, first ? 0 : durationOf(cause));
      if (cause === "step") keepInView(box.top + to.top, PARTS[view.name].height * perCm);
      else if (element.getAnimations().length === 0) moveTo(element, to, degree, 0);
      applied.current.set(view.name, key);
    }
  }, []);

  useLayoutEffect(arrange);

  useEffect(() => {
    const root = stage.current;
    if (!root) return undefined;
    const watcher = new ResizeObserver(() => arrange());
    watcher.observe(root);
    return () => watcher.disconnect();
  }, [current !== undefined && piece.data !== undefined]);

  const pieceRow = (name: PartName): LayoutPiece => currentRef.current?.pieces.find((each) => each.name === name) as LayoutPiece;

  const liftPiece = (name: PartName, at?: { x: number; y: number }): void => {
    const shown = currentRef.current;
    if (!shown || liftRef.current) return;
    const home = pieceRow(name);
    causes.current.set(name, at ? "follow" : "glide");
    setLift({ name, x: at?.x ?? home.x ?? 0, y: at?.y ?? home.y ?? 0, rotation: home.rotation, version: shown.version, home });
    const element = surface.current?.querySelector<HTMLElement>(`[data-piece="${name}"]`);
    if (element) liftMotion(element);
    announce(copy("F-42", { part: name }));
  };

  const step = (dx: number, dy: number): void => {
    const held = liftRef.current;
    if (!held || placing.current) return;
    causes.current.set(held.name, "step");
    setLift({ ...held, x: held.x + dx, y: held.y + dy });
  };

  const rotate = (): void => {
    const held = liftRef.current;
    if (!held || placing.current) return;
    causes.current.set(held.name, "turn");
    setLift({ ...held, rotation: nextRotation(held.name, held.rotation) });
  };

  const putBack = (): void => {
    const held = liftRef.current;
    if (!held || placing.current) return;
    causes.current.set(held.name, "glide");
    drag.current = null;
    setLift(null);
    announce(copy("F-44", { part: held.name }));
  };

  /** A write under the lift's version; a 412 keeps the piece lifted, and the next try reads the newest version. */
  const write = async (held: Lift, send: (version: number) => Promise<Answer>): Promise<boolean> => {
    placing.current = true;
    try {
      const version = held.version ?? (await get<Answer>(`/api/pieces/${id}/layout`)).layout.version;
      const answer = await send(version);
      placing.current = false;
      setLift(null);
      layout.set(answer);
      return true;
    } catch (error) {
      placing.current = false;
      if (error instanceof ApiFailure && error.status === 412) {
        const now = liftRef.current;
        if (now) setLift({ ...now, version: null });
        void layout.reload().catch(() => undefined);
      }
      throw error;
    }
  };

  const refusal = (error: unknown): string => (error instanceof ApiFailure ? error.message : copy("F-02"));

  const place = async (fromDrop = false): Promise<void> => {
    const held = liftRef.current;
    if (!held || placing.current) return;
    const path = `/api/pieces/${id}/layout/placements/${encodeURIComponent(held.name)}`;
    try {
      causes.current.set(held.name, "still");
      await write(held, (version) => api<Answer>("PUT", path, { x: held.x, y: held.y, rotation: held.rotation, version }));
      announce(copy("F-45", { part: held.name, x: held.x, y: held.y }));
    } catch (error) {
      if (fromDrop && error instanceof ApiFailure && error.status === 422) {
        causes.current.set(held.name, "glide");
        setLift(null);
      }
      announce(refusal(error));
    }
  };

  const toTray = async (): Promise<void> => {
    const held = liftRef.current;
    if (!held || placing.current) return;
    causes.current.set(held.name, "glide");
    if (held.home.state === "tray") {
      setLift(null);
      announce(copy("F-43", { part: held.name }));
      return;
    }
    const path = (version: number): string => `/api/pieces/${id}/layout/placements/${encodeURIComponent(held.name)}?version=${version}`;
    try {
      await write(held, (version) => api<Answer>("DELETE", path(version)));
      announce(copy("F-43", { part: held.name }));
    } catch (error) {
      causes.current.delete(held.name);
      announce(refusal(error));
    }
  };

  const choose = (offset: number): void => {
    const at = PART_NAMES.indexOf(chosen);
    setChosen(PART_NAMES[(at + offset + PART_NAMES.length) % PART_NAMES.length] as PartName);
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const size = event.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-size, 0], ArrowRight: [size, 0], ArrowUp: [0, -size], ArrowDown: [0, size] };
    const move = moves[event.key];
    const held = liftRef.current;
    if (move) {
      if (held) step(...move);
      else choose(move[0] + move[1] > 0 ? 1 : -1);
    } else if (event.key === "Enter") {
      if (held) void place();
      else liftPiece(chosen);
    } else if (event.key === "Escape" && held) {
      event.stopPropagation();
      putBack();
    } else if ((event.key === "r" || event.key === "R") && held) rotate();
    else if (event.key === "Delete" && held) void toTray();
    else return;
    event.preventDefault();
  };

  const pointerCm = (event: PointerEvent): { x: number; y: number } => {
    const box = (surface.current as HTMLElement).getBoundingClientRect();
    const perCm = box.width / (currentRef.current as Layout).hide.widthCm;
    const grip = drag.current as Drag;
    return { x: Math.round((event.clientX - box.left - grip.grabX) / perCm), y: Math.round((event.clientY - box.top - grip.grabY) / perCm) };
  };

  const onPiecePress = (event: PointerEvent, name: PartName): void => {
    if (event.pointerType !== "mouse" || event.button !== 0 || isPhone() || placing.current) return;
    const held = liftRef.current;
    if (held && held.name !== name) return;
    event.preventDefault();
    surface.current?.focus({ preventScroll: true });
    setChosen(name);
    const face = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const within = (at: number, size: number): number => Math.min(Math.max(at, 0), size);
    drag.current = { grabX: within(event.clientX - face.left, face.width), grabY: within(event.clientY - face.top, face.height) };
    if (held) return;
    liftPiece(name, pointerCm(event));
  };

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const held = liftRef.current;
      if (!drag.current || !held) return;
      const { x, y } = pointerCm(event);
      if (x === held.x && y === held.y) return;
      causes.current.set(held.name, "follow");
      setLift({ ...held, x, y });
    };
    const onUp = (): void => {
      if (!drag.current) return;
      drag.current = null;
      void place(true);
    };
    addEventListener("pointermove", onMove);
    addEventListener("pointerup", onUp);
    return () => {
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerup", onUp);
    };
  });

  const title = piece.data?.piece.title;
  // The heading and the stage arrive together: a heading landing above shown tiles would push them down.
  if (!current || title === undefined) {
    return (
      <div key="wait" class="bento hide-wait">
        <Loading size="t-large" height={560} />
        <Loading size="t-medium" height={560} />
      </div>
    );
  }
  const heading = (
    <>
      <BackToPiece id={id} />
      <Heading text={`Hide for ${title}`} />
    </>
  );

  const barButton = (label: string, action: () => void): JSX.Element => (
    <button key={label} type="button" class="button" onClick={action}>
      {label}
    </button>
  );

  return (
    <>
      {heading}
      <div class="hide-stage bento" ref={stage}>
        <section class="tile t-large hide-tile" aria-label="Hide tile">
          <div
            ref={surface}
            class="hide-surface"
            data-part="hide"
            role="application"
            aria-label="Hide"
            aria-activedescendant={`piece-${chosen.replace(" ", "-")}`}
            tabIndex={0}
            onKeyDown={onKey}
          >
            <div class="hide-ground" aria-hidden="true" dangerouslySetInnerHTML={{ __html: hideSvg(id) }} />
            {current.flaws.map((flaw) => (
              <div
                key={`${flaw.x}-${flaw.y}`}
                class="hide-flaw"
                data-part="flaw"
                data-x={String(flaw.x)}
                data-y={String(flaw.y)}
                data-width={String(flaw.width)}
                data-height={String(flaw.height)}
                style={{ left: `calc(${flaw.x} * var(--cm))`, top: `calc(${flaw.y} * var(--cm))`, width: `calc(${flaw.width} * var(--cm))`, height: `calc(${flaw.height} * var(--cm))` }}
              />
            ))}
            {current.pieces.map((row) => (
              <PatternPiece key={row.name} view={viewOf(row, lift)} chosen={row.name === chosen} onPress={onPiecePress} />
            ))}
          </div>
        </section>
        <div class="hide-side">
          <section class="tile tile--mint" aria-label="Used leather">
            <HideFigure used={current.usedSqFt} percent={current.usedPercent} />
          </section>
          <div class="tile">
            <button type="button" class="button" onClick={(event) => clear.show(event.currentTarget)}>
              Clear the hide
            </button>
          </div>
          <section class="tile" role="region" aria-label="Tray">
            <h2>Tray</h2>
            <ul class="tray-slots">
              {PART_NAMES.map((name) => (
                <li key={name}>
                  <div class="tray-slot" data-slot={name} style={{ width: `calc(${PARTS[name].width} * var(--cm))`, height: `calc(${PARTS[name].height} * var(--cm))` }} />
                  <small class="muted">
                    {name}, {PARTS[name].width} x {PARTS[name].height} cm
                  </small>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <MainAction name="Hide controls">
        <div class="hide-bar-row">
          {PART_NAMES.map((name) => (
            <button key={name} type="button" class="button" aria-pressed={name === chosen ? "true" : "false"} onClick={() => !liftRef.current && setChosen(name)}>
              {name}
            </button>
          ))}
        </div>
        <div class="hide-bar-row">
          {barButton("Lift", () => liftPiece(chosen))}
          {barButton("Up", () => step(0, -1))}
          {barButton("Down", () => step(0, 1))}
          {barButton("Left", () => step(-1, 0))}
          {barButton("Right", () => step(1, 0))}
        </div>
        <div class="hide-bar-row">
          {barButton("Rotate", rotate)}
          <AsyncButton label="Place" onPress={() => place()} />
          {barButton("Put back", putBack)}
          <AsyncButton label="To tray" onPress={toTray} />
        </div>
      </MainAction>
      <ClearDialog
        control={clear}
        onClear={async () => {
          const version = (currentRef.current as Layout).version;
          const held = liftRef.current;
          if (held) causes.current.set(held.name, "glide");
          const answer = await post<Answer>(`/api/pieces/${id}/layout`, { version, placements: [] });
          setLift(null);
          layout.set(answer);
        }}
      />
    </>
  );
}
