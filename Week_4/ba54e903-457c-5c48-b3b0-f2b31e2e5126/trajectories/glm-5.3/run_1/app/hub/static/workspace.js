/* Workspace: live stream over SSE, composer, panels, drafts (DP-51 to DP-98). */
"use strict";
(() => {
  const root = document.getElementById("wsRoot");
  if (!root) return;

  const EMOJI = [
    { name: "thumbs up", emoji: "👍" }, { name: "heart", emoji: "❤️" },
    { name: "laughing", emoji: "😂" }, { name: "party", emoji: "🎉" },
    { name: "surprised", emoji: "😮" }, { name: "sad", emoji: "😢" },
    { name: "fire", emoji: "🔥" }, { name: "eyes", emoji: "👀" },
  ];

  const state = {
    token: HUB.state.token,
    me: null,
    community: null,
    channel: null,
    channels: [],
    members: [],
    permissions: new Set(),
    messages: new Map(),
    order: [],
    source: null,
    connected: false,
    lastEventId: 0,
    draftsKey: "hub_drafts_" + (sessionStorage.getItem("hub_member_id") || ""),
    serverSkewMs: 0,
    panels: { thread: null, search: null, notif: null, members: false, channels: false },
    notifCursor: null,
    notifHasMore: false,
    searchToken: 0,
    searchQuery: "",
  };

  const $ = (id) => document.getElementById(id);
  const stream = $("main");
  const composer = $("composer");
  const attachBtn = $("attachBtn");
  const fileInput = $("fileInput");
  const pendingList = $("pendingList");
  const statusEl = $("workspaceStatus");
  const rail = $("wsRail");
  const textList = $("textChannelList");
  const voiceList = $("voiceChannelList");
  const heading = $("channelHeading");
  const slowmodeNote = $("slowmodeNote");
  const notifBtn = $("notifBtn");
  const membersEl = $("wsMembers");
  const openChannelsBtn = $("openChannelsBtn");
  const showMembersBtn = $("showMembersBtn");

  const pending = [];
  const fmt = (n) => n.toLocaleString("en-US");

  function say(text) { statusEl.textContent = text; }

  function setSkewFromResponse(resp) {
    const dateHeader = resp.headers.get("Date");
    if (!dateHeader) return;
    const serverTime = Date.parse(dateHeader);
    if (!Number.isNaN(serverTime)) state.serverSkewMs = serverTime - Date.now();
  }

  async function api(method, path, body, extraHeaders) {
    const headers = Object.assign({ Authorization: "Bearer " + state.token }, extraHeaders || {});
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const opts = { method, headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    setSkewFromResponse(resp);
    let data = null;
    if (resp.status !== 204) {
      try { data = await resp.json(); } catch (e) { data = null; }
    }
    return { status: resp.status, data };
  }

  // ---------- drafts (DP-93) ----------
  function loadDrafts() {
    try { return JSON.parse(sessionStorage.getItem(state.draftsKey) || "{}"); }
    catch (e) { return {}; }
  }
  function saveDraft(channelId, text) {
    const drafts = loadDrafts();
    if (text) drafts[channelId] = text; else delete drafts[channelId];
    sessionStorage.setItem(state.draftsKey, JSON.stringify(drafts));
  }
  function restoreDraft() {
    if (!state.channel) return;
    const drafts = loadDrafts();
    composer.value = drafts[state.channel.id] || "";
  }

  // ---------- layout ----------
  function layoutMode() {
    const w = window.innerWidth;
    if (w < 768) return "phone";
    if (w < 1280) return "tablet";
    return "desktop";
  }

  function applyLayout() {
    const mode = layoutMode();
    openChannelsBtn.hidden = mode !== "phone";
    showMembersBtn.hidden = mode !== "tablet";
    if (mode !== "phone") {
      setChannelsPanel(false);
    }
    if (mode === "desktop") {
      membersEl.classList.remove("open");
      showMembersBtn.setAttribute("aria-expanded", "false");
      state.panels.members = false;
    }
  }

  // ---------- panels: collapsed means unavailable (DP-78) ----------
  function closePanels(except) {
    const panels = [
      { id: "threadPanel", key: "thread", opener: "replyOpener" },
      { id: "searchPanel", key: "search", opener: "searchOpener" },
      { id: "notifPanel", key: "notif", opener: "notifOpener" },
    ];
    for (const panel of panels) {
      if (panel.key === except) continue;
      const el = $(panel.id);
      if (el && !el.hidden) {
        el.hidden = true;
        el.setAttribute("inert", "");
        if (el.tagName === "DIALOG") el.close();
      }
    }
  }

  function openPanel(id, opener) {
    closePanels(id);
    const el = $(id);
    el.hidden = false;
    el.removeAttribute("inert");
    state.panels[id === "threadPanel" ? "thread" : id === "searchPanel" ? "search" : "notif"] = el;
    if (id === "threadPanel" || id === "searchPanel") {
      const btn = $("wsSearch");
      if (opener === "search") btn.dataset.opener = "search";
    }
    el.dataset.opener = opener && opener.id ? opener.id : "";
    if (opener && opener.id) el.dataset.openerControl = opener.id;
  }

  function panelOpener(el) {
    const id = el && el.dataset ? el.dataset.openerControl : "";
    return id ? document.getElementById(id) : null;
  }

  function hidePanel(id) {
    const el = $(id);
    if (!el || el.hidden) return null;
    const opener = panelOpener(el);
    el.hidden = true;
    el.setAttribute("inert", "");
    el.textContent = "";
    return opener;
  }

  // ---------- channel and community loading ----------
  async function loadSelf() {
    const resp = await api("GET", "/api/users/@me");
    if (resp.status !== 200) return false;
    state.me = resp.data;
    return true;
  }

  async function loadWorkspace() {
    const path = location.pathname.split("/");
    const communityId = Number(path[2]);
    const channelId = Number(path[3]);
    // Find the community from the member's memberships via the directory of joined communities.
    const detail = await loadCommunityDetail(communityId);
    if (!detail) return false;
    state.community = detail;
    state.channel = detail.channels.find((c) => c.id === channelId) || detail.channels[0];
    await refreshPermissions();
    await Promise.all([loadMembers(), loadHistory()]);
    renderAll();
    return true;
  }

  async function loadCommunityDetail(communityId) {
    // discover the slug by trying the rail data first
    let slug = null;
    const resp = await fetch(`/api/servers?per_page=50`, {
      headers: { Authorization: "Bearer " + state.token },
    });
    const data = await resp.json();
    let found = null;
    for (const c of data.data || []) {
      if (c.id === communityId) { found = c; break; }
    }
    if (!found) {
      // the community may be unpublished; try each joined slug
      for (const slugGuess of state.joinedSlugs || []) {
        try {
          const r2 = await api("GET", `/api/servers/${slugGuess}`);
          if (r2.status === 200 && r2.data.id === communityId) { found = r2.data; break; }
        } catch (e) { /* keep trying */ }
      }
    }
    if (!found) return null;
    const full = await api("GET", `/api/servers/${found.slug}`);
    if (full.status !== 200) return null;
    state.joinedSlugs = (state.joinedSlugs || []).includes(found.slug)
      ? state.joinedSlugs : (state.joinedSlugs || []).concat(found.slug);
    return full.data;
  }

  async function refreshPermissions() {
    if (!state.channel) return;
    const resp = await api("GET", `/api/channels/${state.channel.id}/permissions`);
    if (resp.status === 200) state.permissions = new Set(resp.data.permissions);
    applyPermissionsToUI();
  }

  function applyPermissionsToUI() {
    const canSend = state.permissions.has("send_messages");
    const timedOut = state.me && state.community && state.community.me &&
      state.community.me.communication_disabled_until &&
      (Date.now() + state.serverSkewMs) < Date.parse(state.community.me.communication_disabled_until);
    composer.disabled = !canSend || Boolean(timedOut);
    attachBtn.disabled = !canSend || Boolean(timedOut);
    if (timedOut) {
      updateTimeoutPlaceholder();
    } else if (!canSend) {
      composer.placeholder = "You do not have permission to send messages in this channel.";
    } else {
      composer.placeholder = `Message #${state.channel.name}`;
    }
  }

  function updateTimeoutPlaceholder() {
    if (!state.community || !state.community.me || !state.community.me.communication_disabled_until) return;
    const until = Date.parse(state.community.me.communication_disabled_until);
    const remaining = Math.max(0, until - (Date.now() + state.serverSkewMs));
    const total = Math.ceil(remaining / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, "0");
    composer.placeholder = `You are timed out for ${minutes}:${seconds} more.`;
    if (remaining > 0) {
      setTimeout(() => {
        if (composer.disabled) updateTimeoutPlaceholder();
      }, 900);
    } else {
      composer.disabled = false;
      attachBtn.disabled = false;
      composer.placeholder = `Message #${state.channel.name}`;
    }
  }

  async function loadMembers() {
    if (!state.community) return;
    const slug = state.community.slug;
    const resp = await api("GET", `/api/servers/${slug}/members`);
    if (resp.status === 200) state.members = resp.data.data;
  }

  async function loadHistory() {
    if (!state.channel) return;
    const resp = await api("GET", `/api/channels/${state.channel.id}/messages?limit=50`);
    if (resp.status !== 200) return;
    state.messages = new Map();
    state.order = [];
    for (const msg of resp.data.data) {
      state.messages.set(msg.id, msg);
      state.order.push(msg.id);
    }
  }

  // ---------- rendering ----------
  function renderAll() {
    renderRail();
    renderChannels();
    renderHeading();
    renderStream();
    renderMembers();
    updateNotifButton();
  }

  async function renderRail() {
    const resp = await api("GET", "/api/servers?per_page=50");
    rail.textContent = "";
    const joined = [];
    for (const c of (resp.data && resp.data.data) || []) joined.push(c);
    for (const c of joined) {
      const link = document.createElement("a");
      link.className = "rail-link" + (state.community && c.id === state.community.id ? " active" : "");
      link.href = "#";
      link.setAttribute("aria-label", c.name);
      link.textContent = c.name.slice(0, 2).toUpperCase();
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const detail = await api("GET", `/api/servers/${c.slug}`);
        if (detail.status === 200 && detail.data.channels.length) {
          const target = `/channels/${detail.data.id}/${detail.data.channels[0].id}`;
          history.pushState({}, "", target);
          location.href = target;
        }
      });
      rail.appendChild(link);
    }
  }

  function renderChannels() {
    textList.textContent = "";
    voiceList.textContent = "";
    for (const ch of (state.community ? state.community.channels : [])) {
      const link = document.createElement("a");
      link.className = "ws-channel-link";
      link.href = `/channels/${state.community.id}/${ch.id}`;
      if (state.channel && ch.id === state.channel.id) link.setAttribute("aria-current", "page");
      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = "#";
      hash.setAttribute("aria-hidden", "true");
      link.append(hash, document.createTextNode(" " + ch.name));
      if (ch.type === "voice") voiceList.appendChild(link);
      else textList.appendChild(link);
    }
  }

  function renderHeading() {
    if (!state.channel) return;
    heading.textContent = "#" + state.channel.name;
    composer.setAttribute("aria-label", `Message #${state.channel.name}`);
    if (state.channel.slowmode_seconds > 0) {
      slowmodeNote.hidden = false;
      slowmodeNote.textContent = `Slowmode is on: one message every ${state.channel.slowmode_seconds} seconds.`;
    } else {
      slowmodeNote.hidden = true;
    }
    $("startLine").hidden = state.order.length > 0;
  }

  function timeElement(iso) {
    const time = document.createElement("time");
    time.dateTime = iso;
    const d = new Date(iso);
    time.textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return time;
  }

  function quoteLine(msg) {
    if (!msg.referenced_message) return null;
    const ref = msg.referenced_message;
    const div = document.createElement("div");
    div.className = "quote-line";
    let text = ref.body;
    if (Array.from(text).length > 100) text = Array.from(text).slice(0, 100).join("") + "…";
    let line = `Replying to ${ref.author.display_name}: ${text}`;
    if (ref.edited_at) line += " (edited)";
    div.textContent = line;
    return div;
  }

  function attachmentNode(a) {
    if (a.content_type && a.content_type.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "attach-img";
      img.src = a.url;
      img.alt = a.filename;
      img.width = a.width || 320;
      img.height = a.height || 240;
      return img;
    }
    if (a.content_type === "video/webm") {
      const video = document.createElement("video");
      video.className = "attach-video";
      video.controls = true;
      video.preload = "metadata";
      video.src = a.url;
      video.width = a.width || 320;
      video.height = a.height || 240;
      const caption = document.createElement("span");
      caption.className = "attach-caption";
      const secs = Math.floor((a.duration_ms || 0) / 1000);
      caption.textContent = `${a.filename} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      const wrap = document.createElement("div");
      wrap.append(video, caption);
      return wrap;
    }
    const link = document.createElement("a");
    link.className = "attach-link";
    link.href = a.url;
    link.textContent = a.filename;
    return link;
  }

  function reactionChip(msg, reaction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "reaction-chip";
    const known = EMOJI.find((e) => e.emoji === reaction.emoji);
    const name = known ? known.name : reaction.emoji;
    btn.setAttribute("aria-pressed", String(Boolean(reaction.me)));
    btn.setAttribute("aria-label", `${name}: ${reaction.count}`);
    btn.textContent = `${reaction.emoji} ${reaction.count}`;
    btn.addEventListener("click", () => toggleReaction(msg.id, reaction.emoji));
    return btn;
  }

  function messageRow(msg, { entering = false } = {}) {
    const row = document.createElement("article");
    row.className = "msg-row" + (entering ? " entering" : "");
    row.dataset.id = String(msg.id);
    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = msg.author.avatar_url || "/static/gen/avatar-1.svg";
    avatar.alt = "";
    avatar.width = 40; avatar.height = 40;
    const bodyCol = document.createElement("div");
    const head = document.createElement("div");
    head.className = "msg-head";
    const author = document.createElement("span");
    author.className = "msg-author";
    author.textContent = msg.author.display_name;
    const time = timeElement(msg.created_at);
    head.append(author, time);
    bodyCol.appendChild(head);
    const quote = quoteLine(msg);
    if (quote) bodyCol.appendChild(quote);
    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = msg.body;
    if (msg.edited_at) {
      const edited = document.createElement("span");
      edited.textContent = " (edited)";
      body.appendChild(edited);
    }
    bodyCol.appendChild(body);
    for (const a of msg.attachments || []) bodyCol.appendChild(attachmentNode(a));
    if ((msg.reactions || []).length) {
      const wrap = document.createElement("div");
      wrap.className = "reactions";
      for (const r of msg.reactions) wrap.appendChild(reactionChip(msg, r));
      bodyCol.appendChild(wrap);
    }
    if (msg.reply_count > 0) {
      const replyNote = document.createElement("span");
      replyNote.className = "reply-count";
      replyNote.textContent = `${msg.reply_count} ${msg.reply_count === 1 ? "reply" : "replies"}`;
      replyNote.addEventListener("click", () => openThread(msg.id));
      bodyCol.appendChild(replyNote);
    }
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    if (state.permissions.has("add_reactions")) {
      const react = document.createElement("button");
      react.type = "button";
      react.textContent = "Add reaction";
      react.addEventListener("click", () => openReactionDialog(msg.id, react));
      actions.appendChild(react);
    }
    const reply = document.createElement("button");
    reply.type = "button";
    reply.textContent = "Reply in thread";
    reply.addEventListener("click", () => openThread(msg.id, reply));
    actions.appendChild(reply);
    if (msg.author.id === (state.me && state.me.id)) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit message";
      edit.addEventListener("click", () => startEdit(msg, row));
      actions.appendChild(edit);
    }
    if (msg.author.id === (state.me && state.me.id) || state.permissions.has("manage_messages")) {
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "Delete message";
      del.addEventListener("click", async () => {
        await api("DELETE", `/api/messages/${msg.id}`);
      });
      actions.appendChild(del);
    }
    bodyCol.appendChild(actions);
    row.append(avatar, bodyCol);
    return row;
  }

  function renderStream() {
    for (const child of Array.from(stream.children)) {
      if (child.id !== "startLine" && child.id !== "jumpBtn") stream.removeChild(child);
    }
    const start = $("startLine");
    for (const id of state.order) {
      const msg = state.messages.get(id);
      if (!msg) continue;
      stream.insertBefore(messageRow(msg), $("jumpBtn"));
    }
    start.hidden = state.order.length > 0;
    stream.scrollTop = stream.scrollHeight;
  }

  function renderMembers() {
    membersEl.textContent = "";
    const online = document.createElement("h2");
    const onlineList = document.createElement("ul");
    const offline = document.createElement("h2");
    const offlineList = document.createElement("ul");
    const onlineMembers = state.members.filter((m) => m.status !== "offline");
    const offlineMembers = state.members.filter((m) => m.status === "offline");
    online.textContent = `Online (${onlineMembers.length})`;
    onlineList.setAttribute("aria-label", `Online (${onlineMembers.length})`);
    offline.textContent = `Offline (${offlineMembers.length})`;
    offlineList.setAttribute("aria-label", `Offline (${offlineMembers.length})`);
    for (const m of onlineMembers) {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = m.user.avatar_url || "/static/gen/avatar-1.svg";
      img.alt = "";
      li.append(img, document.createTextNode(m.user.display_name));
      onlineList.appendChild(li);
    }
    for (const m of offlineMembers) {
      const li = document.createElement("li");
      const img = document.createElement("img");
      img.src = m.user.avatar_url || "/static/gen/avatar-1.svg";
      img.alt = "";
      li.append(img, document.createTextNode(m.user.display_name));
      offlineList.appendChild(li);
    }
    membersEl.append(online, onlineList, offline, offlineList);
  }

  // ---------- live connection ----------
  function connectLive() {
    if (state.source) state.source.close();
    const source = new EventSource("/api/live", {
      // the token travels in the Authorization header, never the URL
    });
    state.source = null;
    // EventSource cannot carry headers, so use a fetch-based stream instead.
    source.close();
    startFetchStream();
  }

  let streamAbort = null;

  async function startFetchStream() {
    streamAbort = new AbortController();
    say("Reconnecting…");
    try {
      const resp = await fetch("/api/live", {
        headers: { Authorization: "Bearer " + state.token, Accept: "text/event-stream" },
        signal: streamAbort.signal,
      });
      if (resp.status !== 200) {
        if (resp.status === 401) { endedSession(); return; }
        setTimeout(startFetchStream, 2000);
        return;
      }
      state.connected = true;
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice(6));
          handleEvent(payload);
        }
      }
    } catch (err) {
      if (streamAbort.signal.aborted) return;
    }
    if (!streamAbort.signal.aborted) {
      state.connected = false;
      say("Reconnecting…");
      setTimeout(() => { if (!state.connected) startFetchStream(); }, 2000);
    }
  }

  async function catchUp() {
    await loadHistory();
    renderStream();
    say("Connected.");
  }

  function endedSession() {
    const target = "/login?next=" + encodeURIComponent(location.pathname);
    history.replaceState({}, "", target);
    location.href = target;
  }

  function handleEvent(event) {
    const type = event.type;
    const data = event.data || {};
    if (type === "__session_ended__") { endedSession(); return; }
    if (type === "message_created" && data.message) {
      const msg = data.message;
      if (msg.channel_id === state.channel.id) {
        if (!state.messages.has(msg.id)) {
          state.messages.set(msg.id, msg);
          state.order.push(msg.id);
          const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 120;
          const row = messageRow(msg, { entering: true });
          stream.insertBefore(row, $("jumpBtn"));
          $("startLine").hidden = true;
          if (nearBottom) stream.scrollTop = stream.scrollHeight;
          else $("jumpBtn").hidden = false;
        }
      }
    } else if (type === "message_updated" && data.message) {
      const msg = data.message;
      if (msg.channel_id === state.channel.id) {
        state.messages.set(msg.id, msg);
        replaceRow(msg);
        updateSearchResult(msg);
      }
    } else if (type === "message_deleted") {
      if (data.channel_id === state.channel.id) {
        state.messages.delete(data.message_id);
        state.order = state.order.filter((id) => id !== data.message_id);
        const row = stream.querySelector(`[data-id="${data.message_id}"]`);
        if (row) row.remove();
        if (!state.order.length) $("startLine").hidden = false;
        dropSearchResult(data.message_id);
      }
      dropNotification(data.message_id);
    } else if (type === "reaction_added" || type === "reaction_removed") {
      const msg = data.message;
      if (msg && msg.channel_id === state.channel.id) {
        state.messages.set(msg.id, msg);
        replaceRow(msg);
        updateSearchResult(msg);
      }
    } else if (type === "channel_access_changed" || type === "roles_changed" || type === "member_timed_out") {
      refreshWorkspaceAfterAccessChange();
    } else if (type === "presence_update" || type === "member_joined" || type === "member_left" || type === "member_banned") {
      loadMembers().then(renderMembers);
    }
  }

  async function refreshWorkspaceAfterAccessChange() {
    const full = await api("GET", `/api/servers/${state.community.slug}`);
    if (full.status !== 200) { endedSession(); return; }
    state.community = full.data;
    const still = state.community.channels.find((c) => c.id === state.channel.id);
    if (!still) {
      if (state.community.channels.length) {
        location.href = `/channels/${state.community.id}/${state.community.channels[0].id}`;
      } else {
        location.href = "/servers";
      }
      return;
    }
    state.channel = still;
    await refreshPermissions();
    renderChannels();
    applyPermissionsToUI();
  }

  function replaceRow(msg) {
    const row = stream.querySelector(`[data-id="${msg.id}"]`);
    if (row) {
      const fresh = messageRow(msg);
      row.replaceWith(fresh);
    }
  }

  // ---------- notifications ----------
  async function updateNotifButton() {
    const resp = await api("GET", "/api/notifications?limit=1");
    if (resp.status !== 200) return;
    const unread = resp.data.unread_count || 0;
    if (unread > 0) {
      notifBtn.textContent = `Notifications, ${unread} unread`;
    } else {
      notifBtn.textContent = "Notifications";
    }
  }

  notifBtn.addEventListener("click", () => {
    const panel = $("notifPanel");
    if (!panel.hidden) {
      const opener = hidePanel("notifPanel");
      notifBtn.setAttribute("aria-expanded", "false");
      if (opener) opener.focus(); else notifBtn.focus();
      return;
    }
    openNotifications(notifBtn);
  });

  async function openNotifications(opener) {
    const panel = $("notifPanel");
    openPanel("notifPanel", opener);
    panel.textContent = "";
    const head = document.createElement("h2");
    head.textContent = "Notifications";
    const markAll = document.createElement("button");
    markAll.type = "button";
    markAll.className = "close-btn";
    markAll.textContent = "Mark all as read";
    markAll.addEventListener("click", async () => {
      await api("POST", "/api/notifications/read-all", {});
      await updateNotifButton();
      await openNotifications(opener);
    });
    const list = document.createElement("ul");
    list.style.listStyle = "none";
    list.style.padding = "0";
    panel.append(head, markAll, list);
    const resp = await api("GET", "/api/notifications?limit=20");
    if (resp.status !== 200) return;
    state.notifCursor = resp.data.data.length ? resp.data.data[resp.data.data.length - 1].id : null;
    state.notifHasMore = resp.data.has_more;
    for (const n of resp.data.data) list.appendChild(notificationRow(n));
    if (resp.data.has_more) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "close-btn";
      more.id = "showOlderBtn";
      more.textContent = "Show older notifications";
      more.addEventListener("click", async () => {
        const next = await api("GET", `/api/notifications?limit=20&before=${state.notifCursor}`);
        if (next.status !== 200) return;
        const beforeCount = list.children.length;
        for (const n of next.data.data) list.appendChild(notificationRow(n));
        state.notifCursor = next.data.data.length ? next.data.data[next.data.data.length - 1].id : state.notifCursor;
        state.notifHasMore = next.data.has_more;
        if (!next.data.has_more) more.remove();
        const firstNew = list.children[beforeCount];
        if (firstNew && !next.data.has_more) {
          if (firstNew.querySelector) firstNew.querySelector("button").focus();
        } else {
          more.focus();
        }
      });
      panel.appendChild(more);
    }
  }

  function notificationRow(n) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notif-entry" + (n.read ? "" : " unread");
    const actor = n.actor ? n.actor.display_name : "Someone";
    const verbs = { mention: "mentioned you", reply: "replied to you", message: "posted a message", welcome: "welcomed you" };
    btn.textContent = `${actor} ${verbs[n.kind] || "acted"}`;
    btn.dataset.id = String(n.id);
    btn.addEventListener("click", async () => {
      await api("POST", `/api/notifications/${n.id}/read`, {});
      if (n.channel_id) {
        location.href = `/channels/${n.community_id}/${n.channel_id}`;
      }
      updateNotifButton();
    });
    li.appendChild(btn);
    return li;
  }

  function dropNotification(messageId) {
    const panel = $("notifPanel");
    if (!panel || panel.hidden) return;
    for (const row of panel.querySelectorAll(".notif-entry")) {
      if (row.dataset.msgId === String(messageId)) row.parentElement.remove();
    }
  }

  // ---------- thread ----------
  let threadParent = null;

  async function openThread(messageId, opener) {
    threadParent = state.messages.get(messageId);
    const panel = $("threadPanel");
    openPanel("threadPanel", opener || null);
    panel.textContent = "";
    const head = document.createElement("h2");
    head.textContent = "Thread";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close-btn";
    close.textContent = "Close thread";
    close.addEventListener("click", () => closeThread());
    panel.append(head, close);
    if (threadParent) {
      const parentWrap = messageRow(threadParent);
      parentWrap.classList.add("thread-parent");
      panel.appendChild(parentWrap);
    }
    const repliesList = document.createElement("div");
    panel.appendChild(repliesList);
    const resp = await api("GET", `/api/messages/${messageId}/replies`);
    for (const reply of (resp.data && resp.data.data) || []) {
      repliesList.appendChild(messageRow(reply));
    }
    const input = document.createElement("textarea");
    input.className = "thread-reply-box";
    input.setAttribute("aria-label", "Thread reply");
    input.placeholder = "Thread reply";
    panel.appendChild(input);
    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const body = input.value.trim();
        if (!body) return;
        const post = await api("POST", `/api/channels/${state.channel.id}/messages`,
          { body, reply_to_id: messageId, nonce: "th-" + HUB.randomId() });
        if (post.status === 201) {
          input.value = "";
          repliesList.appendChild(messageRow(post.data, { entering: true }));
          const parent = state.messages.get(messageId);
          if (parent) {
            parent.reply_count += 1;
            replaceRow(parent);
          }
        } else {
          say("Your message could not be saved.");
        }
      }
    });
    input.focus();
  }

  function closeThread() {
    const opener = hidePanel("threadPanel");
    if (opener) opener.focus();
  }

  // ---------- reactions ----------
  let reactionTarget = null;

  function openReactionDialog(messageId, opener) {
    const dialog = $("reactionDialog");
    const grid = $("emojiGrid");
    grid.textContent = "";
    for (const entry of EMOJI) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", entry.name);
      btn.textContent = entry.emoji;
      btn.addEventListener("click", () => {
        dialog.close();
        if (opener) opener.focus();
        toggleReaction(messageId, entry.emoji);
      });
      grid.appendChild(btn);
    }
    reactionTarget = messageId;
    dialog.dataset.openerControl = opener ? opener.id || "" : "";
    if (opener && !opener.id) opener.id = "reactionOpener";
    dialog.dataset.openerControl = opener ? opener.id : "";
    dialog.showModal();
    grid.querySelector("button").focus();
  }

  const dialog = $("reactionDialog");
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dialog.close();
      const openerId = dialog.dataset.openerControl;
      if (openerId) {
        const opener = document.getElementById(openerId);
        if (opener) opener.focus();
      }
    }
  });
  dialog.addEventListener("close", () => {
    dialog.setAttribute("inert", "");
    const openerId = dialog.dataset.openerControl;
    if (openerId) {
      const opener = document.getElementById(openerId);
      if (opener) opener.focus();
    }
  });

  async function toggleReaction(messageId, emoji) {
    const msg = state.messages.get(messageId);
    if (!msg) return;
    const existing = (msg.reactions || []).find((r) => r.emoji === emoji);
    const mine = existing && existing.me;
    // optimistic change shows at once
    if (existing) {
      existing.count += mine ? -1 : 1;
      existing.me = !mine;
      if (existing.count <= 0) msg.reactions = msg.reactions.filter((r) => r !== existing);
    } else {
      msg.reactions = [...(msg.reactions || []), { emoji, count: 1, me: true }];
    }
    replaceRow(msg);
    const resp = await api(mine ? "DELETE" : "PUT", `/api/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
    if (resp.status !== 204 && resp.status !== 404) {
      // roll back to the true state and announce it
      say("Your reaction could not be saved.");
      const fresh = await api("GET", `/api/channels/${state.channel.id}/messages?limit=50`);
      if (fresh.status === 200) {
        const stored = fresh.data.data.find((m) => m.id === messageId);
        if (stored) { state.messages.set(messageId, stored); replaceRow(stored); }
      }
    }
  }

  // ---------- inline editing ----------
  function startEdit(msg, row) {
    const body = row.querySelector(".msg-body");
    if (!body) return;
    const editor = document.createElement("textarea");
    editor.className = "msg-edit-box";
    editor.value = msg.body;
    editor.setAttribute("aria-label", "Edit message text");
    body.replaceWith(editor);
    editor.focus();
    const finish = async (save) => {
      if (!save) {
        replaceRow(msg);
        return;
      }
      const resp = await api("PATCH", `/api/messages/${msg.id}`, { body: editor.value });
      if (resp.status === 200) {
        state.messages.set(msg.id, resp.data);
        replaceRow(resp.data);
        updateSearchResult(resp.data);
      } else {
        say("Your edit could not be saved.");
        replaceRow(msg);
      }
    };
    editor.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finish(true); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
  }

  // ---------- search ----------
  const searchBox = $("wsSearch");
  searchBox.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    runSearch(searchBox.value.trim());
  });

  async function runSearch(query) {
    const token = ++state.searchToken;
    state.searchQuery = query;
    const panel = $("searchPanel");
    openPanel("searchPanel", searchBox);
    panel.textContent = "";
    const head = document.createElement("h2");
    head.textContent = "Searching…";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close-btn";
    close.textContent = "Close search";
    close.addEventListener("click", () => {
      const opener = hidePanel("searchPanel");
      searchBox.focus();
    });
    const list = document.createElement("ul");
    list.style.listStyle = "none";
    list.style.padding = "0";
    panel.append(head, close, list);
    if (!query) { head.textContent = "That search could not be run."; return; }
    const resp = await api("GET", `/api/servers/${state.community.slug}/messages/search?q=${encodeURIComponent(query)}`);
    if (token !== state.searchToken) return;  // latest search wins
    if (resp.status !== 200) { head.textContent = "That search could not be run."; return; }
    const results = resp.data.data || [];
    head.textContent = `${resp.data.total_results} ${resp.data.total_results === 1 ? "result" : "results"}`;
    const terms = parseTerms(query);
    for (const msg of results) {
      const li = document.createElement("li");
      li.className = "search-result";
      li.dataset.id = String(msg.id);
      const meta = document.createElement("div");
      const author = document.createElement("span");
      author.textContent = msg.author.display_name;
      const channelTag = document.createElement("span");
      channelTag.className = "channel-tag";
      const channel = state.community.channels.find((c) => c.id === msg.channel_id);
      channelTag.textContent = `#${channel ? channel.name : ""}`;
      const time = timeElement(msg.created_at);
      meta.append(author, " ", channelTag, " ", time);
      const quote = quoteLine(msg);
      const body = document.createElement("div");
      body.className = "msg-body";
      markTerms(body, msg.body, terms);
      if (msg.edited_at) {
        const edited = document.createElement("span");
        edited.textContent = " (edited)";
        body.appendChild(edited);
      }
      li.append(meta);
      if (quote) li.appendChild(quote);
      li.appendChild(body);
      list.appendChild(li);
    }
  }

  function parseTerms(query) {
    const terms = [];
    for (const part of query.split(/\s+/).filter(Boolean)) {
      if (/^[a-z]+:/.test(part)) continue;
      terms.push(part.replace(/"/g, ""));
    }
    return terms;
  }

  function markTerms(container, text, terms) {
    let rest = text;
    const pieces = [];
    let any = false;
    let remaining = text;
    let cursor = 0;
    const ranges = [];
    const lower = text.toLowerCase();
    for (const term of terms) {
      const needle = term.toLowerCase();
      let idx = lower.indexOf(needle);
      while (idx !== -1) {
        const before = idx > 0 ? text[idx - 1] : "";
        const after = idx + needle.length < text.length ? text[idx + needle.length] : "";
        const wordish = (ch) => /[\p{L}\p{N}]/u.test(ch);
        if (!wordish(before) && !wordish(after)) ranges.push([idx, idx + needle.length]);
        idx = lower.indexOf(needle, idx + needle.length);
      }
    }
    ranges.sort((a, b) => a[0] - b[0]);
    let pos = 0;
    for (const [start, end] of ranges) {
      if (start < pos) continue;
      if (start > pos) container.appendChild(document.createTextNode(text.slice(pos, start)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(start, end);
      container.appendChild(mark);
      pos = end;
      any = true;
    }
    if (pos < text.length) container.appendChild(document.createTextNode(text.slice(pos)));
    if (!any) container.textContent = text;
  }

  function updateSearchResult(msg) {
    const panel = $("searchPanel");
    if (!panel || panel.hidden) return;
    const li = panel.querySelector(`.search-result[data-id="${msg.id}"]`);
    if (!li) return;
    const quote = quoteLine(msg);
    const body = document.createElement("div");
    body.className = "msg-body";
    markTerms(body, msg.body, parseTerms(state.searchQuery));
    if (msg.edited_at) {
      const edited = document.createElement("span");
      edited.textContent = " (edited)";
      body.appendChild(edited);
    }
    const oldBody = li.querySelector(".msg-body");
    if (oldBody) oldBody.replaceWith(body);
    const oldQuote = li.querySelector(".quote-line");
    if (oldQuote) oldQuote.remove();
    if (quote) li.insertBefore(quote, body);
  }

  function dropSearchResult(messageId) {
    const panel = $("searchPanel");
    if (!panel || panel.hidden) return;
    const li = panel.querySelector(`.search-result[data-id="${messageId}"]`);
    if (!li) return;
    li.remove();
    const head = panel.querySelector("h2");
    if (head) {
      const count = panel.querySelectorAll(".search-result").length;
      head.textContent = `${count} ${count === 1 ? "result" : "results"}`;
    }
  }

  // ---------- composer and mentions ----------
  const mentionBox = $("mentionBox");
  let mentionState = { active: 0, options: [], start: -1 };

  composer.addEventListener("input", () => {
    saveDraft(state.channel.id, composer.value);
    updateMentions();
  });

  composer.addEventListener("scroll", () => {
    composer.style.height = "auto";
    composer.style.height = Math.min(180, composer.scrollHeight) + "px";
  });

  function updateMentions() {
    const text = composer.value.slice(0, composer.selectionStart);
    const match = text.match(/@([A-Za-z0-9_.]*)$/);
    if (!match) {
      mentionBox.hidden = true;
      mentionState.options = [];
      return;
    }
    const query = match[1].toLowerCase();
    const options = state.members
      .filter((m) => m.user.username.toLowerCase().startsWith(query))
      .slice(0, 8);
    if (!options.length) { mentionBox.hidden = true; return; }
    mentionState.options = options;
    mentionState.active = 0;
    mentionState.start = text.length - match[0].length;
    renderMentionOptions();
    mentionBox.hidden = false;
  }

  function renderMentionOptions() {
    mentionBox.textContent = "";
    mentionState.options.forEach((m, i) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "opt" + (i === mentionState.active ? " active" : "");
      opt.setAttribute("role", "option");
      opt.setAttribute("aria-selected", String(i === mentionState.active));
      opt.textContent = m.user.username;
      opt.addEventListener("click", () => pickMention(i));
      mentionBox.appendChild(opt);
    });
  }

  function pickMention(index) {
    const member = mentionState.options[index];
    if (!member) return;
    const before = composer.value.slice(0, mentionState.start);
    const after = composer.value.slice(composer.selectionStart);
    composer.value = `${before}@${member.user.username} ${after}`;
    mentionBox.hidden = true;
    composer.focus();
    const caret = (before + "@" + member.user.username + " ").length;
    composer.setSelectionRange(caret, caret);
    saveDraft(state.channel.id, composer.value);
  }

  composer.addEventListener("keydown", (e) => {
    if (!mentionBox.hidden && mentionState.options.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mentionState.active = Math.min(mentionState.options.length - 1, mentionState.active + 1);
        renderMentionOptions();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        mentionState.active = Math.max(0, mentionState.active - 1);
        renderMentionOptions();
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pickMention(mentionState.active);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  async function sendMessage() {
    const body = composer.value.trim();
    if (!body && !pending.length) return;
    const nonce = "msg-" + HUB.randomId();
    const row = buildPendingRow(body, nonce);
    stream.insertBefore(row, $("jumpBtn"));
    stream.scrollTop = stream.scrollHeight;
    composer.value = "";
    saveDraft(state.channel.id, "");
    const attachments = [];
    for (const file of pending.splice(0)) {
      const form = new FormData();
      form.append("file", file.file);
      const resp = await fetch("/api/attachments", {
        method: "POST",
        headers: { Authorization: "Bearer " + state.token },
        body: form,
      });
      if (resp.ok) attachments.push((await resp.json()).id);
    }
    renderPending();
    const payload = { body, nonce };
    if (attachments.length) payload.attachment_ids = attachments;
    const resp = await api("POST", `/api/channels/${state.channel.id}/messages`, payload);
    if (resp.status === 201) {
      state.messages.set(resp.data.id, resp.data);
      state.order.push(resp.data.id);
      const fresh = messageRow(resp.data, { entering: true });
      row.replaceWith(fresh);
      $("startLine").hidden = true;
    } else if (resp.status === 200) {
      row.remove();
    } else {
      markRowFailed(row, nonce, body);
      say("Message failed to send. Tap to retry.");
    }
  }

  function buildPendingRow(body, nonce) {
    const row = document.createElement("article");
    row.className = "msg-row entering";
    row.dataset.nonce = nonce;
    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = state.me.avatar_url || "/static/gen/avatar-1.svg";
    avatar.alt = "";
    const col = document.createElement("div");
    const head = document.createElement("div");
    head.className = "msg-head";
    const author = document.createElement("span");
    author.className = "msg-author";
    author.textContent = state.me.display_name;
    const sending = document.createElement("span");
    sending.className = "msg-time";
    sending.textContent = "sending…";
    head.append(author, sending);
    const bodyEl = document.createElement("div");
    bodyEl.className = "msg-body";
    bodyEl.textContent = body;
    col.append(head, bodyEl);
    row.append(avatar, col);
    return row;
  }

  function markRowFailed(row, nonce, body) {
    const fail = document.createElement("div");
    fail.className = "msg-failed";
    fail.textContent = "Message failed to send. Tap to retry.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.addEventListener("click", async () => {
      const resp = await api("POST", `/api/channels/${state.channel.id}/messages`, { body, nonce });
      if (resp.status === 201 || resp.status === 200) {
        state.messages.set(resp.data.id, resp.data);
        state.order.push(resp.data.id);
        const fresh = messageRow(resp.data);
        row.replaceWith(fresh);
      }
    });
    fail.appendChild(retry);
    row.appendChild(fail);
  }

  // ---------- attachments ----------
  attachBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    for (const file of fileInput.files) pending.push({ file });
    fileInput.value = "";
    renderPending();
  });

  function renderPending() {
    pendingList.textContent = "";
    for (const item of pending) {
      const row = document.createElement("div");
      row.className = "pending-item";
      const name = document.createElement("span");
      name.textContent = item.file.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${item.file.name}`);
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        pending.splice(pending.indexOf(item), 1);
        renderPending();
      });
      row.append(name, remove);
      pendingList.appendChild(row);
    }
  }

  async function checkUploadLimits() {
    const limit = { free: 10485760, basic: 52428800, max: 524288000 }[state.me.tier] || 10485760;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].file.size > limit) {
        say(`${pending[i].file.name} is larger than your upload limit.`);
        pending.splice(i, 1);
        renderPending();
      }
    }
  }

  setInterval(checkUploadLimits, 2000);

  // ---------- Alt+Arrow channel switching ----------
  document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const textChannels = (state.community ? state.community.channels : []).filter((c) => c.type === "text");
    const idx = textChannels.findIndex((c) => c.id === state.channel.id);
    const target = e.key === "ArrowDown" ? idx + 1 : idx - 1;
    if (target < 0 || target >= textChannels.length) return;
    e.preventDefault();
    location.href = `/channels/${state.community.id}/${textChannels[target].id}`;
  });

  // ---------- Escape closes open panels ----------
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (dialog.open) {
      dialog.close();
      const openerId = dialog.dataset.openerControl;
      if (openerId) document.getElementById(openerId)?.focus();
      return;
    }
    for (const panelId of ["threadPanel", "searchPanel", "notifPanel"]) {
      const el = $(panelId);
      if (el && !el.hidden) {
        const opener = hidePanel(panelId);
        if (panelId === "searchPanel") searchBox.focus();
        else if (opener) opener.focus();
        return;
      }
    }
    if (state.panels.channels) setChannelsPanel(false);
    if (state.panels.members) setMembersPanel(false);
  });

  // ---------- phone and tablet panels ----------
  function setChannelsPanel(open) {
    state.panels.channels = open;
    openChannelsBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      rail.removeAttribute("hidden");
      $("wsSidebar").removeAttribute("hidden");
      rail.setAttribute("data-open", "true");
      $("wsSidebar").setAttribute("data-open", "true");
      rail.classList.add("open");
      $("wsSidebar").classList.add("open");
    } else {
      rail.classList.remove("open");
      $("wsSidebar").classList.remove("open");
    }
  }

  function setMembersPanel(open) {
    state.panels.members = open;
    showMembersBtn.setAttribute("aria-expanded", String(open));
    if (open) membersEl.classList.add("open");
    else membersEl.classList.remove("open");
  }

  openChannelsBtn.addEventListener("click", () => {
    setChannelsPanel(!state.panels.channels);
  });
  showMembersBtn.addEventListener("click", () => {
    setMembersPanel(!state.panels.members);
  });

  window.addEventListener("resize", applyLayout);

  // ---------- boot ----------
  (async () => {
    if (!state.token) {
      location.href = "/login?next=" + encodeURIComponent(location.pathname);
      return;
    }
    const ok = await loadSelf();
    if (!ok) {
      location.href = "/login?next=" + encodeURIComponent(location.pathname);
      return;
    }
    state.draftsKey = "hub_drafts_" + state.me.id;
    const previousMember = sessionStorage.getItem("hub_member_id");
    if (previousMember && previousMember !== String(state.me.id)) {
      // a different member signs in here: every earlier draft is discarded
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith("hub_drafts_")) sessionStorage.removeItem(key);
      }
    }
    sessionStorage.setItem("hub_member_id", String(state.me.id));
    const loaded = await loadWorkspace();
    if (!loaded) {
      location.href = "/servers";
      return;
    }
    restoreDraft();
    applyLayout();
    say(`You joined ${state.community.name}.`);
    startFetchStream();
    updateNotifButton();
  })();
})();
