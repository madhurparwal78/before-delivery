/** The stock shelf: every roll and offcut as a card, the on-hand summary, receiving a roll, shelf counts and edits. */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAll, getJson, sendJson } from "../api.js";
import { useLive } from "../live.js";
import { play } from "../motion.js";
import { Link } from "../router.js";
import { Dialog, DialogForm, SelectField, TextField, UnitPair, useCollection, useDialog, useLoad, useSubmitter, type Collection } from "../ui.js";
import { PageHeading } from "./chrome.js";
import { PENDING, SUCCESS } from "../../shared/copy.js";
import { areaParts, grouped, lengthParts } from "../../shared/units.js";
import type { Cloth, Stock, StockSummary } from "../../shared/types.js";

function ReceiveRoll({ cloths, onReceived }: { cloths: Collection<Cloth>; onReceived: (code: string) => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const options = cloths.items.map((cloth) => ({ value: cloth.code, label: `${cloth.code} · ${cloth.name}` }));
  const [cloth, setCloth] = useState("");
  const [lot, setLot] = useState("");
  const [length, setLength] = useState("");
  const [shelf, setShelf] = useState("");
  const save = () =>
    form.run(async () => {
      const { data } = await sendJson<Stock>("POST", "/api/rolls", {
        cloth_code: cloth || options[0]?.value,
        lot,
        length_mm: length.trim() === "" ? undefined : Number(length),
        shelf_location: shelf,
      });
      say(SUCCESS.receive(data.code));
      await onReceived(data.code);
      close(false);
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Receive" busy={form.busy}>
      <SelectField label="Cloth" value={cloth || options[0]?.value || ""} onChange={setCloth} options={options} error={form.errors.cloth_code} />
      <TextField label="Lot" value={lot} onChange={setLot} error={form.errors.lot} />
      <TextField label="Length (mm)" value={length} onChange={setLength} error={form.errors.length_mm} inputMode="numeric" />
      <TextField label="Shelf location" value={shelf} onChange={setShelf} error={form.errors.shelf_location} />
    </DialogForm>
  );
}

function CountDialog({ stock, onDone }: { stock: Stock; onDone: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("");
  const save = () =>
    form.run(async () => {
      const { data } = await sendJson<Stock>("POST", `/api/stock/${stock.code}/counts`, {
        counted_length_mm: counted.trim() === "" ? undefined : Number(counted),
        reason,
      });
      const difference = data.on_hand_mm2 - stock.on_hand_mm2;
      say(difference === 0 ? SUCCESS.countMatches : SUCCESS.countAdjusted(`${difference > 0 ? "+" : "-"}${grouped(Math.abs(difference))}`));
      close(true);
      await onDone();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Record count" busy={form.busy}>
      <TextField label="Counted length (mm)" value={counted} onChange={setCounted} error={form.errors.counted_length_mm} inputMode="numeric" />
      <TextField label="Reason" value={reason} onChange={setReason} error={form.errors.reason} />
    </DialogForm>
  );
}

function EditDialog({ stock, onDone }: { stock: Stock; onDone: () => Promise<void> }) {
  const { close } = useDialog();
  const { say } = useLive();
  const form = useSubmitter();
  const [shelf, setShelf] = useState(stock.shelf_location);
  const [note, setNote] = useState(stock.note);
  const save = () =>
    form.run(async () => {
      await sendJson<Stock>("PATCH", `/api/stock/${stock.code}`, { shelf_location: shelf, note }, { "if-match": `"${stock.revision}"` });
      say(SUCCESS.saved);
      close(true);
      await onDone();
    }, PENDING.save);
  return (
    <DialogForm onSubmit={() => void save()} submit="Save stock" busy={form.busy}>
      <TextField label="Shelf location" value={shelf} onChange={setShelf} error={form.errors.shelf_location} />
      <TextField label="Note" value={note} onChange={setNote} error={form.errors.note} />
    </DialogForm>
  );
}

/** Cards keep their identity: one that moves travels to its new place; the others just close up or open the gap. */
function useShelfMotion(list: React.RefObject<HTMLUListElement | null>, order: string): void {
  const rects = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const container = list.current;
    if (!container) return;
    const next = new Map<string, DOMRect>();
    for (const item of container.querySelectorAll<HTMLElement>("li[data-code]")) {
      const code = item.dataset.code!;
      const rect = item.getBoundingClientRect();
      next.set(code, rect);
      const before = rects.current.get(code);
      if (before && (before.x !== rect.x || before.y !== rect.y)) {
        play(item, [{ transform: `translate(${before.x - rect.x}px, ${before.y - rect.y}px)` }, { transform: "translate(0px, 0px)" }], 320, { fill: "backwards" });
      }
    }
    rects.current = next;
  }, [list, order]);
}

export function StockPage() {
  const stock = useLoad(() => getAll<Stock>("/api/stock"), []);
  const cloths = useCollection<Cloth>("/api/cloths", 1);
  const summary = useLoad((signal) => getJson<StockSummary>("/api/stock/summary", signal), []);
  const [dialog, setDialog] = useState<{ kind: "receive" } | { kind: "count" | "edit"; code: string } | null>(null);
  const [focusCode, setFocusCode] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const received = useRef<string | null>(null);
  const cards = useMemo(() => [...(stock.data ?? [])].sort((a, b) => a.on_hand_mm2 - b.on_hand_mm2 || a.code.localeCompare(b.code, undefined, { numeric: true })), [stock.data]);
  useShelfMotion(list, cards.map((card) => `${card.code}:${card.on_hand_mm2}`).join("|"));

  const refresh = async () => {
    await Promise.all([stock.reload(), summary.reload()]);
  };

  useLayoutEffect(() => {
    if (!focusCode) return;
    const button = list.current?.querySelector<HTMLButtonElement>(`button[data-count="${focusCode}"]`);
    if (button) {
      button.focus();
      setFocusCode(null);
    }
  }, [focusCode, cards]);

  const selected = dialog && dialog.kind !== "receive" ? (stock.data ?? []).find((item) => item.code === dialog.code) : undefined;

  return (
    <main className="page">
      <section className="field-ground">
        <div className="section-head">
          <PageHeading>Stock shelf</PageHeading>
          <button type="button" className="button" onClick={() => setDialog({ kind: "receive" })}>
            Receive roll
          </button>
        </div>
      </section>
      <section role="region" aria-label="Stock on hand" className="field-cobalt poster-section">
        <p className="poster-label">Stock on hand</p>
        <p className="poster">{summary.data ? <UnitPair parts={areaParts(summary.data.on_hand_mm2)} stacked /> : ""}</p>
        <p className="figures-line">{summary.data ? `${summary.data.rolls} rolls · ${summary.data.offcuts} offcuts` : ""}</p>
      </section>
      {cards.length === 0 ? null : (
      <ul aria-label="Rolls and offcuts" className="card-grid shelf-grid" ref={list}>
        {cards.map((card) => (
          <li key={card.code} className="card" data-code={card.code}>
            <Link to={`/ledger?stock=${card.code}`} className="card-link">
              {card.code}
            </Link>
            <p className="card-figure"><UnitPair parts={lengthParts(card.remaining_mm)} stacked /></p>
            <p><UnitPair parts={areaParts(card.on_hand_mm2)} /></p>
            <p className="muted">{`${card.kind === "roll" ? "Roll" : "Offcut"} · ${card.cloth_code} · lot ${card.lot}`}</p>
            <p className="muted">{card.shelf_location}</p>
            <div className="card-actions">
              <button type="button" className="button" data-count={card.code} onClick={() => setDialog({ kind: "count", code: card.code })}>
                {`Count ${card.code}`}
              </button>
              <button type="button" className="button" onClick={() => setDialog({ kind: "edit", code: card.code })}>
                {`Edit ${card.code}`}
              </button>
            </div>
          </li>
        ))}
      </ul>
      )}
      {dialog?.kind === "receive" && cloths.ready ? (
        <Dialog
          title="Receive roll"
          onClose={() => {
            setDialog(null);
            setFocusCode(received.current);
            received.current = null;
          }}
        >
          <ReceiveRoll
            cloths={cloths}
            onReceived={async (code) => {
              await refresh();
              received.current = code;
            }}
          />
        </Dialog>
      ) : null}
      {dialog?.kind === "count" && selected ? (
        <Dialog title="Shelf count" onClose={() => setDialog(null)}>
          <CountDialog stock={selected} onDone={refresh} />
        </Dialog>
      ) : null}
      {dialog?.kind === "edit" && selected ? (
        <Dialog title={`Edit ${selected.code}`} onClose={() => setDialog(null)}>
          <EditDialog stock={selected} onDone={refresh} />
        </Dialog>
      ) : null}
    </main>
  );
}
