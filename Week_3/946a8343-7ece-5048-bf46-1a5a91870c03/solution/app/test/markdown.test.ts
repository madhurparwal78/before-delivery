import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/server/lib/markdown.ts";

test("inline subset", () => {
  assert.equal(
    renderMarkdown("# Title\n\n**bold** *it* `code` <script>boom(1)</script>\n"),
    "<h1>Title</h1>\n<p><strong>bold</strong> <em>it</em> <code>code</code> &lt;script&gt;boom(1)&lt;/script&gt;</p>",
  );
  assert.equal(renderMarkdown("***both*** and __b__ _i_"), "<p><strong><em>both</em></strong> and <strong>b</strong> <em>i</em></p>");
  assert.equal(renderMarkdown("snake_case_name and 2 * 3 * 4"), "<p>snake_case_name and 2 * 3 * 4</p>");
  assert.equal(renderMarkdown("*a **b** c*"), "<p><em>a <strong>b</strong> c</em></p>");
  assert.equal(renderMarkdown("`a < b` and \\*plain\\*"), "<p><code>a &lt; b</code> and *plain*</p>");
});

test("raw html never becomes markup", () => {
  const html = renderMarkdown('**x** <em>raw</em> <img src=x onerror="a()"> &amp;');
  assert.ok(!html.includes("<em"));
  assert.ok(!html.includes("<img"));
  assert.equal(html, "<p><strong>x</strong> &lt;em&gt;raw&lt;/em&gt; &lt;img src=x onerror=&quot;a()&quot;&gt; &amp;amp;</p>");
});

test("links by scheme", () => {
  assert.equal(renderMarkdown("[ok](https://example.org/a?b=1&c=2)"), '<p><a href="https://example.org/a?b=1&amp;c=2">ok</a></p>');
  assert.equal(renderMarkdown("[here](/projects/1) [top](#top) [h](http://x.test)"), '<p><a href="/projects/1">here</a> <a href="#top">top</a> <a href="http://x.test">h</a></p>');
  const scheme = "java" + "script:";
  const bad = renderMarkdown(`[bad](${scheme}boom(1)) [data](data:text/html,x) [m](mailto:a@b.c) [e](&#106;avascript:x)`);
  assert.ok(!bad.includes("<a"));
  assert.equal(bad, "<p>bad data m e</p>");
  assert.equal(renderMarkdown('[q](/a"onclick="x)'), '<p><a href="/a&quot;onclick=&quot;x">q</a></p>');
  assert.equal(renderMarkdown("[**b**](/x)"), '<p><a href="/x"><strong>b</strong></a></p>');
  assert.equal(renderMarkdown("[unclosed](https://x"), "<p>[unclosed](https://x</p>");
});

test("images come from project files only", () => {
  const imageBase = (path: string) => `/raw/${path}`;
  assert.equal(renderMarkdown("![logo](docs/logo.png)", { imageBase }), '<p><img src="/raw/docs/logo.png" alt="logo"></p>');
  assert.equal(renderMarkdown("![logo](/docs/logo.png)", { imageBase }), '<p><img src="/raw/docs/logo.png" alt="logo"></p>');
  for (const url of ["https://evil.test/x.png", "//evil.test/x.png", "../x.png", "data:image/png;base64,AAAA"]) {
    assert.equal(renderMarkdown(`![alt](${url})`, { imageBase }), "<p>alt</p>", url);
  }
  assert.equal(renderMarkdown("![alt](a.png)"), "<p>alt</p>");
});

test("blocks", () => {
  assert.equal(renderMarkdown("```\na < b\n\nc\n```\nafter"), "<pre><code>a &lt; b\n\nc\n</code></pre>\n<p>after</p>");
  assert.equal(renderMarkdown("```ts\nnever closed"), "<pre><code>never closed\n</code></pre>");
  assert.equal(renderMarkdown("- a\n- b **x**\n  more\n\n- c"), "<ul><li>a</li><li>b <strong>x</strong>\nmore</li><li>c</li></ul>");
  assert.equal(renderMarkdown("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
  assert.equal(renderMarkdown("3. x"), '<ol start="3"><li>x</li></ol>');
  assert.equal(renderMarkdown("- a\n  - b\n  - c\n- d"), "<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>");
  assert.equal(
    renderMarkdown("| a | b |\n|---|:-:|\n| 1 | `x` |\n| 2 |\n\ntext"),
    "<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td><code>x</code></td></tr><tr><td>2</td><td></td></tr></tbody></table>\n<p>text</p>",
  );
  assert.equal(renderMarkdown("one\ntwo\n\nthree"), "<p>one\ntwo</p>\n<p>three</p>");
  assert.equal(renderMarkdown("para\n- item"), "<p>para</p>\n<ul><li>item</li></ul>");
  assert.equal(renderMarkdown("> quote\n---"), "<p>&gt; quote\n---</p>");
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown("#nospace"), "<p>#nospace</p>");
});
