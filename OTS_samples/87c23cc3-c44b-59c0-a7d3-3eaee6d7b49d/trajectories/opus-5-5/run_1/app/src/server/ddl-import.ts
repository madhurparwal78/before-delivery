import { choiceBlock, entityBlock, wholeTextBlocks, type TextBlock } from "../shared/canonical.js";
import type { Dialect } from "../shared/ddl-export.js";
import {
  isUniqueColumn,
  type Choice,
  type Column,
  type ColumnType,
  type DeleteAction,
  type Entity,
  type Index,
  type Link,
  type Literal,
  type Model,
} from "../shared/model.js";
import {
  MAX_NAME_LENGTH,
  compareErrors,
  formatError,
  parseMortise,
  type LangError,
  type ParseLimits,
  type ParseResult,
} from "../shared/mortise.js";
import { splitLines, type TextLine } from "../shared/writeback.js";

export type ImportMode = "merge" | "replace";
export type ReportKind = "table" | "type" | "index" | "foreign key" | "statement";
export type ReportStatus = "added" | "merged" | "skipped" | "ambiguous";

export interface ReportItem {
  line: number;
  kind: ReportKind;
  name: string;
  status: ReportStatus;
}

export interface ImportCounts {
  added: number;
  merged: number;
  skipped: number;
  ambiguous: number;
}

export type ImportOutcome =
  | { ok: true; text: string; changed: boolean; report: ReportItem[]; notes: string[]; counts: ImportCounts }
  | { ok: false; lines: string[] };

export interface ImportLimits extends ParseLimits {
  nestingLimit: number;
}

interface Position {
  line: number;
  column: number;
}

class ImportError {
  constructor(
    readonly position: Position,
    readonly message: string,
  ) {}
}

// ---------------------------------------------------------------------------
// UTF-8 validation

function firstInvalidUtf8(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    let need = 0;
    let min = 0;
    if (b < 0x80) {
      i++;
      continue;
    } else if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      min = 0x10000;
    } else return i;
    if (i + need >= bytes.length) return i;
    let code = b & (0x3f >> need);
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k]!;
      if ((c & 0xc0) !== 0x80) return i;
      code = (code << 6) | (c & 0x3f);
    }
    if (code < min || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return i;
    i += need + 1;
  }
  return -1;
}

function positionOfByte(bytes: Uint8Array, index: number): Position {
  const prefix = new TextDecoder().decode(bytes.subarray(0, index));
  const lines = prefix.split("\n");
  return { line: lines.length, column: Array.from(lines[lines.length - 1]!).length + 1 };
}

// ---------------------------------------------------------------------------
// Lexing

type TokenKind = "word" | "quoted" | "string" | "number" | "punct";

interface Token {
  kind: TokenKind;
  text: string;
  value: string;
  line: number;
  column: number;
  offset: number;
}

interface Lexed {
  tokens: Token[];
  /** The source with comments replaced by spaces, for statement words. */
  blanked: string;
  end: Position;
}

function lex(source: string, dialect: Dialect, nestingLimit: number): Lexed {
  const tokens: Token[] = [];
  const blanked = source.split("");
  let i = 0;
  let line = 1;
  let column = 1;
  let depth = 0;
  const advance = (count: number, blank = false) => {
    for (let k = 0; k < count; k++) {
      const ch = source[i]!;
      if (blank && ch !== "\n") blanked[i] = " ";
      if (ch === "\n") {
        line++;
        column = 1;
      } else if (!(ch.charCodeAt(0) >= 0xdc00 && ch.charCodeAt(0) <= 0xdfff)) column++;
      i++;
    }
  };
  const endPosition = (): Position => ({ line, column });
  const identQuote = dialect === "postgresql" ? '"' : "`";
  while (i < source.length) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f") {
      advance(1);
      continue;
    }
    if (ch === "-" && next === "-") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j++;
      advance(j - i, true);
      continue;
    }
    if (ch === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close === -1) throw new ImportError(lexEnd(source), "Unexpected end of text");
      advance(close + 2 - i, true);
      continue;
    }
    const start = { line, column, offset: i };
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j]!)) j++;
      const text = source.slice(i, j);
      tokens.push({ kind: "word", text, value: text, ...start });
      advance(j - i);
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < source.length && /[0-9]/.test(source[j]!)) j++;
      if (source[j] === "." && /[0-9]/.test(source[j + 1] ?? "")) {
        j += 2;
        while (j < source.length && /[0-9]/.test(source[j]!)) j++;
      }
      const text = source.slice(i, j);
      tokens.push({ kind: "number", text, value: text, ...start });
      advance(j - i);
      continue;
    }
    if (ch === identQuote || ch === "'" || (ch === '"' && dialect === "mysql")) {
      const quote = ch;
      let j = i + 1;
      let value = "";
      for (;;) {
        if (j >= source.length) throw new ImportError(lexEnd(source), "Unexpected end of text");
        const c = source[j]!;
        if (c === "\\" && quote !== identQuote && dialect === "mysql") {
          value += source[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (c === quote) {
          if (source[j + 1] === quote) {
            value += quote;
            j += 2;
            continue;
          }
          break;
        }
        value += c;
        j++;
      }
      const text = source.slice(i, j + 1);
      tokens.push({ kind: quote === identQuote ? "quoted" : "string", text, value, ...start });
      advance(j + 1 - i);
      continue;
    }
    if (ch === ":" && next === ":") {
      tokens.push({ kind: "punct", text: "::", value: "::", ...start });
      advance(2);
      continue;
    }
    const text = source.codePointAt(i)! > 0xffff ? source.slice(i, i + 2) : ch;
    if (text === "(") {
      depth++;
      if (depth > nestingLimit) throw new ImportError(start, `Nesting is deeper than ${nestingLimit} levels`);
    } else if (text === ")") depth = Math.max(0, depth - 1);
    else if (text === ";") depth = 0;
    tokens.push({ kind: "punct", text, value: text, ...start });
    advance(text.length);
  }
  return { tokens, blanked: blanked.join(""), end: endPosition() };
}

