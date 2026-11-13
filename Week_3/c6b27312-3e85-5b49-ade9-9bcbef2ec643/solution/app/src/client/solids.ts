// Stored solids fetched by digest, and the scene a build-tape operation draws from them.
import { useEffect, useState } from "react";
import type { TapeJson } from "../shared/api";
import { measure, type Measure, type Solid, type SolidOp } from "../shared/tine";
import { get, notifyStorageOutage } from "./api";
import { clockTime } from "./hooks";
import type { Scene } from "./viewport/engine";
import { opKey, type LitShape } from "./viewport/geometry";

export class StorageDown extends Error {}

const cache = new Map<string, Promise<Solid>>();

export function fetchSolid(digest: string): Promise<Solid> {
  let found = cache.get(digest);
  if (!found) {
    found = get<Solid>(`/api/solids/${digest}`).then((reply) => {
      if (reply.status === 503) throw new StorageDown();
      if (!reply.ok) throw new Error(`solid ${digest} answered ${reply.status}`);
      return reply.data;
    });
    cache.set(digest, found);
    found.catch(() => cache.delete(digest));
  }
  return found;
}

interface Snapshot {
  k: number;
  scene: Scene;
  digest: string;
  measure: Measure;
}

function bodyOf(solid: Solid): number {
  const body = solid.ops[0];
  return body && (body.op === "box" || body.op === "cylinder") ? body.h : 0;
}

/** The stored solid after operation k: material added by k lit cyan, material removed by k as a hatched ghost. */
async function snapshotAt(tape: TapeJson, k: number): Promise<Snapshot> {
  const op = tape.operations[k];
  if (!op) throw new Error(`no operation ${k}`);
  const [solid, before] = await Promise.all([fetchSolid(op.digest), k > 0 ? fetchSolid((tape.operations[k - 1] as { digest: string }).digest) : Promise.resolve<Solid>({ ops: [] })]);
  const had = new Set(before.ops.map(opKey));
  const added: SolidOp[] = solid.ops.filter((o) => !had.has(opKey(o)));
  const height = bodyOf(solid);
  const lit: LitShape[] = added.filter((o) => o.op === "box" || o.op === "cylinder" || o.op === "boss").map((o) => ({ kind: "op", op: o, bodyHeight: height }));
  const ghost: LitShape[] = added.filter((o) => o.op === "hole" || o.op === "slot").map((o) => ({ kind: "op", op: o, bodyHeight: height }));
  return { k, digest: op.digest, measure: measure(solid), scene: { key: `tape:${op.digest}:${k}`, solid, lit, ghost } };
}

/**
 * The stored snapshot for a playhead (null while the viewport shows something else). Each snapshot drawn calls `onPaint`;
 * an unreadable solid reports the outage and yields "outage" with the time of the last solid drawn.
 */
export function useSnapshot(tape: TapeJson | null, playhead: number | null, onPaint: () => void): { snapshot: Snapshot | "outage" | null; lastGood: string | null } {
  const [snapshot, setSnapshot] = useState<Snapshot | "outage" | null>(null);
  const [lastGood, setLastGood] = useState<string | null>(null);
  useEffect(() => {
    if (!tape || playhead === null) {
      setSnapshot(null);
      return;
    }
    let alive = true;
    snapshotAt(tape, playhead).then(
      (shot) => {
        if (!alive) return;
        setSnapshot(shot);
        setLastGood(clockTime(new Date()));
        onPaint();
      },
      (error: unknown) => {
        if (alive && error instanceof StorageDown) {
          notifyStorageOutage();
          setSnapshot("outage");
        }
      },
    );
    return () => {
      alive = false;
    };
    // onPaint is a stable callback from the epoch hook; the snapshot depends only on the tape and the playhead.
  }, [tape, playhead]);
  return { snapshot, lastGood };
}
