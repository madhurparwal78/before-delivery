import type { Choice, Column, Entity, Group, Index, Link, Literal, Model, Ref } from "./model.js";

const RESERVED = new Set([
  "entity",
  "choice",
  "link",
  "group",
  "index",
  "key",
  "auto",
  "required",
  "unique",
  "default",
  "true",
  "false",
  "null",
  "now",
]);

export function printName(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name) ? name : `"${name}"`;
}

export function printRef(ref: Ref): string {
  return `${printName(ref.entity)}.${printName(ref.column)}`;
}

export function printLiteral(literal: Literal): string {
  return literal.kind === "string" ? `'${literal.text.replace(/'/g, "''")}'` : literal.text;
}

function printColumn(column: Column): string {
  const settings: string[] = [];
  if (column.key) settings.push("key");
  if (column.auto) settings.push("auto");
  if (column.required && !column.key) settings.push("required");
  if (column.unique) settings.push("unique");
  if (column.default) settings.push(`default: ${printLiteral(column.default)}`);
  if (column.link) settings.push(`link: ${column.link.token} ${printRef(column.link.to)}`);
  const type = column.type.params.length ? `${printName(column.type.name)}(${column.type.params.join(",")})` : printName(column.type.name);
  return `  ${printName(column.name)} ${type}${settings.length ? ` [${settings.join(", ")}]` : ""}`;
}

function printIndex(index: Index): string {
  const settings: string[] = [];
  if (index.unique) settings.push("unique");
  if (index.name !== null) settings.push(`name: "${index.name}"`);
  return `  index (${index.columns.map(printName).join(", ")})${settings.length ? ` [${settings.join(", ")}]` : ""}`;
}

export function printEntityLines(entity: Entity): string[] {
  return [`entity ${printName(entity.name)} {`, ...entity.columns.map(printColumn), ...entity.indexes.map(printIndex), "}"];
}

export function printLinkLine(link: Pick<Link, "from" | "token" | "to" | "action">): string {
  return `link ${printRef(link.from)} ${link.token} ${printRef(link.to)}${link.action ? ` [delete: ${link.action}]` : ""}`;
}

export function printChoice(choice: Pick<Choice, "name" | "values">): string {
  return `choice ${printName(choice.name)} { ${choice.values.map(printName).join(", ")} }`;
}

export function printGroup(group: Pick<Group, "name" | "entities">): string {
  return `group "${group.name}" { ${group.entities.map(printName).join(", ")} }`;
}

export interface TextBlock {
  kind: "choice" | "entity" | "group";
  name: string;
  /** For entities: the block lines followed by one line per owned link, in `links` order. */
  lines: string[];
  links: Link[];
}

export function entityBlock(model: Model, entity: Entity): TextBlock {
  const links = model.links.filter((l) => !l.inline && l.from.entity === entity.name);
  return { kind: "entity", name: entity.name, lines: [...printEntityLines(entity), ...links.map(printLinkLine)], links };
}

export function choiceBlock(choice: Choice): TextBlock {
  return { kind: "choice", name: choice.name, lines: [printChoice(choice)], links: [] };
}

/** The blocks of the canonical whole text: choices, then entities with the link lines they own, then groups. */
export function wholeTextBlocks(model: Model): TextBlock[] {
  return [
    ...model.choices.map(choiceBlock),
    ...model.entities.map((e) => entityBlock(model, e)),
    ...model.groups.map((g): TextBlock => ({ kind: "group", name: g.name, lines: [printGroup(g)], links: [] })),
  ];
}
