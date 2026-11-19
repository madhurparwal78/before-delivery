import { clientCopy } from "../domain/copy.ts";
import { type Language, directionOf } from "../domain/towns.ts";
import { escapeHtml } from "./document.ts";
import { noteHtml } from "./noteHtml.ts";

const KIND_NAMES: Record<string, string> = { tear: "Tear", crack: "Crack", stain: "Stain", looseJoint: "Loose joint", woodworm: "Woodworm" };

interface DossierFacts {
  title: string;
  maker: string | null;
  year: string | null;
  stamp: string | null;
  clientName: string;
  pins: { number: number; kind: string; note: string }[];
  material: { name: string | null; code: string; lot: string | null } | null;
  /** Data addresses of the latest pictures of each side. */
  before: string | null;
  after: string | null;
  language: Language;
}

function picture(caption: string, address: string | null): string {
  return address ? `<figure><img src="${address}" alt="${caption}"><figcaption>${caption}</figcaption></figure>` : "";
}

/** The dossier as the HTML posted to Gotenberg: no amounts, no unsigned notes, pictures inside the request. */
export function dossierHtml(facts: DossierFacts): string {
  const line = (label: string, value: string | null): string => (value ? `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>` : "");
  const pins = facts.pins.map((pin) => `<tr><td>${pin.number}</td><td>${escapeHtml(KIND_NAMES[pin.kind] ?? pin.kind)}</td><td>${noteHtml(pin.note)}</td></tr>`).join("");
  const material = facts.material
    ? `<table><tr><th>Material</th><td>${escapeHtml(facts.material.name ?? "")} ${escapeHtml(facts.material.code)}</td></tr><tr><th>Dye lot</th><td>${escapeHtml(facts.material.lot ?? "")}</td></tr></table>`
    : "<p>Frame work only, no material.</p>";
  const dir = directionOf(facts.language);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Dossier for ${escapeHtml(facts.title)}</title>
<style>
body { font-family: sans-serif; color: #25282b; margin: 24mm 18mm; font-size: 12pt; line-height: 1.45; overflow-wrap: anywhere; }
h1 { font-size: 24pt; font-weight: 500; margin: 0 0 8mm; }
h2 { font-size: 15pt; font-weight: 500; margin: 8mm 0 3mm; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: start; vertical-align: top; padding: 1.5mm 3mm 1.5mm 0; }
th { font-weight: 500; }
figure { display: inline-block; width: 48%; margin: 0 1% 4mm 0; vertical-align: top; }
img { max-width: 100%; }
</style></head><body>
<h1>Dossier for ${escapeHtml(facts.title)}</h1>
<h2>The piece</h2>
<table>${line("Piece", facts.title)}${line("Client", facts.clientName)}${line("Maker", facts.maker)}${line("Year", facts.year)}${line("Stamp number", facts.stamp)}</table>
<h2>Condition</h2>
${pins ? `<table><tr><th>Pin</th><th>Kind</th><th>Note</th></tr>${pins}</table>` : "<p>No signed pins.</p>"}
<h2>Materials</h2>
${material}
<h2>Photographs</h2>
${picture("Before", facts.before)}${picture("After", facts.after)}
<section lang="${facts.language}" dir="${dir}">
<h2>${escapeHtml(clientCopy("K1", facts.language))}</h2>
<p>${escapeHtml(clientCopy("K2", facts.language))}</p>
</section>
</body></html>`;
}
