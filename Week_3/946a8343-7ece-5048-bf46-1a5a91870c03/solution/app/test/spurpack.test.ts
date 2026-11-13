import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { commitId, treeId, treeIdFromFiles, blobId } from "../src/server/lib/objects.ts";
import {
  decodeField,
  decodeList,
  encodeField,
  encodeList,
  packUsers,
  parsePack,
  previewSentence,
  serializePack,
  type PackCommit,
  type PackModel,
} from "../src/server/lib/spurpack.ts";

const FIRST = "2fb8c1cda9fb9f60c6a31ab386849d1e1f88d512c877f639f59e90e8c808ba65";
const T = "\t";

const SAMPLE = [
  "spurpack 1",
  "user\tasha",
  "file\tREADME.md\thello\\n",
  `commit\t${FIRST}\t-\tasha 1767225600\tasha 1767225600\tFirst commit`,
  `ref\tbranch\tmain\t${FIRST}`,
  "label\tpriority::high\t-",
  "milestone\tSprint 1\t2026-01-05\t2026-01-16\tUTC\tactive",
  "issue\t1\tExport fails\topened\tasha\tpriority::high\tSprint 1\t3\tfalse\t-",
  "wikipage\thome\t1\tasha\tHome\t# Home",
  "config\tauthor_can_approve\tfalse",
  "config\tauto_resolve_outdated\tfalse",
  "config\tdefault_branch\tmain",
  "config\tmerge_method\tmerge_commit",
  "config\tmerge_trains\tfalse",
  "config\tpipelines_must_succeed\tfalse",
  "config\treset_approvals_on_push\ttrue",
  "config\tvisibility\tprivate",
].join("\n") + "\n";

const env = (name: string): boolean => name !== "ghost";

function parsed(text: string): { model: PackModel; preview: { commits: number; issues: number; requests: number } } {
  const result = parsePack(text, env);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result;
}

function errorsOf(text: string): string[] {
  const result = parsePack(text, env);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
}

function makeCommit(
  files: Record<string, string>,
  parents: string[],
  author: string,
  at: number,
  message: string,
  committer = author,
  committedAt = at,
): PackCommit {
  const map = new Map(Object.entries(files));
  const id = commitId({ tree: treeIdFromFiles(map), parents, author, authoredAt: at, committer, committedAt, message });
  return { id, parents, author: { username: author, at }, committer: { username: committer, at: committedAt }, message: message.trimEnd(), files: map };
}

test("field and list encoding", () => {
  assert.equal(encodeField(""), "-");
  assert.equal(encodeField("-"), "\\-");
  assert.equal(encodeField("a\tb\nc\\d"), "a\\tb\\nc\\\\d");
  assert.equal(encodeField("--"), "--");
  for (const value of ["", "-", "a\tb", "\\", "line\nbreak", "\\n", "tab\\t", "é ✓ 日本"]) {
    assert.equal(decodeField(encodeField(value)), value, JSON.stringify(value));
  }
  assert.equal(decodeField("a\\xb"), null);
  assert.equal(decodeField("trailing\\"), null);
  assert.equal(decodeField("a\\,b"), null);
  assert.equal(encodeList([]), "-");
  assert.equal(encodeList(["-"]), "\\-");
  assert.equal(encodeList(["a,b", "c"]), "a\\,b,c");
  assert.deepEqual(decodeList("a\\,b,c"), ["a,b", "c"]);
  assert.deepEqual(decodeList("-"), []);
  assert.deepEqual(decodeList("\\-"), ["-"]);
  for (const items of [[], ["-"], ["a"], ["a,b", "", "x\ty"], ["\\", ",,", "-x"]]) {
    if (items.length === 1 && items[0] === "") continue;
    assert.deepEqual(decodeList(encodeList(items)), items, JSON.stringify(items));
  }
});

