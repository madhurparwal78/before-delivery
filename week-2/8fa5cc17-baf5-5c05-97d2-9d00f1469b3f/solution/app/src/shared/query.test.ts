import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUERY_TEXT_CAP,
  addDays,
  checkQuery,
  compareText,
  groupField,
  groupObjects,
  isSortKey,
  matches,
  sortObjects,
  type QueryContext,
  type QueryField,
  type QueryObject,
  type QueryType,
} from './query.ts';

const field = (name: string, kind: QueryField['kind'], extra: Partial<QueryField> = {}): QueryField => ({
  name,
  kind,
  options: null,
  targetTypeId: null,
  ...extra,
});

const person: QueryType = { id: 'person', name: 'Person', fields: [field('Affiliation', 'text')] };
const source: QueryType = {
  id: 'source',
  name: 'Source',
  fields: [
    field('Author', 'relation', { targetTypeId: 'person' }),
    field('Year', 'number'),
    field('Kind', 'select', { options: ['Book', 'Article', 'Chapter', 'Thesis'] }),
    field('Link', 'url'),
  ],
};

function context(types: QueryType[], objects: QueryObject[], today = '2026-11-01'): QueryContext {
  return {
    today,
    typeById: (id) => types.find((t) => t.id === id),
    objectById: (id) => objects.find((o) => o.id === id),
  };
}

function errorOf(text: string, type: QueryType = source): string {
  const check = checkQuery(text, type, context([source, person], []));
  assert.equal(check.ok, false, text);
  return check.ok ? '' : check.message;
}

test('reports the first error with its column', () => {
  const cases: [string, string][] = [
    ['Kind = ', 'Unexpected end of query at column 8.'],
    ['Kindd = "Book"', 'Unknown field Kindd at column 1.'],
    ['Kind ~ "Book"', '~ does not fit Kind at column 6.'],
    ['@title = "abc', 'Unclosed string at column 10.'],
    ['@title = "a\\"', 'Unclosed string at column 10.'],
    ['@updated > 2026-04-31', 'Not a real date at column 12.'],
    ['Kind = "Zine"', '"Zine" is not an option of Kind at column 8.'],
    ['Year = "1987"', 'Unexpected "1987" at column 8.'],
    ['Kind = = "Book"', 'Unexpected = at column 8.'],
    ['Year = 1 AND', 'Unexpected end of query at column 13.'],
    ['((((((((( Year = 1 )))))))))', 'Too deeply nested at column 9.'],
    ['not not not not not not not not not Kind = "Book"', 'Too deeply nested at column 33.'],
    ['x'.repeat(QUERY_TEXT_CAP + 1), 'Use at most 500 characters.'],
    ['Year < null', 'Unexpected null at column 8.'],
    ['Year.Kind = "x"', 'Unknown field Year.Kind at column 1.'],
    ['Author.Nope = "x"', 'Unknown field Author.Nope at column 1.'],
    ['[Due date] = 2026-01-01', 'Unknown field Due date at column 1.'],
    ['@nope = 1', 'Unknown field @nope at column 1.'],
    ['Year = 1 Year', 'Unexpected Year at column 10.'],
    ['(Year = 1', 'Unexpected end of query at column 10.'],
    ['@updated > today - 1', 'Unexpected 1 at column 20.'],
    ['Link = 5', 'Unexpected 5 at column 8.'],
    ['Author < "x"', '< does not fit Author at column 8.'],
  ];
  for (const [text, message] of cases) assert.equal(errorOf(text), message, text);
});

test('columns count code points, not UTF-16 units', () => {
  const emoji: QueryType = { id: 'e', name: 'E', fields: [field('Note', 'text')] };
  assert.equal(errorOf('Note = "😀" AND Nope = "x"', emoji), 'Unknown field Nope at column 16.');
});

test('the length cap counts characters and allows exactly 500', () => {
  assert.equal(checkQuery(' '.repeat(QUERY_TEXT_CAP), source, context([source], [])).ok, true);
  assert.equal(errorOf('Year = 1' + ' '.repeat(QUERY_TEXT_CAP)), 'Use at most 500 characters.');
});

