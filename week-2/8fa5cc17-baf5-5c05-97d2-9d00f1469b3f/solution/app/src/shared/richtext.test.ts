import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOpsToBody, editText, plainText, renderBody, sanitizeBody, textToBody } from './richtext.ts';
import { applyToText, opsFit, type Op } from './ot.ts';

const DIRTY =
  '<b onclick="steal()">Firm</b> &amp; <i>leaning</i><script>steal()</script><img src="x" onerror="steal()">' +
  '<a href="javascript:steal()">unsafe</a> <a href="https://site.test/?a=1&amp;b=2" rel="me" onmouseover="y">safe</a> ' +
  '<a href="mailto:me@site.test">write</a><span style="color:red">plain</span>' +
  '<iframe src="/frame">gone</iframe><style>p{color:red}</style>';
const CLEAN =
  '<p><strong>Firm</strong> &amp; <em>leaning</em>unsafe <a href="https://site.test/?a=1&amp;b=2">safe</a> ' +
  '<a href="mailto:me@site.test">write</a>plain</p>';

const SAMPLES = [
  DIRTY,
  'Read slowly & twice',
  '<p>one</p><p>two<br>three</p>',
  '<ul>\n  <li>a</li>\n  <li>b<ul><li>c</li></ul>d</li>\n</ul>tail',
  '<blockquote>said<p>inner</p></blockquote>',
  '<em><strong>both</strong> em</em> <code>x &lt; y</code>',
  '<div>block <section>soup</section></div><p>after</p>',
  '<strong>a<p>b</p>c</strong>',
  '<p>a</p><p></p><p>b</p>',
  '<ul>x<li>y</li></ul>',
  '<li>loose</li><li>items</li>',
  '<a href="  HTTPS://Site.test/x">trimmed</a> <a href="/relative">rel</a> <a>none</a> <a href="data:text/html,x">data</a>',
  '<template><p>t</p></template><noscript>n</noscript><object>o</object><embed>',
  '<!-- note --><p>kept</p>',
  'it\'s "quoted" <3 >2',
  '<svg><foreignObject><p>x<ul><li>y</li></ul></p></foreignObject></svg>',
  '<p>  spaced   out  </p>',
  '',
  '<span></span>',
  '<p></p>',
];

test('the dirty sample keeps only the allowlist', () => {
  assert.equal(sanitizeBody(DIRTY), CLEAN);
});

test('plain text is wrapped in one p with & < > escaped', () => {
  assert.equal(sanitizeBody('Read slowly & twice'), '<p>Read slowly &amp; twice</p>');
  assert.equal(sanitizeBody('it\'s "quoted" <3'), '<p>it\'s "quoted" &lt;3</p>');
});

test('links keep href only for http, https and mailto after trimming, case-insensitively', () => {
  assert.equal(
    sanitizeBody(SAMPLES[11]),
    '<p><a href="  HTTPS://Site.test/x">trimmed</a> rel none data</p>',
  );
  assert.equal(sanitizeBody('<a href=\'https://x.test/"q"\'>q</a>'), '<p><a href="https://x.test/&quot;q&quot;">q</a></p>');
});

test('dropped elements lose their content, other elements keep their text', () => {
  assert.equal(sanitizeBody(SAMPLES[12]), '');
  assert.equal(sanitizeBody('<div>block <section>soup</section></div><p>after</p>'), '<p>block soup</p><p>after</p>');
  assert.equal(sanitizeBody('<B>caps</B><I>it</I>'), '<p><strong>caps</strong><em>it</em></p>');
});

test('inline content outside p, li and blockquote gets one p per unbroken run', () => {
  assert.equal(sanitizeBody('a<p>b</p>c<br>d'), '<p>a</p><p>b</p><p>c<br>d</p>');
  assert.equal(sanitizeBody('<ul>x<li>y</li></ul>'), '<ul><p>x</p><li>y</li></ul>');
  assert.equal(sanitizeBody('<blockquote>said<p>inner</p></blockquote>'), '<blockquote>said<p>inner</p></blockquote>');
});

test('marks around blocks move onto the blocks\' text', () => {
  assert.equal(sanitizeBody('<strong>a<p>b</p>c</strong>'), '<p><strong>a</strong></p><p><strong>b</strong></p><p><strong>c</strong></p>');
});

test('whitespace-only text directly inside a list is dropped; other whitespace is kept', () => {
  assert.equal(sanitizeBody(SAMPLES[3]), '<ul><li>a</li><li>b<ul><li>c</li></ul>d</li></ul><p>tail</p>');
  assert.equal(sanitizeBody('<p>  spaced   out  </p>'), '<p>  spaced   out  </p>');
});

test('a body empty after sanitising is the empty string', () => {
  for (const html of ['', '<span></span>', '<p></p>', '<script>x</script>', '<ul></ul>']) assert.equal(sanitizeBody(html), '');
});

test('sanitizeBody is idempotent', () => {
  for (const html of SAMPLES) {
    const once = sanitizeBody(html);
    assert.equal(sanitizeBody(once), once, html);
  }
});

test('renderBody adds rel to every link and re-applies the allowlist', () => {
  assert.equal(
    renderBody(CLEAN),
    '<p><strong>Firm</strong> &amp; <em>leaning</em>unsafe ' +
      '<a href="https://site.test/?a=1&amp;b=2" rel="noopener noreferrer nofollow">safe</a> ' +
      '<a href="mailto:me@site.test" rel="noopener noreferrer nofollow">write</a>plain</p>',
  );
  assert.equal(renderBody('<p onclick="x">a<script>b</script></p>'), '<p>a</p>');
  assert.equal(sanitizeBody(CLEAN).includes('rel='), false);
});