test("treeIdFromFiles follows the published tree rule", () => {
  assert.equal(treeIdFromFiles(new Map()), createHash("sha256").update("tree\n").digest("hex"));
  assert.equal(
    treeIdFromFiles(new Map([["README.md", "hello\n"]])),
    "d0604e08d4be0b90d067bc3f6f5d0d3fc5000d1822a8a487d4db71b94690e941",
  );
  const blob = blobId(Buffer.from("x"));
  const inner = treeId([{ name: "b.txt", mode: "100644", id: blob }]);
  const outer = treeId([
    { name: "a", mode: "040000", id: inner },
    { name: "z.txt", mode: "100644", id: blob },
  ]);
  assert.equal(treeIdFromFiles(new Map([["z.txt", "x"], ["a/b.txt", "x"]])), outer);
});

test("the sample pack imports and exports byte for byte", () => {
  const { model, preview } = parsed(SAMPLE);
  assert.deepEqual(preview, { commits: 1, issues: 1, requests: 0 });
  assert.equal(previewSentence(preview), "Adds 1 commits, 1 issues, 0 requests.");
  assert.equal(serializePack(model), SAMPLE);
  assert.deepEqual(model.issues[0], {
    iid: 1, title: "Export fails", state: "opened", author: "asha", labels: ["priority::high"], milestone: "Sprint 1",
    weight: 3, confidential: false, description: "",
  });
  assert.deepEqual([...(model.commits[0]?.files ?? [])], [["README.md", "hello\n"]]);
});

test("the published error list", () => {
  const zeros = "0".repeat(64);
  const broken = [
    "spurpack 1", "user\tasha", "bogus\tx", "label\tonlyname", "milestone\tM\t2026-02-30\t2026-03-01\tUTC\tactive",
    "user\tasha", "user\tghost", "file\ta.txt\tx", `ref\tbranch\tmain\t${zeros}`, "file\tREADME.md\thello\\n",
    `commit\t${"a".repeat(64)}\t-\tasha 1767225600\tasha 1767225600\tFirst commit`,
  ].join("\n") + "\n";
  assert.deepEqual(errorsOf(broken), [
    'Line 3: unknown record "bogus".',
    "Line 4: label needs 3 fields, got 2.",
    "Line 5: bad value for start.",
    "Line 6: duplicate user asha.",
    'Line 7: user "ghost" doesn\'t exist here.',
    "Line 8: file belongs to no commit.",
    "Line 9: ref main points to unknown commit 0000000.",
    "Line 11: commit id doesn't match its contents.",
  ]);
  assert.deepEqual(errorsOf("spurpak 1\n"), ["Line 1: not a spurpack file."]);
  assert.deepEqual(errorsOf(""), ["Line 1: not a spurpack file."]);
  assert.deepEqual(errorsOf("spurpack 1\nbogus\n"), ['Line 2: unknown record "bogus".']);
  assert.deepEqual(errorsOf("spurpack 1\n\n"), ['Line 2: unknown record "".']);
});

test("commit errors: unknown parent before id mismatch, file runs", () => {
  const good = makeCommit({ "a.txt": "a" }, [], "asha", 10, "one");
  const head = "spurpack 1\nuser\tasha\n";
  const commitLine = (c: PackCommit, parents = "-") =>
    `commit\t${c.id}\t${parents}\tasha ${c.author.at}\tasha ${c.committer.at}\t${c.message}\n`;
  const orphan = `${head}file\ta.txt\ta\n${commitLine(good, "f".repeat(64))}`;
  assert.deepEqual(errorsOf(orphan), [`Line 4: commit ${good.id.slice(0, 7)} has unknown parent fffffff.`]);
  const tail = `${head}file\ta.txt\ta\nfile\tb.txt\tb\n`;
  assert.deepEqual(errorsOf(tail), ["Line 3: file belongs to no commit."]);
  assert.deepEqual(errorsOf(`${head}file\ta.txt\ta\nfile\ta.txt\tb\n${commitLine(good)}`), [
    "Line 4: duplicate file a.txt.",
  ]);
  assert.deepEqual(errorsOf(`${head}${commitLine(good)}`), ["Line 3: commit id doesn't match its contents."]);
  assert.ok(parsePack(`${head}file\ta.txt\ta\n${commitLine(good)}`, env).ok);
  assert.deepEqual(errorsOf(`${head}file\ta.txt\ta\n${commitLine(good)}${commitLine(good)}`), [
    `Line 5: duplicate commit ${good.id}.`,
  ]);
  assert.deepEqual(errorsOf(`${head}file\t/abs\ta\nfile\ta/../b\ta\nfile\t\ta\n`), [
    "Line 3: bad value for path.",
    "Line 4: bad value for path.",
    "Line 5: bad value for path.",
  ]);
});

