import { renderBio } from '../src/server/bio.js';

const pairs: Array<[string, string]> = [
  ['***foo***', '<em><strong>foo</strong></em>'],
  ['a*"foo"*', 'a*&quot;foo&quot;*'],
  ['foo*bar*baz', 'foo<em>bar</em>baz'],
  ['foo_bar_baz', 'foo_bar_baz'],
  ['_foo_bar', '_foo_bar'],
  ['**foo*bar**', '<strong>foo*bar</strong>'],
  ['**foo*', '*<em>foo</em>'],
  ['*foo**bar*', '<em>foo**bar</em>'],
  ['`` a ` b ``', '<code>a ` b</code>'],
  ['[docs](https://example.com/a_(b))', '<a href="https://example.com/a_(b)">docs</a>'],
  ['[docs](https://example.com/a)b)', '<a href="https://example.com/a">docs</a>b)'],
  [
    '[x](javascript:alert(1)) [y](//evil.example/a) [z](data:text/html,hi)',
    '[x](javascript:alert(1)) [y](//evil.example/a) [z](data:text/html,hi)',
  ],
  [
    '<https://example.com/q?a=1&b=2>',
    '<a href="https://example.com/q?a=1&amp;b=2">https://example.com/q?a=1&amp;b=2</a>',
  ],
  [
    '<b>bold</b> &lt; <img src=x onerror=alert(1)>',
    '&lt;b&gt;bold&lt;/b&gt; &amp;lt; &lt;img src=x onerror=alert(1)&gt;',
  ],
  ['line one  \nline two\\\nline three', 'line one<br>\nline two<br>\nline three'],
];

let fails = 0;
for (const [bio, want] of pairs) {
  const got = renderBio(bio);
  const ok = got === want;
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(bio));
  if (!ok) console.log('      got ', JSON.stringify(got), '\n      want', JSON.stringify(want));
}
console.log(fails === 0 ? `all ${pairs.length} pairs OK` : `${fails} failures`);
