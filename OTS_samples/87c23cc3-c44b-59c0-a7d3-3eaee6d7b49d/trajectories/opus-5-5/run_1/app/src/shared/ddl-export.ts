import {
  foreignKeySide,
  refText,
  type Column,
  type DeleteAction,
  type Entity,
  type Link,
  type Literal,
  type Model,
  type Ref,
} from "./model.js";
import { sha256Hex } from "./sha256.js";

export type Dialect = "postgresql" | "mysql";
export const DIALECTS: readonly Dialect[] = ["postgresql", "mysql"];
export const DIALECT_NAMES: Record<Dialect, string> = { postgresql: "PostgreSQL", mysql: "MySQL" };
export const IDENTIFIER_LIMITS: Record<Dialect, number> = { postgresql: 63, mysql: 64 };

export function isDialect(value: unknown): value is Dialect {
  return value === "postgresql" || value === "mysql";
}

export function shortenIdentifier(identifier: string, limit: number): string {
  const chars = Array.from(identifier);
  if (chars.length <= limit) return identifier;
  return `${chars.slice(0, limit - 9).join("")}_${sha256Hex(identifier).slice(0, 8)}`;
}

const PG_TYPES: Record<string, string> = {
  int: "INTEGER",
  smallint: "SMALLINT",
  bigint: "BIGINT",
  float: "REAL",
  double: "DOUBLE PRECISION",
  bool: "BOOLEAN",
  text: "TEXT",
  date: "DATE",
  time: "TIME",
  timestamp: "TIMESTAMP",
  timestamptz: "TIMESTAMPTZ",
  uuid: "UUID",
  json: "JSONB",
  bytes: "BYTEA",
};

const MYSQL_TYPES: Record<string, string> = {
  int: "INT",
  smallint: "SMALLINT",
  bigint: "BIGINT",
  float: "FLOAT",
  double: "DOUBLE",
  bool: "BOOLEAN",
  text: "TEXT",
  date: "DATE",
  time: "TIME",
  timestamp: "DATETIME",
  timestamptz: "TIMESTAMP",
  uuid: "CHAR(36)",
  json: "JSON",
  bytes: "LONGBLOB",
};

const ON_DELETE: Record<DeleteAction, string> = {
  cascade: " ON DELETE CASCADE",
  restrict: " ON DELETE RESTRICT",
  "set null": " ON DELETE SET NULL",
  "no action": " ON DELETE NO ACTION",
};

interface ForeignKey {
  table: string;
  column: string;
  references: Ref;
  action: DeleteAction | null;
  name: string;
}

class Writer {
  readonly notes = new Set<string>();
  private readonly limit: number;

  constructor(
    readonly dialect: Dialect,
    private readonly model: Model,
  ) {
    this.limit = IDENTIFIER_LIMITS[dialect];
  }

  id(identifier: string): string {
    const short = shortenIdentifier(identifier, this.limit);
    if (short !== identifier) this.notes.add(`identifier ${identifier} shortened to ${short}`);
    return this.dialect === "postgresql" ? `"${short}"` : `\`${short}\``;
  }

  ids(names: string[]): string {
    return names.map((n) => this.id(n)).join(", ");
  }

