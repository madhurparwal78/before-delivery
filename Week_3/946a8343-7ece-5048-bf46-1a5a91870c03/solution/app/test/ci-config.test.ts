import { test } from "node:test";
import assert from "node:assert/strict";
import { expandVariables } from "../src/server/ci/config/expand.ts";
import { evaluateIf } from "../src/server/ci/config/expr.ts";
import { NEVER, parseDurationMs } from "../src/server/ci/config/duration.ts";
import { readYaml } from "../src/server/ci/config/yaml.ts";
import { resolvePipelineConfig, type ConfigResult } from "../src/server/ci/config/resolve.ts";

const MAIN = "spurline.pipeline.yml";

interface Extra {
  files?: Record<string, string>;
  variables?: Record<string, string>;
  predefined?: Record<string, string>;
  changedFiles?: string[] | null;
  treeFiles?: string[];
}

function resolve(content: string, extra: Extra = {}): ConfigResult {
  const files = extra.files ?? {};
  return resolvePipelineConfig({
    mainPath: MAIN,
    content,
    load: (path) => files[path] ?? null,
    predefined: extra.predefined ?? { CI_COMMIT_BRANCH: "main" },
    variables: extra.variables ?? {},
    changedFiles: extra.changedFiles === undefined ? [] : extra.changedFiles,
    treeFiles: extra.treeFiles ?? [],
    retryMax: 2,
    defaultTimeoutMs: 3_600_000,
  });
}

function job(result: ConfigResult, name: string) {
  const found = result.jobs.find((j) => j.name === name);
  assert.ok(found, `job ${name} in ${result.jobs.map((j) => j.name).join(", ")} (${result.errors.join(" | ")})`);
  return found;
}

test("yaml: maps, lists, flow lists, scalars and lines", () => {
  const read = readYaml(
    [
      "# comment",
      "a: 1 # trailing",
      "b:",
      "  - x",
      "  - 'it''s'",
      '  - "q\\"z"',
      "  - k: v",
      "    n: true",
      "c: [p, 'q r', 3]",
      "d: null",
      "e:",
      "",
    ].join("\n"),
  );
  assert.ok(read.ok);
  const [a, b, c, d, e] = read.root.entries;
  assert.deepEqual([a?.key, a?.line, a?.value.kind === "scalar" && a.value.value], ["a", 2, 1]);
  assert.equal(b?.line, 3);
  assert.ok(b?.value.kind === "list");
  assert.deepEqual(b.value.items.map((i) => i.line), [4, 5, 6, 7]);
  assert.deepEqual(b.value.items.slice(0, 3).map((i) => (i.kind === "scalar" ? i.text : "")), ["x", "it's", 'q"z']);
  const pair = b.value.items[3];
  assert.ok(pair?.kind === "map");
  assert.deepEqual(pair.entries.map((x) => [x.key, x.line]), [["k", 7], ["n", 8]]);
  assert.ok(c?.value.kind === "list");
  assert.deepEqual(c.value.items.map((i) => (i.kind === "scalar" ? i.value : null)), ["p", "q r", 3]);
  assert.ok(d?.value.kind === "scalar" && d.value.value === null);
  assert.ok(e?.value.kind === "scalar" && e.value.value === null);
});

test("yaml: unreadable lines stop reading with one message", () => {
  const bad: [string, number][] = [
    ["a: 1\nnot a pair\n", 2],
    ["a:\n\tb: 1\n", 2],
    ["a:\n  b: 1\n c: 2\n", 3],
    ["a: 1\n  b: 2\n", 2],
    ["a: 'open\n", 1],
    ['a: "open\n', 1],
    ["a: &x 1\n", 1],
    ["a: *x\n", 1],
    ["a: {b: 1}\n", 1],
    ["a: |\n  text\n", 1],
    ["a: >\n  text\n", 1],
    ["a: [b, c\n", 1],
    ["-\n", 1],
    ["- x\n", 1],
    ["a:\n  - b\n  c: 1\n", 3],
  ];
  for (const [source, line] of bad) {
    const read = readYaml(source);
    assert.ok(!read.ok, source);
    assert.equal(read.message, `Line ${line}: can't read this line.`, JSON.stringify(source));
  }
});

test("yaml: the first bad line wins even when a later line is worse", () => {
  const read = readYaml("a: |\n  x\nb: 'open\n");
  assert.ok(!read.ok);
  assert.equal(read.line, 1);
});

