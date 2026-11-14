import { test } from "node:test";
import assert from "node:assert/strict";
import { formatError, parseMortise } from "../src/shared/mortise.js";

const errorsOf = (text: string) => parseMortise(text).errors.map(formatError);

test("worked multi-error example", () => {
  const text = [
    "entity books [key] {",
    "  id int [key]",
    "  title strng",
    "}",
    "",
    "entity loans",
    "  id int [key]",
    "  book_id int",
    "}",
    "link loans.book_id >- books.id",
    "link books.id >- shelves.id",
    "",
  ].join("\n");
  assert.deepEqual(errorsOf(text), [
    "Line 1, column 14: Unexpected token [",
    "Line 3, column 9: Unknown type strng",
    "Line 6, column 13: Unexpected end of line",
    "Line 10, column 6: Link points to missing entity loans",
    "Line 11, column 18: Link points to missing entity shelves",
  ]);
});

test("worked example 1 parses", () => {
  const text = `entity authors {
  id int [key, auto]
  name varchar(80) [required]
}

entity books {
  id int [key, auto]
  title text [required]
  author_id int [required]
}
link books.author_id >- authors.id
`;
  const result = parseMortise(text);
  assert.deepEqual(result.errors, []);
  assert.equal(result.model.entities.length, 2);
  assert.equal(result.model.links.length, 1);
});

test("choice example", () => {
  const text = `choice shelf_kind { fiction, reference, "large print" }

entity shelves {
  id int [key]
  kind shelf_kind [required, default: 'fiction']
}
`;
  const result = parseMortise(text);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.model.choices[0]!.values, ["fiction", "reference", "large print"]);
});

test("composite key and group", () => {
  const text = `entity loans {
  book_id int [key]
  member_id int [key]
  copy_no smallint [required]
  started_on date [required]
  index (member_id, started_on) [unique, name: "loans_one_per_day"]
}

entity beds {
  id int [key]
}

entity trays {
  id int [key]
  bed_id int
}
link trays.bed_id >- beds.id

group "Potting shed" { beds, trays }
`;
  const result = parseMortise(text);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.model.groups[0]!.entities, ["beds", "trays"]);
  assert.equal(result.model.entities[0]!.indexes[0]!.name, "loans_one_per_day");
});

test("assorted check errors", () => {
  const text = `choice c { a, b, a }
entity e {
  id int(4) [key, default: null]
  v varchar(0)
  d decimal(4,5)
  k c [default: 'z']
  t text [auto, wat]
  id int
  index (nope)
}
entity e {
  x int
}
entity empty {
}
link e.t -- e.v
link e.v -- e.t
link e.k >- e.id [delete: set null]
group "G" { e, e, ghost }
`;
  assert.deepEqual(errorsOf(text), [
    "Line 1, column 18: Choice c lists a twice",
    "Line 3, column 9: Type int takes no parameters",
    "Line 3, column 19: Key column e.id cannot default to null",
    "Line 4, column 5: Type varchar needs a length from 1 to 16383",
    "Line 5, column 5: Type decimal needs a precision from 1 to 65 and a scale from 0 to 30 that is not above the precision",
    "Line 6, column 17: Value z is not in choice c",
    "Line 7, column 11: Setting auto needs an integer column",
    "Line 7, column 17: Unknown setting wat",
    "Line 8, column 3: Column id is already defined in entity e",
    "Line 9, column 10: Index names missing column e.nope",
    "Line 11, column 8: Entity e is already defined on line 2",
    "Line 14, column 8: Entity empty has no columns",
    "Line 16, column 6: One-to-one link needs e.t to be unique",
    "Line 16, column 13: Link joins text to varchar(0)",
    "Line 17, column 1: Link e.v to e.t is already defined on line 16",
    "Line 17, column 6: One-to-one link needs e.v to be unique",
    "Line 17, column 13: Link joins varchar(0) to text",
    "Line 18, column 13: Link joins c to int(4)",
    "Line 19, column 16: Entity e is already in group \"G\"",
    "Line 19, column 19: Group \"G\" names missing entity ghost",
  ]);
});

test("missing braces and end of text", () => {
  assert.deepEqual(errorsOf("entity a {\n  id int\nlink a.id >- a.id\n"), [
    "Line 1, column 10: Missing closing brace for entity a",
  ]);
  assert.deepEqual(errorsOf("choice c { a,\n b"), ["Line 2, column 3: Unexpected end of text"]);
  assert.deepEqual(errorsOf("choice c { a,\nentity x {\n  id int\n}\n"), ["Line 1, column 10: Missing closing brace for choice c"]);
  assert.deepEqual(errorsOf("hello world\n"), ["Line 1, column 1: Unexpected token hello"]);
});
