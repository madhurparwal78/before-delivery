import { CARDINALITY, foreignKeySide, refText, typeText, type Column, type Entity, type Link, type Model } from "../../shared/model.js";
import { copy } from "../copy.js";

export type KeyMarker = "primary" | "unique" | "foreign";

export function columnKeys(model: Model, entity: Entity, column: Column): KeyMarker[] {
  const keys: KeyMarker[] = [];
  if (column.key) keys.push("primary");
  if (column.unique || entity.indexes.some((i) => i.unique && i.columns.includes(column.name))) keys.push("unique");
  const foreign = model.links.some((link) => {
    const side = foreignKeySide(link);
    return side !== null && side.column.entity === entity.name && side.column.column === column.name;
  });
  if (foreign) keys.push("foreign");
  return keys;
}

const KEY_WORDS: Record<KeyMarker, string> = { primary: ", primary key", unique: ", unique", foreign: ", foreign key" };

export function columnLabel(model: Model, entity: Entity, column: Column): string {
  const keys = columnKeys(model, entity, column);
  const required = column.required && !column.key ? ", required" : "";
  return `${column.name} ${typeText(column.type)}${keys.map((k) => KEY_WORDS[k]).join("")}${required}`;
}

export function linksOf(model: Model, entity: string): Link[] {
  return model.links.filter((l) => l.from.entity === entity || l.to.entity === entity);
}

export function entityLabel(model: Model, entity: Entity): string {
  return copy.entityName(entity.name, entity.columns.length, linksOf(model, entity.name).length);
}

export function linkLabel(link: Link): string {
  return copy.linkOutline(refText(link.from), refText(link.to), CARDINALITY[link.token]);
}

/** One outline item per statement, in text order, with inline links right after their entity. */
export function outlineItems(model: Model): string[] {
  return model.statements.map((statement) => {
    switch (statement.kind) {
      case "choice":
        return `Choice ${statement.choice.name}: ${statement.choice.values.join(", ")}`;
      case "entity":
        return entityLabel(model, statement.entity);
      case "link":
        return linkLabel(statement.link);
      case "group":
        return `Group ${statement.group.name}: ${statement.group.entities.join(", ")}`;
    }
  });
}