test("expandVariables: names, braces, passes, unknowns and $$", () => {
  assert.equal(expandVariables("$A ${B}c $NOPE|", { A: "1", B: "2" }), "1 2c |");
  assert.equal(expandVariables("$A", { A: "$B", B: "$C", C: "end" }), "end");
  assert.equal(expandVariables("$A", { A: "$B", B: "$C", C: "$D", D: "too deep" }), "$D");
  assert.equal(expandVariables("cost $$5 $$A $UNKNOWN$$", { A: "x" }), "cost $5 $A $");
  assert.equal(expandVariables("$A", { A: "$$B", B: "x" }), "$B");
  assert.equal(expandVariables("price $ 5 $1", {}), "price $ 5 $1");
});

test("evaluateIf: operators, precedence, regex, bare variables", () => {
  const vars = { BRANCH: "main", EMPTY: "", MSG: "Fix bug", N: "7" };
  const yes = (e: string) => assert.equal(evaluateIf(e, vars), true, e);
  const no = (e: string) => assert.equal(evaluateIf(e, vars), false, e);
  yes('$BRANCH == "main"');
  yes("$BRANCH == 'main'");
  no('$BRANCH != "main"');
  yes('$BRANCH != "dev"');
  yes("$BRANCH");
  no("$EMPTY");
  no("$UNKNOWN");
  yes('$UNKNOWN == ""');
  yes("$MSG =~ /^fix/i");
  no("$MSG =~ /^fix/");
  yes("$MSG =~ /bug$/");
  yes("$N =~ /^(7|8)$/");
  yes('$BRANCH == "dev" || $BRANCH == "main"');
  no('$BRANCH == "dev" || $BRANCH == "x" && $N');
  yes('$BRANCH == "main" && ($EMPTY || $N)');
  no('$BRANCH == "main" && ($EMPTY || $UNKNOWN)');
  yes("${BRANCH} == $BRANCH");
  no("$BRANCH ==");
  no("(($BRANCH)");
  no("$MSG =~ /x/g");
  no("$MSG =~ /(/");
});

test("parseDurationMs", () => {
  assert.equal(parseDurationMs("90s"), 90_000);
  assert.equal(parseDurationMs("250ms"), 250);
  assert.equal(parseDurationMs("2m"), 120_000);
  assert.equal(parseDurationMs("2h"), 7_200_000);
  assert.equal(parseDurationMs("never"), NEVER);
  for (const text of ["5 minutes", "30", "s", "1d", "-1s", "1.5s", ""]) assert.equal(parseDurationMs(text), null, text);
});

const VALID_CONFIG = `stages: [build, test]
variables:
  GREETING: hi
.base:
  stage: test
  variables:
    FROM_BASE: "1"
build:
  stage: build
  script:
    - print $GREETING
unit:
  extends: .base
  script:
    - print unit
  matrix:
    OS: [linux, mac]
    V: [a, b]
skipme:
  stage: test
  script:
    - print x
  rules:
    - if: $NOPE == "yes"
`;

test("a valid file expands matrix jobs and removes jobs whose rules do not match", () => {
  const result = resolve(VALID_CONFIG);
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary, "Valid. 5 jobs in 2 stages.");
  assert.deepEqual(result.jobs.map((j) => j.name), [
    "build",
    "unit [linux, a]",
    "unit [linux, b]",
    "unit [mac, a]",
    "unit [mac, b]",
  ]);
  const unit = job(result, "unit [linux, a]");
  assert.equal(unit.stage, "test");
  assert.equal(unit.stageIndex, 1);
  assert.deepEqual(unit.variables, { GREETING: "hi", FROM_BASE: "1", OS: "linux", V: "a" });
  assert.deepEqual(unit.matrix, { OS: "linux", V: "a" });
  assert.deepEqual(job(result, "build").script, ["print $GREETING"]);
});

