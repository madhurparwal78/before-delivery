import { PLACEHOLDER_TEXT } from "../shared/copy.js";
import { containerOf } from "../shared/moves.js";
import { bulletLabel } from "../shared/text.js";
import type { OutlineState } from "./outline.js";

type ExportFormat = "text" | "markdown" | "opml";

interface Line {
  depth: number;
  id: string;
  text: string;
  completed: boolean;
  mirrorOf: string | null;
  tags: string[];
  mentions: string[];
  date: string | null;
}

const FORMATS: Record<ExportFormat, { extension: string; type: string }> = {
  text: { extension: "txt", type: "text/plain; charset=utf-8" },
  markdown: { extension: "md", type: "text/markdown; charset=utf-8" },
  opml: { extension: "opml", type: "text/x-opml; charset=utf-8" },
};

export const isExportFormat = (value: string): value is ExportFormat => value in FORMATS;

function lines(state: OutlineState, rootId: string | null): Line[] {
  const out: Line[] = [];
  const level = (container: string | null, depth: number): void => {
    for (const id of state.childrenOf(container)) {
      const row = state.placement(id);
      if (row === undefined) continue;
      const bullet = state.bullet(row, depth);
      out.push({
        depth, id, text: bullet.placeholder ? PLACEHOLDER_TEXT : bullet.text, completed: bullet.completed,
        mirrorOf: row.mirrorOf, tags: bullet.tags, mentions: bullet.mentions, date: bullet.date,
      });
      if (row.mirrorOf === null) level(id, depth + 1);
    }
  };
  level(rootId === null ? null : containerOf(state, rootId), 0);
  return out;
}

const escapeXml = (value: string): string =>
  value
    .replace(/[^\u0009\u000a\u000d -퟿-�\u{10000}-\u{10ffff}]/gu, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function plain(items: Line[], checkbox: boolean): string[] {
  return items.map((line) => {
    const marker = checkbox && line.completed ? "- [x] " : "- ";
    const done = !checkbox && line.completed ? " (completed)" : "";
    return `${"  ".repeat(line.depth)}${marker}${line.text}${done}${line.mirrorOf === null ? "" : " (mirror)"}`;
  });
}

function opml(items: Line[], title: string): string {
  const body: string[] = [];
  items.forEach((line, index) => {
    const attributes = [`text="${escapeXml(line.text)}"`, `_id="${escapeXml(line.id)}"`];
    if (line.completed) attributes.push('_complete="true"');
    if (line.tags.length > 0) attributes.push(`_tags="${escapeXml(line.tags.join(" "))}"`);
    if (line.mentions.length > 0) attributes.push(`_mentions="${escapeXml(line.mentions.join(" "))}"`);
    if (line.date !== null) attributes.push(`_date="${line.date}"`);
    if (line.mirrorOf !== null) attributes.push(`_mirrorOf="${escapeXml(line.mirrorOf)}"`);
    const next = items[index + 1];
    const opens = next !== undefined && next.depth > line.depth;
    body.push(`${"  ".repeat(line.depth + 1)}<outline ${attributes.join(" ")}${opens ? ">" : " />"}`);
    if (!opens) {
      for (let depth = line.depth - 1; depth >= (next?.depth ?? 0); depth -= 1) body.push(`${"  ".repeat(depth + 1)}</outline>`);
    }
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `<head><title>${escapeXml(title)}</title></head>`,
    "<body>",
    ...body,
    "</body>",
    "</opml>",
    "",
  ].join("\n");
}

interface ExportFile {
  name: string;
  type: string;
  body: string;
}

export function exportView(state: OutlineState, rootId: string | null, format: ExportFormat): ExportFile {
  const root = rootId === null ? undefined : state.placement(rootId);
  const original = root === undefined ? undefined : state.originalOf(root);
  const title = root === undefined ? "Home" : bulletLabel(original?.text ?? PLACEHOLDER_TEXT);
  const slug = root === undefined ? "home" : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "bullet";
  const items = lines(state, rootId);
  const body =
    format === "opml"
      ? opml(items, title)
      : format === "markdown"
        ? [`# ${title}`, "", ...plain(items, true), ""].join("\n")
        : [...plain(items, false), ""].join("\n");
  return { name: `twigline-${slug}.${FORMATS[format].extension}`, type: FORMATS[format].type, body };
}
