import { parseCsv, exportCell, exportLine } from "../src/shared/csv.js";
import { displayFilename, safeStorageName, contentDispositionFilename, kindForExtension, bytesMatchKind } from "../src/shared/attachment.js";
import { computeObjectiveFit, computePriority, round2 } from "../src/shared/ranking.js";
import { snapOutward, splitsSurrogatePair } from "../src/shared/segments.js";

let fails = 0;
function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.error(`FAIL ${name}: got ${g} want ${w}`); fails++; }
}

// CSV parse with BOM, CRLF and a two-line quoted field.
const csv = "\uFEFFcontact_email,contact_name,company_name,feedback,received_on\r\n" +
  "ana@northwindfreight.example,Ana Ruiz,Northwind Freight,\"We need\r\nreports emailed\",2026-10-20\r\n" +
  "lee@nw.example,Lee,NC,\"plain\",\r\n";
const p = parseCsv(csv);
check("header", p.headerOk, true);
check("rowcount", p.records.length, 2);
check("line2", p.records[0]?.line, 2);
check("multiline", p.records[0]?.fields[3], "We need\nreports emailed");
check("line4", p.records[1]?.line, 4);

// export cells
check("cellplain", exportCell("hello"), "hello");
check("cellcomma", exportCell("a,b"), "\"a,b\"");
check("formula-eq", exportCell("=SUM(A1)"), "'=SUM(A1)");
check("formula-plus", exportCell("+1"), "'+1");
check("formula-minus", exportCell("-3"), "'-3");
check("formula-at", exportCell("@x"), "'@x");
check("cellquote", exportCell('say "hi"'), "\"say \"\"hi\"\"\"");
check("line", exportLine(["a", "b"]), "a,b\r\n");

// filenames
check("disp", displayFilename("../../Ränder call.vtt"), "Ränder call.vtt");
check("safe", safeStorageName("Ränder call.vtt"), "R-nder-call.vtt");
check("cdisp", contentDispositionFilename("Ränder call.vtt"),
  "attachment; filename=\"R_nder call.vtt\"; filename*=UTF-8''R%C3%A4nder%20call.vtt");
check("kind", kindForExtension("x.VTT")?.contentType, "text/vtt; charset=utf-8");
check("longname", displayFilename("a".repeat(130) + ".txt").length <= 120, true);

// vtt checks
check("vtt-ok", bytesMatchKind(new TextEncoder().encode("WEBVTT\n\nx"), ".vtt"), true);
check("vtt-bom", bytesMatchKind(new Uint8Array([0xef,0xbb,0xbf,...new TextEncoder().encode("WEBVTT")]), ".vtt"), true);
check("vtt-bad", bytesMatchKind(new TextEncoder().encode("<html>WEBVTT"), ".vtt"), false);
check("vtt-space", bytesMatchKind(new TextEncoder().encode("WEBVTT hello"), ".vtt"), true);
check("vtt-nul", bytesMatchKind(new Uint8Array([0x57,0x45,0x42,0x56,0x54,0x54,0x0a,0x00]), ".vtt"), false);
check("png", bytesMatchKind(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0]), ".png"), true);
check("png-bad", bytesMatchKind(new Uint8Array([1,2,3]), ".png"), false);
check("jpg", bytesMatchKind(new Uint8Array([0xff,0xd8,0xff,0xe0]), ".jpg"), true);
check("pdf", bytesMatchKind(new TextEncoder().encode("%PDF-1.7 x"), ".pdf"), true);
check("txt", bytesMatchKind(new TextEncoder().encode("hello wörld"), ".txt"), true);
check("txt-badutf8", bytesMatchKind(new Uint8Array([0x68,0x69,0xff]), ".txt"), false);

// ranking
const obj = [{id:"a",weight:50},{id:"b",weight:30},{id:"c",weight:20}];
const fit = computeObjectiveFit({a:2,b:3,c:1}, obj);
check("fit", round2(fit), 0.70);
check("prio", round2(computePriority(fit, 3, 80, 5)), 33.60);
check("prio-eff2", round2(computePriority(fit, 3, 80, 2)), 84.00);
const fit2 = computeObjectiveFit({a:3,b:1,c:0}, obj);
check("fit2", round2(fit2), 0.60);
check("prio-saml", round2(computePriority(fit2, 5, 90, 8)), 33.75);

// surrogate pairs
const emoji = "a😀b";
check("snap-mid-in", snapOutward(emoji, 2, true), 3);
check("snap-mid-out", snapOutward(emoji, 2, false), 1);
check("split-none", splitsSurrogatePair("abcd", 1, 3), false);
check("split-yes", splitsSurrogatePair(emoji, 2, 4), true);

console.log(fails === 0 ? "all domain tests passed" : `${fails} failures`);
