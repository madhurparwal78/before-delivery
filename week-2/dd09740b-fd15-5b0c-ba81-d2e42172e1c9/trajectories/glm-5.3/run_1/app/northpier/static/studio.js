/* The studio queue and inquiry detail. Loaded after app.js. */
(function () {
  "use strict";
  var root = document;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $(sel, scope) { return (scope || root).querySelector(sel); }
  function $all(sel, scope) { return Array.prototype.slice.call((scope || root).querySelectorAll(sel)); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) { Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); }); }
    if (text !== undefined) { node.textContent = text; }
    return node;
  }
  function countText(value) {
    var norm = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    return Array.from(norm).length;
  }

  var LABELS = { new: "New", in_review: "In review", call_booked: "Call booked", won: "Won", declined: "Declined" };
  var REASONS = { outside_services: "Outside our services", timeline: "Timeline does not fit", budget: "Budget does not fit", fully_booked: "Fully booked" };
  var BUDGETS = { under_25k: "Under 25k EUR", "25k_75k": "25k to 75k EUR", "75k_150k": "75k to 150k EUR", over_150k: "Over 150k EUR" };
  var TIMELINES = { asap: "As soon as possible", within_3_months: "Within 3 months", "3_to_6_months": "In 3 to 6 months", exploring: "Just exploring" };
  var SERVICES = { strategy: "Strategy", branding: "Branding", design: "Design", development: "Development" };
  var TABS = ["new", "in_review", "call_booked", "won", "declined", "all"];
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  var DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function stockholmParts(iso) {
    var d = new Date(iso);
    var local = new Date(d.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
    return local;
  }
  function callTimeLabel(iso) {
    var local = stockholmParts(iso);
    var hh = ("0" + local.getHours()).slice(-2);
    var mm = ("0" + local.getMinutes()).slice(-2);
    return DAYS[local.getDay()] + " " + local.getDate() + " " + MONTHS[local.getMonth()] + ", " + hh + ":" + mm;
  }
  function shortDate(iso) {
    var local = stockholmParts(iso);
    return local.getDate() + " " + MONTHS[local.getMonth()] + " " + local.getFullYear();
  }
  function sinceLabel(iso) {
    var seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return "just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? " minute ago" : " minutes ago");
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? " hour ago" : " hours ago");
    var days = Math.floor(hours / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  function api(path, options) {
    return fetch(path, Object.assign({ credentials: "same-origin", headers: { "Accept": "application/json" } }, options || {}))
      .then(function (res) {
        return res.json().then(function (body) { return { status: res.status, body: body }; })
          .catch(function () { return { status: res.status, body: null }; });
      });
  }

  function state() {
    return window.npStudioState;
  }

  /* ------------------------------------------------------------ the queue */
  function initQueue(detailMode) {
    var holder = detailMode ? $("[data-queue-column]") : $(".studio-shell");
    if (!holder) return;
    var tabButtons = {};
    $all("[data-tab]", holder).forEach(function (b) { tabButtons[b.getAttribute("data-tab")] = b; });
    var search = $("[data-queue-search]", holder);
    var list = $("[data-queue-list]", holder);
    var emptyOut = $("[data-queue-empty]", holder);
    var errorOut = $("[data-queue-error]", holder);
    var st = state();
    var debounceTimer = null;
    var seq = 0;

    function currentStatus() {
      var params = new URLSearchParams(window.location.search);
      var value = params.get("status") || "new";
      return TABS.indexOf(value) >= 0 ? value : "new";
    }
    function currentQ() {
      var params = new URLSearchParams(window.location.search);
      return params.get("q") || "";
    }

    function writeAddress(push) {
      var params = new URLSearchParams();
      params.set("status", st.status);
      if (st.q) params.set("q", st.q);
      var query = params.toString();
      var path = window.location.pathname;
      var url = query ? path + "?" + query : path;
      if (push) { window.history.pushState({ status: st.status, q: st.q }, "", url); }
      else { window.history.replaceState({ status: st.status, q: st.q }, "", url); }
    }

    function rowLink(inquiry) {
      var a = el("a", { class: "queue-row-link", href: "/studio/inquiries/" + inquiry.id + "?status=" + st.status + (st.q ? "&q=" + encodeURIComponent(st.q) : "") });
      a.appendChild(el("span", { class: "queue-ref" }, inquiry.reference));
      var who = el("span", { class: "queue-who" }, inquiry.name + (inquiry.company ? " · " + inquiry.company : ""));
      a.appendChild(who);
      var meta;
      if (st.status === "call_booked" && inquiry.call_at) {
        meta = el("span", { class: "queue-meta" }, callTimeLabel(inquiry.call_at));
      } else {
        meta = el("span", { class: "queue-meta" }, sinceLabel(inquiry.created_at));
      }
      a.appendChild(meta);
      a.appendChild(el("span", { class: "pill pill-" + inquiry.status }, LABELS[inquiry.status] || inquiry.status));
      if (detailMode && String(st.openId) === String(inquiry.id)) a.classList.add("current");
      return a;
    }

    function render(data) {
      list.textContent = "";
      data.inquiries.forEach(function (inquiry) { list.appendChild(rowLink(inquiry)); });
      TABS.forEach(function (tab) {
        var holder2 = $("[data-count='" + tab + "']", holder);
        if (holder2) {
          if (reduced) { holder2.textContent = String(data.counts[tab]); }
          else {
            holder2.style.transition = "opacity 0.45s";
            holder2.style.opacity = "0.4";
            setTimeout(function () {
              holder2.textContent = String(data.counts[tab]);
              holder2.style.opacity = "1";
            }, 100);
          }
        }
        if (tabButtons[tab]) {
          tabButtons[tab].setAttribute("aria-selected", tab === st.status ? "true" : "false");
        }
      });
      emptyOut.hidden = data.inquiries.length !== 0;
      if (search) search.value = st.q;
    }

    function load() {
      var mine = ++seq;
      var params = new URLSearchParams();
      params.set("status", st.status);
      if (st.q) params.set("q", st.q);
      return api("/api/studio/inquiries?" + params.toString()).then(function (result) {
        if (mine !== seq) return;
        if (result.status === 200 && result.body) {
          errorOut.hidden = true;
          render(result.body);
        } else if (result.status === 422 && result.body && result.body.error) {
          errorOut.textContent = result.body.error.message;
          errorOut.hidden = false;
        } else {
          errorOut.textContent = "The studio desk is unavailable. Try again shortly.";
          errorOut.hidden = false;
        }
      }).catch(function () {
        if (mine !== seq) return;
        errorOut.textContent = "The studio desk is unavailable. Try again shortly.";
        errorOut.hidden = false;
      });
    }

    function selectTab(tab, push) {
      st.status = tab;
      writeAddress(push);
      load();
    }

    TABS.forEach(function (tab) {
      tabButtons[tab].addEventListener("click", function () { selectTab(tab, true); });
    });

    if (search) {
      search.addEventListener("input", function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          st.q = search.value.trim();
          writeAddress(true);
          load();
        }, 250);
      });
    }

    window.addEventListener("popstate", function () {
      st.status = currentStatus();
      st.q = currentQ();
      if (search) search.value = st.q;
      load();
    });

    st.status = currentStatus();
    st.q = currentQ();
    st.reloadQueue = load;
    st.writeAddress = writeAddress;
    load();
  }

  /* --------------------------------------------------------- the detail */
  function initDetail() {
    var section = $("[data-inquiry-detail]");
    if (!section) return;
    var st = state();
    var id = section.getAttribute("data-inquiry-id");
    var emptyOut = $("[data-detail-empty]");
    var body = $("[data-detail-body]");
    var breadcrumbRef = $("[data-breadcrumb-ref]");
    var current = null;

    function actionNames(role, status) {
      var table = [
        { action: "start_review", from: ["new"], roles: ["lead", "associate"] },
        { action: "book_call", from: ["in_review"], roles: ["lead", "associate"] },
        { action: "reschedule_call", from: ["call_booked"], roles: ["lead", "associate"] },
        { action: "mark_won", from: ["call_booked"], roles: ["lead"] },
        { action: "decline", from: ["new", "in_review", "call_booked"], roles: ["lead"] },
        { action: "reopen", from: ["declined"], roles: ["lead"] }
      ];
      return table.filter(function (t) {
        return t.from.indexOf(status) >= 0 && t.roles.indexOf(role) >= 0;
      }).map(function (t) { return t.action; });
    }

    var ACTION_LABELS = {
      start_review: "Start review", book_call: "Book call", reschedule_call: "Reschedule call",
      mark_won: "Mark won", decline: "Decline", reopen: "Reopen"
    };
    var SUBMITTED = { submitted: "Submitted", book_call: "Call booked", reschedule_call: "Call moved", mark_won: "Marked won", decline: "Declined", reopen: "Reopened", start_review: "Review started" };

    function render(inquiry) {
      current = inquiry;
      if (breadcrumbRef) breadcrumbRef.textContent = inquiry.reference;
      body.textContent = "";

      var refRow = el("div", { class: "detail-ref-row" });
      refRow.appendChild(el("span", { class: "detail-reference" }, inquiry.reference));
      refRow.appendChild(el("span", { class: "detail-submitted" }, "Submitted " + shortDate(inquiry.created_at)));
      body.appendChild(refRow);

      body.appendChild(el("h2", { class: "visitor-name" }, inquiry.name));

      var facts = el("dl", { class: "detail-facts" });
      function fact(term, value) {
        var wrap = el("div", { class: "fact" });
        wrap.appendChild(el("dt", {}, term));
        wrap.appendChild(el("dd", {}, value));
        facts.appendChild(wrap);
      }
      fact("Company", inquiry.company || "—");
      var emailWrap = el("dd", {});
      var link = el("a", { href: "mailto:" + inquiry.email }, inquiry.email);
      var companyFact = facts.lastChild;
      companyFact.replaceChild(link, companyFact.lastChild);
      fact("Services", inquiry.services.map(function (s) { return SERVICES[s] || s; }).join(", "));
      fact("Budget", BUDGETS[inquiry.budget] || inquiry.budget);
      fact("Timeline", TIMELINES[inquiry.timeline] || inquiry.timeline);
      fact("Message", "");
      body.appendChild(facts);
      body.appendChild(el("p", { class: "detail-message" }, inquiry.message));

      var block = el("section", { class: "status-block", "aria-label": "Status" });
      var heading = el("h2", { class: "status-block-heading", tabindex: "-1" });
      heading.appendChild(el("span", { class: "pill pill-" + inquiry.status }, LABELS[inquiry.status] || inquiry.status));
      block.appendChild(heading);
      st.statusHeading = heading;
      if (inquiry.call_at) {
        block.appendChild(el("p", { class: "call-time-line" }, "Call time " + callTimeLabel(inquiry.call_at) + " Stockholm time"));
      }
      var alertOut = el("div", { class: "action-alert", role: "alert", hidden: "hidden" });
      block.appendChild(alertOut);
      var actions = el("div", { class: "actions" });
      var allowed = actionNames(st.role, inquiry.status);
      allowed.forEach(function (action) {
        var button = el("button", { class: "action-button", type: "button", "data-action": action }, ACTION_LABELS[action]);
        actions.appendChild(button);
      });
      block.appendChild(actions);
      var panelHolder = el("div", { class: "panel-holder" });
      block.appendChild(panelHolder);
      var statusOut = el("p", { class: "action-status", role: "status", "aria-live": "polite" });
      block.appendChild(statusOut);
      st.actionStatus = statusOut;
      st.actionAlert = alertOut;
      body.appendChild(block);

      var notesSection = el("section", { class: "notes-section" });
      notesSection.appendChild(el("h2", { class: "section-word" }, "Add a note"));
      var noteForm = el("form", { class: "note-form" });
      var noteArea = el("textarea", { "aria-label": "Add a note", placeholder: "Add a note" });
      var noteButton = el("button", { class: "confirm-button", type: "submit" }, "Add note");
      var noteError = el("p", { class: "panel-message", hidden: "hidden" });
      var noteStatus = el("p", { class: "note-status", role: "status", "aria-live": "polite" });
      noteForm.appendChild(noteArea); noteForm.appendChild(noteError); noteForm.appendChild(noteButton);
      notesSection.appendChild(noteForm);
      notesSection.appendChild(noteStatus);
      var noteList = el("ul", { class: "note-list", "aria-label": "Notes" });
      notesSection.appendChild(noteList);
      body.appendChild(notesSection);
      st.noteList = noteList;
      renderNotes(inquiry.notes || []);
      noteForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var text = noteArea.value;
        noteStatus.textContent = "Adding note...";
        api("/api/studio/inquiries/" + id + "/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text })
        }).then(function (result) {
          if (result.status === 201 && result.body) {
            noteArea.value = "";
            noteError.hidden = true;
            inquiry.notes.unshift(result.body);
            renderNotes(inquiry.notes);
            noteStatus.textContent = "Note added.";
          } else {
            var message = (result.body && result.body.error && result.body.error.message) || "The studio desk is unavailable. Try again shortly.";
            if (result.body && result.body.error && result.body.error.field === "body") {
              noteError.textContent = message; noteError.hidden = false;
              noteArea.setAttribute("aria-invalid", "true");
              noteStatus.textContent = "";
            } else {
              noteError.hidden = true;
              noteStatus.textContent = message;
            }
          }
        }).catch(function () { noteStatus.textContent = "The studio desk is unavailable. Try again shortly."; });
      });

      var historySection = el("section", { class: "history-block" });
      historySection.appendChild(el("h2", { class: "section-word" }, "History"));
      var historyList = el("ul", { class: "history-list", "aria-label": "History" });
      inquiry.history.forEach(function (item) { historyList.appendChild(historyEntry(item)); });
      historySection.appendChild(historyList);
      body.appendChild(historySection);
      st.historyList = historyList;

      allowed.forEach(function (action) {
        var button = $("[data-action='" + action + "']", body);
        button.addEventListener("click", function () { openPanel(action, button, panelHolder, inquiry); });
      });

      emptyOut.hidden = true;
      body.hidden = false;
    }

    function historyEntry(item) {
      var li = el("li", { class: "history-entry" });
      var what = item.action ? (SUBMITTED[item.action] || item.action) : "Submitted";
      var to = LABELS[item.to_status] || item.to_status;
      var text = item.action ? what + " → " + to : "Submitted";
      if (item.call_at) text += " · " + callTimeLabel(item.call_at);
      if (item.decline_reason) text += " · " + (REASONS[item.decline_reason] || item.decline_reason);
      li.appendChild(el("span", { class: "entry-what" }, text));
      var by = item.actor_name ? " by " + item.actor_name : "";
      li.appendChild(el("span", { class: "entry-when" }, shortDate(item.created_at) + by));
      return li;
    }

    function renderNotes(notes) {
      st.noteList.textContent = "";
      notes.forEach(function (note) {
        var li = el("li", { class: "note" });
        li.appendChild(el("p", { class: "note-by" }, note.author_name + " · " + shortDate(note.created_at)));
        li.appendChild(el("p", { class: "note-body-text" }, note.body));
        st.noteList.appendChild(li);
      });
    }

    function mintKey() {
      var bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      return Array.from(bytes).map(function (b) {
        return "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b % 64];
      }).join("");
    }

    function openPanel(action, button, holder, inquiry) {
      holder.textContent = "";
      st.actionAlert.hidden = true;
      var panel = el("div", { class: "action-panel", role: "group", "aria-label": ACTION_LABELS[action] });
      var key = mintKey();
      var callField = null, callError = null, reasonField = null, reasonError = null;

      if (action === "book_call" || action === "reschedule_call") {
        var fieldWrap = el("div", { class: "panel-field" });
        fieldWrap.appendChild(el("label", { for: "call-time" }, "Call time"));
        callField = el("input", { id: "call-time", type: "datetime-local", step: "900" });
        callError = el("p", { class: "panel-message", id: "call-time-msg" });
        fieldWrap.appendChild(callField);
        fieldWrap.appendChild(callError);
        panel.appendChild(fieldWrap);
        panel.appendChild(el("p", { class: "panel-hint" }, "Weekdays 09:00 to 17:00 Stockholm time, on the quarter hour. Calls last 45 minutes."));
        panel.appendChild(el("p", { class: "panel-hint" }, "Closed on Swedish public holidays and the eves of Midsummer, Christmas and New Year."));
        var confirm = el("button", { class: "confirm-button", type: "button" }, "Confirm");
        panel.appendChild(confirm);
        holder.appendChild(panel);
        callField.focus();
        function submit() {
          sendAction(action, { action: action, version: inquiry.version, call_at: callField.value }, key,
            function (err) {
              callError.textContent = err.message;
              callField.setAttribute("aria-invalid", "true");
              callField.setAttribute("aria-describedby", "call-time-msg");
              callField.focus();
            }, button, holder);
        }
        confirm.addEventListener("click", submit);
        callField.addEventListener("keydown", function (event) {
          if (event.key === "Enter") { event.preventDefault(); submit(); }
        });
      } else if (action === "decline") {
        var wrap = el("div", { class: "panel-field" });
        wrap.appendChild(el("label", { for: "decline-reason" }, "Reason"));
        reasonField = el("select", { id: "decline-reason" });
        reasonField.appendChild(el("option", { value: "" }, "Choose a reason"));
        Object.keys(REASONS).forEach(function (value) {
          reasonField.appendChild(el("option", { value: value }, REASONS[value]));
        });
        reasonError = el("p", { class: "panel-message", id: "decline-reason-msg" });
        wrap.appendChild(reasonField);
        wrap.appendChild(reasonError);
        panel.appendChild(wrap);
        var confirmDecline = el("button", { class: "confirm-button", type: "button" }, "Confirm decline");
        panel.appendChild(confirmDecline);
        holder.appendChild(panel);
        reasonField.focus();
        confirmDecline.addEventListener("click", function () {
          sendAction(action, { action: action, version: inquiry.version, decline_reason: reasonField.value }, key,
            function (err) {
              reasonError.textContent = err.message;
              reasonField.setAttribute("aria-invalid", "true");
              reasonField.setAttribute("aria-describedby", "decline-reason-msg");
              reasonField.focus();
            }, button, holder);
        });
      } else {
        sendAction(action, { action: action, version: inquiry.version }, key, null, button, holder);
        return;
      }
      panel.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          holder.textContent = "";
          button.focus();
        }
      });
    }

    function sendAction(action, data, key, onFieldError, button, holder) {
      st.actionStatus.textContent = "Saving...";
      $all(".action-button", body).forEach(function (b) { b.disabled = true; });
      var headers = { "Content-Type": "application/json" };
      if (key) headers["Idempotency-Key"] = key;
      api("/api/studio/inquiries/" + id + "/transition", {
        method: "POST", headers: headers, body: JSON.stringify(data)
      }).then(function (result) {
        $all(".action-button", body).forEach(function (b) { b.disabled = false; });
        if (result.status === 200 && result.body && result.body.status) {
          var rescheduled = action === "reschedule_call";
          holder.textContent = "";
          animatePanelClose(holder, function () {
            render(result.body);
            if (st.statusHeading) st.statusHeading.focus();
            st.actionStatus.textContent = rescheduled
              ? "Call moved to " + callTimeLabel(result.body.call_at) + "."
              : "Status changed to " + (LABELS[result.body.status] || result.body.status) + ".";
            if (st.reloadQueue) st.reloadQueue();
          });
          return;
        }
        var err = result.body && result.body.error;
        if (err && (err.field === "call_at" || err.field === "decline_reason") && onFieldError) {
          onFieldError(err);
          st.actionStatus.textContent = "";
          return;
        }
        holder.textContent = "";
        st.actionAlert.textContent = err ? err.message : "The studio desk is unavailable. Try again shortly.";
        st.actionAlert.hidden = false;
        st.actionStatus.textContent = "";
        button.focus();
      }).catch(function () {
        $all(".action-button", body).forEach(function (b) { b.disabled = false; });
        holder.textContent = "";
        st.actionAlert.textContent = "The studio desk is unavailable. Try again shortly.";
        st.actionAlert.hidden = false;
        button.focus();
      });
    }

    function animatePanelClose(holder, done) {
      if (reduced || !holder.firstChild) { done(); return; }
      var panel = holder.firstChild;
      panel.style.transition = "opacity 0.45s, transform 0.45s";
      panel.style.opacity = "0";
      panel.style.transform = "translateY(-6px)";
      setTimeout(done, 450);
    }

    api("/api/studio/inquiries/" + id).then(function (result) {
      if (result.status === 200 && result.body) {
        render(result.body);
      } else {
        emptyOut.textContent = "";
        emptyOut.appendChild(el("p", {}, "This inquiry is not available."));
      }
    }).catch(function () {
      emptyOut.textContent = "";
      emptyOut.appendChild(el("p", {}, "The studio desk is unavailable. Try again shortly."));
    });
  }

  window.npStudioBoot = function ($fn, allFn, elFn, reducedMotion) {
    var st = { status: "new", q: "", role: null, openId: null };
    window.npStudioState = st;
    var detail = $("[data-inquiry-detail]");
    if (detail) {
      st.openId = detail.getAttribute("data-inquiry-id");
      st.role = document.body.getAttribute("data-role") || "lead";
      initQueue(true);
      initDetail();
    } else if ($("[data-queue-column]") || $(".studio-shell-queue")) {
      st.role = document.body.getAttribute("data-role") || "lead";
      initQueue(false);
    }
  };

  window.npCountText = countText;
})();