test('accepts valid text, brackets, paths and any keyword case', () => {
  for (const text of ['[Kind] = "Book" OR @backlinks >= 1', '  ', 'Author.Affiliation ~ "Fen"', 'Author.@title = null', 'kind = "book" or not year > 1 and @UPDATED <= TODAY + 3d']) {
    assert.equal(checkQuery(text, source, context([source, person], [])).ok, true, text);
  }
});

test('stays fast on hostile 500-character text', () => {
  const inputs = ['('.repeat(500), 'NOT '.repeat(125), 'Year = 1 AND '.repeat(38), '"'.repeat(500), '['.repeat(500), 'a'.repeat(500)];
  const started = Date.now();
  for (const text of inputs) checkQuery(text.slice(0, QUERY_TEXT_CAP), source, context([source], []));
  assert.ok(Date.now() - started < 200);
});

test('evaluates comparisons, nulls, paths and today', () => {
  const ty: QueryType = {
    id: 'ql',
    name: 'QL',
    fields: [
      field('Note', 'text'),
      field('Count', 'number'),
      field('Due', 'date'),
      field('Stage', 'select', { options: ['Draft', 'Final'] }),
      field('Ref', 'relation', { targetTypeId: 'ql' }),
    ],
  };
  const obj = (id: string, title: string, backlinks: number, properties: QueryObject['properties']): QueryObject => ({
    id,
    title,
    typeId: 'ql',
    backlinks,
    updatedDate: '2026-11-01',
    properties,
  });
  const objects = [
    obj('one', 'QL one', 1, { Note: 'Alpha', Count: 5, Due: '2026-01-10', Stage: 'Draft', Ref: null }),
    obj('two', 'QL two', 1, { Count: 1, Stage: 'Final', Ref: 'one' }),
    obj('three', 'QL three', 0, { Note: 'alpha beta', Due: '2030-01-01', Ref: 'two' }),
  ];
  const ctx = context([ty], objects);
  const cases: [string, string[]][] = [
    ['Count > 2', ['one']],
    ['NOT Count > 2', ['two', 'three']],
    ['Count = null', ['three']],
    ['Count != null', ['one', 'two']],
    ['Note = "ALPHA"', ['one']],
    ['Note ~ "ALP"', ['one', 'three']],
    ['Note ~ "%"', []],
    ['Note != "alpha"', ['three']],
    ['Stage = "final"', ['two']],
    ['Ref = "ql ONE"', ['two']],
    ['Ref.@title = "QL two"', ['three']],
    ['Ref.Count >= 1', ['two', 'three']],
    ['Ref.Count = null', ['one']],
    ['Due <= 2026-06-30', ['one']],
    ['Due > today', ['three']],
    ['@updated <= today', ['one', 'two', 'three']],
    ['@updated >= today - 2d', ['one', 'two', 'three']],
    ['@updated > today+0d', []],
    ['(Count > 2 OR Stage = "Final") AND NOT Note = null', ['one']],
    ['@backlinks >= 1', ['one', 'two']],
    ['', ['one', 'two', 'three']],
    ['COUNT >= 3 Or STAGE = "final"', ['one', 'two']],
    ['@title = "QL \\"x\\\\"', []],
  ];
  for (const [text, expected] of cases) {
    const check = checkQuery(text, ty, ctx);
    assert.ok(check.ok, text);
    if (check.ok) assert.deepEqual(objects.filter((o) => matches(check.query, o, ctx)).map((o) => o.id), expected, text);
  }
});

test('addDays moves across months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('compares text lowercased by code point, prefixes first', () => {
  assert.ok(compareText('abc', 'ABD') < 0);
  assert.ok(compareText('ab', 'abc') < 0);
  assert.equal(compareText('Gs A', 'gs a'), 0);
  assert.ok(compareText('￿', '😀') < 0);
});

