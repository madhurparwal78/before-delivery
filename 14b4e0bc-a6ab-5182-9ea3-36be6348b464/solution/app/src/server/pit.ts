import type { Tx } from "./db.ts";
import { latestSeq } from "./audit.ts";
import { invalid } from "./errors.ts";

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Parses an RFC 3339 instant with an offset; null when malformed or not a real calendar time. */
function parseInstant(text: string): Date | null {
  const m = RFC3339.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    return null;
  }
  const offset = m[8];
  if (offset !== "Z" && offset !== "z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null;
  const instant = new Date(text.toUpperCase());
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export interface PointInTime {
  k: number;
  at: string | null;
}

/** Resolves as_of_seq or as_of_time (DP-86); null when neither is sent. */
export async function resolvePointInTime(tx: Tx, params: URLSearchParams): Promise<PointInTime | null> {
  const seqText = params.get("as_of_seq");
  const timeText = params.get("as_of_time");
  if (seqText === null && timeText === null) return null;
  if (seqText !== null && timeText !== null) throw invalid({ as_of_time: "Send as_of_seq or as_of_time, not both." });
  const latest = await latestSeq(tx);
  let k: number;
  if (seqText !== null) {
    if (!/^\d+$/.test(seqText) || Number(seqText) > latest) throw invalid({ as_of_seq: "Use an audit seq from 0 to the latest seq." });
    k = Number(seqText);
  } else {
    const instant = parseInstant(timeText!);
    if (!instant) throw invalid({ as_of_time: "Use an RFC 3339 time with an offset." });
    k = await latestSeq(tx, instant);
  }
  const at = k === 0 ? null : ((await tx.query("select at from audit_log where seq = $1", [k])).rows[0].at as string);
  return { k, at };
}
