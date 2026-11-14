import { FIELD, type Fields } from "./field-messages.js";
import { isColour, type Colour, type Layout } from "./layout.js";
import { findColumn, type Model, type Ref } from "./model.js";
import { parseMortise, type ParseLimits, type ParseResult } from "./mortise.js";
import { appendGroup, insertLinkLine, removeGroupBlock, renameEntityText, type LinkInsertion } from "./writeback.js";

/** Why a diagram write was refused: a state conflict (409) or field messages (422). */
export type Refusal =
  { kind: "link_exists" } | { kind: "already_grouped"; entity: string; group: string } | { kind: "fields"; fields: Fields };

export type Planned<T> = { ok: true; value: T } | { ok: false; refusal: Refusal };

/** Diagram writes need text without errors. */
export const SCHEMA_HAS_ERRORS = "Fix the errors in the text first.";

const refuse = <T>(refusal: Refusal): Planned<T> => ({ ok: false, refusal });

export function refusalMessage(refusal: Refusal): string {
  switch (refusal.kind) {
    case "link_exists":
      return "That link already exists.";
    case "already_grouped":
      return `${refusal.entity} is already in group "${refusal.group}".`;
    case "fields":
      return Object.values(refusal.fields)[0]!;
  }
}

/** Entity names written through the diagram: 1 to 64 printable ASCII characters without " . ` or \. */
export function validEntityName(value: unknown): value is string {
  return typeof value === "string" && /^[\x20-\x7e]{1,64}$/.test(value) && !/["`.\\]/.test(value);
}

export function validGroupName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const length = Array.from(value).length;
  return length >= 1 && length <= 40 && !value.includes('"') && !/[\r\n]/.test(value);
}

export function parseRef(value: unknown): Ref | null {
  if (typeof value !== "string") return null;
  const dot = value.indexOf(".");
  if (dot <= 0 || dot === value.length - 1) return null;
  return { entity: value.slice(0, dot), column: value.slice(dot + 1) };
}

function linkExists(model: Model, from: Ref, to: Ref): boolean {
  const same = (a: Ref, b: Ref) => a.entity === b.entity && a.column === b.column;
  return model.links.some((l) => (same(l.from, from) && same(l.to, to)) || (same(l.from, to) && same(l.to, from)));
}

/** A drawn link: one many-to-one line written after the owning entity's block. */
export function planLink(
  text: string,
  parse: ParseResult,
  fromValue: unknown,
  toValue: unknown,
  limits: ParseLimits,
): Planned<LinkInsertion> {
  const from = parseRef(fromValue);
  const to = parseRef(toValue);
  const fromColumn = from && findColumn(parse.model, from);
  const toColumn = to && findColumn(parse.model, to);
  if (from && to && fromColumn && toColumn && linkExists(parse.model, from, to)) return refuse({ kind: "link_exists" });
  const fields: Fields = {};
  if (!from || !fromColumn) fields.from = FIELD.noColumn(String(fromValue));
  if (!to || !toColumn) fields.to = FIELD.noColumn(String(toValue));
  else if (from && from.entity === to.entity && from.column === to.column) fields.to = FIELD.sameColumn;
  if (Object.keys(fields).length) return refuse({ kind: "fields", fields });
  const insertion = insertLinkLine(text, parse, from!, to!);
  const check = parseMortise(insertion.text, limits);
  if (check.errors.length) return refuse({ kind: "fields", fields: { to: check.errors[0]!.message } });
  return { ok: true, value: insertion };
}

export interface TextAndLayout {
  text: string;
  layout: Layout;
}

export function planGroup(
  text: string,
  parse: ParseResult,
  layout: Layout,
  name: unknown,
  entities: unknown,
  color: unknown,
): Planned<TextAndLayout> {
  const model = parse.model;
  const names = Array.isArray(entities) ? entities.filter((e): e is string => typeof e === "string") : [];
  for (const entity of names) {
    const group = model.groups.find((g) => g.entities.includes(entity));
    if (group) return refuse({ kind: "already_grouped", entity, group: group.name });
  }
  const fields: Fields = {};
  if (!validGroupName(name)) fields.name = FIELD.groupName;
  else if (model.groups.some((g) => g.name === name)) fields.name = FIELD.groupNameTaken;
  if (!Array.isArray(entities) || entities.length === 0 || names.length !== entities.length) fields.entities = FIELD.pickEntity;
  else {
    const missing = names.find((n) => !model.entities.some((e) => e.name === n));
    if (missing !== undefined) fields.entities = FIELD.noEntity(missing);
  }
  if (!isColour(color)) fields.color = FIELD.colour;
  if (Object.keys(fields).length) return refuse({ kind: "fields", fields });
  const groupName = name as string;
  const ordered = model.entities.map((e) => e.name).filter((n) => names.includes(n));
  return {
    ok: true,
    value: {
      text: appendGroup(text, { name: groupName, entities: ordered }),
      layout: { entities: layout.entities, groups: { ...layout.groups, [groupName]: { color: color as Colour } } },
    },
  };
}

/** Removes a group's block; null when there is no such group. */
export function planUngroup(text: string, parse: ParseResult, name: string): string | null {
  const group = parse.model.groups.find((g) => g.name === name);
  return group ? removeGroupBlock(text, group) : null;
}

export function planRename(text: string, parse: ParseResult, layout: Layout, fromValue: unknown, toValue: unknown): Planned<TextAndLayout> {
  const fields: Fields = {};
  const from = typeof fromValue === "string" ? fromValue : "";
  if (!parse.model.entities.some((e) => e.name === from)) fields.from = FIELD.noEntity(String(fromValue));
  if (!validEntityName(toValue)) fields.to = FIELD.entityName;
  else if (parse.model.entities.some((e) => e.name === toValue)) fields.to = FIELD.entityNameTaken;
  if (Object.keys(fields).length) return refuse({ kind: "fields", fields });
  const to = toValue as string;
  const entities = { ...layout.entities };
  const moved = entities[from];
  delete entities[from];
  if (moved) entities[to] = moved;
  return { ok: true, value: { text: renameEntityText(text, parse, from, to), layout: { entities, groups: layout.groups } } };
}
