import { renderBio } from '../src/server/bio.js';

let fails = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', label, '=>', JSON.stringify(String(got)), ok ? '' : 'want ' + JSON.stringify(String(want)));
}

// Only em, strong, code, br, a may be produced; only href; only http(s).
const outputs = [
  '[x](javascript:alert(1))',
  '[x](data:text/html,<script>)',
  '[x](vbscript:msgbox)',
  '[x](//evil.example)',
  '[x](https://ok.example/a?b=1&c=<>)',
  '![img](https://evil.example/x)',
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '[x](HtTpS://mixed.case/a)',
  '[x](https://)',
  '[x](https://a)',
  '`<script>`',
  '*<b>x</b>*',
  '<a href="https://x">y</a>',
  '[a [b] c](https://x.example)',
  '\\*not em\\*',
  '\\[not link\\](https://x.example)',
  '[x](https://a.example/b)',
];
for (const bio of outputs) {
  const html = renderBio(bio);
  // The only elements allowed: em, strong, code, br, a.
  const tags = [...html.matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((m) => m[1]);
  const badTags = tags.filter((t) => !['em', 'strong', 'code', 'br', 'a'].includes(t!));
  const attrs = [...html.matchAll(/<([a-z]+)([^>]*)>/g)].filter((m) => m[2] && m[2]!.trim() !== '');
  const badAttrs = attrs.filter((m) => !(m[1] === 'a' && m[2]!.trim().startsWith('href=')));
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!);
  const badHrefs = hrefs.filter((h) => !/^https:|^https&amp;|^http:/i.test(decode(h)));
  if (badTags.length || badAttrs.length || badHrefs.length) {
    fails++;
    console.log('FAIL unsafe output for', JSON.stringify(bio), '=>', JSON.stringify(html), { badTags, badAttrs, badHrefs });
  } else {
    console.log('ok  ', JSON.stringify(bio), '=>', JSON.stringify(html));
  }
}

// Escaping checks
check('amp escape', renderBio('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
check('literal entity stays', renderBio('&lt;'), '&amp;lt;');
check('code span escape', renderBio('`a < b & "c"`'), '<code>a &lt; b &amp; &quot;c&quot;</code>');
check('unclosed code literal', renderBio('`a < b'), '`a &lt; b');
check('backslash escape', renderBio('\\<b\\>'), '&lt;b&gt;');
check('backslash before letter', renderBio('\\a'), '\\a');
check('soft line break', renderBio('a\nb'), 'a\nb');
check('hard break spaces', renderBio('a  \nb'), 'a<br>\nb');
check('hard break backslash', renderBio('a\\\nb'), 'a<br>\nb');
check('trailing spaces trimmed', renderBio('a  '), 'a');
check('leading whitespace trimmed', renderBio('  a'), 'a');
check('empty bio', renderBio(''), '');
check('only whitespace', renderBio(' \n\t'), '');

console.log(fails === 0 ? 'ALL OK' : fails + ' FAILURES');
function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
