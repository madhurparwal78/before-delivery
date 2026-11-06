import { plainText, sanitizeBody, editText, applyOps, transformOps, type Op } from "../src/shared/richtext.js";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures += 1;
    console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  } else {
    console.log(`ok   ${name}`);
  }
}

// Canonical stored body
check("plain text wrapped", sanitizeBody("Read slowly & twice"), "<p>Read slowly &amp; twice</p>");
check("entities", sanitizeBody("a < b > c &amp; d"), "<p>a &lt; b &gt; c &amp; d</p>");
check("b/i normalised", sanitizeBody("<b>one</b><i>two</i>"), "<p><strong>one</strong><em>two</em></p>");
check("script dropped", sanitizeBody("keep<script>alert(1)</script>"), "<p>keep</p>");
check("unwrap div", sanitizeBody("<div>text</div>"), "<p>text</p>");
check("attr href kept", sanitizeBody('<a href="https://x.test/">link</a>'), '<p><a href="https://x.test/">link</a></p>');
check("attr href javascript", sanitizeBody('<a href="javascript:alert(1)">link</a>'), "<p>link</p>");
check("attr href relative dropped", sanitizeBody('<a href="/page">link</a>'), "<p>link</p>");
check("attr href mailto kept", sanitizeBody('<a href="mailto:a@b.test">mail</a>'), '<p><a href="mailto:a@b.test">mail</a></p>');
check("two paragraphs", sanitizeBody("<p>one</p><p>two</p>"), "<p>one</p><p>two</p>");
check("empty", sanitizeBody(""), "");
check("br", sanitizeBody("a<br>b"), "<p>a<br>b</p>");
check("stray lt kept", sanitizeBody("a < b"), "<p>a &lt; b</p>");
check("encoded lt not tag", sanitizeBody("a &lt;script&gt; b"), "<p>a &lt;script&gt; b</p>");
check("quote kept as is", sanitizeBody('She said "hi"'), '<p>She said "hi"</p>');

// Plain text
check("plain text", plainText("<p>a<br>b</p><p>c</p>"), "a b c");
check("plain text entity", plainText("<p>x &amp; y</p>"), "x & y");

// Edit text
check("edit text", editText("<p>one</p><p>two</p>"), "one\ntwo");
check("edit text br", editText("<p>a<br>b</p>"), "a\nb");
check("edit text plain", editText("<p>Read slowly &amp; twice</p>"), "Read slowly & twice");

// Applying ops
check("insert", applyOps("<p>hello</p>", [{ retain: 5 }, { insert: " world" }]), "<p>hello world</p>");
check("insert into empty block", applyOps("", [{ insert: "A first line." }]), "<p>A first line.</p>");
check("insert at 0", applyOps("<p>hello</p>", [{ insert: "say " }, { retain: 5 }]), "<p>say hello</p>");
check("delete", applyOps("<p>hello world</p>", [{ retain: 6 }, { delete: 5 }, { retain: 1 }]), "<p>hello </p>");
check("insert newline -> br", applyOps("<p>ab</p>", [{ retain: 1 }, { insert: "\n" }, { retain: 1 }]), "<p>a<br>b</p>");
check("delete joins blocks", applyOps("<p>one</p><p>two</p>", [{ retain: 3 }, { delete: 1 }, { retain: 3 }]), "<p>onetwo</p>");
check("insert takes marks", applyOps("<p><strong>ab</strong></p>", [{ retain: 1 }, { insert: "x" }, { retain: 1 }]), "<p><strong>axb</strong></p>");
check("insert at 0 takes after", applyOps("<p><strong>ab</strong></p>", [{ insert: "x" }, { retain: 2 }]), "<p><strong>xab</strong></p>");
check("delete br", applyOps("<p>a<br>b</p>", [{ retain: 1 }, { delete: 1 }, { retain: 1 }]), "<p>ab</p>");
check("insert with link marks", applyOps('<p><a href="https://x.test/">ab</a></p>', [{ retain: 1 }, { insert: "y" }, { retain: 1 }]), '<p><a href="https://x.test/">ayb</a></p>');

// Transform, no conflict
const t1 = transformOps([{ insert: "Note: " }, { retain: 18 }], [{ retain: 18 }, { insert: " And more." }]);
check("incoming insert shifts committed text cover", t1.ops, [{ insert: "Note: " }, { retain: 28 }]);
check("no conflict", t1.conflict, false);
const t2 = transformOps([{ retain: 6 }, { delete: 3 }, { retain: 24 }], [{ retain: 3 }, { insert: "XY" }, { retain: 28 }]);
check("incoming delete shifts right", t2.ops, [{ retain: 8 }, { delete: 3 }, { retain: 24 }]);

// Transform conflicts
const c1 = transformOps([{ retain: 1 }, { delete: 3 }], [{ retain: 2 }, { delete: 3 }]);
check("overlapping deletes conflict", c1.conflict, true);
const c2 = transformOps([{ retain: 2 }, { insert: "x" }], [{ retain: 1 }, { delete: 4 }]);
check("insert inside delete conflict", c2.conflict, true);
const c3 = transformOps([{ retain: 3 }, { delete: 2 }], [{ retain: 3 }, { insert: "q" }]);
check("committed insert inside incoming delete", c3.conflict, true);

// Transform non-conflicting deletes with shrink
const t3 = transformOps([{ retain: 6 }, { delete: 4 }], [{ retain: 1 }, { delete: 2 }]);
check("delete shifted left", t3.ops, [{ retain: 4 }, { delete: 4 }]);

console.log(failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
