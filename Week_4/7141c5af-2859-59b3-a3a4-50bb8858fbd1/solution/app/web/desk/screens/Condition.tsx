import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { copy } from "../../../server/domain/copy.ts";
import { chairSeed, chairSvg } from "../../shared/dots.ts";
import { announce } from "../lib/announce.ts";
import { api, ApiFailure, get, post } from "../lib/api.ts";
import { Dialog, focusables, useDialog } from "../lib/dialog.tsx";
import { DotImage } from "../lib/dotImage.tsx";
import { AsyncButton, Field, Problems, SelectField, useForm } from "../lib/forms.tsx";
import { useLive } from "../lib/live.ts";
import { Note } from "../lib/note.tsx";
import { BackToPiece, Empty, Heading, Loading, MainAction, MintTile } from "../lib/screen.tsx";
import type { ScreenProps } from "../routes.tsx";

const POPOVER_GAP = 12;
const KEY_STEP = 1;
const SHIFT_STEP = 10;

const KINDS = [
  { value: "tear", label: "Tear" },
  { value: "crack", label: "Crack" },
  { value: "stain", label: "Stain" },
  { value: "looseJoint", label: "Loose joint" },
  { value: "woodworm", label: "Woodworm" },
];

interface Pin {
  id: string;
  number: number;
  x: number;
  y: number;
  kind: string;
  note: string;
  signed: boolean;
}

interface ConditionData {
  title: string;
  pins: Pin[];
}

const percent = (value: number): string => value.toFixed(1);
const kindName = (kind: string): string => KINDS.find((item) => item.value === kind)?.label ?? kind;

function PinPopover({ pin, anchor, onClose, onRemoved }: { pin: Pin; anchor: HTMLElement; onClose: () => void; onRemoved: () => Promise<void> }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = panel.current as HTMLDivElement;
    const mark = anchor.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    const topLimit = (document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) + POPOVER_GAP;
    const bar = document.querySelector(".main-action");
    const fixedBar = bar instanceof HTMLElement && getComputedStyle(bar).position === "fixed";
    const bottomLimit = (fixedBar ? bar.getBoundingClientRect().top : innerHeight) - POPOVER_GAP;
    const below = mark.bottom + POPOVER_GAP;
    const top = below + box.height <= bottomLimit ? below : mark.top - POPOVER_GAP - box.height;
    const clampedTop = Math.max(topLimit, Math.min(top, bottomLimit - box.height));
    const left = Math.max(POPOVER_GAP, Math.min(mark.left + mark.width / 2 - box.width / 2, document.documentElement.clientWidth - box.width - POPOVER_GAP));
    node.style.top = `${clampedTop + scrollY}px`;
    node.style.left = `${left + scrollX}px`;
    focusables(node)[0]?.focus({ preventScroll: true });
  }, [pin.id]);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables(panel.current as HTMLDivElement);
    const edge = event.shiftKey ? items[0] : items.at(-1);
    if (document.activeElement === edge) {
      event.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div ref={panel} class="pin-popover" role="dialog" aria-label={`Pin ${pin.number}`} onKeyDown={onKey}>
      <h2 class="pin-popover-kind">{kindName(pin.kind)}</h2>
      <p class="pin-note">
        <Note text={pin.note} />
      </p>
      <AsyncButton
        label="Remove pin"
        onPress={async () => {
          try {
            await onRemoved();
          } catch (error) {
            announce(error instanceof ApiFailure ? error.message : copy("F-02"));
          }
        }}
      />
    </div>,
    document.getElementById("overlays") as HTMLElement,
  );
}