const LINT_CASES: [string, string, string[]][] = [
  ["needs cycle", "stages: [build]\na:\n  stage: build\n  script:\n    - print a\n  needs: [b]\nb:\n  stage: build\n  script:\n    - print b\n  needs: [a]\n", ["Line 2: needs cy" + "cle: a -> b -> a."]],
  ["unknown keyword and no script", "stages: [build]\na:\n  stage: build\n  colour: red\n  script:\n    - print a\nb:\n  stage: build\n", ['Line 4: unknown keyword "colour".', 'Line 7: job "b" has no script.']],
  ["multi-line scalar", "stages: [build]\na:\n  stage: build\n  colour: red\n  script: |\n    print a\n", ["Line 5: can't read this line."]],
  ["include cycle", "include:\n  - ci/a.yml\nbuild:\n  stage: build\n  script:\n    - print a\n", ["Line 2: include cycle: ci/a.yml -> ci/b.yml -> ci/a.yml."]],
  ["self include", "include:\n  - spurline.pipeline.yml\nbuild:\n  stage: build\n  script:\n    - print a\n", ["Line 2: include cycle: spurline.pip" + "eline.yml -> spurline.pipeline.yml."]],
  ["missing include", "include:\n  - ci/missing.yml\nbuild:\n  stage: build\n  script:\n    - print a\n", ['Line 2: include "ci/m' + 'issing.yml" not found.']],
  ["extends cycle", ".x:\n  extends: .y\n.y:\n  extends: .x\nbuild:\n  stage: build\n  script:\n    - print a\n", ["Line 1: extends cyc" + "le: .x -> .y -> .x."]],
  ["retry and duration", "build:\n  stage: build\n  retry: 3\n  timeout: 5 minutes\n  script:\n    - print a\n", ["Line 3: retry m" + "ax can't exceed 2.", 'Line 4: can\'t read duration "5 minutes".']],
];
const INCLUDE_FILES = {
  "ci/a.yml": "include:\n  - ci/b.yml\n",
  "ci/b.yml": "include:\n  - ci/a.yml\n",
  "ci/base.yml": "inc:\n  stage: build\n  script:\n    - print base\n",
};

for (const [label, content, expected] of LINT_CASES) {
  test(`lint: ${label}`, () => {
    const result = resolve(content, { files: INCLUDE_FILES });
    assert.deepEqual(result.errors, expected);
    assert.deepEqual(result.jobs, []);
    assert.equal(result.summary, "");
  });
}

test("lint: stage not in stages, defaulting to test", () => {
  const result = resolve("stages: [build]\na:\n  stage: ship\n  script:\n    - print a\nb:\n  script:\n    - print b\n");
  assert.deepEqual(result.errors, [
    'Line 3: job "a" uses stage "ship", which isn\'t in stages.',
    'Line 6: job "b" uses stage "test", which isn\'t in stages.',
  ]);
});

test("lint: needs that do not exist, were removed by rules, or sit in a later stage", () => {
  const result = resolve(
    [
      "stages: [build, test]",
      "gone:",
      "  stage: build",
      "  rules:",
      '    - if: $CI_COMMIT_BRANCH == "never-branch"',
      "  script:",
      "    - print g",
      "later:",
      "  stage: test",
      "  script:",
      "    - print l",
      "uses:",
      "  stage: build",
      "  needs: [ghost, gone, later]",
      "  script:",
      "    - print u",
      "mid:",
      "  stage: test",
      "  needs: [gone]",
      "  script:",
      "    - print m",
    ].join("\n"),
  );
  assert.deepEqual(result.errors, [
    'Line 14: job "uses" needs "ghost", which doesn\'t exist.',
    'Line 14: job "uses" needs "gone", which rules removed.',
    'Line 14: job "uses" needs "later", in a later stage.',
    'Line 19: job "mid" needs "gone", which rules removed.',
  ]);
});

test("lint: a needs cycle is reported once at the first job in file order, following first needs", () => {
  const result = resolve(
    [
      "stages: [test]",
      "x:", "  stage: test", "  script:", "    - print x",
      "a:", "  stage: test", "  needs: [c, b]", "  script:", "    - print a",
      "b:", "  stage: test", "  needs: [c, a]", "  script:", "    - print b",
      "c:", "  stage: test", "  needs: [a]", "  script:", "    - print c",
      "self:", "  stage: test", "  needs: [self]", "  script:", "    - print s",
    ].join("\n"),
  );
  assert.deepEqual(result.errors, ["Line 6: needs cycle: a -> c -> a.", "Line 21: needs cycle: self -> self."]);
});