test('edit text: tags removed, entities decoded, one line feed per br and element boundary', () => {
  assert.equal(editText(CLEAN), 'Firm & leaningunsafe safe writeplain');
  assert.equal(editText('<p>one</p><p>two<br>three</p>'), 'one\ntwo\nthree');
  assert.equal(editText('<ul><li>a</li><li>b<ul><li>c</li></ul>d</li></ul><p>tail</p>'), 'a\nb\nc\nd\ntail');
  assert.equal(editText('<p> a </p><p></p>'), ' a \n');
  assert.equal(editText(''), '');
});

test('plain text: br and boundaries become spaces, trimmed', () => {
  assert.equal(plainText('<p> one</p><p>two<br>three </p>'), 'one two three');
  assert.equal(plainText('<p><strong>x &lt; y</strong></p>'), 'x < y');
  assert.equal(plainText('<p><br></p><p></p>'), '');
});

test('textToBody turns line feeds into br inside one p', () => {
  assert.equal(textToBody('a & b\nc'), '<p>a &amp; b<br>c</p>');
  assert.equal(textToBody(''), '');
  assert.equal(sanitizeBody(textToBody('x\n\ny')), textToBody('x\n\ny'));
});

test('inserted text takes the marks of the character before it', () => {
  const body = '<p><strong>bold</strong> plain</p>';
  assert.equal(applyOpsToBody(body, [{ retain: 4 }, { insert: 'er' }, { retain: 6 }]), '<p><strong>bolder</strong> plain</p>');
  assert.equal(applyOpsToBody(body, [{ retain: 5 }, { insert: 'very ' }, { retain: 5 }]), '<p><strong>bold</strong> very plain</p>');
  assert.equal(applyOpsToBody('<p><a href="https://x.test">link</a></p>', [{ retain: 4 }, { insert: 's' }]), '<p><a href="https://x.test">links</a></p>');
});

test('at offset 0 inserted text takes the marks of the character after it', () => {
  assert.equal(applyOpsToBody('<p><em>word</em> rest</p>', [{ insert: 'A ' }, { retain: 9 }]), '<p><em>A word</em> rest</p>');
});

test('an inserted line feed becomes a br; deleting it removes the br', () => {
  const split = applyOpsToBody('<p>ab</p>', [{ retain: 1 }, { insert: '\n' }, { retain: 1 }]);
  assert.equal(split, '<p>a<br>b</p>');
  assert.equal(applyOpsToBody(split, [{ retain: 1 }, { delete: 1 }, { retain: 1 }]), '<p>ab</p>');
});

test('deleting an element boundary joins the two elements into the first', () => {
  assert.equal(applyOpsToBody('<p>one</p><p><em>two</em></p>', [{ retain: 3 }, { delete: 1 }, { retain: 3 }]), '<p>one<em>two</em></p>');
  assert.equal(applyOpsToBody('<p>a</p><ul><li>b</li><li>c</li></ul>', [{ retain: 1 }, { delete: 1 }, { retain: 3 }]), '<p>ab</p><ul><li>c</li></ul>');
  assert.equal(applyOpsToBody('<p>a</p><p>b</p><p>c</p>', [{ retain: 1 }, { delete: 3 }, { retain: 1 }]), '<p>ac</p>');
});

test('deleting everything stores the empty string, and ops on an empty body make one p', () => {
  assert.equal(applyOpsToBody('<p>a</p><p>b</p>', [{ delete: 3 }]), '');
  assert.equal(applyOpsToBody('', [{ insert: 'new & <x>' }]), '<p>new &amp; &lt;x&gt;</p>');
});

test('the merge test bodies match a plain p of the merged text', () => {
  const ops: Op[] = [{ retain: 4 }, { delete: 5 }, { retain: 1 }];
  assert.equal(applyOpsToBody(textToBody('XYA base Z'), ops), textToBody(applyToText('XYA base Z', ops)));
});

const OP_BODIES = [
  CLEAN,
  '<p>one</p><p>two<br>three</p>',
  '<ul><li>a<ul><li>b</li></ul>c</li></ul>',
  '<blockquote>q<p>r</p>s</blockquote><ol><li><strong>x</strong></li></ol>',
  '<p><em>a<strong>b</strong></em>c</p><p></p>',
  '<li>l</li><li>m</li>',
  '',
];

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function randomOps(rand: () => number, length: number): Op[] {
  const ops: Op[] = [];
  let pos = 0;
  while (pos < length) {
    const n = 1 + Math.floor(rand() * Math.min(3, length - pos));
    const roll = rand();
    if (roll < 0.25) ops.push({ insert: rand() < 0.3 ? '\n' : 'z&' });
    else if (roll < 0.5) ops.push({ delete: n });
    else ops.push({ retain: n });
    if (roll >= 0.25) pos += n;
  }
  if (ops.length === 0 || rand() < 0.3) ops.push({ insert: 'E' });
  return ops;
}

test('applyOpsToBody keeps edit text in step with the ops and its output canonical', () => {
  const rand = seeded(5);
  for (const body of OP_BODIES) {
    for (let round = 0; round < 300; round += 1) {
      const text = editText(body);
      const ops = randomOps(rand, text.length);
      assert.ok(opsFit(ops, text.length));
      const next = applyOpsToBody(body, ops);
      assert.equal(sanitizeBody(next), next, JSON.stringify({ body, ops }));
      assert.equal(editText(next), applyToText(text, ops), JSON.stringify({ body, ops, next }));
    }
  }
});