test("bad values are checked in record order, first error per line", () => {
  const base = "spurpack 1\nuser\tasha\n";
  const bad = (line: string) => errorsOf(base + line + "\n")[0];
  assert.equal(bad("user\tAB"), "Line 3: bad value for username.");
  assert.equal(bad("user\tghost"), "Line 3: user \"ghost\" doesn't exist here.");
  assert.equal(bad(`ref\ttag\t\t${"1".repeat(64)}`), "Line 3: bad value for name.");
  assert.equal(bad(`ref\tbranch\tx\t${"1".repeat(63)}`), "Line 3: bad value for commit.");
  assert.equal(bad("milestone\tM\t2026-01-05\t2026-01-04\tUTC\tactive"), "Line 3: bad value for due.");
  assert.equal(bad("milestone\tM\t2026-01-05\t2026-01-06\tNowhere/City\tactive"), "Line 3: bad value for zone.");
  assert.equal(bad("milestone\tM\t2026-01-05\t2026-01-06\tUTC\topened"), "Line 3: bad value for state.");
  assert.equal(bad("label\tx\ty\\q"), "Line 3: bad value for description.");
  assert.equal(bad("label\tbad\\tname\t-"), "Line 3: bad value for name.");
  assert.equal(bad("issue\t0\tT\topened\tasha\t-\t-\t-\tfalse\t-"), "Line 3: bad value for iid.");
  assert.equal(bad("issue\t1\tT\topened\tnobody\t-\t-\t-\tfalse\t-"), "Line 3: bad value for author.");
  assert.equal(bad("issue\t1\tT\topened\tasha\tmissing\t-\t-\tfalse\t-"), "Line 3: bad value for labels.");
  assert.equal(bad("issue\t1\tT\topened\tasha\t-\tNone\t-\tfalse\t-"), "Line 3: bad value for milestone.");
  assert.equal(bad("issue\t1\tT\topened\tasha\t-\t-\t101\tfalse\t-"), "Line 3: bad value for weight.");
  assert.equal(bad("issue\t1\tT\topened\tasha\t-\t-\t0\tyes\t-"), "Line 3: bad value for confidential.");
  assert.equal(bad(`issue\t1\t${"x".repeat(256)}\topened\tasha\t-\t-\t0\tfalse\t-`), "Line 3: bad value for title.");
  assert.equal(bad("request\t1\tT\tmerged\tasha\t-\tmain\t-"), "Line 3: bad value for source.");
  assert.equal(bad("thread\t1\t-\t-\tfalse\tasha\tbody"), "Line 3: bad value for request.");
  assert.equal(bad("wikipage\tHome\t1\tasha\tHome\t-"), "Line 3: bad value for slug.");
  assert.equal(bad("wikipage\thome\t2\tasha\tHome\t-"), "Line 3: bad value for version.");
  assert.equal(bad("config\tcolour\tred"), "Line 3: bad value for key.");
  assert.equal(bad("config\tvisibility\tsecret"), "Line 3: bad value for value.");
  assert.equal(bad("config\tdefault_branch\tmain"), "Line 3: bad value for value.");
  assert.equal(bad("config\tmerge_trains\tmaybe"), "Line 3: bad value for value.");
  assert.equal(bad("config\tmerge_method\trebase\nconfig\tmerge_method\tsquash"), "Line 4: duplicate config merge_method.");
});

