/* Community detail: the channels, the counts the viewer may see and the join control. */
(function () {
  'use strict';
  var root = document.querySelector('.detail');
  var slug = root.dataset.slug;
  var join = document.getElementById('detail-join');
  var open = document.getElementById('detail-open');
  var list = document.getElementById('detail-channels');
  var wantsJoin = new URLSearchParams(location.search).get('join') === '1';

  function defaultChannel(channels) {
    var text = channels.filter(function (c) { return c.type === 'text'; });
    text.sort(function (a, b) { return a.position - b.position; });
    return text[0];
  }
  function land(communityId, channelId, name) {
    var path = '/channels/' + communityId + '/' + channelId;
    Hub.rememberChannel(path);
    try { sessionStorage.setItem('hub.joined', name); } catch (e) { /* storage unavailable */ }
    location.replace(path);
  }
  function joinNow(name) {
    join.disabled = true;
    Hub.api('POST', '/api/servers/' + encodeURIComponent(slug) + '/join').then(function (result) {
      if (result.ok) land(result.data.community_id, result.data.default_channel_id, name);
      else join.disabled = false;
    }).catch(function () { join.disabled = false; });
  }

  function render(data) {
    list.textContent = '';
    data.channels.forEach(function (channel) {
      var item = document.createElement('li');
      item.textContent = channel.name;
      list.appendChild(item);
    });
    var member = data.me !== null;
    join.hidden = member;
    open.hidden = !member;
    if (member) {
      var channel = defaultChannel(data.channels);
      open.href = '/channels/' + data.id + '/' + (channel ? channel.id : '');
    }
    if (wantsJoin && Hub.token()) {
      if (member) land(data.id, open.href.split('/').pop(), data.name); else joinNow(data.name);
    }
  }

  function refresh() {
    if (Hub.token()) { join.hidden = true; open.hidden = true; }
    Hub.api('GET', '/api/servers/' + encodeURIComponent(slug)).then(function (result) {
      if (result.ok) render(result.data);
      else { join.hidden = false; open.hidden = true; }
    }).catch(function () { join.hidden = false; });
  }

  join.addEventListener('click', function () {
    if (!Hub.token()) {
      location.assign('/register?next=' + Hub.nextParam('/servers/' + slug + '?join=1'));
      return;
    }
    joinNow(document.querySelector('.detail-title').textContent);
  });
  window.addEventListener('pageshow', function (event) { if (event.persisted) refresh(); });
  refresh();
})();
