/* Community directory: search, category chips and paging. The last input always wins. */
(function () {
  'use strict';
  var input = document.getElementById('dir-q');
  var chips = Array.prototype.slice.call(document.querySelectorAll('#dir-chips .chip'));
  var grid = document.getElementById('dir-grid');
  var status = document.getElementById('dir-status');
  var empty = document.getElementById('dir-empty');
  var pager = document.getElementById('dir-pager');
  var DEBOUNCE_MS = 200;

  var state = { q: '', category: 'all', page: 1 };
  var sequence = 0;
  var controller = null;
  var timer = null;
  var categoryIds = chips.map(function (chip) { return chip.dataset.category; });

  function readAddress() {
    var params = new URLSearchParams(location.search);
    var category = params.get('category');
    var page = parseInt(params.get('page') || '1', 10);
    return {
      q: (params.get('q') || '').trim(),
      category: categoryIds.indexOf(category) !== -1 ? category : 'all',
      page: page >= 1 && page <= 1000 ? page : 1
    };
  }
  function address(next) {
    var parts = [];
    if (next.q) parts.push('q=' + encodeURIComponent(next.q));
    if (next.category !== 'all') parts.push('category=' + encodeURIComponent(next.category));
    if (next.page > 1) parts.push('page=' + next.page);
    return '/servers' + (parts.length ? '?' + parts.join('&') : '');
  }
  function numberText(value) { return Number(value).toLocaleString('en-US'); }

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function image(src, alt, width, height, lazy, className) {
    var img = element('img', className);
    img.src = src;
    img.alt = alt;
    img.width = width;
    img.height = height;
    if (lazy) img.loading = 'lazy';
    return img;
  }
  function card(item) {
    var article = element('article', 'card');
    article.appendChild(image(item.splash_url, '', 520, 228, true, 'card-splash'));
    var body = element('div', 'card-body');
    body.appendChild(image(item.icon_url, item.name + ' icon', 56, 56, false, 'card-icon'));
    var title = element('h2', 'card-title');
    var link = element('a', '', item.name);
    link.href = '/servers/' + encodeURIComponent(item.slug);
    title.appendChild(link);
    body.appendChild(title);
    body.appendChild(element('p', 'card-desc', item.description));
    if (item.verified || item.partnered) {
      var badges = element('p', 'card-badges');
      badges.appendChild(element('span', item.verified ? 'badge badge--verified' : 'badge badge--partner', item.verified ? 'Verified' : 'Partnered'));
      body.appendChild(badges);
    }
    var counts = element('p', 'card-counts');
    counts.appendChild(element('span', '', numberText(item.presence_count) + ' Online'));
    counts.appendChild(element('span', '', numberText(item.member_count) + ' Members'));
    body.appendChild(counts);
    article.appendChild(body);
    return article;
  }

  function syncControls() {
    input.value = state.q;
    chips.forEach(function (chip) { chip.setAttribute('aria-pressed', chip.dataset.category === state.category ? 'true' : 'false'); });
  }
  function drawPager(total) {
    pager.textContent = '';
    var pages = Math.max(1, Math.ceil(total / 12));
    if (state.page > 1) pager.appendChild(pagerLink('Previous page', state.page - 1));
    if (state.page < pages) pager.appendChild(pagerLink('Next page', state.page + 1));
  }
  function pagerLink(text, page) {
    var link = element('a', '', text);
    link.href = address({ q: state.q, category: state.category, page: page });
    link.addEventListener('click', function (event) {
      event.preventDefault();
      state.page = page;
      navigate(true);
    });
    return link;
  }

  function load() {
    sequence += 1;
    var mine = sequence;
    if (controller) controller.abort();
    controller = new AbortController();
    var query = { q: state.q, category: state.category === 'all' ? '' : state.category, page: state.page > 1 ? state.page : '' };
    Hub.api('GET', '/api/servers', { query: query, signal: controller.signal, keepSession: true }).then(function (result) {
      if (mine !== sequence) return;
      if (!result.ok) { fail(); return; }
      draw(result.data);
    }).catch(function (error) {
      if (mine === sequence && !(error && error.name === 'AbortError')) fail();
    });
  }
  function draw(data) {
    grid.textContent = '';
    data.data.forEach(function (item) { grid.appendChild(card(item)); });
    status.textContent = data.total === 1 ? '1 community' : data.total + ' communities';
    empty.hidden = data.total !== 0;
    drawPager(data.total);
  }
  function fail() {
    status.textContent = 'Communities could not be loaded. Try again.';
  }
  function navigate(push) {
    syncControls();
    var target = address(state);
    if (push) history.pushState(null, '', target); else history.replaceState(null, '', target);
    load();
  }

  input.addEventListener('input', function () {
    state.q = input.value.trim();
    state.page = 1;
    history.replaceState(null, '', address(state));
    clearTimeout(timer);
    timer = setTimeout(load, DEBOUNCE_MS);
  });
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      clearTimeout(timer);
      state.category = chip.dataset.category;
      state.page = 1;
      navigate(true);
    });
  });
  document.getElementById('dir-reset').addEventListener('click', function () {
    clearTimeout(timer);
    state = { q: '', category: 'all', page: 1 };
    navigate(true);
  });
  window.addEventListener('popstate', function () {
    clearTimeout(timer);
    state = readAddress();
    syncControls();
    load();
  });

  /* The server put the answer for this very address into the page, so the first paint needs no request. */
  var initial = document.getElementById('dir-initial');
  state = readAddress();
  syncControls();
  if (initial) draw(JSON.parse(initial.textContent).answer); else load();
})();