test("lint: a removed need and a cycle in one file", () => {
  const result = resolve(
    "stages: [build, test]\ngone:\n  stage: build\n  rules:\n    - if: $CI_COMMIT_BRANCH == \"never-branch\"\n  script:\n    - print g\n" +
      "uses:\n  stage: test\n  needs: [gone]\n  script:\n    - print u\na:\n  stage: test\n  needs: [b]\n  script:\n    - print a\n" +
      "b:\n  stage: test\n  needs: [a]\n  script:\n    - print b\n",
  );
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0] ?? "", /^Line (8|10): job "uses" needs "gone", which rules removed\.$/);
  assert.equal(result.errors[1], "Line 13: needs cy" + "cle: a -> b -> a.");
});

test("lint: problems inside includes report at the main file's include line", () => {
  const files = {
    "ci/one.yml": "include:\n  - ci/two.yml\nfrom_one:\n  stage: build\n  colour: red\n  script:\n    - print 1\n",
    "ci/two.yml": "include:\n  - ci/missing.yml\nfrom_two:\n  stage: build\n  retry: 3\n  script:\n    - print 2\n  timeout: nope\n",
    "ci/broken.yml": "a:\n  b: |\n",
  };
  const result = resolve("stages: [build]\ninclude:\n  - ci/other.yml\n  - ci/one.yml\n", {
    files: { ...files, "ci/other.yml": "x:\n  stage: build\n  script:\n    - print x\n" },
  });
  assert.deepEqual(result.errors, [
    'Line 4: unknown keyword "colour".',
    'Line 4: can\'t read duration "nope".',
    'Line 4: include "ci/missing.yml" not found.',
    "Line 4: retry max can't exceed 2.",
  ].sort());
  const broken = resolve("stages: [build]\nbad: 1\ninclude:\n  - ci/broken.yml\n", { files });
  assert.deepEqual(broken.errors, ["Line 4: can't read this line."]);
});

test("lint: at most 20 messages, sorted by line then text", () => {
  const lines = ["stages: [build]"];
  for (let i = 0; i < 25; i++) lines.push(`j${i}:`, "  stage: build");
  const result = resolve(lines.join("\n"));
  assert.equal(result.errors.length, 20);
  assert.deepEqual(result.errors.slice(0, 2), ['Line 2: job "j0" has no script.', 'Line 4: job "j1" has no script.']);
});

test("lint: top-level keys that are not jobs, unknown keys in workflow, rules and default", () => {
  const result = resolve(
    "stages: [build]\ncolour: red\nworkflow:\n  nope: 1\ndefault:\n  weird: 1\n  script:\n    - print d\n" +
      "j:\n  stage: build\n  rules:\n    - when: never\n      sometimes: 1\n",
  );
  assert.deepEqual(result.errors, [
    'Line 13: unknown keyword "sometimes".',
    'Line 2: unknown keyword "colour".',
    'Line 4: unknown keyword "nope".',
    'Line 6: unknown keyword "weird".',
  ].sort((l, r) => Number(/Line (\d+)/.exec(l)?.[1]) - Number(/Line (\d+)/.exec(r)?.[1])));
});

test("lint: extends of an unknown name, hidden templates need no script", () => {
  const result = resolve("stages: [build]\n.t:\n  stage: build\nj:\n  extends: [.t, .nope]\n  script:\n    - print j\n");
  assert.deepEqual(result.errors, ['Line 5: job "j" extends unknown ".nope".']);
  const ok = resolve("stages: [build]\n.t:\n  stage: build\nj:\n  extends: .t\n  script:\n    - print j\n");
  assert.equal(ok.summary, "Valid. 1 jobs in 1 stages.");
  assert.deepEqual(ok.jobs.map((j) => j.name), ["j"]);
});

test("default stages and the summary count", () => {
  const result = resolve("a:\n  stage: build\n  script:\n    - print a\nb:\n  script:\n    - print b\n");
  assert.deepEqual(result.stages, ["build", "test", "deploy"]);
  assert.equal(result.summary, "Valid. 2 jobs in 3 stages.");
  assert.equal(job(result, "b").stage, "test");
});

