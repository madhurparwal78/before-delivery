/**
 * Copies the fonts and icons the app ships out of its devDependencies, so the browser loads
 * them from the app's own origin, and converts the WOFF faces the recap PDF embeds into
 * plain TrueType.
 *
 * Fonts: IBM Plex Sans, IBM Plex Mono, Instrument Serif (OFL-1.1).
 * Icons: Lucide (ISC).
 */
import { inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// npm runs build scripts from the package root, whatever directory the compiled file sits in.
const root = process.cwd();
const clientFonts = resolve(root, 'src/client/fonts');
const pdfFonts = resolve(root, 'assets/fonts');
const iconModule = resolve(root, 'src/client/icons/generated.ts');

mkdirSync(clientFonts, { recursive: true });
mkdirSync(pdfFonts, { recursive: true });
mkdirSync(dirname(iconModule), { recursive: true });

/** Each face the client loads, with the subsets it needs. */
interface BrowserFace {
  readonly package: string;
  readonly file: string;
  readonly weights: readonly number[];
  readonly subsets: readonly string[];
}

const FACES: readonly BrowserFace[] = [
  { package: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans', weights: [400, 600], subsets: ['latin', 'latin-ext'] },
  { package: '@fontsource/ibm-plex-mono', file: 'ibm-plex-mono', weights: [400, 500], subsets: ['latin', 'latin-ext'] },
  { package: '@fontsource/instrument-serif', file: 'instrument-serif', weights: [400], subsets: ['latin', 'latin-ext'] },
];

/** The faces the recap PDF embeds, converted from WOFF to TrueType. */
interface PdfFace {
  readonly package: string;
  readonly file: string;
  readonly weight: number;
  readonly name: string;
}

const PDF_FACES: readonly PdfFace[] = [
  { package: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans', weight: 400, name: 'IBMPlexSans' },
  { package: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans', weight: 600, name: 'IBMPlexSans-SemiBold' },
  { package: '@fontsource/instrument-serif', file: 'instrument-serif', weight: 400, name: 'InstrumentSerif' },
];

function facePath(pkg: string, file: string, subset: string, weight: number): string {
  return resolve(root, 'node_modules', pkg, 'files', `${file}-${subset}-${weight}-normal.woff2`);
}

function woffPath(pkg: string, file: string, weight: number): string {
  return resolve(root, 'node_modules', pkg, 'files', `${file}-latin-${weight}-normal.woff`);
}

// --- Browser faces -----------------------------------------------------------

let copied = 0;
for (const face of FACES) {
  for (const subset of face.subsets) {
    for (const weight of face.weights) {
      const source = facePath(face.package, face.file, subset, weight);
      if (!existsSync(source)) continue;
      writeFileSync(resolve(clientFonts, `${face.file}-${subset}-${weight}.woff2`), readFileSync(source));
      copied += 1;
    }
  }
}

// --- WOFF to TrueType, for the PDF text layer --------------------------------

/**
 * WOFF1 wraps a TrueType font: a header, a table directory, and each table either stored or
 * zlib-deflated. Rebuilding the sfnt is a matter of inflating each table and writing a plain
 * table directory back.
 */
function woffToTrueType(woff: Buffer): Buffer {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  const tables: Array<{ tag: string; data: Buffer; origChecksum: number }> = [];
  for (let index = 0; index < numTables; index += 1) {
    const entry = 44 + index * 20;
    const tag = woff.toString('latin1', entry, entry + 4);
    const offset = woff.readUInt32BE(entry + 4);
    const compLength = woff.readUInt32BE(entry + 8);
    const origLength = woff.readUInt32BE(entry + 12);
    const origChecksum = woff.readUInt32BE(entry + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(raw) : raw;
    if (data.length !== origLength) throw new Error(`table ${tag} inflated to the wrong length`);
    tables.push({ tag, data, origChecksum });
  }
  tables.sort((left, right) => (left.tag < right.tag ? -1 : 1));

  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = 2 ** entrySelector * 16;
  const header = Buffer.alloc(12);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);

  const directory = Buffer.alloc(numTables * 16);
  const bodies: Buffer[] = [];
  let offset = 12 + numTables * 16;
  tables.forEach((table, index) => {
    const entry = index * 16;
    directory.write(table.tag, entry, 4, 'latin1');
    directory.writeUInt32BE(table.origChecksum, entry + 4);
    directory.writeUInt32BE(offset, entry + 8);
    directory.writeUInt32BE(table.data.length, entry + 12);
    const padding = (4 - (table.data.length % 4)) % 4;
    bodies.push(table.data, Buffer.alloc(padding));
    offset += table.data.length + padding;
  });

  return Buffer.concat([header, directory, ...bodies]);
}

const manifest: Array<{ name: string; bytes: number }> = [];
for (const face of PDF_FACES) {
  const source = woffPath(face.package, face.file, face.weight);
  if (!existsSync(source)) throw new Error(`missing WOFF for ${face.name} at ${source}`);
  const ttf = woffToTrueType(readFileSync(source));
  writeFileSync(resolve(pdfFonts, `${face.name}.ttf`), ttf);
  manifest.push({ name: face.name, bytes: ttf.length });
}

// --- Lucide icons ------------------------------------------------------------

const ICONS: Readonly<Record<string, string>> = {
  search: 'search',
  panelLeft: 'panel-left',
  panelRight: 'panel-right',
  stickyNote: 'sticky-note',
  image: 'image',
  group: 'group',
  link: 'link-2',
  zoomIn: 'zoom-in',
  zoomOut: 'zoom-out',
  maximize: 'maximize',
  trash: 'trash-2',
  history: 'history',
  copy: 'copy',
  plus: 'plus',
  close: 'x',
  play: 'play',
  undo: 'rotate-ccw',
  eye: 'eye',
  download: 'download',
  check: 'check',
};

function iconBody(name: string): string {
  const file = resolve(root, 'node_modules/lucide-static/icons', `${name}.svg`);
  const svg = readFileSync(file, 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return inner.replace(/\s+/g, ' ').trim();
}

const entries = Object.entries(ICONS)
  .map(([key, name]) => `  ${key}: ${JSON.stringify(iconBody(name))},`)
  .join('\n');

writeFileSync(
  iconModule,
  `// Generated by scripts/vendor-assets.mjs from the Lucide icon set (ISC). Do not edit.\n` +
    `export const ICON_BODIES = {\n${entries}\n} as const;\n\n` +
    `export type IconName = keyof typeof ICON_BODIES;\n`,
  'utf8',
);

process.stdout.write(
  `vendored ${copied} browser font files, ${manifest.length} PDF fonts ` +
    `(${manifest.map((entry) => `${entry.name} ${entry.bytes}B`).join(', ')}), ` +
    `${Object.keys(ICONS).length} icons\n`,
);
