import {
  INTEGER_TYPES,
  emptyModel,
  isUniqueColumn,
  typeText,
  type Choice,
  type Column,
  type ColumnType,
  type DeleteAction,
  type Entity,
  type Group,
  type Index,
  type Link,
  type LinkToken,
  type Literal,
  type Model,
  type Ref,
  type Statement,
} from "./model.js";

export interface LangError {
  line: number;
  column: number;
  message: string;
}

export interface ParseLimits {
  textLimitBytes: number;
  entityLimit: number;
  statementLimit: number;
}

export const DEFAULT_LIMITS: ParseLimits = { textLimitBytes: 200000, entityLimit: 200, statementLimit: 1000 };

/** Where a name that refers to an entity sits in the text, as UTF-16 offsets. */
export interface EntityNameSpan {
  entity: string;
  start: number;
  end: number;
}

export interface ParseResult {
  errors: LangError[];
  model: Model;
  entitySpans: EntityNameSpan[];
  /** 1-based lines holding top-level link statements. */
  linkLines: Set<number>;
}

export const MAX_NAME_LENGTH = 64;

export const BUILTIN_TYPES: readonly string[] = [
  "int",
  "smallint",
  "bigint",
  "decimal",
  "float",
  "double",
  "bool",
  "text",
  "varchar",
  "char",
  "date",
  "time",
  "timestamp",
  "timestamptz",
  "uuid",
  "json",
  "bytes",
];

const STATEMENT_KEYWORDS = new Set(["entity", "choice", "link", "group"]);

export function formatError(error: LangError): string {
  return `Line ${error.line}, column ${error.column}: ${error.message}`;
}

