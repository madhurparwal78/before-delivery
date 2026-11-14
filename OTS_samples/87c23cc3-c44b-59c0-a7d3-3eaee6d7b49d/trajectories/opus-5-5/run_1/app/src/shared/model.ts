export type LinkToken = ">-" | "-<" | "--" | ">-<";
export type Cardinality = "many-to-one" | "one-to-many" | "one-to-one" | "many-to-many";
export type DeleteAction = "cascade" | "restrict" | "set null" | "no action";

export const CARDINALITY: Record<LinkToken, Cardinality> = {
  ">-": "many-to-one",
  "-<": "one-to-many",
  "--": "one-to-one",
  ">-<": "many-to-many",
};

export const CARDINALITY_WORDS: Record<Cardinality, string> = {
  "many-to-one": "many to one",
  "one-to-many": "one to many",
  "one-to-one": "one to one",
  "many-to-many": "many to many",
};

export type LiteralKind = "integer" | "decimal" | "string" | "true" | "false" | "null" | "now";

export interface Literal {
  kind: LiteralKind;
  /** Digits as written for numbers, the unescaped value for strings, the keyword otherwise. */
  text: string;
}

export interface ColumnType {
  name: string;
  params: number[];
}

export interface Ref {
  entity: string;
  column: string;
}

export interface Column {
  name: string;
  type: ColumnType;
  key: boolean;
  auto: boolean;
  required: boolean;
  unique: boolean;
  default: Literal | null;
  link: { token: LinkToken; to: Ref } | null;
}

export interface Index {
  columns: string[];
  unique: boolean;
  name: string | null;
}

export interface Entity {
  name: string;
  columns: Column[];
  indexes: Index[];
  /** 1-based line of the header. */
  line: number;
  /** 1-based line of the closing brace. */
  endLine: number;
}

export interface Choice {
  name: string;
  values: string[];
  line: number;
  endLine: number;
}

export interface Link {
  from: Ref;
  token: LinkToken;
  to: Ref;
  action: DeleteAction | null;
  line: number;
  inline: boolean;
}

export interface Group {
  name: string;
  entities: string[];
  line: number;
  endLine: number;
}

export type Statement =
  { kind: "choice"; choice: Choice } | { kind: "entity"; entity: Entity } | { kind: "link"; link: Link } | { kind: "group"; group: Group };

export interface Model {
  choices: Choice[];
  entities: Entity[];
  links: Link[];
  groups: Group[];
  statements: Statement[];
}

export const INTEGER_TYPES: readonly string[] = ["int", "smallint", "bigint"];

export function emptyModel(): Model {
  return { choices: [], entities: [], links: [], groups: [], statements: [] };
}

export function refText(ref: Ref): string {
  return `${ref.entity}.${ref.column}`;
}

export function findEntity(model: Model, name: string): Entity | undefined {
  return model.entities.find((e) => e.name === name);
}

export function findColumn(model: Model, ref: Ref): Column | undefined {
  return findEntity(model, ref.entity)?.columns.find((c) => c.name === ref.column);
}

/** The column holding the foreign key of a link, or null for many-to-many links. */
export function foreignKeySide(link: Link): { column: Ref; references: Ref } | null {
  switch (link.token) {
    case ">-":
    case "--":
      return { column: link.from, references: link.to };
    case "-<":
      return { column: link.to, references: link.from };
    case ">-<":
      return null;
  }
}

/** A column counts as unique when it has the unique setting, is the sole key, or is the sole column of a unique index. */
export function isUniqueColumn(entity: Entity, column: Column): boolean {
  if (column.unique) return true;
  const keys = entity.columns.filter((c) => c.key);
  if (keys.length === 1 && keys[0] === column) return true;
  return entity.indexes.some((i) => i.unique && i.columns.length === 1 && i.columns[0] === column.name);
}

export function typeText(type: ColumnType): string {
  return type.params.length ? `${type.name}(${type.params.join(",")})` : type.name;
}
