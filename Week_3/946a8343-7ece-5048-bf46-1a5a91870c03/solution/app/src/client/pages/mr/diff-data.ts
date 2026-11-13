// Which two versions the diff compares, kept in the address (`from` = `target` or a version number, `to` = a version number), and
// the compare body for them.
//   useCompare(page)   { from, to, latest, versions, oldRef, newRef, diff }
//       from    'target' compares the chosen version's base with it; a number compares that version's head
//       to      the version asked for in the address, else the newest; null until the request has loaded
//       oldRef / newRef   the commits the two sides of the diff are read from
import { api, useResource, type Resource } from "../../api.ts";
import { useQuery } from "../../router.ts";
import { mrBase, type MrPage, type MrVersion } from "./data.ts";
import type { DiffBody } from "./diff-types.ts";

type FromChoice = "target" | number;

export interface Compare {
  from: FromChoice;
  to: number | null;
  latest: number | null;
  versions: readonly MrVersion[];
  oldRef: string | null;
  newRef: string | null;
  diff: Resource<DiffBody | null>;
}

function wholeNumber(text: string | null): number | null {
  if (text === null || !/^\d+$/.test(text)) return null;
  return Number(text);
}

export function useCompare(page: MrPage): Compare {
  const query = useQuery();
  const versions = page.mr?.versions ?? [];
  const known = (number: number | null): number | null => (number !== null && versions.some((version) => version.number === number) ? number : null);
  const latest = versions.reduce<number | null>((best, version) => (best === null || version.number > best ? version.number : best), null);
  const to = known(wholeNumber(query.get("to"))) ?? latest;
  const asked = known(wholeNumber(query.get("from")));
  const from: FromChoice = asked !== null && to !== null && asked < to ? asked : "target";
  const toVersion = versions.find((version) => version.number === to);
  const fromVersion = from === "target" ? undefined : versions.find((version) => version.number === from);
  const diff = useResource<DiffBody | null>(
    (signal) => (to === null ? Promise.resolve(null) : api.get<DiffBody>(`${mrBase(page.project, page.iid)}/diff?from=${from}&to=${to}`, { signal })),
    [page.project, page.iid, from, to],
  );
  return {
    from,
    to,
    latest,
    versions,
    oldRef: from === "target" ? (toVersion?.base ?? null) : (fromVersion?.head ?? null),
    newRef: toVersion?.head ?? null,
    diff,
  };
}
