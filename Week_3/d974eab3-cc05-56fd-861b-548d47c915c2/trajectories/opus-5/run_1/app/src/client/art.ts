import { escapeHtml } from '../shared/escape';

export type PackView = 'front' | 'side' | 'back';

export const PACK_VIEWS: readonly PackView[] = ['front', 'side', 'back'];

function packFront(productName: string): string {
  return `<svg viewBox="0 0 220 300" aria-hidden="true" focusable="false">
<rect class="pack__body" x="4" y="4" width="212" height="292" rx="12"/>
<path class="pack__band" d="M4 198c46-18 84-18 106-6 24 13 68 15 106-4v96a12 12 0 0 1-12 12H16a12 12 0 0 1-12-12Z"/>
<path class="pack__beet" d="M110 202c20 0 30 14 30 30 0 22-18 42-30 52-12-10-30-30-30-52 0-16 10-30 30-30Z"/>
<path class="pack__leaf" d="M110 202c-7-13-4-26 5-33 4 13 2 25-5 33Z"/>
<path class="pack__leaf" d="M110 202c7-13 17-22 27-25-3 14-13 22-27 25Z"/>
<text class="pack__name" x="110" y="96" text-anchor="middle">${escapeHtml(productName)}</text>
<path class="pack__rule" d="M44 120h132"/>
<path class="pack__rule" d="M62 140h96"/>
</svg>`;
}

function packSide(productName: string): string {
  return `<svg viewBox="0 0 70 300" aria-hidden="true" focusable="false">
<rect class="pack__body" x="4" y="4" width="62" height="292" rx="10"/>
<path class="pack__band" d="M4 198c20-10 42-10 62 0v88a10 10 0 0 1-10 10H14a10 10 0 0 1-10-10Z"/>
<text class="pack__name pack__name--side" x="35" y="150" text-anchor="middle" transform="rotate(-90 35 150)">${escapeHtml(productName)}</text>
</svg>`;
}

function packBack(productName: string): string {
  const rules = [0, 1, 2, 3, 4, 5]
    .map((row) => `<path class="pack__rule" d="M30 ${132 + row * 22}h160"/>`)
    .join('');
  return `<svg viewBox="0 0 220 300" aria-hidden="true" focusable="false">
<rect class="pack__body" x="4" y="4" width="212" height="292" rx="12"/>
<text class="pack__name pack__name--back" x="110" y="68" text-anchor="middle">${escapeHtml(productName)}</text>
<path class="pack__rule" d="M30 94h160"/>
<rect class="pack__panel" x="30" y="110" width="160" height="150" rx="6"/>
${rules}
<path class="pack__band" d="M4 272h212v12a12 12 0 0 1-12 12H16a12 12 0 0 1-12-12Z"/>
</svg>`;
}

/** The drawn pack, as three faces of one turning box. */
export function packFaces(productName: string): string {
  return `<div class="pack__cube" data-pack-cube>
<div class="pack__face pack__face--front">${packFront(productName)}</div>
<div class="pack__face pack__face--side">${packSide(productName)}</div>
<div class="pack__face pack__face--back">${packBack(productName)}</div>
</div>`;
}

/** An abstract head-and-shoulders portrait coloured from the interview's hue. */
export function portraitSvg(hue: number): string {
  return `<svg class="portrait" viewBox="0 22 200 134" role="presentation" focusable="false"
 style="--portrait-hue:${hue}">
<rect class="portrait__field" width="200" height="200"/>
<circle class="portrait__halo" cx="100" cy="86" r="62"/>
<path class="portrait__shoulders" d="M22 200c6-42 36-62 78-62s72 20 78 62Z"/>
<circle class="portrait__head" cx="100" cy="82" r="38"/>
<path class="portrait__mark" d="M62 150c22-10 54-10 76 0"/>
</svg>`;
}

