import { build } from 'esbuild';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* Bundles the shared domain modules so this script can call them directly. */
const dir = mkdtempSync(join(tmpdir(), 'mullion-'));
const entry = join(dir, 'entry.ts');
const shared = resolve('src/shared');
writeFileSync(
  entry,
  [
    'announce',
    'area',
    'changes',
    'conflict',
    'diff',
    'generate',
    'grid',
    'messages',
    'parseCss',
    'templates',
    'trackSize',
  ]
    .map((name) => `export * from '${shared}/${name}.js';`)
    .join('\n'),
);
await build({
  entryPoints: [entry],
  outfile: join(dir, 'shared.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const m = await import(join(dir, 'shared.mjs'));

let failures = 0;
const eq = (label, actual, expected) => {
  if (actual !== expected) {
    failures += 1;
    console.log(`FAIL ${label}\n--- actual ---\n${actual}\n--- expected ---\n${expected}\n`);
  }
};

const holyGrailCss = `.layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto auto 1fr auto auto;
  gap: 16px;
  grid-template-areas:
    "header"
    "nav"
    "main"
    "aside"
    "footer";
}

.header { grid-area: header; }
.nav { grid-area: nav; }
.main { grid-area: main; }
.aside { grid-area: aside; }
.footer { grid-area: footer; }

@media (min-width: 768px) {
  .layout {
    grid-template-columns: 200px 1fr 200px;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header header header"
      "nav main aside"
      "footer footer footer";
  }
}
`;

const blankCss = `.layout {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr 1fr;
  gap: 16px;
}
`;

const dashboardCss = `.layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: 56px auto 1fr;
  gap: 12px;
  grid-template-areas:
    "top"
    "side"
    "content";
}

.top { grid-area: top; }
.side { grid-area: side; }
.content { grid-area: content; }

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: 240px 1fr;
    grid-template-rows: 56px 1fr;
    grid-template-areas:
      "top top"
      "side content";
  }
}
`;

const magazineCss = `.layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto auto auto;
  gap: 24px 16px;
  grid-template-areas:
    "lead lead"
    "story-a story-b"
    "story-c story-c";
}

.lead { grid-area: lead; }
.story-a { grid-area: story-a; }
.story-b { grid-area: story-b; }
.story-c { grid-area: story-c; }

@media (min-width: 1280px) {
  .layout {
    grid-template-columns: 2fr 1fr 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "lead story-a story-b"
      "lead story-c story-c";
  }
}
`;

const limits = { maxTracks: 12, maxBreakpoints: 3 };

eq('blank css', m.generateCss(m.templateState('blank')), blankCss);
eq('blank html', m.generateHtml(m.templateState('blank')), '<div class="layout"></div>\n');
eq('holy-grail css', m.generateCss(m.templateState('holy-grail')), holyGrailCss);
eq(
  'holy-grail html',
  m.generateHtml(m.templateState('holy-grail')),
  `<div class="layout">
  <div class="header">header</div>
  <div class="nav">nav</div>
  <div class="main">main</div>
  <div class="aside">aside</div>
  <div class="footer">footer</div>
</div>
`,
);
eq('dashboard css', m.generateCss(m.templateState('dashboard-shell')), dashboardCss);
eq(
  'dashboard html',
  m.generateHtml(m.templateState('dashboard-shell')),
  `<div class="layout">
  <div class="top">top</div>
  <div class="side">side</div>
  <div class="content">content</div>
</div>
`,
);
eq('magazine css', m.generateCss(m.templateState('magazine-spread')), magazineCss);
eq(
  'magazine html',
  m.generateHtml(m.templateState('magazine-spread')),
  `<div class="layout">
  <div class="lead">lead</div>
  <div class="story-a">story-a</div>
  <div class="story-b">story-b</div>
  <div class="story-c">story-c</div>
</div>
`,
);

// Worked example 1: Holy Grail breakpoint dropping aside.
{
  const state = m.templateState('holy-grail');
  const bp = state.breakpoints[0];
  bp.columns = ['200px', '1fr'];
  bp.areas = [
    { name: 'header', row_start: 1, column_start: 1, row_end: 2, column_end: 3 },
    { name: 'nav', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
    { name: 'main', row_start: 2, column_start: 2, row_end: 3, column_end: 3 },
    { name: 'footer', row_start: 3, column_start: 1, row_end: 4, column_end: 3 },
  ];
  const css = m.generateCss(state);
  const block = css.slice(css.indexOf('@media'));
  eq(
    'worked example 1',
    block,
    `@media (min-width: 768px) {
  .layout {
    grid-template-columns: 200px 1fr;
    grid-template-rows: auto 1fr auto;
    grid-template-areas:
      "header header"
      "nav main"
      "footer footer";
  }
  .aside { display: none; }
}
`,
  );
}

// Worked example 2: hide-then-show and an inherited gap.
{
  const state = {
    columns: ['1fr'],
    rows: ['auto', '1fr'],
    gap: { row: 16, column: 16 },
    areas: [
      { name: 'header', row_start: 1, column_start: 1, row_end: 2, column_end: 2 },
      { name: 'main', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
    ],
    breakpoints: [
      {
        min_width: 600,
        columns: ['1fr'],
        rows: ['auto', '1fr'],
        areas: [
          { name: 'header', row_start: 1, column_start: 1, row_end: 2, column_end: 2 },
          { name: 'main', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
        ],
        gap: { row: 24, column: 24 },
      },
      {
        min_width: 1024,
        columns: ['1fr', '300px'],
        rows: ['auto', '1fr'],
        areas: [
          { name: 'header', row_start: 1, column_start: 1, row_end: 2, column_end: 3 },
          { name: 'main', row_start: 2, column_start: 1, row_end: 3, column_end: 2 },
          { name: 'promo', row_start: 2, column_start: 2, row_end: 3, column_end: 3 },
        ],
        gap: null,
      },
    ],
  };
  eq(
    'worked example 2',
    m.generateCss(state),
    `.layout {
  display: grid;
  grid-template-columns: 1fr;
  grid-template-rows: auto 1fr;
  gap: 16px;
  grid-template-areas:
    "header"
    "main";
}

.header { grid-area: header; }
.main { grid-area: main; }
.promo { grid-area: promo; }
.promo { display: none; }

@media (min-width: 600px) {
  .layout {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    gap: 24px;
    grid-template-areas:
      "header"
      "main";
  }
}

@media (min-width: 1024px) {
  .layout {
    grid-template-columns: 1fr 300px;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "header header"
      "main promo";
  }
  .promo { display: block; }
}
`,
  );
  eq(
    'worked example 2 html',
    m.generateHtml(state),
    `<div class="layout">
  <div class="header">header</div>
  <div class="main">main</div>
  <div class="promo">promo</div>
</div>
`,
  );
}

// Round trip: applying generated CSS yields the same layout.
for (const key of ['blank', 'holy-grail', 'dashboard-shell', 'magazine-spread']) {
  const state = m.templateState(key);
  const parsed = m.cssToLayout(m.generateCss(state), limits);
  if (!parsed.ok) {
    failures += 1;
    console.log(`FAIL round trip ${key}: ${parsed.message}`);
  } else if (!m.statesEqual(parsed.state, state)) {
    failures += 1;
    console.log(`FAIL round trip ${key} differs: ${JSON.stringify(parsed.state)}`);
  }
}

// Track sizes.
const sizeCases = [
  ['1fr', '1fr'],
  ['1.50fr', '1.5fr'],
  ['2.0fr', '2fr'],
  ['  minmax( 200px , 300px ) ', 'minmax(200px, 300px)'],
  ['auto', 'auto'],
  ['25%', '25%'],
  ['0.25fr', '0.25fr'],
  ['100fr', '100fr'],
  ['4000px', '4000px'],
  ['minmax(auto, 1fr)', 'minmax(auto, 1fr)'],
  ['minmax(10%, auto)', 'minmax(10%, auto)'],
];
for (const [input, expected] of sizeCases) {
  const check = m.checkTrackSize(input);
  if (!check.ok) {
    failures += 1;
    console.log(`FAIL size ${input}: ${check.message}`);
  } else eq(`size ${input}`, check.canonical, expected);
}

const refusals = [
  ['10em', m.SIZE_FORM_MESSAGE],
  ['200.5px', m.SIZE_FORM_MESSAGE],
  ['fit-content(200px)', m.SIZE_FORM_MESSAGE],
  ['1FR', m.SIZE_FORM_MESSAGE],
  ['0fr', m.SIZE_RANGE_MESSAGE],
  ['0.2fr', m.SIZE_RANGE_MESSAGE],
  ['101fr', m.SIZE_RANGE_MESSAGE],
  ['0px', m.SIZE_RANGE_MESSAGE],
  ['4001px', m.SIZE_RANGE_MESSAGE],
  ['150%', m.SIZE_RANGE_MESSAGE],
  ['minmax(1fr, 0.1fr)', m.SIZE_RANGE_MESSAGE],
  ['minmax(1fr, 200px)', m.SIZE_FR_MIN_MESSAGE],
  ['minmax(300px, 200px)', m.SIZE_ORDER_MESSAGE],
  ['minmax(50%, 20%)', m.SIZE_ORDER_MESSAGE],
];
for (const [input, expected] of refusals) {
  const check = m.checkTrackSize(input);
  eq(`refusal ${input}`, check.ok ? 'accepted' : check.message, expected);
}

// Adding and removing tracks on the Holy Grail "From 768px" grid.
{
  const grid = {
    columns: ['200px', '1fr', '200px'],
    rows: ['auto', '1fr', 'auto'],
    areas: m.templateState('holy-grail').breakpoints[0].areas,
  };
  const rows = (g) => m.areaRowsOf(g).map((cells) => cells.join(' ')).join(' | ');
  const after1 = m.addTrack(grid, 'column', 1);
  eq('add after column 1', rows(after1), 'header header header header | nav . main aside | footer footer footer footer');
  eq('add after column 1 tracks', after1.columns.join(' '), '200px 1fr 1fr 200px');
  const after3 = m.addTrack(grid, 'column', 3);
  eq('add after column 3', rows(after3), 'header header header . | nav main aside . | footer footer footer .');
  eq('add after column 3 tracks', after3.columns.join(' '), '200px 1fr 200px 1fr');
  const removed = m.removeTrack(grid, 'column', 3);
  eq('remove column 3', rows(removed.grid), 'header header | nav main | footer footer');
  eq('remove column 3 tracks', removed.grid.columns.join(' '), '200px 1fr');
  eq('remove column 3 areas', removed.removedAreas.join(','), 'aside');
}

// Version differences.
{
  const blank = m.templateState('blank');
  const holy = m.templateState('holy-grail');
  eq(
    'differences blank to holy grail',
    m.versionDifferences(blank, holy).join('\n'),
    [
      'Columns: 1fr 1fr 1fr → 1fr',
      'Rows: 1fr 1fr 1fr → auto auto 1fr auto auto',
      'Area aside added: 4 / 1 / 5 / 2',
      'Area footer added: 5 / 1 / 6 / 2',
      'Area header added: 1 / 1 / 2 / 2',
      'Area main added: 3 / 1 / 4 / 2',
      'Area nav added: 2 / 1 / 3 / 2',
      'Breakpoint From 768px added',
    ].join('\n'),
  );
  const changed = m.templateState('holy-grail');
  changed.gap = { row: 24, column: 16 };
  changed.breakpoints[0].columns = ['240px', '1fr', '200px'];
  eq(
    'differences holy grail tweak',
    m.versionDifferences(holy, changed).join('\n'),
    ['Gap: 16px → 24px 16px', 'From 768px Columns: 200px 1fr 200px → 240px 1fr 200px'].join('\n'),
  );
  eq('no differences', m.versionDifferences(holy, m.templateState('holy-grail')).join('\n'), 'No differences.');
}

// CSS errors.
{
  const cases = [
    ['.layout {\n  display: grid;\n  colour: red;\n}\n', 'Line 3: unknown property colour.'],
    ['.layout {\n  display: grid;\n  grid-template-columns: 10em;\n}\n', `Line 3: ${m.SIZE_FORM_MESSAGE}`],
    ['.layout {\n  display: grid;\n  gap: 300px;\n}\n', `Line 3: ${m.GAP_MESSAGE}`],
    [
      '.layout {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  grid-template-rows: auto;\n  grid-template-areas:\n    "a a a";\n}\n',
      'Line 6: every area row needs 2 cells.',
    ],
    [
      '.layout {\n  display: grid;\n  grid-template-columns: 1fr;\n  grid-template-rows: auto auto;\n  grid-template-areas:\n    "a";\n}\n',
      'Line 5: grid-template-areas needs 2 rows.',
    ],
    [
      '.layout {\n  display: grid;\n  grid-template-columns: 1fr 1fr;\n  grid-template-rows: auto auto;\n  grid-template-areas:\n    "a b"\n    "b a";\n}\n',
      'Line 6: area a is not one rectangle.',
    ],
    [
      '.layout {\n  display: grid;\n  grid-template-columns: 1fr;\n  grid-template-rows: auto;\n  grid-template-areas:\n    "Bad";\n}\n',
      `Line 6: ${m.AREA_NAME_MESSAGE}`,
    ],
    [
      '.layout {\n  display: grid;\n  grid-template-columns: 1fr;\n  grid-template-rows: auto;\n  grid-template-areas:\n    "layout";\n}\n',
      `Line 6: ${m.AREA_RESERVED_MESSAGE}`,
    ],
    [
      '.layout {\n  display: grid;\n  grid-template-columns: 1fr;\n  grid-template-rows: auto;\n}\n\n.ghost { grid-area: ghost; }\n',
      'Line 7: area ghost is not in any grid-template-areas.',
    ],
    ['.layout {\n  display: grid;\n}\n\nbody { color: red; }\n', 'Line 5: only .layout and area rules are allowed.'],
    ['.layout {\n  display: grid;\n}\n\n@media screen {\n  .layout { gap: 0; }\n}\n', 'Line 5: breakpoints use @media (min-width: <n>px).'],
    ['.layout {\n  display: grid;\n}\n\n@media (min-width: 200px) {\n  .layout { gap: 0; }\n}\n', `Line 5: ${m.BREAKPOINT_RANGE_MESSAGE}`],
    [
      '.layout {\n  display: grid;\n}\n\n@media (min-width: 768px) {\n  .layout { gap: 0; }\n}\n\n@media (min-width: 768px) {\n  .layout { gap: 0; }\n}\n',
      'Line 9: There is already a breakpoint at 768px.',
    ],
    ['.layout {\n  grid-template-columns: 1fr;\n}\n', 'Line 1: .layout needs display: grid.'],
    ['.ghost { grid-area: ghost; }\n', 'Line 1: .layout needs display: grid.'],
    ['.layout {\n  display: grid;\n', 'Line 3: missing }.'],
  ];
  for (const [css, expected] of cases) {
    const parsed = m.cssToLayout(css, limits);
    eq(`css error`, parsed.ok ? 'accepted' : parsed.message, expected);
  }
}

// Comments, whitespace and property order are accepted.
{
  const css = `/* hello */ .layout{grid-template-rows:auto 1fr;display:grid;gap:8px 4px;grid-template-columns:1fr 1fr;grid-template-areas:"a a" "b c";}`;
  const parsed = m.cssToLayout(css, limits);
  if (!parsed.ok) {
    failures += 1;
    console.log(`FAIL loose css: ${parsed.message}`);
  } else {
    eq('loose css gap', JSON.stringify(parsed.state.gap), '{"row":8,"column":4}');
    eq('loose css areas', parsed.state.areas.map((a) => a.name).join(','), 'a,b,c');
  }
}

console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
