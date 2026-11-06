// Sequences every accepted strength change (brief: Motion and effects; Feedback states → Strength readout):
// digits roll → 300 ms → tier pattern and label swap over 300 ms → Payable rolls, all within 2 s of the server's
// answer; then "Strength readout" announces. Reduced motion: everything at once, plus a "Strength changes" note.

import { useCallback, useRef, useState } from "react";
import { tierLabel, type Tier } from "../shared/api.js";
import { frames, money } from "../shared/format.js";
import { useFeedback } from "./feedback.js";
import { useReducedMotion } from "./hooks.js";
import { rollSpan } from "./Odometer.js";

export interface Figures {
  /** Average frames in tenths, or null with no samples. */
  average: number | null;
  tier: Tier | null;
}

export interface ShownBlock {
  /** What the digits are rolling to (provisional while `dim`). */
  readout: number | null;
  /** The server's figures: the meter takes these as soon as a roll begins. */
  meter: Figures;
  /** Tier and average shown in the pattern, label and accessible name; swap after the digits settle. */
  settled: Figures;
  dim: boolean;
  rollBudget?: number;
}

export interface Shown {
  blocks: Record<string, ShownBlock>;
  payable: number;
  payableDelay: number;
  payableBudget?: number;
}

const TIER_PAUSE_MS = 300;
const TIER_FADE_MS = 300;
const SEQUENCE_MS = 1950;
const ROLLBACK_MS = 800;

export function toTenths(average: number | null): number | null {
  return average === null ? null : Math.round(average * 10);
}

function readoutCopy(name: string, figures: Figures, payable: number): string {
  return figures.average === null
    ? `${name}: no samples, ${tierLabel(null)}. Orchard payable ${money(payable)}.`
    : `${name}: ${frames(figures.average)} frames, ${tierLabel(figures.tier)}. Orchard payable ${money(payable)}.`;
}

function noteCopy(name: string, before: Figures, after: Figures): string {
  const old = before.average === null ? "no samples" : frames(before.average);
  if (after.average === null) return `${name}: ${old} → no samples, now ${tierLabel(null)}`;
  const word = before.tier === after.tier ? "still" : "now";
  return `${name}: ${old} → ${frames(after.average)} frames, ${word} ${tierLabel(after.tier)}`;
}

function same(a: Figures, b: Figures): boolean {
  return a.average === b.average && a.tier === b.tier;
}

export interface BlockFigures extends Figures {
  id: string;
  name: string;
}

export function useStrength() {
  const reduced = useReducedMotion();
  const feedback = useFeedback();
  const [shown, setShown] = useState<Shown>({ blocks: {}, payable: 0, payableDelay: 0 });
  const [notes, setNotes] = useState<string[]>([]);
  const known = useRef<{ blocks: Record<string, Figures>; payable: number }>({ blocks: {}, payable: 0 });
  const timers = useRef<number[]>([]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  /** When each block's provisional roll comes to rest (page clock). */
  const rollEnds = useRef<Record<string, number>>({});

  /** Shows figures at once without motion or announcement (first load, another order). */
  const load = useCallback((blocks: BlockFigures[], payable: number) => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current = [];
    known.current = { blocks: Object.fromEntries(blocks.map((block) => [block.id, { average: block.average, tier: block.tier }])), payable };
    setShown({
      blocks: Object.fromEntries(
        blocks.map((block) => {
          const figures = { average: block.average, tier: block.tier };
          return [block.id, { readout: block.average, meter: figures, settled: figures, dim: false }];
        }),
      ),
      payable,
      payableDelay: 0,
    });
  }, []);

  /** Rolls a block toward the browser's provisional average, dimmed, while the server decides. */
  const provisional = useCallback(
    (id: string, average: number | null) => {
      if (reduced) return;
      const block = shownRef.current.blocks[id];
      if (!block) return;
      rollEnds.current[id] = performance.now() + rollSpan("frames", block.readout, average);
      setShown((last) => ({ ...last, blocks: { ...last.blocks, [id]: { ...block, readout: average, dim: true, rollBudget: undefined } } }));
    },
    [reduced],
  );

  /** The server refused: the digits roll back to the prior value within 0.8 s; no tier swap. */
  const rollback = useCallback((id: string) => {
    setShown((last) => {
      const block = last.blocks[id];
      return block ? { ...last, blocks: { ...last.blocks, [id]: { ...block, readout: block.meter.average, dim: false, rollBudget: ROLLBACK_MS } } } : last;
    });
  }, []);

  /** Applies the server's figures; every block whose figures changed runs the sequence. */
  const apply = useCallback(
    (blocks: BlockFigures[], payable: number) => {
      const changed = blocks.filter((block) => !same(known.current.blocks[block.id] ?? { average: null, tier: null }, block));
      const payableChanged = payable !== known.current.payable;
      if (changed.length === 0 && !payableChanged) {
        setShown((last) => {
          const next = { ...last.blocks };
          for (const block of blocks) if (next[block.id]?.dim) next[block.id] = { ...next[block.id], readout: next[block.id].meter.average, dim: false };
          return { ...last, blocks: next };
        });
        return;
      }
      const before = known.current.blocks;
      const previousPayable = known.current.payable;
      known.current = { blocks: { ...before, ...Object.fromEntries(blocks.map((block) => [block.id, { average: block.average, tier: block.tier }])) }, payable };
      if (reduced) {
        setShown((last) => {
          const next = { ...last.blocks };
          for (const block of changed) {
            const figures = { average: block.average, tier: block.tier };
            next[block.id] = { readout: block.average, meter: figures, settled: figures, dim: false };
          }
          return { blocks: next, payable, payableDelay: 0 };
        });
        setNotes((last) => [...last, ...changed.map((block) => noteCopy(block.name, before[block.id] ?? { average: null, tier: null }, block))]);
        for (const block of changed) feedback.readout(readoutCopy(block.name, block, payable));
        return;
      }
      const current = shownRef.current.blocks;
      let payStart = 0;
      const schedule = changed.map((block) => {
        const shownBlock = current[block.id];
        const stillRolling = Math.max(0, (rollEnds.current[block.id] ?? 0) - performance.now());
        const tierAt = Math.max(stillRolling, rollSpan("frames", shownBlock?.readout ?? null, block.average)) + TIER_PAUSE_MS;
        const end = tierAt + ((shownBlock?.settled.tier ?? null) !== block.tier ? TIER_FADE_MS : 0);
        payStart = Math.max(payStart, end);
        return { block, tierAt, end };
      });
      const payEnd = payStart + Math.min(SEQUENCE_MS - payStart, rollSpan("money", previousPayable, payable));
      setShown((last) => {
        const next = { ...last.blocks };
        for (const { block } of schedule) {
          next[block.id] = { readout: block.average, meter: { average: block.average, tier: block.tier }, settled: next[block.id]?.settled ?? block, dim: false };
        }
        return { blocks: next, payable, payableDelay: payStart, payableBudget: SEQUENCE_MS - payStart };
      });
      for (const { block, tierAt, end } of schedule) {
        timers.current.push(
          window.setTimeout(() => {
            setShown((last) => {
              const shownBlock = last.blocks[block.id];
              return shownBlock ? { ...last, blocks: { ...last.blocks, [block.id]: { ...shownBlock, settled: { average: block.average, tier: block.tier } } } } : last;
            });
          }, tierAt),
          window.setTimeout(() => feedback.readout(readoutCopy(block.name, block, payable)), Math.max(end, payEnd)),
        );
      }
    },
    [feedback, reduced],
  );

  return { shown, notes, reduced, load, provisional, rollback, apply };
}