export function ConditionScreen({ id }: ScreenProps): JSX.Element {
  const live = useLive(async (): Promise<ConditionData> => {
    const [{ piece }, { pins }] = await Promise.all([get<{ piece: { title: string } }>(`/api/pieces/${id}`), get<{ pins: Pin[] }>(`/api/pieces/${id}/pins`)]);
    return { title: piece.title, pins };
  }, [id]);
  const dialog = useDialog("Pin");
  const form = useForm({ x: "", y: "", kind: "tear", note: "", signed: "" }, dialog);
  const add = useRef<HTMLButtonElement>(null);
  const map = useRef<HTMLDivElement>(null);
  const crosshair = useRef<HTMLButtonElement>(null);
  const [cross, setCross] = useState<{ x: number; y: number } | null>(null);
  const [stop, setStop] = useState<string | null>(null);
  const [openPin, setOpenPin] = useState<string | null>(null);
  const [focusNext, setFocusNext] = useState<string | null>(null);
  const closedByPress = useRef(false);

  const pins = live.data?.pins ?? [];
  const opened = pins.find((pin) => pin.id === openPin) ?? null;
  const stopId = pins.some((pin) => pin.id === stop) ? stop : pins[0]?.id;
  const pinNode = (pinId: string): HTMLElement | null => map.current?.querySelector<HTMLElement>(`[data-pin="${pinId}"]`) ?? null;

  useLayoutEffect(() => {
    if (cross) crosshair.current?.focus();
  }, [cross !== null]);

  useLayoutEffect(() => {
    if (focusNext === null) return;
    (focusNext === "add" ? add.current : pinNode(focusNext))?.focus();
    setFocusNext(null);
  }, [focusNext]);

  useEffect(() => {
    if (!openPin) return undefined;
    const outside = (event: PointerEvent): void => {
      const target = event.target as Element;
      if (target.closest(".pin-popover") || target.closest('[data-part="pin"]')) return;
      closedByPress.current = true;
      setOpenPin(null);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [openPin]);

  const place = (x: number, y: number): void => {
    setCross(null);
    form.clear();
    form.replace({ x: percent(x), y: percent(y), kind: "tear", note: "", signed: "" });
    dialog.show(add.current);
  };

  const onMapPress = (event: MouseEvent): void => {
    if (closedByPress.current) {
      closedByPress.current = false;
      return;
    }
    if ((event.target as Element).closest('[data-part="pin"],[data-part="crosshair"]')) return;
    const box = (map.current as HTMLDivElement).getBoundingClientRect();
    const share = (offset: number, size: number): number => Math.min(100, Math.max(0, Math.round((offset / size) * 1000) / 10));
    place(share(event.clientX - box.left, box.width), share(event.clientY - box.top, box.height));
  };

  const onCrossKey = (event: KeyboardEvent): void => {
    const step = event.shiftKey ? SHIFT_STEP : KEY_STEP;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = moves[event.key];
    if (delta) {
      event.preventDefault();
      setCross((old) => old && { x: Math.min(100, Math.max(0, old.x + delta[0])), y: Math.min(100, Math.max(0, old.y + delta[1])) });
    } else if (event.key === "Escape") {
      event.preventDefault();
      setCross(null);
      add.current?.focus();
    }
  };

  const onPinKey = (event: KeyboardEvent, index: number): void => {
    const delta = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = pins[(index + delta + pins.length) % pins.length] as Pin;
    setStop(next.id);
    pinNode(next.id)?.focus();
  };

  const closePopover = (): void => {
    if (openPin) pinNode(openPin)?.focus();
    setOpenPin(null);
  };

  const removePin = async (pin: Pin): Promise<void> => {
    await api("DELETE", `/api/pieces/${id}/pins/${pin.id}`);
    const left = pins.filter((item) => item.id !== pin.id);
    const next = pins[pins.indexOf(pin) + 1] ?? left[0];
    live.set({ title: live.data?.title ?? "", pins: left });
    setOpenPin(null);
    setFocusNext(next?.id ?? "add");
    announce(copy("F-23"));
  };

  const savePin = async (): Promise<void> => {
    const { x, y, kind, note, signed } = form.values;
    const saved = await form.submit(() => post(`/api/pieces/${id}/pins`, { x: Number(x), y: Number(y), kind, note, signed: signed === "true" }));
    if (!saved) return;
    dialog.done();
    announce(copy("F-22", { x, y }));
    void live.reload();
  };

  const data = live.data;
  if (!data) return <Loading height={480} />;
  return (
    <>
      <BackToPiece id={id} />
      <Heading text={`Condition of ${data.title}`}>
        <MainAction>
          <button
            ref={add}
            type="button"
            class="button button--primary"
            onClick={() => {
              setOpenPin(null);
              setCross({ x: 50, y: 50 });
            }}
          >
            Add a pin
          </button>
        </MainAction>
      </Heading>
      <div class="bento">
        <section class="tile t-large" aria-label="Drawing">
          <div ref={map} class="condition-map" role="group" aria-label="Condition map" data-part="condition-map" onClick={onMapPress}>
            <div class="condition-drawing">
              <DotImage drawing={chairSvg(chairSeed(data.title), { tone: "muted" })} />
            </div>
            {pins.map((pin, index) => (
              <button
                key={pin.id}
                type="button"
                class="pin"
                data-part="pin"
                data-pin={pin.id}
                data-x={percent(pin.x)}
                data-y={percent(pin.y)}
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                tabIndex={pin.id === stopId ? 0 : -1}
                aria-label={`Pin ${pin.number}: ${kindName(pin.kind)}`}
                aria-expanded={pin.id === openPin}
                onFocus={() => setStop(pin.id)}
                onKeyDown={(event) => onPinKey(event, index)}
                onClick={() => setOpenPin(pin.id)}
              >
                <span class="pin-mark">{pin.number}</span>
              </button>
            ))}
            {cross ? (
              <button
                ref={crosshair}
                type="button"
                class="crosshair"
                data-part="crosshair"
                data-x={percent(cross.x)}
                data-y={percent(cross.y)}
                style={{ left: `${cross.x}%`, top: `${cross.y}%` }}
                aria-label={`Place a pin at ${percent(cross.x)}, ${percent(cross.y)}`}
                onKeyDown={onCrossKey}
                onClick={() => place(cross.x, cross.y)}
              />
            ) : null}
          </div>
        </section>
        <div class="t-medium side-stack">
          <MintTile label="Pins" figure={String(pins.length)} size="" />
          <section class="tile" aria-label="Pin list">
            <h2>Pins</h2>
            {pins.length === 0 ? (
              <Empty text="No pins yet." />
            ) : (
              <ol class="pin-list">
                {pins.map((pin) => (
                  <li key={pin.id}>
                    <span class="pin-list-name">
                      {pin.number}. {kindName(pin.kind)}
                    </span>
                    <span class="pin-note">
                      <Note text={pin.note} />
                    </span>
                    <small class="pin-signed">{pin.signed ? "Signed" : "Not signed"}</small>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
      {opened ? <PinPopover pin={opened} anchor={pinNode(opened.id) as HTMLElement} onClose={closePopover} onRemoved={() => removePin(opened)} /> : null}
      <Dialog control={dialog} title="Pin">
        <Problems form={form} firstField="note" />
        <SelectField form={form} name="kind" label="Kind" choices={KINDS} />
        <Field form={form} name="note" label="Note" multiline />
        <label class="choice">
          <input type="checkbox" checked={form.values.signed === "true"} onChange={(event) => form.set("signed", event.currentTarget.checked ? "true" : "")} />
          Signed note
        </label>
        <AsyncButton label="Save pin" primary onPress={savePin} />
      </Dialog>
    </>
  );
}