function lexEnd(source: string): Position {
  const lines = source.split("\n");
  return { line: lines.length, column: Array.from(lines[lines.length - 1]!).length + 1 };
}

// ---------------------------------------------------------------------------
// Statements

interface Statement {
  tokens: Token[];
  semicolon: Token;
  words: string;
}

function statementWords(blanked: string, from: number, to: number): string {
  const parts = blanked
    .slice(from, to)
    .split(/[\s;(),=]+/)
    .filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p.toUpperCase())
    .join(" ");
}

const SKIPPED: readonly string[][] = [
  ["SET"],
  ["BEGIN"],
  ["COMMIT"],
  ["START", "TRANSACTION"],
  ["DROP", "TABLE"],
  ["CREATE", "EXTENSION"],
  ["CREATE", "SCHEMA"],
  ["USE"],
  ["LOCK", "TABLES"],
  ["UNLOCK", "TABLES"],
];

class Cursor {
  private i = 0;
  constructor(
    readonly tokens: Token[],
    private readonly end: Token,
  ) {}

  peek(n = 0): Token {
    return this.tokens[this.i + n] ?? this.end;
  }

  next(): Token {
    const token = this.peek();
    if (this.i < this.tokens.length) this.i++;
    return token;
  }

  atEnd(): boolean {
    return this.i >= this.tokens.length;
  }

  isWord(word: string, n = 0): boolean {
    const t = this.peek(n);
    return t.kind === "word" && t.value.toUpperCase() === word;
  }

  isWords(...words: string[]): boolean {
    return words.every((w, n) => this.isWord(w, n));
  }

  acceptWords(...words: string[]): boolean {
    if (!this.isWords(...words)) return false;
    for (let k = 0; k < words.length; k++) this.next();
    return true;
  }

  expectWord(word: string): Token {
    if (!this.isWord(word)) fail(this.peek());
    return this.next();
  }

  isPunct(p: string, n = 0): boolean {
    const t = this.peek(n);
    return t.kind === "punct" && t.value === p;
  }

  expectPunct(p: string): Token {
    if (!this.isPunct(p)) fail(this.peek());
    return this.next();
  }

  expectEnd(): void {
    if (!this.atEnd()) fail(this.peek());
  }
}

function fail(token: Token): never {
  throw new ImportError(token, `Unexpected token ${token.text}`);
}

function unsupportedClause(token: Token, clause: string): never {
  throw new ImportError(token, `Unsupported clause: ${clause}`);
}

// ---------------------------------------------------------------------------
// Imported items

interface ImportedColumn {
  column: Column;
  token: Token;
}

interface ForeignKeyDef {
  table: string;
  column: string;
  columnToken: Token;
  refTable: string;
  refTableToken: Token;
  refColumn: string;
  refColumnToken: Token;
  action: DeleteAction | null;
  origin: Position;
}

interface ColumnListRef {
  names: string[];
  tokens: Token[];
}

interface ImportedTable {
  name: string;
  token: Token;
  origin: Position;
  columns: ImportedColumn[];
  keyLists: ColumnListRef[];
  uniqueLists: ColumnListRef[];
  indexes: { index: Index; columns: ColumnListRef }[];
  foreignKeys: ForeignKeyDef[];
  choices: Choice[];
}

interface ImportedType {
  choice: Choice;
  token: Token;
  origin: Position;
}

interface SeparateIndex {
  name: string;
  table: string;
  tableToken: Token;
  unique: boolean;
  columns: ColumnListRef;
  origin: Position;
}

type ParsedStatement =
  | { kind: "table"; table: ImportedTable }
  | { kind: "type"; type: ImportedType }
  | { kind: "index"; index: SeparateIndex }
  | { kind: "foreign key"; key: ForeignKeyDef }
  | { kind: "statement"; words: string; origin: Position };

class DdlParser {
  readonly notes: string[] = [];
  readonly enumNames = new Set<string>();

