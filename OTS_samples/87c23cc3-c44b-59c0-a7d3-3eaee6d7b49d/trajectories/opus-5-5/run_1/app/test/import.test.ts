import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LIMITS, parseMortise } from "../src/shared/mortise.js";
import { exportDdl, type Dialect } from "../src/shared/ddl-export.js";
import { importDdl, type ImportMode } from "../src/server/ddl-import.js";
import { TEMPLATES } from "../src/shared/templates.js";
import { isUniqueColumn, type Model } from "../src/shared/model.js";

const limits = { ...DEFAULT_LIMITS, nestingLimit: 32 };

function run(ddl: string, dialect: Dialect, mode: ImportMode, currentText = "") {
  return importDdl({ bytes: new TextEncoder().encode(ddl), dialect, mode, currentText, current: parseMortise(currentText), limits });
}

function normal(model: Model) {
  const entities = model.entities.map((e) => ({
    name: e.name,
    columns: e.columns.map((c) => ({ ...c, link: null })),
    indexes: e.indexes,
  }));
  const links = model.links
    .map((l) => {
      const flipped = l.token === "-<" ? { from: l.to, to: l.from, token: ">-" } : { from: l.from, to: l.to, token: l.token };
      if (flipped.token === ">-") {
        const entity = model.entities.find((e) => e.name === flipped.from.entity)!;
        const column = entity.columns.find((c) => c.name === flipped.from.column)!;
        if (isUniqueColumn(entity, column)) flipped.token = "--";
      }
      return `${flipped.from.entity}.${flipped.from.column} ${flipped.token} ${flipped.to.entity}.${flipped.to.column} ${l.action}`;
    })
    .sort();
  return { entities: [...entities].sort((a, b) => a.name.localeCompare(b.name)), links, choices: model.choices.map((c) => ({ name: c.name, values: c.values })) };
}

test("postgresql round trip of every template", () => {
  for (const template of TEMPLATES) {
    const source = parseMortise(template.text);
    const ddl = exportDdl(source.model, "postgresql");
    const result = run(ddl, "postgresql", "replace");
    assert.ok(result.ok, JSON.stringify(result));
    if (!result.ok) continue;
    const back = parseMortise(result.text);
    assert.deepEqual(back.errors, []);
    const expected = normal(source.model);
    expected.choices.sort((a, b) => a.name.localeCompare(b.name));
    assert.deepEqual(normal(back.model), expected);
  }
});

test("mysql round trip without choices", () => {
  const source = parseMortise(TEMPLATES[2]!.text);
  const result = run(exportDdl(source.model, "mysql"), "mysql", "replace");
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(normal(parseMortise(result.text).model), normal(source.model));
});

test("unsupported statement and skip words", () => {
  const result = run("SET search_path = x;\nCREATE VIEW v AS SELECT 1;\n", "postgresql", "replace");
  assert.deepEqual(result, { ok: false, lines: ["Line 2, column 1: Unsupported statement: CREATE VIEW"] });
  const ok = run("SET NAMES utf8mb4;\nCOMMIT;\nUSE shop;\nDROP TABLE IF EXISTS loans;\nCREATE TABLE a (id int PRIMARY KEY);\n", "mysql", "replace");
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.report.map((r) => `${r.kind} ${r.name} ${r.status}`), [
      "statement SET NAMES skipped",
      "statement COMMIT skipped",
      "statement USE SHOP skipped",
      "statement DROP TABLE skipped",
      "table a added",
    ]);
    assert.equal(ok.text, "entity a {\n  id int [key]\n}\n");
  }
});

test("merge by table name", () => {
  const current = "# keep me\nentity books {\n  id int [key]\n}\nlink books.id >- books.id\n\nentity Shelves {\n  id int [key]\n}\n";
  const ddl = "CREATE TABLE books (id integer PRIMARY KEY, title text NOT NULL);\nCREATE TABLE shelves (id int);\nCREATE TABLE members (id int, book_id int REFERENCES books (id));\n";
  const result = run(ddl, "postgresql", "merge", current);
  assert.ok(result.ok, JSON.stringify(result));
  if (!result.ok) return;
  assert.equal(
    result.text,
    "# keep me\nentity books {\n  id int [key]\n  title text [required]\n}\n\nentity Shelves {\n  id int [key]\n}\n\nentity members {\n  id int\n  book_id int\n}\nlink members.book_id >- books.id\n",
  );
  assert.deepEqual(result.counts, { added: 1, merged: 1, skipped: 0, ambiguous: 1 });
  const again = run(ddl, "postgresql", "merge", result.text);
  assert.ok(again.ok && !again.changed);
});

test("errors carry positions", () => {
  assert.deepEqual(run("CREATE TABLE a (id int CHECK (id > 0));", "postgresql", "replace"), {
    ok: false,
    lines: ["Line 1, column 24: Unsupported clause: CHECK"],
  });
  assert.deepEqual(run("CREATE TABLE a (id money);", "postgresql", "replace"), { ok: false, lines: ["Line 1, column 20: Unsupported type: MONEY"] });
  assert.deepEqual(run("CREATE TABLE a (id int)", "postgresql", "replace"), { ok: false, lines: ["Line 1, column 24: Missing semicolon at end of statement"] });
  assert.deepEqual(run("CREATE TABLE a (id varchar(0));", "postgresql", "replace"), {
    ok: false,
    lines: ["Line 1, column 1: Type varchar needs a length from 1 to 16383"],
  });
  const bad = importDdl({ bytes: new Uint8Array([0x41, 0x0a, 0x42, 0xff]), dialect: "mysql", mode: "replace", currentText: "", current: parseMortise(""), limits });
  assert.deepEqual(bad, { ok: false, lines: ["Line 2, column 2: Import is not valid UTF-8 text"] });
  assert.deepEqual(run("CREATE TABLE a (id int, " + "(".repeat(40) + ");", "postgresql", "replace"), {
    ok: false,
    lines: ["Line 1, column 56: Nesting is deeper than 32 levels"],
  });
});