test("threads", () => {
  const pre = `spurpack 1\nuser\tasha\nrequest\t1\tT\topened\tasha\tfeat\tmain\t-\n`;
  assert.ok(parsePack(`${pre}thread\t1\tsrc/a.ts\t4\ttrue\tasha\thello\nthread\t1\t-\t-\tfalse\tasha\tgeneral\n`, env).ok);
  assert.deepEqual(errorsOf(`${pre}thread\t1\tsrc/a.ts\t-\tfalse\tasha\tx\n`), ["Line 4: bad value for line."]);
  assert.deepEqual(errorsOf(`${pre}thread\t1\t-\t3\tfalse\tasha\tx\n`), ["Line 4: bad value for line."]);
  assert.deepEqual(errorsOf(`${pre}thread\t1\t-\t-\tfalse\tasha\t-\n`), ["Line 4: bad value for body."]);
  assert.deepEqual(errorsOf(`${pre}thread\t2\t-\t-\tfalse\tasha\tx\n`), ["Line 4: bad value for request."]);
});

test("at most 20 errors", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `nope${i}`).join("\n");
  const errors = errorsOf(`spurpack 1\n${lines}\n`);
  assert.equal(errors.length, 20);
  assert.equal(errors[19], 'Line 21: unknown record "nope19".');
});

function richModel(): PackModel {
  const c1 = makeCommit({ "README.md": "hello\n", "src/main.ts": "export {};\n", "-": "-", "empty.txt": "", "tab\tname.txt": "a\tb\\n\nc" }, [], "asha", 1000, "First\tcommit");
  const c2 = makeCommit({ "README.md": "hello\nworld\n", "src/main.ts": "export {};\n", "docs/a/b.md": "# b" }, [c1.id], "cyr", 900, "Second\n\nbody\n", "spurline-train", 1100);
  const c3 = makeCommit({ "README.md": "hello\n" }, [c1.id], "asha", 1100, "Side");
  const c4 = makeCommit({}, [c2.id, c3.id], "asha", 1200, "Merge");
  return {
    users: ["spurline-train", "cyr", "asha"],
    commits: [c4, c3, c2, c1],
    refs: [
      { kind: "tag", name: "v1", commit: c1.id },
      { kind: "branch", name: "main", commit: c4.id },
      { kind: "branch", name: "feat/é", commit: c3.id },
    ],
    labels: [
      { name: "type::bug", description: "Broken, \\ really\nso" },
      { name: "a,b", description: "" },
      { name: "-", description: "-" },
    ],
    milestones: [
      { title: "Sprint 2", start: "2026-02-01", due: "2026-02-14", zone: "Europe/Paris", state: "closed" },
      { title: "Sprint 1", start: "2026-01-05", due: "2026-01-16", zone: "UTC", state: "active" },
    ],
    issues: [
      { iid: 2, title: "Second", state: "closed", author: "cyr", labels: ["a,b", "type::bug"], milestone: "Sprint 2", weight: 0, confidential: true, description: "multi\nline\ttab" },
      { iid: 1, title: "First", state: "opened", author: "asha", labels: ["-"], milestone: null, weight: null, confidential: false, description: "-" },
    ],
    requests: [
      { iid: 3, title: "Draft: x", state: "merged", author: "cyr", source: "feat/é", target: "main", description: "" },
      { iid: 1, title: "Add it", state: "opened", author: "asha", source: "feat/é", target: "main", description: "Please\nreview" },
    ],
    threads: [
      { request: 3, path: null, line: null, resolved: false, author: "asha", body: "overall" },
      { request: 1, path: "src/main.ts", line: 12, resolved: true, author: "cyr", body: "second created first" },
      { request: 1, path: "-", line: 1, resolved: false, author: "asha", body: "keeps creation order\nacross lines" },
      { request: 1, path: null, line: null, resolved: false, author: "cyr", body: "third" },
    ],
    wikiPages: [
      { slug: "home", version: 2, author: "cyr", title: "Home", content: "v2" },
      { slug: "a/b", version: 1, author: "asha", title: "-", content: "x\\ty" },
      { slug: "home", version: 1, author: "asha", title: "Home", content: "# Home" },
    ],
    config: [
      { key: "visibility", value: "internal" },
      { key: "default_branch", value: "main" },
      { key: "merge_method", value: "fast_forward" },
      { key: "merge_trains", value: "true" },
      { key: "author_can_approve", value: "true" },
      { key: "auto_resolve_outdated", value: "false" },
      { key: "pipelines_must_succeed", value: "true" },
      { key: "reset_approvals_on_push", value: "false" },
    ],
  };
}