  constructor(
    private readonly dialect: Dialect,
    existingChoices: string[],
  ) {
    for (const name of existingChoices) this.enumNames.add(name);
  }

  name(c: Cursor): { name: string; token: Token } {
    const token = c.next();
    let name: string;
    if (token.kind === "word") name = this.dialect === "postgresql" ? token.value.toLowerCase() : token.value;
    else if (token.kind === "quoted") name = token.value;
    else fail(token);
    if (Array.from(name).length > MAX_NAME_LENGTH)
      throw new ImportError(token, `Name ${name} is longer than ${MAX_NAME_LENGTH} characters`);
    return { name, token };
  }

  nameList(c: Cursor): ColumnListRef {
    c.expectPunct("(");
    const list: ColumnListRef = { names: [], tokens: [] };
    for (;;) {
      const { name, token } = this.name(c);
      list.names.push(name);
      list.tokens.push(token);
      if (c.isPunct(")")) break;
      c.expectPunct(",");
    }
    c.expectPunct(")");
    return list;
  }

  statement(stmt: Statement): ParsedStatement {
    const first = stmt.tokens[0]!;
    const origin = { line: first.line, column: first.column };
    const c = new Cursor(stmt.tokens, stmt.semicolon);
    for (const entry of SKIPPED) {
      if (c.isWords(...entry)) return { kind: "statement", words: stmt.words, origin };
    }
    if (c.isWords("CREATE", "TABLE")) return { kind: "table", table: this.createTable(c, origin) };
    if (c.isWords("CREATE", "TYPE") && this.dialect === "postgresql") return { kind: "type", type: this.createType(c, origin) };
    if (c.isWords("CREATE", "INDEX") || c.isWords("CREATE", "UNIQUE", "INDEX"))
      return { kind: "index", index: this.createIndex(c, origin) };
    if (c.isWords("ALTER", "TABLE")) return { kind: "foreign key", key: this.alterTable(c, origin) };
    throw new ImportError(origin, `Unsupported statement: ${stmt.words}`);
  }

  createType(c: Cursor, origin: Position): ImportedType {
    c.next();
    c.next();
    const { name, token } = this.name(c);
    c.expectWord("AS");
    c.expectWord("ENUM");
    const values = this.stringList(c);
    c.expectEnd();
    this.enumNames.add(name);
    return { choice: { name, values, line: 0, endLine: 0 }, token, origin };
  }

  stringList(c: Cursor): string[] {
    c.expectPunct("(");
    const values: string[] = [];
    for (;;) {
      const t = c.next();
      if (t.kind !== "string") fail(t);
      values.push(t.value);
      if (c.isPunct(")")) break;
      c.expectPunct(",");
    }
    c.expectPunct(")");
    return values;
  }

  createIndex(c: Cursor, origin: Position): SeparateIndex {
    c.next();
    const unique = c.acceptWords("UNIQUE");
    c.expectWord("INDEX");
    c.acceptWords("IF", "NOT", "EXISTS");
    const nameToken = c.peek();
    this.name(c);
    const name = nameToken.value;
    c.expectWord("ON");
    const table = this.name(c);
    c.acceptWords("USING", "BTREE");
    const columns = this.nameList(c);
    c.expectEnd();
    return { name, table: table.name, tableToken: table.token, unique, columns, origin };
  }

  alterTable(c: Cursor, origin: Position): ForeignKeyDef {
    c.next();
    c.next();
    const table = this.name(c);
    if (!c.isWord("ADD")) {
      if (c.peek().kind !== "word") fail(c.peek());
      unsupportedClause(c.peek(), clauseWords(c));
    }
    const add = c.next();
    let named = false;
    if (c.isWord("CONSTRAINT")) {
      c.next();
      const constraint = this.name(c);
      this.notes.push(`Line ${constraint.token.line}: constraint name ${constraint.name} not kept`);
      named = true;
    }
    if (!c.isWords("FOREIGN", "KEY")) {
      const t = c.peek();
      if (t.kind !== "word") fail(t);
      const word = t.value.toUpperCase();
      if (word === "CHECK" || word === "UNIQUE") unsupportedClause(t, word);
      if (word === "PRIMARY") unsupportedClause(t, clauseWords(c));
      if (named) fail(t);
      unsupportedClause(add, `ADD ${word}`);
    }
    const key = this.foreignKeyBody(c, table.name, origin);
    c.expectEnd();
    return key;
  }

  foreignKeyBody(c: Cursor, table: string, origin: Position): ForeignKeyDef {
    const foreign = c.next();
    c.next();
    const columns = this.nameList(c);
    if (columns.names.length > 1) unsupportedClause(foreign, "composite FOREIGN KEY");
    return this.references(c, table, columns.names[0]!, columns.tokens[0]!, origin, foreign);
  }

