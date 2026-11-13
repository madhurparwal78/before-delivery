import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { api, RetryKey } from "../api.ts";
import { useDecimals, useFeedback, useLive, useNav, useSession } from "../state.tsx";
import { ActionButton, amountCopy, amountError, Field, Fig, Mono, Select, typedAmount, useAction, widestDecimals } from "../ui.tsx";
import type { Position, Settlement } from "../types.ts";
import { StateLabel } from "./parts.tsx";
import { ShockRuler } from "./ShockRuler.tsx";
import { displayAmount, displayHealth } from "../../shared/format.ts";
import { useChosenAsset } from "./chosen-asset.ts";

const EMPTY = "No positions are below health factor 1.";
const DIALOG_MS = 180;
const COLUMNS = ["Position", "Borrower", "Health factor", "State", "Debt", "Collateral", "Max repay", "Round", "Action"] as const;
const ACTION_COLUMN = COLUMNS.length - 1;

function cellId(positionId: string, column: number): string {
  return `queue-${positionId}-${column}`;
}

/** The Liquidate button of a row: the grid's Action cell. */
function openerId(positionId: string): string {
  return cellId(positionId, ACTION_COLUMN);
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("input, button, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter(
    (e) => e.getAttribute("aria-disabled") !== "true" && !e.hasAttribute("disabled") && e.getAttribute("role") !== "menuitem",
  );
}

