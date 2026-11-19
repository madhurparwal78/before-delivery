/* Trending chart and game pages. Dates are plain calendar days, never instants. */
(function () {
  'use strict';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

  function weekLabel(date) {
    var parts = DATE.exec(date);
    return 'Week of ' + MONTHS[Number(parts[2]) - 1] + ' ' + Number(parts[3]) + ', ' + parts[1];
  }
  function change(value) { return (value >= 0 ? '+' : '-') + Math.abs(value) + '%'; }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function cover(game, width, height, className) {
    var img = element('img', className);
    img.src = game.cover_url;
    img.alt = game.name + ' cover art';
    img.width = width;
    img.height = height;
    return img;
  }
  function metrics(game) {
    var list = element('dl', 'metrics');
    [['Plays', game.plays_change_pct], ['Streams', game.streams_change_pct]].forEach(function (pair) {
      var wrap = element('div');
      wrap.appendChild(element('dt', '', pair[0]));
      wrap.appendChild(element('dd', pair[1] < 0 ? 'down' : '', change(pair[1])));
      list.appendChild(wrap);
    });
    return list;
  }
  function communityLine(game, className) {
    if (!game.community) return null;
    var line = element('p', className);
    line.appendChild(element('span', '', game.community.member_count.toLocaleString('en-US') + ' Members'));
    var link = element('a', '', 'Join ' + game.community.name);
    link.href = '/servers/' + encodeURIComponent(game.community.slug);
    line.appendChild(link);
    return line;
  }
  function gameLink(game, heading) {
    var title = element(heading);
    var link = element('a', '', game.name);
    link.href = '/game/' + encodeURIComponent(game.slug);
    title.appendChild(link);
    return title;
  }

  /* /trending-games */
  var chart = document.getElementById('trend');
  if (chart) {
    var prev = document.getElementById('week-prev');
    var next = document.getElementById('week-next');
    var label = document.getElementById('week-label');
    var chips = Array.prototype.slice.call(document.querySelectorAll('#game-chips .chip'));
    var featured = document.getElementById('featured');
    var ranked = document.getElementById('ranked');
    var none = document.getElementById('trend-empty');
    var categories = chips.map(function (chip) { return chip.dataset.category; });
    var state = { week: null, category: 'all' };
    var latest = null;
    var sequence = 0;
    var controller = null;
    var answered = null;

    var readAddress = function () {
      var params = new URLSearchParams(location.search);
      var category = params.get('category');
      var week = params.get('week');
      return { week: week && DATE.test(week) ? week : null, category: categories.indexOf(category) !== -1 ? category : 'all' };
    };
    var address = function (s) {
      var parts = [];
      if (s.week) parts.push('week=' + encodeURIComponent(s.week));
      if (s.category !== 'all') parts.push('category=' + encodeURIComponent(s.category));
      return '/trending-games' + (parts.length ? '?' + parts.join('&') : '');
    };
    var sync = function () {
      chips.forEach(function (chip) { chip.setAttribute('aria-pressed', chip.dataset.category === state.category ? 'true' : 'false'); });
    };
    var draw = function (data, drawn) {
      answered = data;
      if (data.next_week_date === null) latest = data.week_date;
      label.textContent = weekLabel(data.week_date);
      prev.disabled = data.prev_week_date === null;
      next.disabled = data.next_week_date === null;
      if (drawn) return;
      featured.textContent = '';
      ranked.textContent = '';
      var games = data.games;
      featured.hidden = games.length === 0;
      none.hidden = games.length !== 0;
      games.forEach(function (game, index) {
        if (index === 0) {
          featured.appendChild(cover(game, 480, 270, 'featured-cover'));
          var body = element('div', 'featured-body');
          body.appendChild(element('p', 'rank rank--big', '#' + game.rank));
          body.appendChild(gameLink(game, 'h2'));
          body.appendChild(metrics(game));
          var line = communityLine(game, 'community-line');
          if (line) body.appendChild(line);
          featured.appendChild(body);
          return;
        }
        var row = element('li', 'ranked-row');
        row.appendChild(element('span', 'rank', '#' + game.rank));
        row.appendChild(cover(game, 120, 68, 'ranked-cover'));
        row.appendChild(gameLink(game, 'h3')).className = 'ranked-title';
        var meta = element('p', 'ranked-meta');
        meta.appendChild(element('span', '', 'Plays ' + change(game.plays_change_pct)));
        meta.appendChild(element('span', '', 'Streams ' + change(game.streams_change_pct)));
        var mine = communityLine(game, 'community-line');
        if (mine) { while (mine.firstChild) meta.appendChild(mine.firstChild); }
        row.appendChild(meta);
        ranked.appendChild(row);
      });
    };
    var load = function () {
      sequence += 1;
      var mine = sequence;
      if (controller) controller.abort();
      controller = new AbortController();
      Hub.api('GET', '/api/trending-games', { query: { week: state.week, category: state.category === 'all' ? '' : state.category }, signal: controller.signal, keepSession: true })
        .then(function (result) {
          if (mine !== sequence) return;
          if (result.ok) { draw(result.data); return; }
          if (result.status === 422 || result.status === 404) {
            state = { week: null, category: 'all' };
            sync();
            history.replaceState(null, '', '/trending-games');
            load();
          }
        }).catch(function (error) { if (!(error && error.name === 'AbortError') && mine === sequence) { label.textContent = ''; } });
    };
    var go = function (target) {
      state = target;
      sync();
      history.pushState(null, '', address(state));
      load();
    };
    var step = function (date) {
      return { week: date === latest ? null : date, category: state.category };
    };
    prev.addEventListener('click', function () { if (answered && answered.prev_week_date) go(step(answered.prev_week_date)); });
    next.addEventListener('click', function () { if (answered && answered.next_week_date) go(step(answered.next_week_date)); });
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () { go({ week: state.week, category: chip.dataset.category }); });
    });
    window.addEventListener('popstate', function () { state = readAddress(); sync(); load(); });
    window.addEventListener('pageshow', function (event) { if (event.persisted) load(); });
    state = readAddress();
    sync();
    /* The server drew the answer for this very address into the page, so the first paint holds the chart and the
       footer never moves. A signed-in visitor also asks the API: it alone knows which unpublished communities they see. */
    var initial = document.getElementById('trend-initial');
    if (initial) { draw(JSON.parse(initial.textContent), true); if (Hub.token()) load(); } else load();
  }

  /* /game/<slug> */
  var game = document.querySelector('.game');
  if (game) {
    var slug = game.dataset.slug;
    var body = document.querySelector('#history tbody');
    var community = document.getElementById('game-community');
    var description = document.getElementById('game-desc');
    var loadGame = function () {
      Hub.api('GET', '/api/games/' + encodeURIComponent(slug), { keepSession: true }).then(function (result) {
        if (!result.ok) return;
        var data = result.data;
        description.textContent = data.description;
        if (!document.getElementById('game-cover')) {
          var art = cover(data, 480, 270, 'game-cover');
          art.id = 'game-cover';
          game.insertBefore(art, description);
        }
        community.textContent = '';
        if (data.community) {
          var link = element('a', '', 'Join ' + data.community.name);
          link.href = '/servers/' + encodeURIComponent(data.community.slug);
          community.appendChild(link);
        } else {
          community.textContent = 'Community not available.';
        }
        body.textContent = '';
        data.history.forEach(function (entry) {
          var row = element('tr');
          row.appendChild(element('td', '', weekLabel(entry.week_date)));
          row.appendChild(element('td', '', String(entry.rank)));
          row.appendChild(element('td', '', change(entry.plays_change_pct)));
          row.appendChild(element('td', '', change(entry.streams_change_pct)));
          body.appendChild(row);
        });
      });
    };
    window.addEventListener('pageshow', function (event) { if (event.persisted) loadGame(); });
    loadGame();
  }
})();