export function compareErrors(a: LangError, b: LangError): number {
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function textTooLargeMessage(limit: number): string {
  return `Text is larger than ${limit} bytes`;
}

// ---------------------------------------------------------------------------
// Lexing

type TokenKind = "name" | "dq" | "sq" | "int" | "dec" | "punct" | "arrow" | "other" | "open-quote";

interface Token {
  kind: TokenKind;
  /** The token as written. */
  raw: string;
  /** Names: the name; dq: the content; sq: the unescaped value. */
  value: string;
  line: number;
  column: number;
  start: number;
  end: number;
}

interface LexedLine {
  number: number;
  tokens: Token[];
  /** Column just past the last character before any comment, trailing blanks ignored. */
  endColumn: number;
}

function isLetter(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function lexLine(line: string, number: number, offset: number): LexedLine {
  const chars = Array.from(line);
  const units: number[] = [];
  let u = offset;
  for (const ch of chars) {
    units.push(u);
    u += ch.length;
  }
  units.push(u);
  const tokens: Token[] = [];
  let lastContent = 0;
  let i = 0;
  const push = (kind: TokenKind, from: number, to: number, value: string) => {
    const raw = chars.slice(from, to).join("");
    tokens.push({ kind, raw, value, line: number, column: from + 1, start: units[from]!, end: units[to]! });
    lastContent = to;
  };
  while (i < chars.length) {
    const ch = chars[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "#") break;
    if (isLetter(ch)) {
      let j = i + 1;
      while (j < chars.length && (isLetter(chars[j]!) || isDigit(chars[j]!))) j++;
      push("name", i, j, chars.slice(i, j).join(""));
      i = j;
    } else if (isDigit(ch)) {
      let j = i + 1;
      while (j < chars.length && isDigit(chars[j]!)) j++;
      let kind: TokenKind = "int";
      if (chars[j] === "." && j + 1 < chars.length && isDigit(chars[j + 1]!)) {
        j += 2;
        while (j < chars.length && isDigit(chars[j]!)) j++;
        kind = "dec";
      }
      push(kind, i, j, chars.slice(i, j).join(""));
      i = j;
    } else if (ch === '"') {
      let j = i + 1;
      while (j < chars.length && chars[j] !== '"') j++;
      if (j >= chars.length) {
        push("open-quote", i, chars.length, "");
        lastContent = chars.length;
        break;
      }
      push("dq", i, j + 1, chars.slice(i + 1, j).join(""));
      i = j + 1;
    } else if (ch === "'") {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < chars.length) {
        if (chars[j] === "'") {
          if (chars[j + 1] === "'") {
            value += "'";
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        value += chars[j];
        j++;
      }
      if (!closed) {
        push("open-quote", i, chars.length, "");
        break;
      }
      push("sq", i, j + 1, value);
      i = j + 1;
    } else if (ch === ">" && chars[i + 1] === "-") {
      if (chars[i + 2] === "<") {
        push("arrow", i, i + 3, ">-<");
        i += 3;
      } else {
        push("arrow", i, i + 2, ">-");
        i += 2;
      }
    } else if (ch === "-" && (chars[i + 1] === "<" || chars[i + 1] === "-")) {
      push("arrow", i, i + 2, chars[i + 1] === "<" ? "-<" : "--");
      i += 2;
    } else if ("{}[](),:.".includes(ch)) {
      push("punct", i, i + 1, ch);
      i++;
    } else {
      push("other", i, i + 1, ch);
      i++;
    }
  }
  return { number, tokens, endColumn: lastContent + 1 };
}

// ---------------------------------------------------------------------------
// Parsing

class SyntaxFailure {
  constructor(readonly error: LangError) {}
}

interface NameToken {
  name: string;
  token: Token;
}

interface PendingColumn {
  column: Column;
  nameToken: Token;
  typeToken: Token;
  paramsToken: Token | null;
  autoToken: Token | null;
  defaultToken: Token | null;
  literalToken: Token | null;
  linkToken: Token | null;
  linkRefTokens: [Token, Token] | null;
}

interface PendingIndex {
  index: Index;
  columnTokens: NameToken[];
}

interface PendingEntity {
  entity: Entity;
  nameToken: Token;
  braceToken: Token;
  columns: PendingColumn[];
  indexes: PendingIndex[];
}

interface PendingLink {
  link: Link;
  startToken: Token;
  fromToken: Token;
  fromColumnToken: Token;
  toToken: Token;
  toColumnToken: Token;
  actionToken: Token | null;
}

interface PendingList {
  kind: "choice" | "group";
  name: string;
  nameToken: Token;
  items: NameToken[];
  line: number;
  endLine: number;
}

type TopStatement =
  | { kind: "choice"; list: PendingList }
  | { kind: "entity"; entity: PendingEntity }
  | { kind: "link"; link: PendingLink }
  | { kind: "group"; list: PendingList };

class Parser {
  readonly errors: LangError[] = [];
  readonly statements: TopStatement[] = [];
  readonly entitySpans: EntityNameSpan[] = [];
  readonly linkLines = new Set<number>();
  private lines: LexedLine[] = [];
  private textEnd: { line: number; column: number } = { line: 1, column: 1 };
  private statementCount = 0;
  private entityCount = 0;

  constructor(
    private readonly text: string,
    private readonly limits: ParseLimits,
  ) {}

  run(): void {
    const rawLines = this.text.split("\n");
    let offset = 0;
    this.lines = rawLines.map((raw, index) => {
      const content = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      const lexed = lexLine(content, index + 1, offset);
      offset += raw.length + 1;
      return lexed;
    });
    const last = rawLines[rawLines.length - 1]!;
    this.textEnd = { line: rawLines.length, column: Array.from(last.endsWith("\r") ? last.slice(0, -1) : last).length + 1 };

    let open: PendingEntity | null = null;
    let skipping = false;
    let i = 0;
    while (i < this.lines.length) {
      const line = this.lines[i]!;
      const tokens = line.tokens;
      if (tokens.length === 0) {
        i++;
        continue;
      }
      if (skipping) {
        if (tokens.length === 1 && tokens[0]!.raw === "}") skipping = false;
        i++;
        continue;
      }
      if (open) {
        const first = tokens[0]!;
        if (first.kind === "name" && STATEMENT_KEYWORDS.has(first.value)) {
          this.missingBrace(open);
          open.entity.endLine = line.number - 1;
          this.closeEntity(open);
          open = null;
          continue;
        }
        if (first.raw === "}") {
          open.entity.endLine = line.number;
          if (tokens.length > 1) this.unexpected(tokens[1]!);
          this.closeEntity(open);
          open = null;
          i++;
          continue;
        }
        this.member(open, line);
        i++;
        continue;
      }
      const first = tokens[0]!;
      const keyword = first.kind === "name" ? first.value : "";
      if (keyword === "entity") {
        this.countStatement(first);
        const result = this.entityHeader(line);
        if (result === "skip") skipping = true;
        else if (result) open = result;
        i++;
      } else if (keyword === "choice" || keyword === "group") {
        this.countStatement(first);
        i = this.list(keyword, i);
      } else if (keyword === "link") {
        this.countStatement(first);
        this.linkLines.add(line.number);
        this.linkLine(line);
        i++;
      } else {
        this.unexpected(first);
        i++;
      }
    }
    if (open) {
      this.missingBrace(open);
      open.entity.endLine = this.lines.length;
      this.closeEntity(open);
    }
  }

  private countStatement(token: Token): void {
    this.statementCount++;
    if (this.statementCount === this.limits.statementLimit + 1) {
      this.check(token, `Schema has more than ${this.limits.statementLimit} statements`);
    }
  }

  private check(token: { line: number; column: number }, message: string): void {
    this.errors.push({ line: token.line, column: token.column, message });
  }

  private unexpected(token: Token): void {
    if (token.kind === "open-quote") {
      const line = this.lines[token.line - 1]!;
      this.errors.push({ line: token.line, column: line.endColumn, message: "Unexpected end of line" });
    } else this.check(token, `Unexpected token ${token.raw}`);
  }

  private fail(token: Token): never {
    if (token.kind === "open-quote") {
      const line = this.lines[token.line - 1]!;
      throw new SyntaxFailure({ line: token.line, column: line.endColumn, message: "Unexpected end of line" });
    }
    throw new SyntaxFailure({ line: token.line, column: token.column, message: `Unexpected token ${token.raw}` });
  }

  private endOfLine(line: LexedLine): never {
    throw new SyntaxFailure({ line: line.number, column: line.endColumn, message: "Unexpected end of line" });
  }

  private missingBrace(open: PendingEntity): void {
    this.check(open.braceToken, `Missing closing brace for entity ${open.entity.name}`);
  }

  /** Reads a name token: a bare name or a valid quoted name. */
  private nameAt(line: LexedLine, index: number): NameToken {
    const token = line.tokens[index];
    if (!token) this.endOfLine(line);
    if (token.kind === "name") {
      this.checkLength(token, token.value);
      return { name: token.value, token };
    }
    if (token.kind === "dq" && validQuotedName(token.value)) {
      this.checkLength(token, token.value);
      return { name: token.value, token };
    }
    this.fail(token);
  }

  private checkLength(token: Token, name: string): void {
    if (Array.from(name).length > MAX_NAME_LENGTH) this.check(token, `Name ${name} is longer than ${MAX_NAME_LENGTH} characters`);
  }

  private expect(line: LexedLine, index: number, raw: string): Token {
    const token = line.tokens[index];
    if (!token) this.endOfLine(line);
    if (token.raw !== raw || (token.kind !== "punct" && token.kind !== "arrow")) this.fail(token);
    return token;
  }

  private expectEnd(line: LexedLine, index: number): void {
    const token = line.tokens[index];
    if (token) this.fail(token);
  }

  private entityHeader(line: LexedLine): PendingEntity | "skip" {
    const tokens = line.tokens;
    let name: NameToken | null = null;
    try {
      name = this.nameAt(line, 1);
      const brace = this.expect(line, 2, "{");
      this.expectEnd(line, 3);
      return this.openEntity(name, brace, line);
    } catch (failure) {
      if (!(failure instanceof SyntaxFailure)) throw failure;
      this.errors.push(failure.error);
      const lastToken = tokens[tokens.length - 1]!;
      if (name && lastToken.raw === "{" && lastToken.kind === "punct") return this.openEntity(name, lastToken, line);
      return "skip";
    }
  }

  private openEntity(name: NameToken, brace: Token, line: LexedLine): PendingEntity {
    this.entityCount++;
    if (this.entityCount === this.limits.entityLimit + 1) {
      this.check(line.tokens[0]!, `Schema has more than ${this.limits.entityLimit} entities`);
    }
    this.entitySpans.push({ entity: name.name, start: name.token.start, end: name.token.end });
    const pending: PendingEntity = {
      entity: { name: name.name, columns: [], indexes: [], line: line.number, endLine: line.number },
      nameToken: name.token,
      braceToken: brace,
      columns: [],
      indexes: [],
    };
    this.statements.push({ kind: "entity", entity: pending });
    return pending;
  }

  private closeEntity(open: PendingEntity): void {
    if (open.columns.length === 0) this.check(open.nameToken, `Entity ${open.entity.name} has no columns`);
  }

  private member(open: PendingEntity, line: LexedLine): void {
    const tokens = line.tokens;
    try {
      if (tokens[0]!.kind === "name" && tokens[0]!.value === "index" && tokens[1]?.raw === "(" && tokens[1].kind === "punct") {
        this.index(open, line);
      } else this.column(open, line);
    } catch (failure) {
      if (!(failure instanceof SyntaxFailure)) throw failure;
      this.errors.push(failure.error);
    }
  }

  private column(open: PendingEntity, line: LexedLine): void {
    const tokens = line.tokens;
    const name = this.nameAt(line, 0);
    const typeToken = tokens[1];
    if (!typeToken) this.endOfLine(line);
    if (typeToken.kind !== "name") this.fail(typeToken);
    const type: ColumnType = { name: typeToken.value, params: [] };
    let i = 2;
    let paramsToken: Token | null = null;
    if (tokens[i]?.raw === "(" && tokens[i]!.kind === "punct") {
      paramsToken = tokens[i]!;
      i++;
      for (;;) {
        const num = tokens[i];
        if (!num) this.endOfLine(line);
        if (num.kind !== "int") this.fail(num);
        type.params.push(Number(num.value));
        i++;
        const sep = tokens[i];
        if (!sep) this.endOfLine(line);
        if (sep.raw === ")" && sep.kind === "punct") {
          i++;
          break;
        }
        if (sep.raw !== "," || sep.kind !== "punct" || type.params.length >= 2) this.fail(sep);
        i++;
      }
    }
    const pending: PendingColumn = {
      column: { name: name.name, type, key: false, auto: false, required: false, unique: false, default: null, link: null },
      nameToken: name.token,
      typeToken,
      paramsToken,
      autoToken: null,
      defaultToken: null,
      literalToken: null,
      linkToken: null,
      linkRefTokens: null,
    };
    const unknownSettings: Token[] = [];
    if (tokens[i]?.raw === "[" && tokens[i]!.kind === "punct") {
      i++;
      for (;;) {
        const setting = tokens[i];
        if (!setting) this.endOfLine(line);
        if (setting.kind !== "name") this.fail(setting);
        i++;
        switch (setting.value) {
          case "key":
            pending.column.key = true;
            break;
          case "auto":
            pending.column.auto = true;
            pending.autoToken = setting;
            break;
          case "required":
            pending.column.required = true;
            break;
          case "unique":
            pending.column.unique = true;
            break;
          case "default": {
            this.expect(line, i, ":");
            i++;
            const literalToken = tokens[i];
            if (!literalToken) this.endOfLine(line);
            pending.column.default = literalOf(literalToken) ?? this.fail(literalToken);
            pending.defaultToken = setting;
            pending.literalToken = literalToken;
            i++;
            break;
          }
          case "link": {
            this.expect(line, i, ":");
            i++;
            const arrow = tokens[i];
            if (!arrow) this.endOfLine(line);
            if (arrow.kind !== "arrow") this.fail(arrow);
            i++;
            const [ref, refTokens, next] = this.ref(line, i);
            i = next;
            pending.column.link = { token: arrow.value as LinkToken, to: ref };
            pending.linkToken = setting;
            pending.linkRefTokens = refTokens;
            break;
          }
          default:
            unknownSettings.push(setting);
            while (tokens[i] && !(tokens[i]!.kind === "punct" && (tokens[i]!.raw === "," || tokens[i]!.raw === "]"))) i++;
        }
        const sep = tokens[i];
        if (!sep) this.endOfLine(line);
        if (sep.kind === "punct" && sep.raw === "]") {
          i++;
          break;
        }
        if (sep.kind !== "punct" || sep.raw !== ",") this.fail(sep);
        i++;
      }
    }
    for (const setting of unknownSettings) this.check(setting, `Unknown setting ${setting.value}`);
    this.expectEnd(line, i);
    if (open.columns.some((c) => c.column.name === name.name)) {
      this.check(name.token, `Column ${name.name} is already defined in entity ${open.entity.name}`);
      return;
    }
    if (pending.linkRefTokens) {
      const refToken = pending.linkRefTokens[0];
      this.entitySpans.push({ entity: refToken.value, start: refToken.start, end: refToken.end });
    }
    open.columns.push(pending);
    open.entity.columns.push(pending.column);
  }

  private ref(line: LexedLine, i: number): [Ref, [Token, Token], number] {
    const entity = this.nameAt(line, i);
    this.expect(line, i + 1, ".");
    const column = this.nameAt(line, i + 2);
    return [{ entity: entity.name, column: column.name }, [entity.token, column.token], i + 3];
  }

  private index(open: PendingEntity, line: LexedLine): void {
    const tokens = line.tokens;
    let i = 2;
    const columnTokens: NameToken[] = [];
    for (;;) {
      columnTokens.push(this.nameAt(line, i));
      i++;
      const sep = tokens[i];
      if (!sep) this.endOfLine(line);
      if (sep.kind === "punct" && sep.raw === ")") {
        i++;
        break;
      }
      if (sep.kind !== "punct" || sep.raw !== ",") this.fail(sep);
      i++;
    }
    const index: Index = { columns: columnTokens.map((c) => c.name), unique: false, name: null };
    if (tokens[i]?.raw === "[" && tokens[i]!.kind === "punct") {
      i++;
      for (;;) {
        const setting = tokens[i];
        if (!setting) this.endOfLine(line);
        if (setting.kind === "name" && setting.value === "unique") {
          index.unique = true;
          i++;
        } else if (setting.kind === "name" && setting.value === "name") {
          this.expect(line, i + 1, ":");
          const value = tokens[i + 2];
          if (!value) this.endOfLine(line);
          if (value.kind !== "dq" || !validQuotedLabel(value.value)) this.fail(value);
          index.name = value.value;
          i += 3;
        } else this.fail(setting);
        const sep = tokens[i];
        if (!sep) this.endOfLine(line);
        if (sep.kind === "punct" && sep.raw === "]") {
          i++;
          break;
        }
        if (sep.kind !== "punct" || sep.raw !== ",") this.fail(sep);
        i++;
      }
    }
    this.expectEnd(line, i);
    open.indexes.push({ index, columnTokens });
    open.entity.indexes.push(index);
  }

  private linkLine(line: LexedLine): void {
    const tokens = line.tokens;
    try {
      const [from, fromTokens, afterFrom] = this.ref(line, 1);
      const arrow = tokens[afterFrom];
      if (!arrow) this.endOfLine(line);
      if (arrow.kind !== "arrow") this.fail(arrow);
      const [to, toTokens, afterTo] = this.ref(line, afterFrom + 1);
      let i = afterTo;
      let action: DeleteAction | null = null;
      let actionToken: Token | null = null;
      if (tokens[i]) {
        this.expect(line, i, "[");
        const word = tokens[i + 1];
        if (!word) this.endOfLine(line);
        if (word.kind !== "name" || word.value !== "delete") this.fail(word);
        this.expect(line, i + 2, ":");
        const first = tokens[i + 3];
        if (!first) this.endOfLine(line);
        actionToken = first;
        i += 4;
        if (first.kind === "name" && (first.value === "cascade" || first.value === "restrict")) action = first.value;
        else if (first.kind === "name" && (first.value === "set" || first.value === "no")) {
          const second = tokens[i];
          if (!second) this.endOfLine(line);
          const wanted = first.value === "set" ? "null" : "action";
          if (second.kind !== "name" || second.value !== wanted) this.fail(second);
          action = first.value === "set" ? "set null" : "no action";
          i++;
        } else this.fail(first);
        this.expect(line, i, "]");
        i++;
        this.expectEnd(line, i);
      }
      const link: Link = { from, token: arrow.value as LinkToken, to, action, line: line.number, inline: false };
      this.entitySpans.push({ entity: from.entity, start: fromTokens[0].start, end: fromTokens[0].end });
      this.entitySpans.push({ entity: to.entity, start: toTokens[0].start, end: toTokens[0].end });
      this.statements.push({
        kind: "link",
        link: {
          link,
          startToken: tokens[0]!,
          fromToken: fromTokens[0],
          fromColumnToken: fromTokens[1],
          toToken: toTokens[0],
          toColumnToken: toTokens[1],
          actionToken,
        },
      });
    } catch (failure) {
      if (!(failure instanceof SyntaxFailure)) throw failure;
      this.errors.push(failure.error);
    }
  }

  /** Parses a choice or group, which may span lines. Returns the index of the next line to read. */
  private list(kind: "choice" | "group", start: number): number {
    let lineIndex = start;
    let tokenIndex = 1;
    const startLine = this.lines[start]!;
    const list: PendingList = {
      kind,
      name: "",
      nameToken: startLine.tokens[0]!,
      items: [],
      line: startLine.number,
      endLine: startLine.number,
    };
    let opened = false;
    let braceToken: Token | null = null;

    const current = (): LexedLine => this.lines[lineIndex]!;
    const finishAt = (): number => lineIndex + 1;
    const statement: TopStatement = kind === "choice" ? { kind: "choice", list } : { kind: "group", list };
    const label = (): string => (kind === "choice" ? `choice ${list.name}` : `group "${list.name}"`);

    /** Moves to the next token, crossing line ends once the list is open. Returns null when the block ends early. */
    const next = (): Token | "end-of-text" | "keyword" => {
      for (;;) {
        const line = current();
        const token = line.tokens[tokenIndex];
        if (token) return token;
        if (!opened) this.endOfLine(line);
        if (lineIndex + 1 >= this.lines.length) return "end-of-text";
        lineIndex++;
        tokenIndex = 0;
        const first = current().tokens[0];
        if (first && first.kind === "name" && STATEMENT_KEYWORDS.has(first.value)) return "keyword";
      }
    };

    try {
      if (kind === "choice") {
        const name = this.nameAt(startLine, 1);
        list.name = name.name;
        list.nameToken = name.token;
      } else {
        const token = startLine.tokens[1];
        if (!token) this.endOfLine(startLine);
        if (token.kind !== "dq" || !validQuotedLabel(token.value)) this.fail(token);
        list.name = token.value;
        list.nameToken = token;
      }
      braceToken = this.expect(startLine, 2, "{");
      opened = true;
      this.statements.push(statement);
      tokenIndex = 3;
      for (;;) {
        const item = next();
        if (item === "end-of-text") {
          this.errors.push({ ...this.textEnd, message: "Unexpected end of text" });
          list.endLine = current().number;
          return this.lines.length;
        }
        if (item === "keyword") {
          this.check(braceToken, `Missing closing brace for ${label()}`);
          list.endLine = current().number - 1;
          return lineIndex;
        }
        const name = this.nameAt(current(), tokenIndex);
        list.items.push(name);
        tokenIndex++;
        const sep = next();
        if (sep === "end-of-text") {
          this.errors.push({ ...this.textEnd, message: "Unexpected end of text" });
          list.endLine = current().number;
          return this.lines.length;
        }
        if (sep === "keyword") {
          this.check(braceToken, `Missing closing brace for ${label()}`);
          list.endLine = current().number - 1;
          return lineIndex;
        }
        tokenIndex++;
        if (sep.kind === "punct" && sep.raw === "}") break;
        if (sep.kind !== "punct" || sep.raw !== ",") this.fail(sep);
      }
      list.endLine = current().number;
      this.expectEnd(current(), tokenIndex);
      return finishAt();
    } catch (failure) {
      if (!(failure instanceof SyntaxFailure)) throw failure;
      this.errors.push(failure.error);
      if (!opened) {
        // Skip forward to the next closing brace without defining anything.
        return this.skipToBrace(lineIndex, tokenIndex);
      }
      list.endLine = current().number;
      if (
        failure.error.line === current().number &&
        current().tokens.some((t, idx) => idx >= tokenIndex && t.raw === "}" && t.kind === "punct")
      ) {
        return finishAt();
      }
      const resume = this.skipToBrace(lineIndex + 1, 0);
      list.endLine = Math.min(resume, this.lines.length);
      return resume;
    }
  }

  /** Returns the index of the line after the one holding the next closing brace at or after the given position. */
  private skipToBrace(lineIndex: number, tokenIndex: number): number {
    for (let l = lineIndex; l < this.lines.length; l++) {
      const tokens = this.lines[l]!.tokens;
      for (let t = l === lineIndex ? tokenIndex : 0; t < tokens.length; t++) {
        if (tokens[t]!.kind === "punct" && tokens[t]!.raw === "}") return l + 1;
      }
    }
    return this.lines.length;
  }

  // -------------------------------------------------------------------------
  // Checks on statements that parsed

  finish(): Model {
    const model = emptyModel();
    const entityByName = new Map<string, PendingEntity>();
    const choiceByName = new Map<string, PendingList>();
    const groupByName = new Map<string, PendingList>();
    const statements: Statement[] = [];
    const pendingLinks: PendingLink[] = [];

    for (const statement of this.statements) {
      if (statement.kind === "entity") {
        const first = entityByName.get(statement.entity.entity.name);
        if (first) {
          this.check(statement.entity.nameToken, `Entity ${statement.entity.entity.name} is already defined on line ${first.entity.line}`);
          continue;
        }
        entityByName.set(statement.entity.entity.name, statement.entity);
      } else if (statement.kind === "choice") {
        const first = choiceByName.get(statement.list.name);
        if (first) {
          this.check(statement.list.nameToken, `Choice ${statement.list.name} is already defined on line ${first.line}`);
          continue;
        }
        choiceByName.set(statement.list.name, statement.list);
      } else if (statement.kind === "group") {
        const first = groupByName.get(statement.list.name);
        if (first) {
          this.check(statement.list.nameToken, `Group "${statement.list.name}" is already defined on line ${first.line}`);
          continue;
        }
        groupByName.set(statement.list.name, statement.list);
      }
    }

    const choices = new Map<string, Choice>();
    for (const list of choiceByName.values()) {
      const seen = new Set<string>();
      for (const item of list.items) {
        if (seen.has(item.name)) this.check(item.token, `Choice ${list.name} lists ${item.name} twice`);
        seen.add(item.name);
      }
      choices.set(list.name, { name: list.name, values: [...seen], line: list.line, endLine: list.endLine });
    }

    const columnOf = new Map<string, { entity: PendingEntity; column: PendingColumn }>();
    for (const statement of this.statements) {
      if (statement.kind !== "entity") continue;
      const pending = statement.entity;
      const isFirst = entityByName.get(pending.entity.name) === pending;
      for (const column of pending.columns) {
        this.checkColumn(pending, column, choices);
        if (isFirst) columnOf.set(`${pending.entity.name}\u0000${column.column.name}`, { entity: pending, column });
      }
      for (const index of pending.indexes) {
        for (const nameToken of index.columnTokens) {
          if (!pending.columns.some((c) => c.column.name === nameToken.name)) {
            this.check(nameToken.token, `Index names missing column ${pending.entity.name}.${nameToken.name}`);
          }
        }
      }
    }

    for (const statement of this.statements) {
      if (statement.kind === "entity") {
        if (entityByName.get(statement.entity.entity.name) !== statement.entity) continue;
        statements.push({ kind: "entity", entity: statement.entity.entity });
        model.entities.push(statement.entity.entity);
        for (const column of statement.entity.columns) {
          if (!column.column.link || !column.linkToken || !column.linkRefTokens) continue;
          const link: Link = {
            from: { entity: statement.entity.entity.name, column: column.column.name },
            token: column.column.link.token,
            to: column.column.link.to,
            action: null,
            line: column.nameToken.line,
            inline: true,
          };
          pendingLinks.push({
            link,
            startToken: column.linkToken,
            fromToken: column.nameToken,
            fromColumnToken: column.nameToken,
            toToken: column.linkRefTokens[0],
            toColumnToken: column.linkRefTokens[1],
            actionToken: null,
          });
          statements.push({ kind: "link", link });
        }
      } else if (statement.kind === "link") {
        pendingLinks.push(statement.link);
        statements.push({ kind: "link", link: statement.link.link });
      } else if (statement.kind === "choice") {
        const choice = choices.get(statement.list.name)!;
        if (choiceByName.get(statement.list.name) !== statement.list) continue;
        statements.push({ kind: "choice", choice });
        model.choices.push(choice);
      } else {
        if (groupByName.get(statement.list.name) !== statement.list) continue;
        const group: Group = { name: statement.list.name, entities: [], line: statement.list.line, endLine: statement.list.endLine };
        statements.push({ kind: "group", group });
        model.groups.push(group);
      }
    }

    const groupOf = new Map<string, string>();
    for (const list of groupByName.values()) {
      const group = model.groups.find((g) => g.name === list.name)!;
      for (const item of list.items) {
        this.entitySpans.push({ entity: item.name, start: item.token.start, end: item.token.end });
        if (!entityByName.has(item.name)) {
          this.check(item.token, `Group "${list.name}" names missing entity ${item.name}`);
          continue;
        }
        const existing = groupOf.get(item.name);
        if (existing !== undefined) {
          this.check(item.token, `Entity ${item.name} is already in group "${existing}"`);
          continue;
        }
        groupOf.set(item.name, list.name);
        group.entities.push(item.name);
      }
      const order = model.entities.map((e) => e.name);
      group.entities.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    }

    const seenLinks = new Map<string, number>();
    for (const pending of pendingLinks) {
      const link = pending.link;
      const from = this.resolve(link.from, pending.fromToken, entityByName, columnOf);
      const to = this.resolve(link.to, pending.toToken, entityByName, columnOf);
      if (from && to) {
        const fromType = from.column.column.type;
        const toType = to.column.column.type;
        const known = (t: ColumnType) => BUILTIN_TYPES.includes(t.name) || choices.has(t.name);
        if (known(fromType) && known(toType) && !sameBaseType(fromType, toType)) {
          this.check(pending.toToken, `Link joins ${typeText(fromType)} to ${typeText(toType)}`);
        }
      }
      if (from && link.token === "--" && !isUniqueColumn(from.entity.entity, from.column.column)) {
        this.check(pending.fromToken, `One-to-one link needs ${link.from.entity}.${link.from.column} to be unique`);
      }
      if (link.action === "set null" && pending.actionToken && link.token !== ">-<") {
        const fk = link.token === "-<" ? to : from;
        const fkRef = link.token === "-<" ? link.to : link.from;
        if (fk && (fk.column.column.required || fk.column.column.key)) {
          this.check(pending.actionToken, `Link sets null on required column ${fkRef.entity}.${fkRef.column}`);
        }
      }
      const a = `${link.from.entity}.${link.from.column}`;
      const b = `${link.to.entity}.${link.to.column}`;
      const pair = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
      const firstLine = seenLinks.get(pair);
      if (firstLine !== undefined) {
        this.check(pending.startToken, `Link ${a} to ${b} is already defined on line ${firstLine}`);
      } else seenLinks.set(pair, link.line);
      if (from && to) model.links.push(link);
    }

    model.statements = statements.filter((s) => s.kind !== "link" || model.links.includes(s.link));
    return model;
  }

  private resolve(
    ref: Ref,
    token: Token,
    entities: Map<string, PendingEntity>,
    columns: Map<string, { entity: PendingEntity; column: PendingColumn }>,
  ): { entity: PendingEntity; column: PendingColumn } | null {
    if (!entities.has(ref.entity)) {
      this.check(token, `Link points to missing entity ${ref.entity}`);
      return null;
    }
    const found = columns.get(`${ref.entity}\u0000${ref.column}`);
    if (!found) {
      this.check(token, `Link points to missing column ${ref.entity}.${ref.column}`);
      return null;
    }
    return found;
  }

  private checkColumn(entity: PendingEntity, pending: PendingColumn, choices: Map<string, Choice>): void {
    const column = pending.column;
    const type = column.type;
    const choice = choices.get(type.name);
    if (BUILTIN_TYPES.includes(type.name)) {
      const message = typeParamsMessage(type);
      if (message === "no-params") this.check(pending.paramsToken!, `Type ${type.name} takes no parameters`);
      else if (message) this.check(pending.typeToken, message);
    } else if (choice) {
      if (pending.paramsToken) this.check(pending.paramsToken, `Type ${type.name} takes no parameters`);
    } else {
      this.check(pending.typeToken, `Unknown type ${type.name}`);
    }
    if (column.auto && pending.autoToken && !INTEGER_TYPES.includes(type.name)) {
      this.check(pending.autoToken, "Setting auto needs an integer column");
    }
    if (column.default && pending.defaultToken && pending.literalToken) {
      if (column.key && column.default.kind === "null") {
        this.check(pending.defaultToken, `Key column ${entity.entity.name}.${column.name} cannot default to null`);
      }
      if (choice && column.default.kind !== "null" && !choice.values.includes(column.default.text)) {
        this.check(pending.literalToken, `Value ${column.default.text} is not in choice ${choice.name}`);
      }
    }
  }
}

function sameBaseType(a: ColumnType, b: ColumnType): boolean {
  if (a.name === b.name) return true;
  return INTEGER_TYPES.includes(a.name) && INTEGER_TYPES.includes(b.name);
}

/** Returns null when the parameters suit the type, "no-params" when it takes none, or the message to report at the type. */
export function typeParamsMessage(type: ColumnType): string | null {
  const p = type.params;
  switch (type.name) {
    case "varchar":
      return p.length === 1 && p[0]! >= 1 && p[0]! <= 16383 ? null : "Type varchar needs a length from 1 to 16383";
    case "char":
      return p.length === 1 && p[0]! >= 1 && p[0]! <= 255 ? null : "Type char needs a length from 1 to 255";
    case "decimal":
      return p.length === 2 && p[0]! >= 1 && p[0]! <= 65 && p[1]! >= 0 && p[1]! <= 30 && p[1]! <= p[0]!
        ? null
        : "Type decimal needs a precision from 1 to 65 and a scale from 0 to 30 that is not above the precision";
    default:
      return p.length ? "no-params" : null;
  }
}

function literalOf(token: Token): Literal | null {
  switch (token.kind) {
    case "int":
      return { kind: "integer", text: token.value };
    case "dec":
      return { kind: "decimal", text: token.value };
    case "sq":
      return { kind: "string", text: token.value };
    case "name":
      if (token.value === "true" || token.value === "false" || token.value === "null" || token.value === "now") {
        return { kind: token.value, text: token.value };
      }
      return null;
    default:
      return null;
  }
}

export function validQuotedName(content: string): boolean {
  if (content.length < 1) return false;
  for (const ch of content) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code > 0x7e || ch === '"' || ch === "\\" || ch === "." || ch === "`") return false;
  }
  return true;
}

export function validQuotedLabel(content: string): boolean {
  const length = Array.from(content).length;
  return length >= 1 && length <= 40 && !content.includes('"');
}

export function parseMortise(text: string, limits: ParseLimits = DEFAULT_LIMITS): ParseResult {
  if (utf8Length(text) > limits.textLimitBytes) {
    return {
      errors: [{ line: 1, column: 1, message: textTooLargeMessage(limits.textLimitBytes) }],
      model: emptyModel(),
      entitySpans: [],
      linkLines: new Set(),
    };
  }
  const parser = new Parser(text, limits);
  parser.run();
  const model = parser.finish();
  const errors = parser.errors.sort(compareErrors);
  return { errors, model, entitySpans: parser.entitySpans, linkLines: parser.linkLines };
}
