export const START_UNIT = "the start of the text";

export interface Unit {
  name: string;
  text: string;
}

function unitHeader(line: string): string | null {
  const match = /^(entity|choice|group) /.exec(line);
  if (!match) return null;
  const rest = line.slice(match[0].length).trimStart();
  const quoted = /^"([^"]*)"/.exec(rest);
  const bare = /^[^\s{#]*/.exec(rest)![0];
  if (match[1] === "group") return `group "${quoted ? quoted[1] : bare}"`;
  return `${match[1]} ${quoted ? quoted[1] : bare}`;
}

/** Splits text into merge units: one per entity, choice or group header line, plus the lines before the first. */
export function splitUnits(text: string): Unit[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const units: Unit[] = [];
  const seen = new Map<string, number>();
  for (const line of lines) {
    const header = unitHeader(line);
    if (header !== null) {
      const count = (seen.get(header) ?? 0) + 1;
      seen.set(header, count);
      units.push({ name: count === 1 ? header : `${header} (${count})`, text: line });
    } else if (units.length === 0) {
      units.push({ name: START_UNIT, text: line });
    } else {
      units[units.length - 1]!.text += line;
    }
  }
  return units;
}

function joinUnits(units: Unit[]): string {
  return units.map((u, i) => (i < units.length - 1 && !u.text.endsWith("\n") ? `${u.text}\n` : u.text)).join("");
}

/** Names of units added, removed or changed between two texts, in the order they appear in `to` then `from`. */
export function changedUnits(from: string, to: string): string[] {
  const a = new Map(splitUnits(from).map((u) => [u.name, u.text]));
  const b = splitUnits(to);
  const names: string[] = [];
  for (const unit of b) if (a.get(unit.name) !== unit.text) names.push(unit.name);
  const inB = new Set(b.map((u) => u.name));
  for (const name of a.keys()) if (!inB.has(name)) names.push(name);
  return names;
}

export type MergeResult = { ok: true; text: string } | { ok: false; unit: string };

/** Applies the sender's unit changes (base → sent) onto the current text, unless both touched the same unit. */
export function mergeUnits(base: string, sent: string, current: string): MergeResult {
  const senderChanged = changedUnits(base, sent);
  const currentChanged = new Set(changedUnits(base, current));
  const currentUnits = splitUnits(current);
  const shared = senderChanged.filter((name) => currentChanged.has(name));
  if (shared.length) {
    const inCurrent = currentUnits.map((u) => u.name).filter((name) => shared.includes(name));
    return { ok: false, unit: inCurrent[0] ?? shared[0]! };
  }
  const baseNames = new Set(splitUnits(base).map((u) => u.name));
  const sentUnits = splitUnits(sent);
  const sentByName = new Map(sentUnits.map((u) => [u.name, u.text]));
  const changed = new Set(senderChanged);
  let result: Unit[] = currentUnits
    .filter((u) => !(changed.has(u.name) && baseNames.has(u.name) && !sentByName.has(u.name)))
    .map((u) => (changed.has(u.name) && sentByName.has(u.name) ? { name: u.name, text: sentByName.get(u.name)! } : u));
  sentUnits.forEach((unit, index) => {
    if (baseNames.has(unit.name)) return;
    const added = { name: unit.name, text: unit.text };
    if (index === 0) {
      result = [added, ...result];
      return;
    }
    const previous = sentUnits[index - 1]!.name;
    const at = result.findIndex((u) => u.name === previous);
    if (at === -1) result.push(added);
    else result.splice(at + 1, 0, added);
  });
  return { ok: true, text: joinUnits(result) };
}
