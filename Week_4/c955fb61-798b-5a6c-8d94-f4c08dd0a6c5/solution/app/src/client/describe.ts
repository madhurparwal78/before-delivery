import { formatLong } from "../shared/calendar";
import { varianceText, workingDays } from "../shared/format";
import { LINK_TYPE_WORDS, type Item, type Project } from "../shared/types";

/** The sentence of dates, duration, progress, critical, late, variance and links that describes a bar. */
export function describeItem(item: Item, project: Project): string {
  const start = formatLong(item.start ?? "");
  const end = formatLong(item.end ?? "");
  const parts: string[] = [];
  if (item.kind === "task") parts.push(`Starts ${start}, ends ${end}`, `${workingDays(item.duration)}, ${item.percent}% complete`);
  else if (item.kind === "milestone") parts.push(`Milestone on ${start}`, item.percent === 100 ? "Done" : "Not done");
  else parts.push(`Group from ${start} to ${end}`, `${item.percent}% complete`);
  if (item.critical) parts.push("Critical");
  if (item.late) parts.push("Late");
  if (item.baseline) parts.push(varianceText(item.baseline.variance));
  const rowOf = new Map(project.items.map((candidate) => [candidate.id, candidate]));
  const incoming = project.links
    .filter((link) => link.to === item.id)
    .sort((a, b) => (rowOf.get(a.from)?.row ?? 0) - (rowOf.get(b.from)?.row ?? 0));
  for (const link of incoming) parts.push(`Waits for ${rowOf.get(link.from)?.name}, ${LINK_TYPE_WORDS[link.type]}, lag ${link.lag}`);
  return `${parts.join(". ")}.`;
}