  references(c: Cursor, table: string, column: string, columnToken: Token, origin: Position, clauseToken: Token): ForeignKeyDef {
    c.expectWord("REFERENCES");
    const ref = this.name(c);
    const refColumns = this.nameList(c);
    if (refColumns.names.length > 1) unsupportedClause(clauseToken, "composite FOREIGN KEY");
    let action: DeleteAction | null = null;
    while (c.isWord("ON")) {
      if (c.isWord("UPDATE", 1)) unsupportedClause(c.peek(), "ON UPDATE");
      if (!c.isWord("DELETE", 1)) fail(c.peek(1));
      c.next();
      c.next();
      if (c.acceptWords("CASCADE")) action = "cascade";
      else if (c.acceptWords("RESTRICT")) action = "restrict";
      else if (c.acceptWords("SET", "NULL")) action = "set null";
      else if (c.acceptWords("NO", "ACTION")) action = "no action";
      else if (c.isWords("SET", "DEFAULT")) unsupportedClause(c.peek(), "SET DEFAULT");
      else fail(c.peek());
    }
    return {
      table,
      column,
      columnToken,
      refTable: ref.name,
      refTableToken: ref.token,
      refColumn: refColumns.names[0]!,
      refColumnToken: refColumns.tokens[0]!,
      action,
      origin,
    };
  }

  createTable(c: Cursor, origin: Position): ImportedTable {
    c.next();
    c.next();
    c.acceptWords("IF", "NOT", "EXISTS");
    const { name, token } = this.name(c);
    const table: ImportedTable = {
      name,
      token,
      origin,
      columns: [],
      keyLists: [],
      uniqueLists: [],
      indexes: [],
      foreignKeys: [],
      choices: [],
    };
    c.expectPunct("(");
    for (;;) {
      this.tableItem(c, table);
      if (c.isPunct(")")) break;
      c.expectPunct(",");
    }
    c.expectPunct(")");
    this.tableOptions(c);
    c.expectEnd();
    return table;
  }

  tableOptions(c: Cursor): void {
    while (!c.atEnd()) {
      const t = c.peek();
      if (t.kind !== "word") fail(t);
      if (this.dialect !== "mysql") unsupportedClause(t, t.value.toUpperCase());
      let option: string;
      if (c.acceptWords("ENGINE")) option = "ENGINE";
      else if (c.acceptWords("DEFAULT", "CHARSET")) option = "DEFAULT CHARSET";
      else if (c.acceptWords("CHARSET")) option = "CHARSET";
      else if (c.acceptWords("COLLATE")) option = "COLLATE";
      else if (c.acceptWords("AUTO_INCREMENT")) option = "AUTO_INCREMENT";
      else unsupportedClause(t, t.value.toUpperCase());
      if (c.isPunct("=")) c.next();
      const value = c.next();
      if (value.kind === "punct") fail(value);
      this.notes.push(`Line ${t.line}: table option ${option} ignored`);
    }
  }

  tableItem(c: Cursor, table: ImportedTable): void {
    if (c.isWord("CONSTRAINT")) {
      c.next();
      const constraint = this.name(c);
      this.notes.push(`Line ${constraint.token.line}: constraint name ${constraint.name} not kept`);
      this.tableConstraint(c, table, true);
      return;
    }
    if (this.tableConstraint(c, table, false)) return;
    this.columnDef(c, table);
  }

  /** Parses a table constraint when one starts here; returns false when the item is a column. */
  tableConstraint(c: Cursor, table: ImportedTable, required: boolean): boolean {
    if (c.isWords("PRIMARY", "KEY")) {
      c.next();
      c.next();
      table.keyLists.push(this.nameList(c));
      return true;
    }
    if (c.isWord("UNIQUE")) {
      c.next();
      if (c.isWord("KEY") || c.isWord("INDEX")) {
        c.next();
        if (!c.isPunct("(")) {
          const keyName = this.name(c);
          this.notes.push(`Line ${keyName.token.line}: constraint name ${keyName.name} not kept`);
        }
      }
      table.uniqueLists.push(this.nameList(c));
      return true;
    }
    if (c.isWords("FOREIGN", "KEY")) {
      table.foreignKeys.push(this.foreignKeyBody(c, table.name, table.origin));
      return true;
    }
    if (c.isWord("CHECK")) unsupportedClause(c.peek(), "CHECK");
    if (this.dialect === "mysql" && (c.isWord("INDEX") || c.isWord("KEY")) && !c.isPunct("(", 1) && c.peek(2).value === "(") {
      c.next();
      const indexName = c.peek().value;
      this.name(c);
      const columns = this.nameList(c);
      const defaultName = `${table.name}_${columns.names.join("_")}_idx`;
      table.indexes.push({ index: { columns: columns.names, unique: false, name: indexName === defaultName ? null : indexName }, columns });
      return true;
    }
    if (required) fail(c.peek());
    return false;
  }

