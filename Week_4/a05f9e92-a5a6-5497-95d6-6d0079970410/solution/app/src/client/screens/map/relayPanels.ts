import type { AffectedItem } from "../../../server/map.js";

const MAX_PANELS = 8;

export type RelayPanel = {
  key: string;
  name: string;
  tier: 1 | 2 | 3;
  path: string[];
  added: number;
  running: number;
  detail: string;
  rest: AffectedItem[];
};

function describe(item: AffectedItem): string {
  return `${item.ci.class}${item.ci.business_critical ? ", business-critical" : `, criticality ${item.ci.criticality}`}`;
}

function single(item: AffectedItem): RelayPanel {
  return { key: item.ci.name, name: item.ci.name, tier: item.tier, path: item.path, added: item.people_added, running: item.running_people, detail: describe(item), rest: [] };
}

/** One panel per affected item in the server's order; past eight, the first seven then one panel that lists the rest and carries the final total. */
export function relayPanels(affected: AffectedItem[]): RelayPanel[] {
  if (affected.length <= MAX_PANELS) return affected.map(single);
  const rest = affected.slice(MAX_PANELS - 1);
  const tier = Math.min(...rest.map((item) => item.tier)) as RelayPanel["tier"];
  return [
    ...affected.slice(0, MAX_PANELS - 1).map(single),
    {
      key: "rest",
      name: `and ${rest.length} more`,
      tier,
      path: [],
      added: rest.reduce((sum, item) => sum + item.people_added, 0),
      running: rest[rest.length - 1]!.running_people,
      detail: "The rest of the outage",
      rest,
    },
  ];
}

export const pathText = (path: string[]): string => path.join(" > ");