test("extends merges deeply, templates left to right, own keys last, default fills the rest", () => {
  const result = resolve(
    [
      "default:",
      "  script:",
      "    - print default",
      "  timeout: 30s",
      "  variables:",
      "    FILLED: used",
      ".t1:",
      "  variables:",
      "    X: one",
      "    Y: one",
      "  artifacts:",
      "    paths: [a.txt]",
      "    expire_in: 1h",
      ".t2:",
      "  variables:",
      "    Y: two",
      "    Z: two",
      "  artifacts:",
      "    paths: [b.txt]",
      ".t3:",
      "  extends: .t2",
      "  stage: build",
      "j:",
      "  extends: [.t1, .t3]",
      "  variables:",
      "    Z: three",
      "k:",
      "  stage: build",
      "  script:",
      "    - print k",
    ].join("\n"),
  );
  assert.deepEqual(result.errors, []);
  const j = job(result, "j");
  assert.deepEqual(j.variables, { X: "one", Y: "two", Z: "three" });
  assert.deepEqual(j.artifacts, { paths: ["b.txt"], expireInMs: 3_600_000, when: "on_success" });
  assert.deepEqual(j.script, ["print default"]);
  assert.equal(j.timeoutMs, 30_000);
  assert.equal(j.stage, "build");
  assert.deepEqual(job(result, "k").variables, { FILLED: "used" });
});

test("extends follows at most five levels of templates", () => {
  const lines = ["stages: [build]", ".t0:", "  variables:", "    DEEP: yes"];
  for (let i = 1; i <= 6; i++) lines.push(`.t${i}:`, `  extends: .t${i - 1}`);
  const user = (name: string, base: string) => [`${name}:`, `  extends: ${base}`, "  stage: build", "  script:", "    - print a"];
  const result = resolve([...lines, ...user("five", ".t4"), ...user("six", ".t5")].join("\n"));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(job(result, "five").variables, { DEEP: "yes" });
  assert.deepEqual(job(result, "six").variables, {});
});

test("includes: later files over earlier, main file over all, deep merge, depth first", () => {
  const files = {
    "ci/base.yml": "stages: [build, test]\nvariables:\n  A: base\n  B: base\ninc:\n  stage: build\n  script:\n    - print base\n",
    "ci/more.yml": "include:\n  - ci/deep.yml\nvariables:\n  B: more\nother:\n  stage: build\n  script:\n    - print more\n",
    "ci/deep.yml": "variables:\n  A: deep\n  C: deep\n",
  };
  const result = resolve(
    "include:\n  - ci/base.yml\n  - ci/more.yml\nvariables:\n  C: main\ninc:\n  stage: test\n  script:\n    - print main\n",
    { files },
  );
  assert.deepEqual(result.errors, []);
  assert.equal(job(result, "inc").stage, "test");
  assert.deepEqual(job(result, "inc").script, ["print main"]);
  assert.deepEqual(job(result, "inc").variables, { A: "deep", B: "more", C: "main" });
  assert.deepEqual(result.jobs.map((j) => j.name), ["inc", "other"]);
  assert.deepEqual(result.stages, ["build", "test"]);
});

test("variable layering: top-level, job, rule; matrix values are variables", () => {
  const result = resolve(
    [
      "stages: [build]",
      "variables:",
      "  A: top",
      "  B: top",
      "  C: top",
      "j:",
      "  stage: build",
      "  variables:",
      "    B: job",
      "    C: job",
      "  matrix:",
      "    D: [one]",
      "  rules:",
      "    - if: $CI_COMMIT_BRANCH",
      "      variables:",
      "        C: rule",
      "  script:",
      "    - print $A",
    ].join("\n"),
  );
  assert.deepEqual(job(result, "j [one]").variables, { A: "top", B: "job", C: "rule", D: "one" });
});

test("rules: first match wins, if sees predefined, top-level, job and request variables", () => {
  const config = [
    "stages: [build]",
    "variables:",
    "  TOP: yes",
    "a:",
    "  stage: build",
    "  variables:",
    "    JOBV: here",
    "  script:",
    "    - print a",
    "  rules:",
    '    - if: $CI_COMMIT_BRANCH == "other"',
    "      when: never",
    '    - if: $TOP == "yes" && $JOBV == "here" && $REQ == "1"',
    "      when: manual",
    "      allow_failure: false",
    "    - when: always",
    "b:",
    "  stage: build",
    "  script:",
    "    - print b",
    "  rules:",
    "    - if: $REQ == 'nope'",
  ].join("\n");
  const hit = resolve(config, { variables: { REQ: "1" } });
  assert.deepEqual(hit.errors, []);
  assert.deepEqual(hit.jobs.map((j) => j.name), ["a"]);
  const a = job(hit, "a");
  assert.deepEqual([a.when, a.allowFailure], ["manual", false]);
  const miss = resolve(config);
  assert.equal(job(miss, "a").when, "always");
  const never = resolve(config, { predefined: { CI_COMMIT_BRANCH: "other" } });
  assert.deepEqual(never.jobs, []);
});

