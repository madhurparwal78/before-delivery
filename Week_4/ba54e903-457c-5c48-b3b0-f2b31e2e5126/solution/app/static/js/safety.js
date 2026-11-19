/* Safety library search and filters; teen charter flip cards. */
(function () {
  'use strict';
  var flips = document.querySelectorAll('.flip');
  Array.prototype.forEach.call(flips, function (card) {
    card.addEventListener('click', function () {
      card.setAttribute('aria-pressed', card.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
    });
  });

  var box = document.getElementById('lib-q');
  if (!box) return;
  var category = document.getElementById('lib-category');
  var topic = document.getElementById('lib-topic');
  var status = document.getElementById('lib-status');
  var list = document.getElementById('lib-list');
  var empty = document.getElementById('lib-empty');
  var DEBOUNCE_MS = 200;
  var sequence = 0;
  var controller = null;
  var timer = null;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function draw(articles, announce) {
    list.textContent = '';
    articles.forEach(function (article) {
      var item = element('li', 'article-card');
      item.appendChild(element('p', 'tag', article.category + ' · ' + article.topic));
      var heading = element('h2', 'article-title');
      var link = element('a', '', article.title);
      link.href = '/safety-library/' + encodeURIComponent(article.slug);
      heading.appendChild(link);
      item.appendChild(heading);
      item.appendChild(element('p', '', article.summary));
      list.appendChild(item);
    });
    empty.hidden = articles.length !== 0;
    if (announce) status.textContent = articles.length === 1 ? '1 article' : articles.length + ' articles';
  }
  function load(announce) {
    sequence += 1;
    var mine = sequence;
    if (controller) controller.abort();
    controller = new AbortController();
    Hub.api('GET', '/api/safety/articles', { query: { q: box.value, category: category.value, topic: topic.value }, signal: controller.signal, anonymous: true })
      .then(function (result) {
        if (mine !== sequence) return;
        if (result.ok) draw(result.data.data, announce);
        else status.textContent = 'Articles could not be loaded. Try again.';
      }).catch(function (error) {
        if (mine === sequence && !(error && error.name === 'AbortError')) status.textContent = 'Articles could not be loaded. Try again.';
      });
  }
  box.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { load(true); }, DEBOUNCE_MS); });
  [category, topic].forEach(function (select) { select.addEventListener('change', function () { clearTimeout(timer); load(true); }); });
  /* The unfiltered list is already in the page, so the first paint holds the cards and the footer never moves. */
  var initial = document.getElementById('lib-initial');
  /* The server already drew the unfiltered cards; drawing them again would only repaint the same markup. */
  if (!initial) load(false);
})();
