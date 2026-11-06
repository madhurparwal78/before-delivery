import { CellValue, Line } from "./api.js";
import { reducedMotion } from "./util.js";
import { CaseBlock } from "./blocks/caseblock.js";
import { crateManager } from "./crate/manager.js";

/**
 * The fill-the-case sequence: cells in reading order, crate unit drops, the
 * numeral count, and the seal or unseal step. One place runs it, and every
 * timer it leaves behind is cancelled by the next newer line.
 */

interface SequenceState {
  timers: number[];
}

const sequences = new Map<string, SequenceState>();

/** Cancels any running sequence so nothing later in it ever runs. */
export function cancelSequence(block: CaseBlock): void {
  const seq = sequences.get(block.caseKey);
  if (!seq) return;
  for (const t of seq.timers) clearTimeout(t);
  seq.timers.length = 0;
  sequences.delete(block.caseKey);
}

export function sequenceRunning(block: CaseBlock): boolean {
  return sequences.has(block.caseKey);
}

function schedule(seq: SequenceState, fn: () => void, delay: number): void {
  const t = window.setTimeout(fn, delay);
  seq.timers.push(t);
}

export function runFillSequence(
  block: CaseBlock,
  oldLine: Line,
  newLine: Line,
  onSealMoment: () => void
): void {
  cancelSequence(block);
  if (reducedMotion()) {
    block.redrawStatic();
    block.panelDraw("line");
    onSealMoment();
    return;
  }
  const seq: SequenceState = { timers: [] };
  sequences.set(block.caseKey, seq);

  const wasSealed = oldLine.status === "sealed" || oldLine.status === "taken_up";
  const nowSealed = newLine.status === "sealed" || newLine.status === "taken_up";
  const withdrawing = newLine.pledged_units < oldLine.pledged_units;

  // Cells that change, in reading order; reductions and withdrawals run them
  // backwards so units rise out last first.
  const changed: number[] = [];
  for (let i = 0; i < newLine.pack; i++) {
    if (oldLine.cells[i] !== newLine.cells[i]) changed.push(i);
  }
  const ordered = withdrawing ? [...changed].reverse() : changed;
  const gap = ordered.length > 27 ? 800 / Math.max(1, ordered.length - 1) : 30;
  const cellsEnd = ordered.length > 0 ? (ordered.length - 1) * gap + 200 : 0;

  // An unseal goes first: the stamp lifts and the lid opens.
  if (wasSealed && !nowSealed) {
    runUnsealStep(block, onSealMoment, seq);
  }

  // The raised-units overlay for the crate, shared by all drops.
  const raised = new Map<number, { frac: number; cell: CellValue }>();
  ordered.forEach((cellIndex, k) => {
    const start = wasSealed && !nowSealed ? 400 + k * gap : k * gap;
    schedule(seq, () => {
      const prevCell = oldLine.cells[cellIndex];
      block.cells[cellIndex].setAttribute("data-cell", newLine.cells[cellIndex]);
      animateUnit(block, cellIndex, withdrawing, prevCell, raised, seq);
    }, start);
  });

  // After the cells, the numeral counts one integer at a time.
  const numeralStart = wasSealed && !nowSealed ? 400 + cellsEnd : cellsEnd;
  schedule(seq, () => countNumeral(block, oldLine.units_to_go, newLine.units_to_go, seq), numeralStart);

  // If units to go reach zero, the seal step runs after the numeral.
  if (!wasSealed && nowSealed) {
    schedule(seq, () => runSealStep(block, onSealMoment, seq), numeralStart + 350);
  }

  // End on the server's values, whatever else happened.
  const sealMs = !wasSealed && nowSealed ? 350 + 640 : 0;
  schedule(seq, () => {
    cancelSequence(block);
    block.redrawStatic();
    block.panelDraw("line");
  }, numeralStart + 400 + sealMs);
}

function animateUnit(
  block: CaseBlock,
  cellIndex: number,
  withdrawing: boolean,
  prevCell: CellValue,
  raised: Map<number, { frac: number; cell: CellValue }>,
  seq: SequenceState
): void {
  const steps = 4;
  for (let s = 1; s <= steps; s++) {
    const frac = s / steps;
    schedule(seq, () => {
      if (withdrawing) {
        raised.set(cellIndex, { frac: frac * 0.9, cell: prevCell === "empty" ? "taken" : prevCell });
      } else {
        raised.set(cellIndex, { frac: (1 - frac) * 1.0, cell: prevCell });
      }
      void crateManager.draw(block.caseKey, "sequence", { raised: new Map(raised) });
    }, s * 45);
  }
  schedule(seq, () => {
    raised.delete(cellIndex);
    void crateManager.draw(block.caseKey, "sequence", { raised: new Map(raised) });
  }, 190);
}

function countNumeral(block: CaseBlock, from: number, to: number, seq: SequenceState): void {
  if (from === to) {
    setNumeral(block, to);
    return;
  }
  const stepMs = Math.max(28, Math.floor(333 / Math.max(1, Math.abs(to - from))));
  const dir = to > from ? 1 : -1;
  let current = from;
  const tick = () => {
    current += dir;
    setNumeral(block, current);
    if (current !== to) schedule(seq, tick, stepMs);
  };
  tick();
}

function setNumeral(block: CaseBlock, value: number): void {
  const numeral = block.article.querySelector(".numeral")!;
  numeral.textContent = "";
  const span = document.createElement("span");
  span.className = "to-go-words";
  span.textContent = " to go";
  numeral.append(document.createTextNode(String(value)), span);
}

function runSealStep(block: CaseBlock, onSealMoment: () => void, seq: SequenceState): void {
  // The lid swings shut with some weight...
  const lidMs = 300;
  const stampMs = 180;
  for (let s = 1; s <= 6; s++) {
    const frac = s / 6;
    schedule(seq, () => {
      void crateManager.draw(block.caseKey, "sequence", {
        lidAngle: 100 * (1 - frac),
        stampScale: 0,
      });
    }, frac * lidMs);
  }
  // ...and when it lands, the block turns sealed green and the stamp presses on.
  schedule(seq, onSealMoment, lidMs + 30);
  for (let s = 1; s <= 3; s++) {
    const frac = s / 3;
    schedule(seq, () => {
      void crateManager.draw(block.caseKey, "sequence", {
        lidAngle: 0,
        stampScale: frac,
      });
    }, lidMs + frac * stampMs);
  }
}

function runUnsealStep(block: CaseBlock, onSealMoment: () => void, seq: SequenceState): void {
  const stampMs = 140;
  const lidMs = 280;
  for (let s = 1; s <= 3; s++) {
    const frac = s / 3;
    schedule(seq, () => {
      void crateManager.draw(block.caseKey, "sequence", {
        lidAngle: 0,
        stampScale: 1 - frac,
      });
    }, frac * stampMs);
  }
  for (let s = 1; s <= 6; s++) {
    const frac = s / 6;
    schedule(seq, () => {
      void crateManager.draw(block.caseKey, "sequence", {
        lidAngle: 100 * frac,
        stampScale: 0,
      });
    }, stampMs + frac * lidMs);
  }
  schedule(seq, onSealMoment, stampMs + lidMs + 20);
}