  columnDef(c: Cursor, table: ImportedTable): void {
    const { name, token } = this.name(c);
    const column: Column = {
      name,
      type: { name: "", params: [] },
      key: false,
      auto: false,
      required: false,
      unique: false,
      default: null,
      link: null,
    };
    const typed = this.columnType(c, table, name);
    column.type = typed.type;
    column.auto = typed.auto;
    for (;;) {
      if (c.atEnd() || c.isPunct(",") || c.isPunct(")")) break;
      const t = c.peek();
      if (t.kind !== "word") fail(t);
      if (c.acceptWords("NOT", "NULL")) column.required = true;
      else if (c.acceptWords("NULL")) continue;
      else if (c.acceptWords("PRIMARY", "KEY")) column.key = true;
      else if (c.acceptWords("UNIQUE")) {
        c.acceptWords("KEY");
        column.unique = true;
      } else if (c.acceptWords("AUTO_INCREMENT")) column.auto = true;
      else if (c.acceptWords("GENERATED", "BY", "DEFAULT", "AS", "IDENTITY")) column.auto = true;
      else if (c.isWords("GENERATED", "ALWAYS", "AS", "IDENTITY")) {
        this.notes.push(`Line ${t.line}: GENERATED ALWAYS imported as auto`);
        c.acceptWords("GENERATED", "ALWAYS", "AS", "IDENTITY");
        column.auto = true;
      } else if (c.isWord("DEFAULT")) {
        c.next();
        column.default = this.defaultValue(c);
      } else if (c.isWord("REFERENCES")) {
        table.foreignKeys.push(this.references(c, table.name, name, token, table.origin, t));
      } else if (c.isWord("CONSTRAINT")) {
        c.next();
        const constraint = this.name(c);
        this.notes.push(`Line ${constraint.token.line}: constraint name ${constraint.name} not kept`);
      } else if (c.isWords("ON", "UPDATE")) unsupportedClause(t, "ON UPDATE");
      else unsupportedClause(t, t.value.toUpperCase());
    }
    table.columns.push({ column, token });
  }

  defaultValue(c: Cursor): Literal {
    const t = c.next();
    if (t.kind === "string") return { kind: "string", text: t.value };
    if (t.kind === "number") return { kind: t.value.includes(".") ? "decimal" : "integer", text: t.value };
    if (t.kind === "punct" && t.value === "-" && c.peek().kind === "number") {
      const n = c.next();
      return { kind: n.value.includes(".") ? "decimal" : "integer", text: `-${n.value}` };
    }
    if (t.kind === "word") {
      const word = t.value.toUpperCase();
      if (word === "TRUE") return { kind: "true", text: "true" };
      if (word === "FALSE") return { kind: "false", text: "false" };
      if (word === "NULL") return { kind: "null", text: "null" };
      if (word === "CURRENT_TIMESTAMP") return { kind: "now", text: "now" };
      if (word === "NOW" && c.isPunct("(") && c.isPunct(")", 1)) {
        c.next();
        c.next();
        return { kind: "now", text: "now" };
      }
      if (word === "NEXTVAL") unsupportedClause(t, "DEFAULT nextval");
    }
    fail(t);
  }

  columnType(c: Cursor, table: ImportedTable, column: string): { type: ColumnType; auto: boolean } {
    const t = c.next();
    if (t.kind === "quoted" && this.dialect === "postgresql") {
      if (this.enumNames.has(t.value)) return { type: { name: t.value, params: [] }, auto: false };
      throw new ImportError(t, `Unsupported type: ${t.text}`);
    }
    if (t.kind !== "word") fail(t);
    const pg = this.dialect === "postgresql";
    let word = t.value.toLowerCase();
    let written = t.value.toUpperCase();
    if (word === "double" && c.isWord("PRECISION")) {
      c.next();
      word = "double precision";
      written = "DOUBLE PRECISION";
    } else if (word === "character" && c.isWord("VARYING")) {
      c.next();
      word = "character varying";
      written = "CHARACTER VARYING";
    } else if (word === "timestamp" && pg && c.isWords("WITH", "TIME", "ZONE")) {
      c.acceptWords("WITH", "TIME", "ZONE");
      word = "timestamptz";
    } else if (word === "timestamp" && pg && c.isWords("WITHOUT", "TIME", "ZONE")) {
      c.acceptWords("WITHOUT", "TIME", "ZONE");
    }
    if (word === "enum" && !pg) {
      const values = this.stringList(c);
      const choiceName = `${table.name}_${column}`;
      table.choices.push({ name: choiceName, values, line: 0, endLine: 0 });
      return { type: { name: choiceName, params: [] }, auto: false };
    }
    const params: number[] = [];
    if (c.isPunct("(")) {
      c.next();
      for (;;) {
        const n = c.next();
        if (n.kind !== "number" || n.value.includes(".")) fail(n);
        params.push(Number(n.value));
        if (c.isPunct(")")) break;
        c.expectPunct(",");
      }
      c.next();
    }
    const simple = (name: string): { type: ColumnType; auto: boolean } => ({ type: { name, params: [] }, auto: false });
    const integer = (name: string): { type: ColumnType; auto: boolean } => {
      if (params.length) this.notes.push(`Line ${t.line}: display width on ${column} ignored`);
      return simple(name);
    };
    switch (word) {
      case "integer":
      case "int":
      case "int4":
        return integer("int");
      case "smallint":
      case "int2":
        return integer("smallint");
      case "bigint":
      case "int8":
        return integer("bigint");
      case "serial":
        return { type: { name: "int", params: [] }, auto: true };
      case "smallserial":
        return { type: { name: "smallint", params: [] }, auto: true };
      case "bigserial":
        return { type: { name: "bigint", params: [] }, auto: true };
      case "tinyint":
        if (!pg && params.length === 1 && params[0] === 1) return simple("bool");
        break;
      case "numeric":
      case "decimal":
        return { type: { name: "decimal", params }, auto: false };
      case "real":
      case "float4":
      case "float":
        return simple("float");
      case "double precision":
      case "float8":
      case "double":
        return simple("double");
      case "boolean":
      case "bool":
        return simple("bool");
      case "text":
        return simple("text");
      case "varchar":
      case "character varying":
        return { type: { name: "varchar", params }, auto: false };
      case "char":
      case "character":
        return { type: { name: "char", params }, auto: false };
      case "date":
        return simple("date");
      case "time":
        return simple("time");
      case "timestamp":
        return simple(pg ? "timestamp" : "timestamptz");
      case "timestamptz":
        if (pg) return simple("timestamptz");
        break;
      case "datetime":
        if (!pg) return simple("timestamp");
        break;
      case "uuid":
        return simple("uuid");
      case "json":
      case "jsonb":
        return simple("json");
      case "bytea":
      case "blob":
      case "longblob":
        return simple("bytes");
      default: {
        const enumName = pg ? word : t.value;
        if (pg && this.enumNames.has(enumName)) return simple(enumName);
      }
    }
    throw new ImportError(t, `Unsupported type: ${written}`);
  }
}