const stageType: QueryType = {
  id: 'gs',
  name: 'GS',
  fields: [field('Stage', 'select', { options: ['Low', 'High'] }), field('Count', 'number'), field('Note', 'text')],
};
const gs = (id: string, title: string, properties: QueryObject['properties']): QueryObject => ({
  id,
  title,
  typeId: 'gs',
  backlinks: 0,
  updatedDate: '2026-11-01',
  properties,
});
const g1 = gs('g1', 'Gs b', { Stage: 'High', Count: 2 });
const g2 = gs('g2', 'Gs a', { Stage: 'High', Count: 2 });
const g3 = gs('g3', 'Gs c', { Stage: 'Low', Count: 9 });
const g4 = gs('g4', 'Gs d', {});
const g5 = gs('g5', 'Gs e', { Stage: 'Low', Count: 1 });
const all = [g1, g2, g3, g4, g5];
const ids = (rows: QueryObject[]): string[] => rows.map((r) => r.id);

test('sorts by keys, nulls last both ways, ties by title then id', () => {
  const ctx = context([stageType], all);
  assert.deepEqual(ids(sortObjects(all, stageType, [{ key: 'Count', dir: 'desc' }], ctx)), ['g3', 'g2', 'g1', 'g5', 'g4']);
  assert.deepEqual(ids(sortObjects(all, stageType, [{ key: 'Count', dir: 'asc' }], ctx)), ['g5', 'g2', 'g1', 'g3', 'g4']);
  assert.deepEqual(
    ids(sortObjects(all, stageType, [{ key: 'stage', dir: 'asc' }, { key: '@title', dir: 'desc' }], ctx)),
    ['g5', 'g3', 'g1', 'g2', 'g4'],
  );
  const twin = gs('G0', 'gs A', {});
  assert.deepEqual(ids(sortObjects([g2, twin], stageType, [{ key: '@backlinks', dir: 'asc' }], ctx)), ['G0', 'g2']);
});

test('sorts relations by target title and dates by calendar', () => {
  const ty: QueryType = { id: 'r', name: 'R', fields: [field('Ref', 'relation', { targetTypeId: 'r' }), field('Due', 'date')] };
  const r = (id: string, title: string, props: QueryObject['properties']): QueryObject => ({
    id,
    title,
    typeId: 'r',
    backlinks: 0,
    updatedDate: '2026-11-01',
    properties: props,
  });
  const zed = r('z', 'zed', { Due: '2026-02-01' });
  const amy = r('a', 'Amy', { Due: '2025-12-31' });
  const toZed = r('x1', 'x1', { Ref: 'z' });
  const toAmy = r('x2', 'x2', { Ref: 'a' });
  const rows = [zed, amy, toZed, toAmy];
  const ctx = context([ty], rows);
  assert.deepEqual(ids(sortObjects(rows, ty, [{ key: 'Ref', dir: 'asc' }], ctx)), ['x2', 'x1', 'a', 'z']);
  assert.deepEqual(ids(sortObjects(rows, ty, [{ key: 'Due', dir: 'desc' }], ctx)), ['z', 'a', 'x1', 'x2']);
});

test('groups by label like text with No value last, rows keep order', () => {
  const ctx = context([stageType], all);
  const rows = sortObjects(all, stageType, [{ key: 'Count', dir: 'desc' }], ctx);
  const stage = groupField(stageType, 'Stage');
  assert.ok(stage);
  if (stage === undefined) return;
  assert.deepEqual(
    groupObjects(rows, stage, ctx).map((g) => [g.label, g.key, ids(g.rows)]),
    [
      ['High', 'High', ['g2', 'g1']],
      ['Low', 'Low', ['g3', 'g5']],
      ['No value', null, ['g4']],
    ],
  );
});

test('only select, relation, date and text fields group; sort keys are fields or built-ins', () => {
  assert.equal(groupField(stageType, 'Count'), undefined);
  assert.equal(groupField(stageType, 'note')?.name, 'Note');
  assert.equal(isSortKey(stageType, '@updated'), true);
  assert.equal(isSortKey(stageType, 'count'), true);
  assert.equal(isSortKey(stageType, 'Nope'), false);
});
