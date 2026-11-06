import type { RenderedPages } from '../../shared/render';
import { config } from '../config';

export interface PublishObject {
  key: string;
  body: Buffer;
  contentType: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const READER_CSS = `:root{color-scheme:dark}
*{box-sizing:border-box}
html{background:#0c0f12}
body{margin:0;background:#0c0f12;color:#e8e2d6;font-family:'IBM Plex Sans',system-ui,sans-serif;line-height:1.6}
main{max-width:68ch;margin:0 auto;padding:1.5rem 1rem 4rem}
h1,h2,h3,h4{font-family:Fraunces,serif;color:#f3ede1}
h1{font-size:2rem;margin:0.5rem 0 1rem}
nav[role=navigation] ul{list-style:none;padding:0;margin:0.5rem 0 1.5rem;border-top:1px solid #22282e;border-bottom:1px solid #22282e}
nav[role=navigation] li{margin:0.25rem 0}
a{color:#e0a030}
a:focus-visible{outline:2px solid #e0a030;outline-offset:2px}
code,pre{font-family:'IBM Plex Mono',monospace;background:#161b20;border-radius:4px}
pre{padding:0.75rem;overflow-x:auto}
hr{border:0;border-top:1px solid #22282e}
footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #22282e;color:#8d8578;font-size:0.85rem}
.num{font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}
form[role=search]{display:flex;gap:0.5rem;margin:1.5rem 0}
input[type=search]{flex:1;background:#161b20;border:1px solid #2a3138;color:#e8e2d6;padding:0.5rem 0.75rem;border-radius:6px;font:inherit}
button{background:#161b20;border:1px solid #2a3138;color:#e8e2d6;padding:0.5rem 1rem;border-radius:6px;font:inherit;min-height:44px;min-width:44px}
section[aria-label="Linked from"]{margin-top:2rem;padding-top:1rem;border-top:1px solid #22282e}
section[aria-label="Linked from"] h2{font-size:1.1rem}
section[aria-label="Linked from"] ul{list-style:none;padding:0}
#preview-tip{position:absolute;max-width:22rem;background:#161b20;border:1px solid #2a3138;padding:0.6rem 0.8rem;border-radius:6px;color:#e8e2d6;box-shadow:0 6px 24px rgba(0,0,0,.5)}
#preview-tip h3{margin:0 0 0.25rem;font-size:1rem}
#preview-tip p{margin:0;font-size:0.85rem;color:#8d8578}
[hidden]{display:none}
@media (prefers-reduced-motion:no-preference){a{transition:color .1s}}`;

const READER_JS = `(function(){
  var tip=null,hideTimer=null,showTimer=null;
  var previews=null;
  function load(cb){if(previews)return cb();var x=new XMLHttpRequest();x.open('GET','previews.json');x.onload=function(){try{previews=JSON.parse(x.responseText)}catch(e){previews={}}cb()};x.onerror=function(){previews={};cb()};x.send()}
  function slugOf(a){var href=a.getAttribute('href');if(!href)return '';if(href==='./'||href==='.'||href==='')return '';var m=href.match(/^\\.\\/(.+)$/);return m?m[1]:href.replace(/^.*\\//,'')}
  document.addEventListener('mouseover',function(e){
    var a=e.target.closest?e.target.closest('main a, nav[role=navigation] a, section[aria-label="Linked from"] a'):null;
    if(!a||!a.getAttribute('href')||a.getAttribute('href').indexOf('http')===0||a.getAttribute('href').indexOf('mailto')===0)return;
    clearTimeout(showTimer);
    showTimer=setTimeout(function(){
      load(function(){
        var slug=slugOf(a);
        var p=previews[slug];if(!p)return;
        hide();
        tip=document.createElement('div');tip.id='preview-tip';
        var h=document.createElement('h3');h.textContent=p.title;tip.appendChild(h);
        var para=document.createElement('p');para.textContent=p.excerpt;tip.appendChild(para);
        tip.setAttribute('role','tooltip');
        document.body.appendChild(tip);
        var r=a.getBoundingClientRect();
        tip.style.left=Math.max(8,r.left+window.scrollX)+'px';
        tip.style.top=(r.bottom+window.scrollY+8)+'px';
      });
    },350);
  });
  function hide(){if(tip){tip.remove();tip=null}clearTimeout(showTimer)}
  document.addEventListener('mouseout',function(e){if(e.target.closest&&e.target.closest('a'))hide()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')hide()});
})();`;

interface PageShellInput {
  title: string;
  bodyHtml: string;
  nav: string;
  linkedFrom: string;
  searchAction: string;
  resultsHtml: string;
  footer: string;
  banner?: string;
  assetBase: string;
}

export const pageShell = (p: PageShellInput): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
<link rel="stylesheet" href="${esc(p.assetBase)}assets/reader.css">
<script src="${esc(p.assetBase)}assets/reader.js" defer></script>
</head>
<body>
${p.banner ?? ''}
<main>
<h1>${esc(p.title)}</h1>
<nav role="navigation" aria-label="Dossier">
<ul>
${p.nav}
</ul>
</nav>
<div id="body">
${p.bodyHtml}
</div>
<section aria-label="Linked from">
<h2>Linked from</h2>
<ul>
${p.linkedFrom}
</ul>
</section>
<form role="search" action="${esc(p.searchAction)}" method="get">
<input type="search" name="q" aria-label="Search this dossier">
<button type="submit">Search</button>
</form>
${p.resultsHtml}
<footer>${p.footer}</footer>
</main>
</body>
</html>`;

export const buildPublishObjects = (
  slug: string,
  prefix: string,
  rendered: RenderedPages,
  rootId: string,
  mode: 'd' | 'p',
): PublishObject[] => {
  const base = mode === 'd' ? `/d/${slug}/` : prefix;
  const assetBase = mode === 'd' ? `/d/${slug}/` : `../`;
  const navLinks = rendered.pages
    .filter((p) => p.slug !== '')
    .map((p) => `<li><a href="${esc(`./${p.slug}`)}">${esc(p.title)}</a></li>`)
    .join('\n');
  const nav = `<li><a href="./">${esc(rendered.pages.find((p) => p.slug === '')?.title ?? slug)}</a></li>\n${navLinks}`;
  const dateText = new Date().toISOString().slice(0, 10);
  const footer = `<span class="num">${dateText}</span> · <span class="num">${rendered.pages.length}</span> notes`;
  const objects: PublishObject[] = [];
  const searchIndex = JSON.stringify(rendered.searchIndex.map((s) => ({ path: s.path, title: s.title, text: s.text })));
  const previewsJson = JSON.stringify(rendered.previews);
  for (const page of rendered.pages) {
    const linkedFrom = page.linkedFrom.length
      ? page.linkedFrom.map((s) => `<li><a href="${esc(s === '' ? './' : `./${s}`)}">${esc(rendered.pages.find((x) => x.slug === s)?.title ?? '')}</a></li>`).join('\n')
      : '';
    const html = pageShell({
      title: page.title,
      bodyHtml: page.html,
      nav,
      linkedFrom,
      searchAction: `${base}search`,
      resultsHtml: '',
      footer,
      assetBase,
    });
    objects.push({
      key: `${prefix}${page.slug === '' ? 'index.html' : `pages/${page.slug}.html`}`,
      body: Buffer.from(html, 'utf8'),
      contentType: 'text/html; charset=utf-8',
    });
  }
  objects.push({ key: `${prefix}search-index.json`, body: Buffer.from(searchIndex, 'utf8'), contentType: 'application/json; charset=utf-8' });
  objects.push({ key: `${prefix}previews.json`, body: Buffer.from(previewsJson, 'utf8'), contentType: 'application/json; charset=utf-8' });
  objects.push({ key: `${prefix}assets/reader.css`, body: Buffer.from(READER_CSS, 'utf8'), contentType: 'text/css; charset=utf-8' });
  objects.push({ key: `${prefix}assets/reader.js`, body: Buffer.from(READER_JS, 'utf8'), contentType: 'application/javascript; charset=utf-8' });
  const site = config.publicUrl;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${
    rendered.pages.map((p) => `<url><loc>${site}/d/${slug}/${p.slug === '' ? '' : p.slug}</loc></url>`).join('\n')
  }\n</urlset>\n`;
  objects.push({ key: `${prefix}sitemap.xml`, body: Buffer.from(sitemap, 'utf8'), contentType: 'application/xml; charset=utf-8' });
  void rootId;
  return objects;
};

export const buildSearchPage = (
  q: string,
  rendered: { pages: Array<{ slug: string; title: string; plainText: string }> },
): string => {
  const lower = q.toLowerCase();
  const hits = rendered.pages.filter(
    (p) => p.title.toLowerCase().includes(lower) || p.plainText.toLowerCase().includes(lower),
  );
  const nav = rendered.pages.map((p) => `<li><a href="${esc(p.slug === '' ? './' : `./${p.slug}`)}">${esc(p.title)}</a></li>`).join('\n');
  const results = hits.length
    ? `<ul aria-label="Search results">\n${hits.map((p) => `<li><a href="${esc(p.slug === '' ? './' : `./${p.slug}`)}">${esc(p.title)}</a></li>`).join('\n')}\n</ul>`
    : `<p>No published notes match ${esc(q)}.</p>`;
  return pageShell({
    title: `Search — ${q}`,
    bodyHtml: `<p>${results}</p>`,
    nav,
    linkedFrom: '',
    searchAction: `./search`,
    resultsHtml: results,
    footer: `<span class="num">${rendered.pages.length}</span> notes`,
    assetBase: './',
  });
};