function LiquidateDialog({ position, onClose }: { position: Position; onClose: (focusOpener: boolean) => void }) {
  const decimalsOf = useDecimals();
  const { navigate } = useNav();
  const feedback = useFeedback();
  const debtDecimals = decimalsOf(position.debt_asset);
  const [typed, setTyped] = useState(displayAmount(position.max_repay, debtDecimals));
  const [closing, setClosing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const key = useRef(new RetryKey());
  const { busy, errors, run, showFieldErrors } = useAction(useMemo(() => ({ repay_amount: { id: "liquidation-repay", label: "Repay amount" } }), []));

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (menuOpen) firstItem.current?.focus();
  }, [menuOpen]);

  function close() {
    if (closing) return;
    setClosing(true);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => onClose(true), reduced ? 0 : DIALOG_MS);
  }

  function closeMenu() {
    setMenuOpen(false);
    options.current?.focus();
  }

  function choose(divisor: bigint) {
    // Half of max repay is rounded down to a whole minor unit.
    setTyped(displayAmount(BigInt(position.max_repay) / divisor, debtDecimals));
    closeMenu();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (menuOpen) closeMenu();
      else close();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const tabbable = focusables(panel.current);
    const first = tabbable[0];
    const last = tabbable[tabbable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = items.current.findIndex((item) => item === document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    items.current[(at + step + items.current.length) % items.current.length]?.focus();
  }

  async function submitFill() {
    const amount = typedAmount(typed, debtDecimals);
    if ("error" in amount) {
      showFieldErrors({ repay_amount: amount.error });
      return;
    }
    const body = { repay_amount: amount.minor, round: position.round };
    const idempotencyKey = key.current.forBody({ position: position.position_id, ...body });
    const settlement = await run("liquidate", {
      pending: "Submitting liquidation",
      call: () => api<Settlement>("POST", `/api/positions/${encodeURIComponent(position.position_id)}/liquidations`, body, idempotencyKey),
      done: (s) => ({
        text: `Liquidation filled. Repaid ${amountCopy(s.repaid ?? s.amount, debtDecimals, position.debt_asset)}, received ${amountCopy(s.seized ?? "0", decimalsOf(position.collateral_asset), position.collateral_asset)}.`,
      }),
      // A conflict ends this attempt: the dialog closes and the queue shows the new round.
      failed: (failure) => {
        if (failure.kind === "error" && failure.status < 500) onClose(true);
      },
    });
    if (settlement) {
      onClose(false);
      navigate(`/settlements/${settlement.settlement_id}`);
    }
  }

  return (
    <div className={`dialog-backdrop${closing ? " is-closing" : ""}`}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="liquidate-title" className="dialog" onKeyDown={onKeyDown}>
        <h2 id="liquidate-title">Liquidate position</h2>
        <p className="dialog-lede">
          <Mono>{position.position_id}</Mono> · round <Mono>{position.round}</Mono> · max repay{" "}
          <Fig minor={position.max_repay} decimals={debtDecimals} asset={position.debt_asset} />
        </p>
        <Field
          id="liquidation-repay"
          label="Repay amount"
          value={typed}
          onChange={setTyped}
          error={errors["liquidation-repay"] ?? amountError(typed, debtDecimals)}
          inputRef={input}
          onEnter={() => void submitFill()}
        />
        <div className="menu-anchor">
          <button
            type="button"
            ref={options}
            className="btn btn-quiet"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
          >
            Repay options
          </button>
          {menuOpen ? (
            <div role="menu" aria-label="Repay options" className="menu" onKeyDown={onMenuKeyDown}>
              <button type="button" role="menuitem" ref={(node) => { firstItem.current = node; items.current[0] = node; }} className="menu-item" onClick={() => choose(1n)}>
                Use max repay
              </button>
              <button type="button" role="menuitem" ref={(node) => { items.current[1] = node; }} className="menu-item" onClick={() => choose(2n)}>
                Use half of max repay
              </button>
            </div>
          ) : null}
        </div>
        {feedback.problem && "text" in feedback.problem ? <p className="dialog-problem">{feedback.problem.text}</p> : null}
        <div className="actions">
          <ActionButton tone="signal" busy={busy !== null} onClick={() => void submitFill()}>
            Confirm liquidation
          </ActionButton>
          <ActionButton tone="quiet" onClick={close}>
            Cancel
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

/** Where the roving tab stop sits: a position's row and a column. */
interface Cursor {
  positionId: string;
  column: number;
}

function QueueGrid({ queue, onOpen }: { queue: Position[]; onOpen: (position: Position) => void }) {
  const decimalsOf = useDecimals();
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const grid = useRef<HTMLTableElement>(null);
  // Whether focus was in the grid when it last moved; a focused row that leaves the queue takes it away silently.
  const focusInGrid = useRef(false);
  const debtPad = widestDecimals(queue.map((p) => p.debt_asset), decimalsOf);
  const collateralPad = widestDecimals(queue.map((p) => p.collateral_asset), decimalsOf);
  const first = queue[0];
  const current: Cursor | null = cursor && queue.some((p) => p.position_id === cursor.positionId) ? cursor : first ? { positionId: first.position_id, column: 0 } : null;

  // When the queue refreshes, focus stays on the same position's cell if it is still listed; otherwise it moves to
  // the first cell.
  useEffect(() => {
    if (!cursor || !first || queue.some((p) => p.position_id === cursor.positionId)) return;
    setCursor({ positionId: first.position_id, column: 0 });
    if (focusInGrid.current) document.getElementById(cellId(first.position_id, 0))?.focus();
  }, [queue, cursor, first]);

  function move(next: Cursor) {
    setCursor(next);
    document.getElementById(cellId(next.positionId, next.column))?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, row: number, column: number) {
    const last = queue.length - 1;
    const at = (r: number, c: number) => {
      const target = queue[Math.max(0, Math.min(last, r))];
      return target ? { positionId: target.position_id, column: Math.max(0, Math.min(ACTION_COLUMN, c)) } : null;
    };
    let next: Cursor | null = null;
    if (event.key === "ArrowRight") next = at(row, column + 1);
    else if (event.key === "ArrowLeft") next = at(row, column - 1);
    else if (event.key === "ArrowDown") next = at(row + 1, column);
    else if (event.key === "ArrowUp") next = at(row - 1, column);
    else if (event.key === "Home") next = event.ctrlKey ? at(0, 0) : at(row, 0);
    else if (event.key === "End") next = event.ctrlKey ? at(last, ACTION_COLUMN) : at(row, ACTION_COLUMN);
    if (!next) return;
    event.preventDefault();
    move(next);
  }

  const stop = (positionId: string, column: number) => (current?.positionId === positionId && current.column === column ? 0 : -1);
  return (
    <table
      aria-label="Liquidation queue"
      role="grid"
      className="ledger-table queue-table"
      ref={grid}
      onFocus={() => {
        focusInGrid.current = true;
      }}
      onBlur={(event) => {
        if (event.relatedTarget !== null && !grid.current?.contains(event.relatedTarget as Node)) focusInGrid.current = false;
      }}
    >
      <thead role="rowgroup">
        <tr role="row">
          {COLUMNS.map((h) => (
            <th key={h} role="columnheader" scope="col" className={["Debt", "Collateral", "Max repay", "Health factor", "Round"].includes(h) ? "num" : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup">
        {queue.map((p, row) => {
          const cellProps = (column: number) => ({
            role: "gridcell" as const,
            id: cellId(p.position_id, column),
            tabIndex: stop(p.position_id, column),
            onFocus: () => setCursor({ positionId: p.position_id, column }),
            onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, row, column),
          });
          return (
            <tr key={p.position_id} role="row" className="row-signal">
              <td {...cellProps(0)} data-label="Position">
                <Mono>{p.position_id}</Mono>
              </td>
              <td {...cellProps(1)} data-label="Borrower">
                <Mono>{p.borrower_id}</Mono>
              </td>
              <td {...cellProps(2)} data-label="Health factor" className="num">
                <Mono className="signal-figure">{displayHealth(p.health_factor)}</Mono>
              </td>
              <td {...cellProps(3)} data-label="State">
                <StateLabel state={p.state} />
              </td>
              <td {...cellProps(4)} data-label="Debt" className="num">
                <Fig minor={p.debt} decimals={decimalsOf(p.debt_asset)} asset={p.debt_asset} pad={debtPad} />
              </td>
              <td {...cellProps(5)} data-label="Collateral" className="num">
                <Fig minor={p.collateral_amount} decimals={decimalsOf(p.collateral_asset)} asset={p.collateral_asset} pad={collateralPad} />
              </td>
              <td {...cellProps(6)} data-label="Max repay" className="num">
                <Fig minor={p.max_repay} decimals={decimalsOf(p.debt_asset)} asset={p.debt_asset} pad={debtPad} />
              </td>
              <td {...cellProps(7)} data-label="Round" className="num">
                <Mono>{p.round}</Mono>
              </td>
              <td role="gridcell" className="row-action" data-label="Action" onKeyDown={(event) => onKeyDown(event, row, ACTION_COLUMN)}>
                <ActionButton
                  id={cellId(p.position_id, ACTION_COLUMN)}
                  tone="quiet"
                  aria-label={`Liquidate ${p.position_id}`}
                  tabIndex={stop(p.position_id, ACTION_COLUMN)}
                  onFocus={() => setCursor({ positionId: p.position_id, column: ACTION_COLUMN })}
                  onClick={() => onOpen(p)}
                >
                  Liquidate
                </ActionButton>
              </td>
            </tr>
          );
        })}
        {queue.length === 0 ? (
          <tr role="row">
            <td role="gridcell" colSpan={COLUMNS.length} className="empty-row">
              {EMPTY}
            </td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export function LiquidationsView() {
  const { market } = useSession();
  const { data: queue, reload } = useLive(() => api<{ positions: Position[] }>("GET", "/api/liquidations/queue").then((b) => b.positions), 5000, []);
  const [open, setOpen] = useState<Position | null>(null);
  const [asset, setAsset, assetKnown] = useChosenAsset();
  const pool = market?.pools.find((p) => p.asset === asset);

  function closeDialog(focusOpener: boolean) {
    const positionId = open?.position_id;
    setOpen(null);
    void reload();
    if (focusOpener && positionId) document.getElementById(openerId(positionId))?.focus();
  }

  if (!queue || !assetKnown) return null;

  return (
    <section className="sheet-section">
      <h1>Liquidations</h1>
      <p className="lede">Positions the server has marked below health factor 1, lowest first. A fill repays up to the close factor and receives collateral plus the bonus, exactly once per round.</p>
      <QueueGrid queue={queue ?? []} onOpen={setOpen} />
      {queue ? (
        <>
          <div className="form-grid ruler-chooser">
            <Select id="ruler-asset" label="Shock ruler asset" value={asset} options={(market?.pools ?? []).map((p) => ({ value: p.asset, label: p.asset }))} onChange={setAsset} />
          </div>
          {pool ? <ShockRuler pool={pool} /> : null}
        </>
      ) : null}
      {open ? <LiquidateDialog key={`${open.position_id}-${open.round}`} position={open} onClose={closeDialog} /> : null}
    </section>
  );
}