function clauseWords(c: Cursor): string {
  const first = c.peek();
  const second = c.peek(1);
  return second.kind === "word" ? `${first.value.toUpperCase()} ${second.value.toUpperCase()}` : first.value.toUpperCase();
}

// ---------------------------------------------------------------------------
// Building the result

interface OriginLine extends TextLine {
  origin: Position | null;
}

export interface ImportInput {
  bytes: Uint8Array;
  dialect: Dialect;
  mode: ImportMode;
  currentText: string;
  current: ParseResult;
  limits: ImportLimits;
}

export function importDdl(input: ImportInput): ImportOutcome {
  try {
    return runImport(input);
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, lines: [formatError({ ...error.position, message: error.message })] };
    throw error;
  }
}

function runImport({ bytes, dialect, mode, currentText, current, limits }: ImportInput): ImportOutcome {
  const bad = firstInvalidUtf8(bytes);
  if (bad !== -1) throw new ImportError(positionOfByte(bytes, bad), "Import is not valid UTF-8 text");
  const source = new TextDecoder().decode(bytes);
  const lexed = lex(source, dialect, limits.nestingLimit);

  const statements: Statement[] = [];
  let pending: Token[] = [];
  for (const token of lexed.tokens) {
    if (token.kind === "punct" && token.value === ";") {
      if (pending.length) {
        if (statements.length === limits.statementLimit) {
          throw new ImportError(pending[0]!, `Import has more than ${limits.statementLimit} statements`);
        }
        statements.push({ tokens: pending, semicolon: token, words: statementWords(lexed.blanked, pending[0]!.offset, token.offset) });
      }
      pending = [];
    } else pending.push(token);
  }
  if (pending.length) {
    const last = pending[pending.length - 1]!;
    throw new ImportError({ line: last.line, column: last.column + Array.from(last.text).length }, "Missing semicolon at end of statement");
  }

  const merge = mode === "merge";
  const existing = current.model;
  const parser = new DdlParser(dialect, merge ? existing.choices.map((ch) => ch.name) : []);
  const errors: LangError[] = [];
  const parsed: ParsedStatement[] = [];
  for (const stmt of statements) {
    try {
      parsed.push(parser.statement(stmt));
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      errors.push({ ...error.position, message: error.message });
    }
  }
  if (errors.length) return failure(errors);

  const existingEntities = new Set(merge ? existing.entities.map((e) => e.name) : []);
  const existingLower = new Map<string, string>();
  if (merge) for (const e of existing.entities) existingLower.set(e.name.toLowerCase(), e.name);
  const isAmbiguous = (name: string) => merge && !existingEntities.has(name) && existingLower.has(name.toLowerCase());

  const tables = new Map<string, ImportedTable>();
  for (const p of parsed) {
    if (p.kind !== "table") continue;
    if (tables.has(p.table.name)) {
      errors.push({ ...pos(p.table.token), message: `Duplicate table in import: ${p.table.name}` });
      continue;
    }
    tables.set(p.table.name, p.table);
  }
  const imported = (name: string) => tables.has(name) && !isAmbiguous(name);
  const columnExists = (table: string, column: string): boolean => {
    const t = tables.get(table);
    if (t) return t.columns.some((c) => c.column.name === column);
    return existing.entities.find((e) => e.name === table)?.columns.some((c) => c.name === column) ?? false;
  };

  const foreignKeys: ForeignKeyDef[] = [];
  for (const table of tables.values()) {
    for (const list of [...table.keyLists, ...table.uniqueLists, ...table.indexes.map((i) => i.columns)]) {
      list.names.forEach((name, k) => {
        if (!columnExists(table.name, name)) errors.push({ ...pos(list.tokens[k]!), message: `Unknown column ${table.name}.${name}` });
      });
    }
    foreignKeys.push(...table.foreignKeys);
  }
  for (const p of parsed) if (p.kind === "foreign key") foreignKeys.push(p.key);
  for (const key of foreignKeys) {
    for (const [name, token] of [
      [key.table, key.columnToken],
      [key.refTable, key.refTableToken],
    ] as const) {
      if (isAmbiguous(name)) errors.push({ ...pos(token), message: `Foreign key points to ambiguous table ${name}` });
    }
    if (!tables.has(key.table)) {
      if (!isAmbiguous(key.table)) errors.push({ ...key.origin, message: `Unknown table in foreign key: ${key.table}` });
      continue;
    }
    const refKnown = tables.has(key.refTable) || existingEntities.has(key.refTable);
    if (!refKnown) {
      if (!isAmbiguous(key.refTable)) errors.push({ ...pos(key.refTableToken), message: `Unknown table in foreign key: ${key.refTable}` });
      continue;
    }
    if (!columnExists(key.table, key.column))
      errors.push({ ...pos(key.columnToken), message: `Unknown column ${key.table}.${key.column}` });
    if (!columnExists(key.refTable, key.refColumn))
      errors.push({ ...pos(key.refColumnToken), message: `Unknown column ${key.refTable}.${key.refColumn}` });
  }
  for (const p of parsed) {
    if (p.kind !== "index") continue;
    if (!imported(p.index.table)) {
      errors.push({ ...pos(p.index.tableToken), message: `Unknown table in index: ${p.index.table}` });
      continue;
    }
    p.index.columns.names.forEach((name, k) => {
      if (!columnExists(p.index.table, name))
        errors.push({ ...pos(p.index.columns.tokens[k]!), message: `Unknown column ${p.index.table}.${name}` });
    });
  }
  if (errors.length) return failure(errors);

  // The imported model, with each block remembering the statement it came from.
  const model: Model = { choices: [], entities: [], links: [], groups: [], statements: [] };
  const choiceOrigin = new Map<string, Position>();
  const entityOrigin = new Map<string, Position>();
  const linkOrigin = new Map<Link, Position>();
  const order: { kind: "choice" | "entity"; name: string }[] = [];
  for (const p of parsed) {
    if (p.kind === "type") {
      model.choices.push(p.type.choice);
      choiceOrigin.set(p.type.choice.name, p.type.origin);
      order.push({ kind: "choice", name: p.type.choice.name });
    } else if (p.kind === "table" && imported(p.table.name) && tables.get(p.table.name) === p.table) {
      const table = p.table;
      for (const choice of table.choices) {
        model.choices.push(choice);
        choiceOrigin.set(choice.name, table.origin);
        order.push({ kind: "choice", name: choice.name });
      }
      const keyNames = new Set(table.keyLists.flatMap((l) => l.names));
      const columns = table.columns.map(({ column }) => ({ ...column, key: column.key || keyNames.has(column.name) }));
      const indexes: Index[] = table.indexes.map((i) => i.index);
      for (const list of table.uniqueLists) {
        if (list.names.length === 1) {
          const col = columns.find((c) => c.name === list.names[0]);
          if (col) col.unique = true;
        } else indexes.push({ columns: list.names, unique: true, name: null });
      }
      const entity: Entity = { name: table.name, columns, indexes, line: 0, endLine: 0 };
      model.entities.push(entity);
      entityOrigin.set(entity.name, table.origin);
      order.push({ kind: "entity", name: entity.name });
    }
  }
  for (const p of parsed) {
    if (p.kind !== "index") continue;
    const entity = model.entities.find((e) => e.name === p.index.table)!;
    const defaultName = `${entity.name}_${p.index.columns.names.join("_")}_idx`;
    entity.indexes.push({
      columns: p.index.columns.names,
      unique: p.index.unique,
      name: p.index.name === defaultName ? null : p.index.name,
    });
  }
  for (const key of foreignKeys) {
    if (!imported(key.table)) continue;
    const entity = model.entities.find((e) => e.name === key.table)!;
    const column = entity.columns.find((c) => c.name === key.column)!;
    const link: Link = {
      from: { entity: key.table, column: key.column },
      token: isUniqueColumn(entity, column) ? "--" : ">-",
      to: { entity: key.refTable, column: key.refColumn },
      action: key.action,
      line: 0,
      inline: false,
    };
    model.links.push(link);
    linkOrigin.set(link, key.origin);
  }

  const firstOrigin: Position = statements.length ? pos(statements[0]!.tokens[0]!) : { line: 1, column: 1 };
  const blockOrigins = (block: TextBlock): Position[] => {
    const base = block.kind === "choice" ? choiceOrigin.get(block.name)! : entityOrigin.get(block.name)!;
    const entityLines = block.lines.length - block.links.length;
    return block.lines.map((_, i) => (i < entityLines ? base : linkOrigin.get(block.links[i - entityLines]!)!));
  };

  let lines: OriginLine[];
  if (!merge) {
    lines = [];
    wholeTextBlocks(model).forEach((block, index) => {
      if (index > 0) lines.push({ content: "", eol: "\n", origin: null });
      const origins = blockOrigins(block);
      block.lines.forEach((content, i) => lines.push({ content, eol: "\n", origin: origins[i]! }));
    });
  } else {
    lines = splitLines(currentText).map((l) => ({ ...l, origin: null }));
    const replacements: { start: number; end: number; block: TextBlock }[] = [];
    const appended: TextBlock[] = [];
    for (const item of order) {
      if (item.kind === "choice") {
        const choice = model.choices.find((ch) => ch.name === item.name)!;
        const match = existing.choices.find((ch) => ch.name === item.name);
        if (match) replacements.push({ start: match.line, end: match.endLine, block: choiceBlock(choice) });
        else appended.push(choiceBlock(choice));
      } else {
        const entity = model.entities.find((e) => e.name === item.name)!;
        const match = existing.entities.find((e) => e.name === item.name);
        if (match) {
          let end = match.endLine;
          while (current.linkLines.has(end + 1)) end++;
          replacements.push({ start: match.line, end, block: entityBlock(model, entity) });
        } else appended.push(entityBlock(model, entity));
      }
    }
    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      const eol = lines[r.end - 1]!.eol;
      const origins = blockOrigins(r.block);
      const fill = r.block.lines.map((content, i): OriginLine => ({
        content,
        eol: i === r.block.lines.length - 1 ? eol : eolOf(lines),
        origin: origins[i]!,
      }));
      lines.splice(r.start - 1, r.end - r.start + 1, ...fill);
    }
    for (const block of appended) {
      const eol = eolOf(lines);
      if (lines.length) {
        const last = lines[lines.length - 1]!;
        if (last.eol === "") last.eol = eol;
        lines.push({ content: "", eol, origin: null });
      }
      const origins = blockOrigins(block);
      block.lines.forEach((content, i) => lines.push({ content, eol, origin: origins[i]! }));
    }
  }

  const text = lines.map((l) => l.content + l.eol).join("");
  const check = parseMortise(text, limits);
  if (check.errors.length) {
    return failure(check.errors.map((e) => ({ ...(lines[e.line - 1]?.origin ?? firstOrigin), message: e.message })));
  }

  const report: ReportItem[] = [];
  const tableStatus = (name: string): ReportStatus =>
    !merge ? "added" : isAmbiguous(name) ? "ambiguous" : existingEntities.has(name) ? "merged" : "added";
  for (const p of parsed) {
    switch (p.kind) {
      case "table":
        report.push({ line: p.table.origin.line, kind: "table", name: p.table.name, status: tableStatus(p.table.name) });
        break;
      case "type":
        report.push({
          line: p.type.origin.line,
          kind: "type",
          name: p.type.choice.name,
          status: merge && existing.choices.some((ch) => ch.name === p.type.choice.name) ? "merged" : "added",
        });
        break;
      case "index":
        report.push({ line: p.index.origin.line, kind: "index", name: p.index.name, status: tableStatus(p.index.table) });
        break;
      case "foreign key":
        report.push({
          line: p.key.origin.line,
          kind: "foreign key",
          name: `${p.key.table}.${p.key.column}`,
          status: tableStatus(p.key.table),
        });
        break;
      case "statement":
        report.push({ line: p.origin.line, kind: "statement", name: p.words, status: "skipped" });
        break;
    }
  }
  const tableItems = report.filter((r) => r.kind === "table");
  const counts: ImportCounts = {
    added: tableItems.filter((r) => r.status === "added").length,
    merged: tableItems.filter((r) => r.status === "merged").length,
    skipped: report.filter((r) => r.kind === "statement").length,
    ambiguous: tableItems.filter((r) => r.status === "ambiguous").length,
  };
  return { ok: true, text, changed: text !== currentText, report, notes: parser.notes, counts };
}

function eolOf(lines: TextLine[]): "\n" | "\r\n" {
  for (let i = lines.length - 1; i >= 0; i--) {
    const eol = lines[i]!.eol;
    if (eol) return eol;
  }
  return "\n";
}

function pos(token: { line: number; column: number }): Position {
  return { line: token.line, column: token.column };
}

function failure(errors: LangError[]): ImportOutcome {
  const lines = [...new Set(errors.sort(compareErrors).map(formatError))];
  return { ok: false, lines };
}
