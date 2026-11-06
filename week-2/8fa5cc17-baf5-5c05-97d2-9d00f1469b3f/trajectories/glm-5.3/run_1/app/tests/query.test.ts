import { parseQuery, evalQuery, type QueryType, type QueryObject } from "../src/shared/query.js";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures += 1;
    console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  } else console.log(`ok   ${name}`);
}

const sourceType: QueryType = {
  id: "src",
  name: "Source",
  fields: [
    { name: "Author", kind: "relation", required: false, options: null, target_type_id: "person" },
    { name: "Year", kind: "number", required: false, options: null, target_type_id: null },
    { name: "Kind", kind: "select", required: false, options: ["Book", "Article", "Chapter", "Thesis"], target_type_id: null },
    { name: "Link", kind: "url", required: false, options: null, target_type_id: null },
    { name: "Opened", kind: "date", required: false, options: null, target_type_id: null },
    { name: "Note", kind: "text", required: false, options: null, target_type_id: null },
  ],
};
const personType: QueryType = {
  id: "person",
  name: "Person",
  fields: [{ name: "Affiliation", kind: "text", required: false, options: null, target_type_id: null }],
};
const types = new Map<string, QueryType>([
  ["src", sourceType],
  ["person", personType],
]);

const opts = {
  type: sourceType,
  today: "2026-11-03",
  relationTarget: (f: { target_type_id: string | null }) => (f.target_type_id ? (types.get(f.target_type_id) ?? null) : null),
};

const obj = (properties: Record<string, unknown>, backlinks = 0, title = "x"): QueryObject => ({
  id: "o1",
  title,
  properties,
  backlinks,
  updated_at: "2026-11-01T10:00:00Z",
  updated_date: "2026-11-01",
});

// valid queries
check("empty matches all", parseQuery("", opts).error, null);
check("simple or", parseQuery('Kind = "Book" OR @backlinks >= 1', opts).error, null);
check("and of ors", parseQuery('(Kind = "Book" OR Kind = "Article") AND @title ~ "read"', opts).error, null);
check("not", parseQuery('NOT Kind = "Book"', opts).error, null);
check("null compare", parseQuery("Author = null", opts).error, null);
check("null not", parseQuery("Author != null", opts).error, null);
check("relation path", parseQuery("Author.Affiliation ~ \"fen\"", opts).error, null);
check("relation path title", parseQuery('Author.@title = "hesper vane"', opts).error, null);
check("today", parseQuery("@updated = today", opts).error, null);
check("today - 3d", parseQuery("@updated = today - 3d", opts).error, null);
check("case-insensitive keywords", parseQuery('kind = "book" or @backlinks >= 1', opts).error, null);
check("bracketed name", parseQuery("[Opened Date] = 2020-01-01", opts).error !== null, true);
check("date value on date field", parseQuery("Opened = 2026-10-01", opts).error, null);

// errors with columns
check("unknown field col", parseQuery("Knd = \"Book\"", opts).error, { message: "Unknown field Knd at column 1.", col: 1 });
check("unknown field mid", parseQuery("@backlinks >= 1 AND Knd = 1", opts).error, { message: "Unknown field Knd at column 21.", col: 21 });
check("unexpected number on select", parseQuery("Kind ~ 5", opts).error?.message, "~ does not fit Kind at column 6.");
check("unexpected number as string value", parseQuery("Year = 5 OR @title = 9", opts).error, { message: "Unexpected 9 at column 22.", col: 22 });
check("unexpected end", parseQuery("Kind =", opts).error, { message: "Unexpected end of query at column 7.", col: 7 });
check("op does not fit", parseQuery('Kind ~ 5 OR Link > "x"', opts).error?.message, '~ does not fit Kind at column 6.');
check("unclosed string", parseQuery('Kind = "Book', opts).error, { message: "Unclosed string at column 8.", col: 8 });
check("not a real date", parseQuery("Opened = 2026-02-30", opts).error, { message: "Not a real date at column 10.", col: 10 });
check("not an option", parseQuery('Kind = "Pamphlet"', opts).error, { message: '"Pamphlet" is not an option of Kind at column 8.', col: 8 });
check("wrong value kind", parseQuery("Year = \"Book\"", opts).error, { message: "Unexpected \"Book\" at column 8.", col: 8 });
check("too deeply nested", parseQuery("NOT NOT NOT NOT NOT NOT NOT NOT NOT Kind = \"Book\"", opts).error?.message, "Too deeply nested at column 33.");
check("unbalanced paren end", parseQuery('(Kind = "Book" OR @backlinks >= 1', opts).error, { message: "Unexpected end of query at column 34.", col: 34 });
check("cap 500", parseQuery("Kind = \"Book\" ".repeat(40), opts).error?.message, "Use at most 500 characters.");
check("exactly 500 valid", parseQuery("Kind = \"Book\" OR ".repeat(10) + "Kind = \"Article\"", opts).error, null);

// evaluation
const p = evalCtx();
function evalCtx() {
  return {
    today: "2026-11-03",
    resolveRelation: (id: unknown): QueryObject | null => {
      if (id === "p1") return obj({ Affiliation: "Collegium of Lower Fen" }, 0, "Hesper Vane");
      return null;
    },
  };
}
const book = obj({ Kind: "Book", Year: 1987, Author: "p1" }, 1, "The Gathered Margin");
const article = obj({ Kind: "Article", Year: 2011 }, 2, "Reading by Lamplight");
const thesis = obj({ Kind: "Thesis" }, 0, "x");
check("or matches", [book, article, thesis].map((o) => evalQuery(parseQuery('Kind = "Book" OR @backlinks >= 1', opts).ast, o, p)), [true, true, false]);
check("and matches", [book, article].map((o) => evalQuery(parseQuery('Kind = "Book" AND @backlinks >= 1', opts).ast, o, p)), [true, false]);
check("tilde title", evalQuery(parseQuery('@title ~ "gathered"', opts).ast, book, p), true);
check("tilde case", evalQuery(parseQuery('@title ~ "GATHERED"', opts).ast, book, p), true);
check("not inverts", evalQuery(parseQuery('NOT Kind = "Book"', opts).ast, book, p), false);
check("null author", evalQuery(parseQuery("Author = null", opts).ast, book, p), false);
check("null author thesis", evalQuery(parseQuery("Author = null", opts).ast, thesis, p), true);
check("relpath", evalQuery(parseQuery('Author.Affiliation ~ "collegium"', opts).ast, book, p), true);
check("relpath title", evalQuery(parseQuery('Author.@title = "hesper vane"', opts).ast, book, p), true);
check("updated today-3d", evalQuery(parseQuery("@updated = today - 2d", opts).ast, book, p), true);
check("number gt", evalQuery(parseQuery("Year > 2000", opts).ast, article, p), true);

console.log(failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
