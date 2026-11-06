// Checks of the shared exact arithmetic against every worked example printed
// in the brief. Run with: node tools/checks.mjs after a build, or with
// tools/run-checks.mjs which builds the shared bundle first.
import { strict as assert } from "node:assert";
import {
  FRAME_RATES,
  convertFrames,
  nominalFrames,
  parsePositiveDecimal,
  realSecondsText,
  secondsToFrames,
  targetFrames,
} from "../build/shared/index.js";
import { framesOfTimecode, timecode } from "../build/shared/index.js";
import { foldAscii, foldForCompare } from "../build/shared/index.js";
import { amountText } from "../build/shared/index.js";

let count = 0;
function check(name, got, want) {
  count++;
  assert.strictEqual(got, want, `${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  console.log(`ok ${name} = ${JSON.stringify(got)}`);
}

// Timecode: the published drop-frame table.
for (const [f, want] of [
  [899, "00:00:29;29"],
  [900, "00:00:30;00"],
  [1799, "00:00:59;29"],
  [1800, "00:01:00;02"],
  [3598, "00:02:00;02"],
  [17981, "00:09:59;29"],
  [17982, "00:10:00;00"],
]) {
  check(`timecode 29.97 ${f}`, timecode(f, "29.97"), want);
}
check("timecode 23.976 720", timecode(720, "23.976"), "00:00:30:00");
check("timecode 25 37", timecode(37, "25"), "00:00:01:12");

// framesOfTimecode inverts timecode over the whole drop-frame range of a
// commercial's length and over a minute boundary at the other rates.
for (let f = 0; f <= 40000; f += 7) {
  const back = framesOfTimecode(timecode(f, "29.97"), "29.97");
  assert.strictEqual(back, f, `roundtrip 29.97 ${f}`);
  if (f % 499 === 0) console.log(`ok roundtrip 29.97 ${f}`);
}
for (const rate of ["25", "23.976"]) {
  for (let f = 0; f <= 5000; f += 13) {
    assert.strictEqual(framesOfTimecode(timecode(f, rate), rate), f);
  }
  console.log(`ok roundtrip ${rate}`);
}

// Real seconds: 120 frames at 23.976 is exactly 5.005 -> 5.01 s; 180 -> 7.51 s.
check("seconds 23.976 120", realSecondsText(120, "23.976"), "5.01 s");
check("seconds 23.976 180", realSecondsText(180, "23.976"), "7.51 s");
check("seconds 25 37", realSecondsText(37, "25"), "1.48 s");
check("seconds 29.97 38", realSecondsText(38, "29.97"), "1.27 s");

// Frames from seconds, half up on the exact value.
check("secondsToFrames 25 1.5", secondsToFrames("1.5", "25"), 38);
check("secondsToFrames 23.976 1.5", secondsToFrames("1.5", "23.976"), 36);
check("secondsToFrames 29.97 1.5", secondsToFrames("1.5", "29.97"), 45);

// Target frames of a nominal length.
check("target 30@25", targetFrames(30, "25"), 750);
check("target 30@23.976", targetFrames(30, "23.976"), 720);
check("target 30@29.97", targetFrames(30, "29.97"), 900);
check("target 6@29.97", targetFrames(6, "29.97"), 180);

// Changing the frame rate keeps real length as near as whole frames allow.
check("convert 38 25->23.976", convertFrames(38, "25", "23.976"), 36);
check("convert 38 25->29.97", convertFrames(38, "25", "29.97"), 46);
check("convert 1 25->29.97", convertFrames(1, "25", "29.97"), 1);

// Nominal seconds.
check("nominal 25", nominalFrames("25"), 25);
check("nominal 23.976", nominalFrames("23.976"), 24);
check("nominal 29.97", nominalFrames("29.97"), 30);

// Money: milestones split exactly, tax half up per milestone.
check("amount EUR", amountText("EUR", 183550n), "€1,835.50");
check("amount CAD", amountText("CAD", 183550n), "CA$1,835.50");
check("amount USD", amountText("USD", 183550n), "US$1,835.50");
check("amount EUR tax 385455", amountText("EUR", 38546n), "€385.46");

// Folding: search folds, the edit decision list folds to printable ASCII.
check("fold compare", foldForCompare("Zoë Ørsted"), "zoe orsted");
check("fold ascii", foldAscii("Zoë Ørsted"), "Zoe Orsted");
check("fold ascii É", foldAscii("Élodie"), "Elodie");
check("fold ascii capital Æ", foldAscii("Æon"), "AEon");
check("fold ascii Œ", foldAscii("Œuvre"), "OEuvre");
check("fold ascii İ", foldAscii("İstanbul"), "Istanbul");
check("fold ascii ẞ", foldAscii("Straẞe"), "Strasse");
check("fold ascii keeps case", foldAscii("ABC def"), "ABC def");
check("fold ascii outside", foldAscii("liæ \u732b"), "liae _");
check("fold arabic stays", foldForCompare("ليلى حداد"), "ليلى حداد");

// Decimal parsing.
const oneAndAHalf = parsePositiveDecimal("1.5", null);
check("parse 1.5 value", oneAndAHalf === null ? "null" : oneAndAHalf.n.toString(), "15");
check("parse 1.5 denom", oneAndAHalf === null ? "null" : oneAndAHalf.d.toString(), "10");
check("parse rejects negative", parsePositiveDecimal("-1.5", null), null);
const money = parsePositiveDecimal("5506.50", 2);
check("parse 2 places ok", money === null ? "null" : money.n.toString(), "550650");
check("parse 3 places rejected for money", parsePositiveDecimal("1.234", 2), null);

// Frame rate set.
check("rates", FRAME_RATES.join("|"), "25|23.976|29.97");

console.log(`\n${count} checks passed`);
