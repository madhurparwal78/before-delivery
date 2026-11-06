import { rankSearch, commandScore, tokens, type SearchDoc } from "../src/shared/ranking.js";

let failures = 0;
function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    failures += 1;
    console.error(`FAIL ${name}\n  got  ${g}\n  want ${w}`);
  } else console.log(`ok   ${name}`);
}

function doc(id: string, title: string, blocks: string[], updatedDate: string): SearchDoc {
  return {
    objectId: id,
    title,
    titleTokens: tokens(title),
    blocks: blocks.map((plain) => ({ plain, tokens: tokens(plain) })),
    updatedDate,
  };
}

const docs = [
  doc("d1", "The Gathered Margin", ["Every reader keeps two books: the one in hand and the one they write in its margins.", "A heading is a promise to return."], "2026-11-01"),
  doc("d2", "Florilegium", ["Gathered under one heading, borrowed lines start to argue with each other."], "2026-11-01"),
  doc("d3", "Reading by Lamplight", ["Lamplight narrows the page until only one line can be trusted at a time."], "2026-10-30"),
];

const r1 = rankSearch("gathered", docs, "2026-11-03");
check("title hit first", r1.length, 2);
check("found d1 title match", r1[0].object_id, "d1");
check("snippet from title", r1[0].snippet, [{ text: "The ", match: false }, { text: "Gathered", match: true }, { text: " Margin", match: false }]);

const r2 = rankSearch("margni", docs, "2026-11-03");
check("swap is distance 2, no notes", r2, []);

const r5 = rankSearch("margin", docs, "2026-11-03");
check("margin returns d1", r5[0].object_id, "d1");

const r3 = rankSearch("narrows", docs, "2026-11-03");
check("body match d3", r3.map((r) => r.object_id), ["d3"]);
check("body snippet", r3[0].snippet.some((s) => s.match), true);

const r4 = rankSearch("zzz", docs, "2026-11-03");
check("no match", r4, []);

// command score
check("command full", commandScore("Go to Today", "gototoday"), 21);
check("command partial", commandScore("Go to Today", "gtt"), 9);
check("command excluded", commandScore("Go to Today", "xyz"), null);
check("command spaces ignored", commandScore("Open settings", "os"), 6);
check("empty query all match", commandScore("Open graph", ""), 0);
// a swap of two letters counts as 2, so no distance-1 typo
check("typo single substitution", rankSearch("gatherd", docs, "2026-11-03").length, 2);

console.log(failures === 0 ? "ALL OK" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