test("a rich pack is written canonically and survives import and export", () => {
  const text = serializePack(richModel());
  const lines = text.split("\n");
  const kinds = lines.map((line) => line.split(T)[0]);
  const firstCommit = lines.findIndex((l) => l.startsWith("commit"));
  assert.deepEqual(lines.slice(0, 4), ["spurpack 1", "user\tasha", "user\tcyr", "user\tspurline-train"]);
  assert.equal(kinds.filter((k) => k === "commit").length, 4);
  assert.ok(firstCommit > 4);

  const commitIds = lines.filter((l) => l.startsWith("commit\t")).map((l) => l.split(T)[1]);
  const model = richModel();
  const [c4, c3, c2, c1] = model.commits;
  // c1 first; then c3 (time 1100) and c2 (committed 1100) tie on time, so the smaller id goes first; c4 last.
  const middle = [c2, c3].sort((a, b) => (a?.id ?? "") < (b?.id ?? "") ? -1 : 1).map((c) => c?.id);
  assert.deepEqual(commitIds, [c1?.id, ...middle, c4?.id]);

  const refLines = lines.filter((l) => l.startsWith("ref\t")).map((l) => l.split(T).slice(1, 3).join(" "));
  assert.deepEqual(refLines, ["branch feat/é", "branch main", "tag v1"]);
  const threadLines = lines.filter((l) => l.startsWith("thread\t")).map((l) => l.split(T)[5]);
  assert.deepEqual(threadLines, ["cyr", "asha", "cyr", "asha"]);
  assert.deepEqual(lines.filter((l) => l.startsWith("wikipage")).map((l) => l.split(T).slice(1, 3).join(" ")), ["a/b 1", "home 1", "home 2"]);
  assert.deepEqual(lines.filter((l) => l.startsWith("config")).map((l) => l.split(T)[1]), [
    "author_can_approve", "auto_resolve_outdated", "default_branch", "merge_method", "merge_trains", "pipelines_must_succeed", "reset_approvals_on_push", "visibility",
  ]);
  assert.ok(text.includes("label\ta,b\t-\n"), "a comma is plain in a label field");
  assert.ok(text.includes("\ta\\,b,type::bug\t"), "a comma is escaped inside a list item");
  assert.ok(text.includes("\\-"), "literal dashes are escaped");

  const again = parsed(text);
  assert.deepEqual(again.preview, { commits: 4, issues: 2, requests: 2 });
  assert.equal(serializePack(again.model), text);
  const reordered = again;
  assert.deepEqual(reordered.model.threads.map((t) => t.body), ["second created first", "keeps creation order\nacross lines", "third", "overall"]);
  const reversedFiles = [...(reordered.model.commits[0]?.files ?? [])];
  assert.ok(reversedFiles.some(([path, content]) => path === "tab\tname.txt" && content === "a\tb\\n\nc"));
  assert.ok(reversedFiles.some(([path, content]) => path === "empty.txt" && content === ""));
});

test("export users are exactly those that appear in exported records", () => {
  const model = richModel();
  const { users: _unused, ...parts } = model;
  assert.deepEqual(packUsers(parts), ["asha", "cyr", "spurline-train"]);
  assert.deepEqual(packUsers({ ...parts, commits: [], issues: [], requests: [], threads: [], wikiPages: [] }), []);
});

test("an empty pack is only the header", () => {
  const empty: PackModel = {
    users: [], commits: [], refs: [], labels: [], milestones: [], issues: [], requests: [], threads: [], wikiPages: [], config: [],
  };
  assert.equal(serializePack(empty), "spurpack 1\n");
  assert.deepEqual(parsed("spurpack 1\n").preview, { commits: 0, issues: 0, requests: 0 });
});
