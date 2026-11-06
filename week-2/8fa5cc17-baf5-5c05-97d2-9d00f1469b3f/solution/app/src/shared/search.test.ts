import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandScore, paletteCommands, rankCommands, rankNotes, searchTokens, type NoteDocument } from './search.ts';

const TODAY = '2026-11-01';
const doc = (objectId: string, title: string, blockTexts: string[] = [], updatedDate = TODAY): NoteDocument => ({
  objectId,
  title,
  typeName: 'Concept',
  blockTexts,
  updatedDate,
});

test('tokens are NFKC, lowercased runs of letters and digits', () => {
  assert.deepEqual(searchTokens('Café-au-lait, ＡＢＣ１２ ﬁne'), ['café', 'au', 'lait', 'abc12', 'fine']);
  assert.deepEqual(searchTokens('Café ok'), ['café', 'ok']);
  assert.deepEqual(searchTokens('  !! '), []);
  for (const text of ['Ünïcödé — ①② x²', 'İstanbul ǅemal', '한국어 텍스트', 'é́t']) {
    assert.deepEqual(searchTokens(text), text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [], text);
  }
});

test('scores follow BM25 with title weight, idf and recency', () => {
  const docs = [doc('a', 'alpha beta'), doc('b', 'gamma', ['alpha delta delta'], '2026-10-18'), doc('c', 'other')];
  const results = rankNotes('alpha', docs, TODAY);
  const n = 3;
  const nt = 2;
  const idf = Math.log(1 + (n - nt + 0.5) / (nt + 0.5));
  const avgdl = (6 + (3 + 3) + 3) / 3;
  const bm25 = (tf: number, dl: number): number => (idf * tf * 2.2) / (tf + 1.2 * (1 - 0.75 + (0.75 * dl) / avgdl));
  const scoreA = bm25(3, 6) * 1.2;
  const scoreB = bm25(1, 6) * (1 + 0.2 * 2 ** (-14 / 14));
  assert.deepEqual(results.map((r) => r.object_id), ['a', 'b']);
  assert.equal(results[0].score, Math.round(scoreA * 10_000) / 10_000);
  assert.equal(results[1].score, Math.round(scoreB * 10_000) / 10_000);
  assert.equal(results[0].type_name, 'Concept');
});

test('typo tolerance scores half for distance exactly 1 on 5+ character terms', () => {
  const docs = [doc('x', 'Ranker zrabcdef'), doc('y', 'unrelated')];
  const exact = rankNotes('zrabcdef', docs, TODAY)[0].score;
  assert.ok(Math.abs(rankNotes('zrabxdef', docs, TODAY)[0].score - exact / 2) <= 0.0002);
  assert.ok(Math.abs(rankNotes('zrabcdefg', docs, TODAY)[0].score - exact / 2) <= 0.0002);
  assert.ok(Math.abs(rankNotes('zrabdef', docs, TODAY)[0].score - exact / 2) <= 0.0002);
  assert.deepEqual(rankNotes('zrbacdef', docs, TODAY), [], 'a swap counts as 2');
  assert.deepEqual(rankNotes('rankr', [doc('x', 'Ranker')], TODAY).length, 1);
  assert.deepEqual(rankNotes('rank', [doc('x', 'Rand')], TODAY), [], 'terms under 5 characters need an exact match');
});

test('typo match in the title gives a title snippet with that token marked', () => {
  const [result] = rankNotes('lantarn', [doc('x', 'The lantern', ['lantarn mention'])], TODAY);
  assert.deepEqual(result.snippet, [
    { text: 'The ', match: false },
    { text: 'lantern', match: true },
  ]);
});

test('title snippets beat body snippets and ties order by title then id', () => {
  const v = 'zvqqqq';
  const text = 'a '.repeat(30) + v + ' ' + 'b '.repeat(40);
  const plain = text.trim();
  const results = rankNotes(v, [doc('body', 'Plain abc', ['nothing here', plain]), doc('title', `Heading ${v}`)], TODAY);
  assert.deepEqual(results.map((r) => r.object_id), ['title', 'body']);
  assert.equal(results[0].snippet.map((s) => s.text).join(''), `Heading ${v}`);
  assert.deepEqual(results[0].snippet.filter((s) => s.match).map((s) => s.text), [v]);
  const pos = plain.indexOf(v);
  assert.equal(results[1].snippet.map((s) => s.text).join(''), plain.slice(pos - 20, pos + 60));
  assert.deepEqual(results[1].snippet.filter((s) => s.match).map((s) => s.text), [v]);

  const ties = rankNotes('ztie', [doc('2', 'Tie beta ztie'), doc('1', 'Tie alpha ztie'), doc('0', 'tie ALPHA ztie')], TODAY);
  assert.deepEqual(ties.map((r) => r.object_id), ['0', '1', '2']);
});