  quote(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  type(entity: Entity, column: Column): string {
    const t = column.type;
    const pg = this.dialect === "postgresql";
    const where = `${entity.name}.${column.name}`;
    switch (t.name) {
      case "decimal":
        return `${pg ? "NUMERIC" : "DECIMAL"}(${t.params[0]},${t.params[1]})`;
      case "varchar":
        return `VARCHAR(${t.params[0]})`;
      case "char":
        return `CHAR(${t.params[0]})`;
      default: {
        const mapped = (pg ? PG_TYPES : MYSQL_TYPES)[t.name];
        if (mapped) {
          if (!pg && t.name === "uuid") this.notes.add(`uuid column ${where} stored as CHAR(36)`);
          if (!pg && t.name === "timestamptz") this.notes.add(`timestamptz column ${where} stored as TIMESTAMP`);
          return mapped;
        }
        const choice = this.model.choices.find((c) => c.name === t.name)!;
        if (pg) return this.id(choice.name);
        this.notes.add(`choice ${choice.name} inlined as ENUM on ${where}`);
        return `ENUM(${choice.values.map((v) => this.quote(v)).join(", ")})`;
      }
    }
  }

  literal(literal: Literal): string {
    switch (literal.kind) {
      case "string":
        return this.quote(literal.text);
      case "integer":
      case "decimal":
        return literal.text;
      case "now":
        return "CURRENT_TIMESTAMP";
      default:
        return literal.kind.toUpperCase();
    }
  }

  foreignKey(fk: ForeignKey): string {
    return `CONSTRAINT ${this.id(fk.name)} FOREIGN KEY (${this.id(fk.column)}) REFERENCES ${this.id(fk.references.entity)} (${this.id(fk.references.column)})${fk.action ? ON_DELETE[fk.action] : ""}`;
  }
}

function foreignKeysOf(model: Model): ForeignKey[] {
  const keys: ForeignKey[] = [];
  for (const link of model.links) {
    const side = foreignKeySide(link);
    if (!side) continue;
    keys.push({
      table: side.column.entity,
      column: side.column.column,
      references: side.references,
      action: link.action,
      name: `${side.column.entity}_${side.column.column}_fkey`,
    });
  }
  return keys;
}

function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function creationOrder(model: Model, keys: ForeignKey[]): Entity[] {
  const remaining = [...model.entities].sort((a, b) => compareCodePoints(a.name, b.name));
  const created = new Set<string>();
  const order: Entity[] = [];
  while (remaining.length) {
    let pick = remaining.findIndex((entity) =>
      keys.every((k) => k.table !== entity.name || k.references.entity === entity.name || created.has(k.references.entity)),
    );
    if (pick === -1) pick = 0;
    const [entity] = remaining.splice(pick, 1);
    created.add(entity!.name);
    order.push(entity!);
  }
  return order;
}

function manyToManyNote(link: Link): string {
  return `many-to-many link ${refText(link.from)} >-< ${refText(link.to)} has no foreign key`;
}

export function exportDdl(model: Model, dialect: Dialect): string {
  const w = new Writer(dialect, model);
  const pg = dialect === "postgresql";
  const statements: string[] = [];
  const keys = foreignKeysOf(model);
  for (const link of model.links) if (link.token === ">-<") w.notes.add(manyToManyNote(link));

  if (pg) {
    for (const choice of [...model.choices].sort((a, b) => compareCodePoints(a.name, b.name))) {
      statements.push(`CREATE TYPE ${w.id(choice.name)} AS ENUM (${choice.values.map((v) => w.quote(v)).join(", ")})`);
    }
  }

  const order = creationOrder(model, keys);
  const position = new Map(order.map((e, i) => [e.name, i]));
  const deferred: ForeignKey[] = [];
  for (const entity of order) {
    const items: string[] = [];
    for (const column of entity.columns) {
      let line = `${w.id(column.name)} ${w.type(entity, column)}`;
      if (column.required || column.key) line += " NOT NULL";
      if (column.auto) line += pg ? " GENERATED BY DEFAULT AS IDENTITY" : " AUTO_INCREMENT";
      if (column.default) line += ` DEFAULT ${w.literal(column.default)}`;
      items.push(line);
    }
    const keyColumns = entity.columns.filter((c) => c.key).map((c) => c.name);
    if (keyColumns.length) {
      items.push(
        pg ? `CONSTRAINT ${w.id(`${entity.name}_pkey`)} PRIMARY KEY (${w.ids(keyColumns)})` : `PRIMARY KEY (${w.ids(keyColumns)})`,
      );
    }
    for (const column of entity.columns.filter((c) => c.unique)) {
      const name = w.id(`${entity.name}_${column.name}_key`);
      items.push(pg ? `CONSTRAINT ${name} UNIQUE (${w.id(column.name)})` : `UNIQUE KEY ${name} (${w.id(column.name)})`);
    }
    for (const key of keys.filter((k) => k.table === entity.name)) {
      if (position.get(key.references.entity)! > position.get(entity.name)!) deferred.push(key);
      else items.push(w.foreignKey(key));
    }
    statements.push(`CREATE TABLE ${w.id(entity.name)} (\n${items.map((i) => `  ${i}`).join(",\n")}\n)`);
  }

  deferred.sort((a, b) => position.get(a.table)! - position.get(b.table)! || compareCodePoints(a.name, b.name));
  for (const key of deferred) statements.push(`ALTER TABLE ${w.id(key.table)} ADD ${w.foreignKey(key)}`);

  for (const entity of order) {
    for (const index of entity.indexes) {
      const name = index.name ?? `${entity.name}_${index.columns.join("_")}_idx`;
      statements.push(`CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${w.id(name)} ON ${w.id(entity.name)} (${w.ids(index.columns)})`);
    }
  }

  const header = [`-- Joinery export: ${DIALECT_NAMES[dialect]}`, ...[...w.notes].sort(compareCodePoints).map((n) => `-- note: ${n}`)];
  if (statements.length === 0) return `${header.join("\n")}\n`;
  return `${header.join("\n")}\n\n${statements.map((s) => `${s};`).join("\n\n")}\n`;
}

export function exportFileName(projectName: string, dialect: Dialect): string {
  const slug = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "schema"}-${dialect}.sql`;
}
