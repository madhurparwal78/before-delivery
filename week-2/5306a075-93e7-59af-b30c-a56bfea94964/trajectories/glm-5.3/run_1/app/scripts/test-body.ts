import { allowlistBody, bodyToText } from "../src/server/body.js";

const cases: Array<[string, string, string]> = [
  [
    `<p>Hello <strong>world</strong> <script>alert(1)</script>bye</p>`,
    `<p>Hello <strong>world</strong> bye</p>`,
    `Hello world bye`,
  ],
  [
    `<p>a<br>b</p><ul><li>one</li><li>two</li></ul>`,
    `<p>a<br>b</p><ul><li>one</li><li>two</li></ul>`,
    `a\nb\none\ntwo`,
  ],
  [
    `<p><a href="javascript:alert(1)">x</a> and <a href="https://ok.example">y</a></p>`,
    `<p><a>x</a> and <a href="https://ok.example" rel="noopener noreferrer nofollow">y</a></p>`,
    `x and y`,
  ],
  [
    `<div onclick="x()" style="color:red"><span>inner</span> tail</div>`,
    `inner tail`,
    `inner tail`,
  ],
  [
    `<p>a  b   c</p><pre>x  y\n  z</pre><blockquote>q</blockquote>`,
    `<p>a  b   c</p><pre>x  y\n  z</pre><blockquote>q</blockquote>`,
    `a b c\nx  y\n  z\nq`,
  ],
  [
    `<p>&amp;&lt; entity</p>`,
    `<p>&amp;&lt; entity</p>`,
    `&< entity`,
  ],
];
let fail = 0;
for (const [input, wantBody, wantText] of cases) {
  const b = allowlistBody(input);
  const t = bodyToText(b);
  if (b !== wantBody) { console.error("BODY FAIL", JSON.stringify(input), "->", JSON.stringify(b), "want", JSON.stringify(wantBody)); fail++; }
  if (t !== wantText) { console.error("TEXT FAIL", JSON.stringify(input), "->", JSON.stringify(t), "want", JSON.stringify(wantText)); fail++; }
}
console.log(fail === 0 ? "all body tests passed" : `${fail} failures`);