const SCENES: Record<string, string> = {
  'on-work': `<rect class="scene__field" width="400" height="260"/>
<rect class="scene__window" x="236" y="26" width="132" height="120" rx="4"/>
<path class="scene__line" d="M302 26v120M236 86h132"/>
<path class="scene__beam" d="M236 146 368 30v116Z"/>
<path class="scene__line" d="M24 198h352"/>
<path class="scene__solid" d="M72 198v-44h108v44Z"/>
<path class="scene__line" d="M60 198h132"/>
<rect class="scene__accent" x="214" y="166" width="26" height="32" rx="4"/>`,
  'on-sports': `<rect class="scene__field" width="400" height="260"/>
<path class="scene__solid" d="M0 200 112 66l78 92 46-44 164 86Z"/>
<path class="scene__line" d="M0 212c80-26 150 10 216-14s118-6 184 18"/>
<circle class="scene__accent" cx="314" cy="54" r="22"/>
<path class="scene__line" d="M58 238c26-14 54-14 80 0"/>
<rect class="scene__accent" x="140" y="208" width="22" height="42" rx="8"/>`,
  'on-hobby': `<rect class="scene__field" width="400" height="260"/>
<path class="scene__solid" d="M28 170h344v22H28Z"/>
<path class="scene__line" d="M56 192v52M344 192v52"/>
<path class="scene__line" d="M96 170 170 96l26 26-74 74"/>
<path class="scene__line" d="M170 96l-10 12 24 24 12-10"/>
<rect class="scene__accent" x="248" y="112" width="68" height="58" rx="6"/>
<circle class="scene__field-dot" cx="282" cy="142" r="16"/>
<path class="scene__line" d="M40 150h120"/>`,
  'on-housework': `<rect class="scene__field" width="400" height="260"/>
<path class="scene__line" d="M20 64c120 22 240 22 360 0"/>
<path class="scene__solid" d="M68 72h58v74H68Z"/>
<path class="scene__solid" d="M168 70h62v88h-62Z"/>
<path class="scene__accent" d="M272 68h54v66h-54Z"/>
<path class="scene__line" d="M96 208h104l-12 44H108Z"/>
<path class="scene__line" d="M96 208h104"/>
<path class="scene__line" d="M236 252h132"/>`,
  'off-break': `<rect class="scene__field" width="400" height="260"/>
<rect class="scene__window" x="44" y="24" width="180" height="150" rx="4"/>
<path class="scene__line" d="M134 24v150M44 99h180"/>
<path class="scene__line" d="M24 196h352"/>
<rect class="scene__solid" x="252" y="166" width="94" height="30" rx="8"/>
<circle class="scene__accent" cx="170" cy="222" r="20"/>
<path class="scene__line" d="M150 222h40"/>`,
  'off-holiday': `<rect class="scene__field" width="400" height="260"/>
<circle class="scene__accent" cx="300" cy="72" r="34"/>
<path class="scene__line" d="M0 170h400"/>
<path class="scene__solid" d="M96 170v-36h132v36Z"/>
<path class="scene__line" d="M162 134v36"/>
<path class="scene__solid" d="M252 236v-48h74v48Z"/>
<path class="scene__line" d="M274 188v-16h30v16"/>
<path class="scene__line" d="M40 236h160"/>`,
  'off-relax': `<rect class="scene__field" width="400" height="260"/>
<path class="scene__solid" d="M56 150h288c0 54-30 82-72 82H128c-42 0-72-28-72-82Z"/>
<path class="scene__line" d="M40 150h320"/>
<path class="scene__line" d="M132 112c-18-18 6-30-6-48M200 104c-18-18 6-32-6-50M268 112c-18-18 6-30-6-48"/>
<circle class="scene__accent" cx="330" cy="206" r="18"/>
<path class="scene__line" d="M312 206h36"/>`,
  'off-rest': `<rect class="scene__field" width="400" height="260"/>
<path class="scene__accent" d="M318 32a34 34 0 1 0 28 54 28 28 0 0 1-28-54Z"/>
<circle class="scene__field-dot" cx="252" cy="44" r="4"/>
<circle class="scene__field-dot" cx="212" cy="76" r="3"/>
<circle class="scene__field-dot" cx="286" cy="104" r="3"/>
<path class="scene__solid" d="M44 168h312v40H44Z"/>
<path class="scene__line" d="M44 208v34M356 208v34"/>
<path class="scene__line" d="M72 168c0-22 18-34 46-34h22c18 0 26 12 26 34"/>
<path class="scene__line" d="M186 168h170"/>`,
};

/** The scenario picture: a distinct scene in the scenario's mode colours. */
export function sceneSvg(scenarioId: string): string {
  const shapes = SCENES[scenarioId];
  if (shapes === undefined) {
    throw new Error(`No scene for ${scenarioId}.`);
  }
  return `<svg class="scene" viewBox="0 0 400 260" role="presentation" focusable="false">${shapes}</svg>`;
}
