#!/usr/bin/env node
/* Cross-check the browser preview maths against the server's figures. */
"use strict";

const { execSync } = require("child_process");

const pythonFigures = JSON.parse(execSync(
  ".venv/bin/python - <<'EOF'\n" +
  `import json
from edgeprint.exposure import relative_stops, relative_log_h, parse_aperture, parse_shutter, round_half_away
cases = [
    {"ev": 10, "ei": 400, "ap": "8", "sh": "1/125", "p": 1.00},
    {"ev": 3, "ei": 400, "ap": "8", "sh": '4"', "p": 0.85},
    {"ev": 12, "ei": 100, "ap": "5.6", "sh": "1/125", "p": 1.00},
    {"ev": -6, "ei": 6, "ap": "1", "sh": "3600\\"", "p": 0.5},
    {"ev": 21, "ei": 12800, "ap": "64", "sh": "1/8000", "p": 1.00},
]
out = []
for c in cases:
    s = relative_stops(metered_ev=c["ev"], ei=c["ei"], aperture=c["ap"],
                       t_seconds=parse_shutter(c["sh"]), reciprocity_p=c["p"])
    out.append({"stops": round_half_away(s, 2), "log_h": round_half_away(s * 0.30103, 2)})
print(json.dumps(out))
`, { cwd: "/app" }).toString());

// The browser's maths, copied from static/js/exposure.js.
const fs = require("fs");
const source = fs.readFileSync("/app/edgeprint/static/js/exposure.js", "utf8");
global.window = {};
new Function(source)();
const E = global.window.Edgeprint;
// The preview needs the aperture table; the server's table is the one source.
const aperturesBody = JSON.parse(execSync(
  "curl -s http://127.0.0.1:4173/api/config/apertures", { cwd: "/app" }).toString());
// loadApertures reads through fetch; give it the server's table directly.
global.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(aperturesBody),
});
const cases = [
  { ev: 10, ei: 400, ap: "8", sh: "1/125", p: 1.00 },
  { ev: 3, ei: 400, ap: "8", sh: '4"', p: 0.85 },
  { ev: 12, ei: 100, ap: "5.6", sh: "1/125", p: 1.00 },
  { ev: -6, ei: 6, ap: "1", sh: '3600"', p: 0.5 },
  { ev: 21, ei: 12800, ap: "64", sh: "1/8000", p: 1.00 },
];

let failures = 0;

async function main() {
  await E.loadApertures();
  for (let i = 0; i < cases.length; i += 1) {
  const expected = pythonFigures[i];
    const preview = E.previewText({ ei: cases[i].ei, reciprocity_p: cases[i].p },
                                  cases[i].ap, cases[i].sh, String(cases[i].ev));
    const sign = (value) => (value === 0 ? "" : (value > 0 ? "+" : "\u2212"));
    const wanted = `${expected.stops === 0 ? "0.00" : sign(expected.stops)}${Math.abs(expected.stops).toFixed(2)} stops \u00b7 log H ${expected.log_h === 0 ? "0.00" : sign(expected.log_h)}${Math.abs(expected.log_h).toFixed(2)}`;
    const ok = preview === wanted;
    console.log((ok ? "PASS  " : "FAIL  ") + JSON.stringify(cases[i]) +
      (ok ? "" : ` browser="${preview}" server="${wanted}"`));
    if (!ok) failures += 1;
  }

  // The unparsable cases read exactly —.
  for (const [ap, sh, ev] of [["5.61", "1/125", "12"], ["8", "banana", "12"],
                              ["8", "1/125", ""], ["8", "1/125", "25"]]) {
    const preview = E.previewText({ ei: 400, reciprocity_p: 1.0 }, ap, sh, ev);
    const ok = preview === "\u2014";
    console.log((ok ? "PASS  " : "FAIL  ") + `preview ${ap}/${sh}/${ev} -> ${preview}`);
    if (!ok) failures += 1;
  }
}

main().then(() => process.exit(failures ? 1 : 0));
