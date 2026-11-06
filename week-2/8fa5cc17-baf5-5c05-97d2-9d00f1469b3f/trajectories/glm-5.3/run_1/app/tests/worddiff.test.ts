import { wordDiff } from "../src/shared/worddiff.js";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures += 1;
    console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  } else console.log(`ok   ${name}`);
}

check("identical", wordDiff("one two", "one two"), [{ op: "equal", text: "one two" }]);
check("empty both", wordDiff("", ""), []);
check("insert", wordDiff("one", "one two"), [{ op: "equal", text: "one" }, { op: "insert", text: " two" }]);
check("delete", wordDiff("one two", "one"), [{ op: "equal", text: "one" }, { op: "delete", text: " two" }]);
check("replace", wordDiff("one two", "one too"), [
  { op: "equal", text: "one " },
  { op: "delete", text: "two" },
  { op: "insert", text: "too" },
]);
check("empty to text", wordDiff("", "a b"), [{ op: "insert", text: "a b" }]);
check("text to empty", wordDiff("a b", ""), [{ op: "delete", text: "a b" }]);
check("middle change", wordDiff("a b c", "a x c"), [
  { op: "equal", text: "a " },
  { op: "delete", text: "b" },
  { op: "insert", text: "x" },
  { op: "equal", text: " c" },
]);

console.log(failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