test('snippet windows stay within the text and use source characters', () => {
  const long = 'x'.repeat(100) + ' needle';
  const [end] = rankNotes('needle', [doc('e', 'T', [long])], TODAY);
  assert.equal(end.snippet.map((s) => s.text).join(''), long.slice(long.length - 80));
  const early = 'one needle ' + 'y'.repeat(100);
  const [start] = rankNotes('needle', [doc('s', 'T', [early])], TODAY);
  assert.equal(start.snippet.map((s) => s.text).join(''), early.slice(0, 80));
  assert.deepEqual(start.snippet.slice(0, 2), [
    { text: 'one ', match: false },
    { text: 'needle', match: true },
  ]);
  const [wide] = rankNotes('abc', [doc('w', 'ＡＢＣ and abc')], TODAY);
  assert.deepEqual(wide.snippet, [
    { text: 'ＡＢＣ', match: true },
    { text: ' and ', match: false },
    { text: 'abc', match: true },
  ]);
});

test('empty queries, no matches and the top 20', () => {
  assert.deepEqual(rankNotes('', [doc('a', 'a')], TODAY), []);
  assert.deepEqual(rankNotes('!!', [doc('a', 'a')], TODAY), []);
  assert.deepEqual(rankNotes('zzz', [doc('a', 'a')], TODAY), []);
  const many = Array.from({ length: 30 }, (_, i) => doc(`d${i}`, `common ${i}`));
  assert.equal(rankNotes('common', many, TODAY).length, 20);
});

test('a 200-character query over many documents is fast', () => {
  const words = Array.from({ length: 400 }, (_, i) => `word${i}x`);
  const docs = Array.from({ length: 500 }, (_, i) =>
    doc(`d${i}`, `Note ${words[i % 400]}`, [Array.from({ length: 60 }, (_, j) => words[(i * 7 + j) % 400]).join(' ')]),
  );
  const q = words.slice(0, 40).join(' ').slice(0, 200);
  const started = Date.now();
  rankNotes(q, docs, TODAY);
  assert.ok(Date.now() - started < 1000);
});

test('palette commands follow the theme', () => {
  assert.deepEqual(paletteCommands('paper'), ['Go to Today', 'Open graph', 'Open timeline', 'Open queries', 'Open settings', 'Switch to Lamplight', 'New type']);
  assert.equal(paletteCommands('lamplight')[5], 'Switch to Paper');
});

test('command scores reward word starts and runs', () => {
  assert.equal(commandScore('Open graph', 'op'), 3 + 2);
  assert.equal(commandScore('Open graph', 'og'), 3 + 3);
  assert.equal(commandScore('Open graph', 'O G'), 6);
  assert.equal(commandScore('Go to Today', 'xyz'), null);
  assert.equal(commandScore('New type', ''), 0);
  assert.equal(commandScore('Open timeline', 'ope'), 3 + 2 + 2);
});

test('commands rank by score, then list order', () => {
  const commands = paletteCommands('paper');
  assert.deepEqual(rankCommands(commands, ''), commands);
  assert.deepEqual(rankCommands(commands, 'op'), ['Open graph', 'Open timeline', 'Open queries', 'Open settings', 'Switch to Lamplight']);
  assert.deepEqual(rankCommands(commands, 't'), ['Go to Today', 'Open timeline', 'New type', 'Open settings', 'Switch to Lamplight']);
  assert.deepEqual(rankCommands(commands, 'og'), ['Open graph', 'Open settings', 'Switch to Lamplight']);
  assert.deepEqual(rankCommands(commands, 'ope'), ['Open graph', 'Open timeline', 'Open queries', 'Open settings']);
});