test("rules: changes and exists use owners-file globs; null changes always match", () => {
  const config = [
    "stages: [test]",
    "docs:",
    "  stage: test",
    "  script:",
    "    - print d",
    "  rules:",
    "    - changes: ['docs/**/*', '*.md']",
    "web:",
    "  stage: test",
    "  script:",
    "    - print w",
    "  rules:",
    "    - exists: [package.json]",
    "both:",
    "  stage: test",
    "  script:",
    "    - print b",
    "  rules:",
    "    - changes: [src/]",
    "      exists: [package.json]",
  ].join("\n");
  const names = (extra: Extra) => resolve(config, extra).jobs.map((j) => j.name);
  assert.deepEqual(names({ changedFiles: ["README.md"], treeFiles: [] }), ["docs"]);
  assert.deepEqual(names({ changedFiles: ["src/a.ts"], treeFiles: ["package.json"] }), ["web", "both"]);
  assert.deepEqual(names({ changedFiles: [], treeFiles: ["package.json"] }), ["web"]);
  assert.deepEqual(names({ changedFiles: null, treeFiles: ["package.json"] }), ["docs", "web", "both"]);
  assert.deepEqual(names({ changedFiles: null, treeFiles: [] }), ["docs"]);
});

test("rules: when, allow_failure and start_in from the matching rule", () => {
  const result = resolve(
    "stages: [test]\nj:\n  stage: test\n  start_in: 5s\n  script:\n    - print j\n  rules:\n    - when: delayed\n      start_in: 90s\n      allow_failure: true\n" +
      "m:\n  stage: test\n  when: manual\n  script:\n    - print m\nn:\n  stage: test\n  when: manual\n  allow_failure: false\n  script:\n    - print n\n",
  );
  const j = job(result, "j");
  assert.deepEqual([j.when, j.startInMs, j.allowFailure], ["delayed", 90_000, true]);
  assert.equal(job(result, "m").allowFailure, true);
  assert.equal(job(result, "n").allowFailure, false);
});

test("workflow rules decide whether the pipeline is created", () => {
  const body = "j:\n  stage: build\n  script:\n    - print j\n";
  const config = (rules: string) => `workflow:\n  rules:\n${rules}${body}`;
  assert.equal(resolve(body).workflowPasses, true);
  assert.equal(resolve(config('    - if: $CI_COMMIT_BRANCH == "never-branch"\n')).workflowPasses, false);
  assert.equal(resolve(config('    - if: $CI_COMMIT_BRANCH == "main"\n')).workflowPasses, true);
  assert.equal(resolve(config('    - if: $CI_COMMIT_BRANCH == "main"\n      when: never\n    - when: always\n')).workflowPasses, false);
  assert.equal(resolve(config('    - if: $X == "1"\n'), { variables: { X: "1" } }).workflowPasses, true);
  assert.deepEqual(resolve(config('    - if: $CI_COMMIT_BRANCH == "never-branch"\n')).errors, []);
});

const MATRIX_CONFIG = `stages: [build, test]
variables:
  SHARED: top
.t:
  stage: build
  variables:
    FROM_T: fromt
    SHARED: tmpl
  script:
    - print x
pack:
  extends: .t
  variables:
    SHARED: job
  matrix:
    OS: [linux, mac]
    NODE: [16, 18]
gone:
  stage: test
  rules:
    - if: $CI_COMMIT_BRANCH == "never-branch"
  script:
    - print g
tail:
  stage: test
  script:
    - print t
`;

test("matrix: one job per combination, last key fastest, every value a variable", () => {
  const result = resolve(MATRIX_CONFIG);
  assert.equal(result.summary, "Valid. 5 jobs in 2 stages.");
  assert.deepEqual(result.jobs.map((j) => j.name), [
    "pack [linux, 16]",
    "pack [linux, 18]",
    "pack [mac, 16]",
    "pack [mac, 18]",
    "tail",
  ]);
  assert.deepEqual(job(result, "pack [mac, 18]").variables, {
    SHARED: "job",
    FROM_T: "fromt",
    OS: "mac",
    NODE: "18",
  });
  assert.equal(job(result, "pack [mac, 18]").line, 11);
});

test("matrix: needs on a matrix job needs every expansion; needs: [] differs from no needs", () => {
  const result = resolve(
    [
      "stages: [build, test, deploy]",
      "bld:", "  stage: build", "  matrix:", "    OS: [a, b]", "  script:", "    - print b",
      "chk:", "  stage: test", "  needs: [bld]", "  dependencies: [bld]", "  script:", "    - print c",
      "free:", "  stage: test", "  needs: []", "  script:", "    - print f",
      "plain:", "  stage: deploy", "  script:", "    - print p",
      "exact:", "  stage: test", "  needs: ['bld [b]']", "  script:", "    - print e",
    ].join("\n"),
  );
  assert.deepEqual(result.errors, []);
  assert.deepEqual(job(result, "chk").needs, ["bld [a]", "bld [b]"]);
  assert.deepEqual(job(result, "chk").dependencies, ["bld [a]", "bld [b]"]);
  assert.deepEqual(job(result, "free").needs, []);
  assert.equal(job(result, "plain").needs, null);
  assert.equal(job(result, "plain").dependencies, null);
  assert.deepEqual(job(result, "exact").needs, ["bld [b]"]);
});

test("matrix: rules judge each expansion with its matrix values", () => {
  const result = resolve(
    "stages: [test]\nj:\n  stage: test\n  matrix:\n    OS: [linux, mac]\n  rules:\n    - if: $OS == \"mac\"\n  script:\n    - print j\n",
  );
  assert.deepEqual(result.jobs.map((j) => j.name), ["j [mac]"]);
});

test("job fields: retry, timeout, artifacts, cache, environment and the rest", () => {
  const result = resolve(
    [
      "stages: [build]",
      "j:",
      "  stage: build",
      "  script:",
      "    - print $A",
      "    - 'write out.txt hello'",
      "  retry:",
      "    max: 2",
      "    when: [job_timeout]",
      "  timeout: 2h",
      "  interruptible: true",
      "  resource_group: deploys",
      "  artifacts:",
      "    paths: ['out/*.txt']",
      "    expire_in: never",
      "    when: always",
      "  cache:",
      "    key: deps-$CI_COMMIT_REF_NAME",
      "    fallback_keys: [deps-main]",
      "    paths: [node_modules/]",
      "    policy: pull",
      "  environment:",
      "    name: review/$CI_MERGE_REQUEST_IID",
      "    action: start",
      "    auto_stop_in: 10m",
      "    on_stop: stop_review",
      "    tier: staging",
      "bare:",
      "  stage: build",
      "  retry: 1",
      "  script: print solo",
      "  environment: production",
      "  cache:",
      "    paths: [x]",
    ].join("\n"),
  );
  assert.deepEqual(result.errors, []);
  const j = job(result, "j");
  assert.deepEqual(j.script, ["print $A", "write out.txt hello"]);
  assert.deepEqual(j.retry, { max: 2, when: ["job_timeout"] });
  assert.equal(j.timeoutMs, 7_200_000);
  assert.deepEqual([j.interruptible, j.resourceGroup], [true, "deploys"]);
  assert.deepEqual(j.artifacts, { paths: ["out/*.txt"], expireInMs: "never", when: "always" });
  assert.deepEqual(j.cache, { key: "deps-$CI_COMMIT_REF_NAME", fallbackKeys: ["deps-main"], paths: ["node_modules/"], policy: "pull" });
  assert.deepEqual(j.environment, {
    name: "review/$CI_MERGE_REQUEST_IID",
    action: "start",
    autoStopInMs: 600_000,
    onStop: "stop_review",
    tier: "staging",
  });
  const bare = job(result, "bare");
  assert.deepEqual(bare.retry, { max: 1, when: ["script_failure", "job_timeout", "system_failure"] });
  assert.deepEqual(bare.script, ["print solo"]);
  assert.equal(bare.timeoutMs, null);
  assert.equal(bare.artifacts, null);
  assert.equal(bare.cache?.policy, "pull-push");
  assert.equal(bare.environment?.name, "production");
  assert.deepEqual(j.when, "on_success");
});

test("never is only a duration for artifact expiry", () => {
  const result = resolve("j:\n  stage: build\n  timeout: never\n  script:\n    - print a\n");
  assert.deepEqual(result.errors, ['Line 3: can\'t read duration "never".']);
});

test("a file that is empty or only comments has no jobs and no errors", () => {
  const result = resolve("# nothing\n");
  assert.deepEqual(result.errors, []);
  assert.equal(result.summary, "Valid. 0 jobs in 3 stages.");
});
