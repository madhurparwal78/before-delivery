/* Northpier Studio — progressive enhancement for the desk. */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  function calm() {
    return reduced.matches;
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function randomKey() {
    var bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"[bytes[i] % 64];
    }
    return out;
  }
  function countCharacters(value) {
    return Array.from(value.replace(/\r\n/g, "\n").trim()).length;
  }

  function api(method, path, body, key) {
    var headers = { Accept: "application/json" };
    var init = { method: method, headers: headers, credentials: "same-origin" };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (key) headers["Idempotency-Key"] = key;
    return fetch(path, init).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (payload) {
          return { ok: response.ok, status: response.status, payload: payload };
        });
    });
  }

  function refusalOf(result) {
    var error = result.payload && result.payload.error;
    return {
      field: error ? error.field : null,
      message: error && error.message ? error.message : "The studio desk is unavailable. Try again shortly."
    };
  }

  /* ---------------- letter reveals and label rises ---------------- */

  function observeOnce(nodes, apply) {
    if (!nodes.length) return;
    if (!("IntersectionObserver" in window)) {
      nodes.forEach(apply);
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            apply(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );
    nodes.forEach(function (node) {
      observer.observe(node);
    });
  }

  function setUpReveals(root) {
    observeOnce($$("[data-reveal]", root), function (node) {
      node.classList.add("is-revealed");
    });
    var groups = [
      ".eyebrow",
      ".work-grid",
      ".client-index",
      ".history",
      ".case-awards",
      ".service-rows",
      ".notes",
      ".offices"
    ];
    groups.forEach(function (selector) {
      $$(selector, root).forEach(function (parent) {
        var children = Array.prototype.slice.call(parent.children);
        children.forEach(function (child, index) {
          child.classList.add("rise");
          child.style.setProperty("--rise-delay", index * 60 + "ms");
        });
        observeOnce([parent], function () {
          children.forEach(function (child) {
            child.classList.add("is-risen");
          });
        });
      });
    });
  }

  function retypeLetters(host, text) {
    host.textContent = "";
    if (host.hasAttribute("aria-label")) host.setAttribute("aria-label", text);
    var wrap = el("span", "reveal");
    wrap.setAttribute("data-reveal", "");
    Array.from(text).forEach(function (char, index) {
      if (char === " ") {
        wrap.appendChild(el("span", "ltr-sp", " "));
        return;
      }
      var letter = el("span", "ltr", char);
      letter.style.setProperty("--ltr", String(index));
      wrap.appendChild(letter);
    });
    host.appendChild(wrap);
    requestAnimationFrame(function () {
      wrap.classList.add("is-revealed");
    });
  }

  /* ---------------- hero line, client index, footer, cookie card ---------------- */

  function setUpRotator() {
    var host = $("[data-rotator]");
    if (!host) return;
    var slot = $("[data-phrase]", host);
    if (!slot || calm()) return;
    var phrases = ["Intelligent products", "Brands with purpose", "Sites that move"];
    var at = 0;
    setInterval(function () {
      slot.classList.add("is-out");
      window.setTimeout(function () {
        at = (at + 1) % phrases.length;
        slot.textContent = phrases[at];
        slot.classList.remove("is-out");
        slot.classList.add("is-in");
        window.setTimeout(function () {
          slot.classList.remove("is-in");
        }, 450);
      }, 450);
    }, 3000);
  }

  function setUpClientIndex() {
    var index = $("[data-client-index]");
    if (!index) return;
    $$(".client-row", index).forEach(function (row) {
      row.addEventListener("pointerenter", function () {
        index.classList.add("is-pointed");
        row.classList.add("is-hot");
      });
      row.addEventListener("pointerleave", function () {
        index.classList.remove("is-pointed");
        row.classList.remove("is-hot");
      });
    });
  }

  function setUpFooter() {
    var footer = $("[data-footer]");
    if (!footer) return;
    if (calm()) {
      footer.style.setProperty("--footer-progress", "1");
      return;
    }
    function step() {
      var box = footer.getBoundingClientRect();
      var start = window.innerHeight;
      var end = window.innerHeight - Math.min(box.height, window.innerHeight * 0.8);
      var progress = (start - box.top) / Math.max(1, start - end);
      footer.style.setProperty("--footer-progress", String(Math.max(0, Math.min(1, progress))));
    }
    step();
    window.addEventListener("scroll", step, { passive: true });
    window.addEventListener("resize", step);
  }

  function setUpCookieCard() {
    var card = $("[data-cookie-card]");
    if (!card) return;
    $$("button[name='choice']", card).forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        var choice = button.value === "accept" ? "accepted" : "rejected";
        document.cookie =
          "np_consent=" + choice + "; path=/; max-age=" + 60 * 60 * 24 * 365 + "; samesite=lax";
        card.remove();
      });
    });
  }

  /* ---------------- menu sheet ---------------- */

  function setUpMenu() {
    var opener = $("[data-menu-open]");
    var sheet = $(".menu-sheet");
    if (!opener || !sheet) return;
    opener.addEventListener("click", function () {
      sheet.showModal();
      var first = $(".menu-link", sheet);
      if (first) first.focus();
    });

    function closeSheet() {
      if (calm()) {
        sheet.close();
        return;
      }
      sheet.classList.add("is-closing");
      window.setTimeout(function () {
        sheet.classList.remove("is-closing");
        sheet.close();
      }, 450);
    }

    $$("[data-menu-close]", sheet).forEach(function (button) {
      button.addEventListener("click", closeSheet);
    });
    sheet.addEventListener("close", function () {
      opener.focus();
    });
    sheet.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeSheet();
    });
  }

  /* ---------------- office clocks ---------------- */

  var CLOCKS = {
    stockholm: {
      zone: "Europe/Stockholm",
      line: function (hour, minute) {
        var word = hour < 12 ? "God morgon" : hour < 18 ? "God eftermiddag" : "God kväll";
        return word + ", klockan är " + String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
      }
    },
    reykjavik: {
      zone: "Atlantic/Reykjavik",
      line: function (hour, minute) {
        var word = hour < 12 ? "Góðan daginn" : hour < 18 ? "Góðan dag" : "Gott kvöld";
        var shown = hour % 12 === 0 ? 12 : hour % 12;
        var suffix = hour < 12 ? "AM" : "PM";
        return word + ", klukkan er " + shown + ":" + String(minute).padStart(2, "0") + " " + suffix;
      }
    }
  };

  function zoneParts(zone) {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date());
    var found = {};
    parts.forEach(function (part) {
      found[part.type] = part.value;
    });
    return { hour: parseInt(found.hour, 10), minute: parseInt(found.minute, 10) };
  }

  function setUpClocks() {
    var hosts = $$("[data-clock]");
    if (!hosts.length) return;
    function tick() {
      hosts.forEach(function (host) {
        var clock = CLOCKS[host.getAttribute("data-clock")];
        if (!clock) return;
        var now = zoneParts(clock.zone);
        var text = clock.line(now.hour, now.minute);
        if (host.textContent.trim() !== text) host.textContent = text;
      });
    }
    tick();
    window.setInterval(tick, 5000);
  }

  /* ---------------- shared time formatting ---------------- */

  function callTimeText(iso) {
    if (!iso) return "";
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Stockholm",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(iso));
    var found = {};
    parts.forEach(function (part) {
      found[part.type] = part.value;
    });
    return found.weekday + " " + found.day + " " + found.month + ", " + found.hour + ":" + found.minute;
  }

  function dateTimeText(iso) {
    var parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Stockholm",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(iso));
    var found = {};
    parts.forEach(function (part) {
      found[part.type] = part.value;
    });
    return (
      found.day + " " + found.month + " " + found.year + ", " + found.hour + ":" + found.minute
    );
  }

  function timeSinceText(iso) {
    var seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago";
    return Math.floor(seconds / 86400) + "d ago";
  }

  /* ---------------- composer ---------------- */

  var EMAIL_OK = function (value) {
    if (!value || /\s/.test(value) || (value.match(/@/g) || []).length !== 1) return false;
    var halves = value.split("@");
    if (!halves[0]) return false;
    var dot = halves[1].indexOf(".");
    return dot > 0 && dot < halves[1].length - 1;
  };

  function setUpComposer() {
    var form = $("[data-composer-form]");
    if (!form) return;
    var status = $("[data-send-status]");
    var send = $("[data-send]", form);
    var message = $("[data-message]", form);
    var counter = $("[data-counter]", form);
    var keyField = $("[data-form-key]", form);
    var pending = false;

    function fieldNode(name) {
      return form.querySelector("[name='" + name + "']");
    }

    function clearErrors() {
      $$(".field-error", form).forEach(function (node) {
        node.remove();
      });
      $$("[aria-invalid='true']", form).forEach(function (node) {
        node.removeAttribute("aria-invalid");
        node.removeAttribute("aria-describedby");
      });
    }

    function values() {
      return {
        name: fieldNode("name").value,
        email: fieldNode("email").value,
        company: fieldNode("company").value,
        services: $$("[data-service]", form)
          .filter(function (box) {
            return box.checked;
          })
          .map(function (box) {
            return box.value;
          }),
        budget: fieldNode("budget").value,
        timeline: fieldNode("timeline").value,
        message: message.value
      };
    }

    function valid() {
      var v = values();
      var length = countCharacters(v.message);
      return (
        countCharacters(v.name) > 0 &&
        countCharacters(v.name) <= 80 &&
        EMAIL_OK(v.email.trim().toLowerCase()) &&
        v.services.length > 0 &&
        !!v.budget &&
        !!v.timeline &&
        length >= 20 &&
        length <= 2000
      );
    }

    function refresh() {
      if (counter) counter.textContent = countCharacters(message.value) + " / 2000";
      send.disabled = pending || !valid();
    }

    function showConfirmation(payload) {
      var panel = el("div", "panel confirmation");
      panel.setAttribute("data-confirmation", "");
      var firstName = values().name.trim().split(" ")[0];
      var head = el("h2", "confirmation-head", "Thanks, " + firstName + ". We have your inquiry.");
      var ref = el("p", "confirmation-ref", "Reference " + payload.reference);
      var hint = el("p", "confirmation-hint", "Keep this link to follow your inquiry:");
      var wrap = el("div", "confirmation-link");
      var field = el("input", "status-link-field");
      field.type = "text";
      field.readOnly = true;
      field.setAttribute("aria-label", "Status link");
      field.setAttribute("data-status-link", "");
      field.value = payload.status_url;
      var copy = el("button", "btn-quiet", "Copy link");
      copy.type = "button";
      copy.setAttribute("data-copy-link", "");
      wrap.appendChild(field);
      wrap.appendChild(copy);
      var openWrap = el("p");
      var open = el("a", "inline-link", "Open status page");
      open.href = "/inquiry/" + payload.status_token;
      openWrap.appendChild(open);
      panel.appendChild(head);
      panel.appendChild(ref);
      panel.appendChild(hint);
      panel.appendChild(wrap);
      panel.appendChild(openWrap);
      form.replaceWith(panel);
      bindCopyLink(panel, status);
      if (status) status.textContent = "Inquiry sent.";
    }

    function submit() {
      if (pending || !valid()) return;
      pending = true;
      refresh();
      clearErrors();
      if (status) status.textContent = "Sending your inquiry...";
      api("POST", "/api/inquiries", values(), keyField.value).then(function (result) {
        if (result.ok) {
          showConfirmation(result.payload);
          return;
        }
        pending = false;
        refresh();
        var refusal = refusalOf(result);
        var target = refusal.field ? fieldNode(refusal.field) : null;
        if (refusal.field === "services") target = $("[data-service]", form);
        if (target) {
          var holder = target.closest(".field") || target.parentNode;
          var note = el("p", "field-error", refusal.message);
          note.id = "err-" + refusal.field;
          holder.appendChild(note);
          target.setAttribute("aria-invalid", "true");
          target.setAttribute("aria-describedby", note.id);
          target.focus();
          if (status) status.textContent = "Check the highlighted field.";
        } else if (status) {
          status.textContent = refusal.message;
        }
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submit();
    });
    form.addEventListener("input", refresh);
    form.addEventListener("change", refresh);

    $$("[data-starter]").forEach(function (card) {
      card.addEventListener("click", function () {
        var picks = card.getAttribute("data-starter").split(",");
        $$("[data-starter]").forEach(function (other) {
          other.setAttribute("aria-pressed", String(other === card));
        });
        $$("[data-service]", form).forEach(function (box) {
          box.checked = picks.indexOf(box.value) !== -1;
        });
        refresh();
        var empty = ["name", "email", "message"].map(fieldNode).filter(function (node) {
          return node && !node.value.trim();
        });
        if (empty.length) empty[0].focus();
      });
    });

    refresh();
  }

  function bindCopyLink(root, status) {
    var button = $("[data-copy-link]", root);
    var field = $("[data-status-link]", root);
    if (!button || !field) return;
    button.addEventListener("click", function () {
      var done = function () {
        if (status) status.textContent = "Link copied.";
      };
      var failed = function () {
        if (status) status.textContent = "Copy the link from the field above.";
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(field.value).then(done, failed);
        return;
      }
      field.select();
      try {
        document.execCommand("copy") ? done() : failed();
      } catch (error) {
        failed();
      }
    });
  }

  /* ---------------- status page recheck ---------------- */

  function setUpStatusPage() {
    var token = document.body.getAttribute("data-status-token");
    if (!token) return;
    var label = $("[data-status-label]");
    var line = $("[data-status-line]");
    var history = $("[data-history]");
    window.setInterval(function () {
      fetch("/inquiry/" + encodeURIComponent(token), { credentials: "same-origin" })
        .then(function (response) {
          return response.ok ? response.text() : Promise.reject(new Error("recheck failed"));
        })
        .then(function (html) {
          var fresh = new DOMParser().parseFromString(html, "text/html");
          var freshLabel = $("[data-status-label]", fresh);
          var freshLine = $("[data-status-line]", fresh);
          var freshHistory = $("[data-history]", fresh);
          if (!freshLabel || !freshLine) return;
          var newText = freshLabel.textContent.trim();
          if (newText === label.textContent.trim()) return;
          if (calm()) label.textContent = newText;
          else retypeLetters(label, newText);
          line.textContent = freshLine.textContent.trim();
          line.classList.remove("is-fading");
          void line.offsetWidth;
          line.classList.add("is-fading");
          if (freshHistory && history) {
            history.innerHTML = freshHistory.innerHTML;
            setUpReveals(history.parentNode);
          }
        })
        .catch(function () {
          /* keep what is shown and try again at the next recheck */
        });
    }, 15000);
  }

  /* ---------------- sign in ---------------- */

  function setUpSignIn() {
    var form = $("[data-signin-form]");
    if (!form) return;
    var status = $("[data-signin-status]");
    var error = $("[data-signin-error]");
    var button = $("[data-signin-submit]", form);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      button.disabled = true;
      if (status) status.textContent = "Signing in...";
      if (error) {
        error.hidden = true;
        error.textContent = "";
      }
      var body = {
        email: form.querySelector("[name='email']").value,
        password: form.querySelector("[name='password']").value
      };
      api("POST", "/api/auth/login", body).then(function (result) {
        button.disabled = false;
        if (result.ok) {
          var next = form.querySelector("[name='next']").value;
          window.location.assign(next && /^\/studio([/?].*)?$/.test(next) ? next : "/studio");
          return;
        }
        var refusal = refusalOf(result);
        if (status) status.textContent = refusal.message;
        if (error) {
          error.textContent = refusal.message;
          error.hidden = false;
        }
      });
    });
  }

  /* ---------------- the studio queue and inquiry ---------------- */

  function labels() {
    var node = $("#np-labels");
    return node ? JSON.parse(node.textContent) : {};
  }

  function setUpStudio() {
    if (!document.body.hasAttribute("data-studio")) return;
    var L = labels();
    var queue = $("[data-queue]");
    var search = $("[data-search]");
    var tablist = $("[data-tablist]");
    var rows = $("[data-rows]");
    var empty = $("[data-queue-empty]");
    var notice = $("[data-queue-notice]");
    var detail = $("[data-detail]");
    var state = { tab: currentTab(), q: search ? search.value : "" };
    var timer = null;

    function currentTab() {
      var selected = $(".tab[aria-selected='true']", tablist);
      return selected ? selected.getAttribute("data-tab") : "new";
    }

    function addressFor(tab, q) {
      var params = new URLSearchParams();
      params.set("status", tab);
      if (q) params.set("q", q);
      return "/studio?" + params.toString();
    }

    function buildRow(row) {
      var item = el("li", "row");
      item.setAttribute("data-row", String(row.id));
      var link = el("a", "row-link");
      link.href = "/studio/inquiries/" + row.id + "?" + addressFor(state.tab, state.q).split("?")[1];
      var top = el("span", "row-top");
      top.appendChild(el("span", "row-ref", row.reference));
      top.appendChild(document.createTextNode(" "));
      top.appendChild(el("span", "row-who", row.name));
      if (row.company) {
        var company = el("span", "row-company", " \u00b7 " + row.company);
        company.setAttribute("aria-hidden", "true");
        top.appendChild(company);
      }
      var when =
        state.tab === "call_booked" && row.call_at
          ? callTimeText(row.call_at)
          : timeSinceText(row.created_at);
      var bottom = el(
        "span",
        "row-bottom",
        row.services
          .map(function (value) {
            return L.services[value];
          })
          .join(", ") +
          " \u00b7 " +
          L.budgets[row.budget] +
          " \u00b7 " +
          when
      );
      bottom.setAttribute("aria-hidden", "true");
      link.appendChild(top);
      link.appendChild(bottom);
      item.appendChild(link);
      item.appendChild(buildPill(row.status, L));
      if (detail && String(row.id) === detail.getAttribute("data-inquiry")) {
        item.classList.add("is-open");
      }
      return item;
    }

    function paintRows(listing) {
      rows.textContent = "";
      listing.inquiries.forEach(function (row) {
        rows.appendChild(buildRow(row));
      });
      if (empty) empty.hidden = listing.inquiries.length > 0;
      setUpReveals(rows.parentNode);
    }

    function paintCounts(listing) {
      Object.keys(listing.counts).forEach(function (key) {
        var cell = $("[data-count='" + key + "']", tablist);
        if (!cell) return;
        var next = String(listing.counts[key]);
        if (cell.textContent !== next) {
          cell.textContent = next;
          cell.classList.remove("is-fading");
          void cell.offsetWidth;
          cell.classList.add("is-fading");
        }
      });
      $$(".tab", tablist).forEach(function (tab) {
        tab.setAttribute("aria-selected", String(tab.getAttribute("data-tab") === state.tab));
        tab.classList.toggle("is-selected", tab.getAttribute("data-tab") === state.tab);
        tab.href = addressFor(tab.getAttribute("data-tab"), state.q);
      });
    }

    function load(push, countsOnly) {
      var params = new URLSearchParams();
      params.set("status", state.tab);
      if (state.q) params.set("q", state.q);
      return api("GET", "/api/studio/inquiries?" + params.toString()).then(function (result) {
        if (!result.ok) {
          var refusal = refusalOf(result);
          if (notice) {
            notice.textContent = refusal.message;
            notice.hidden = false;
          }
          return null;
        }
        if (notice) {
          notice.hidden = true;
          notice.textContent = "";
        }
        paintCounts(result.payload);
        if (!countsOnly) paintRows(result.payload);
        if (push) {
          var address = addressFor(state.tab, state.q);
          if (address !== window.location.pathname + window.location.search) {
            window.history.pushState({ tab: state.tab, q: state.q }, "", address);
          }
        }
        return result.payload;
      });
    }

    if (search) {
      search.addEventListener("input", function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(function () {
          state.q = search.value;
          load(true);
        }, 250);
      });
      var searchForm = $("[data-search-form]");
      if (searchForm) {
        searchForm.addEventListener("submit", function (event) {
          event.preventDefault();
          window.clearTimeout(timer);
          state.q = search.value;
          load(true);
        });
      }
    }

    if (tablist) {
      $$(".tab", tablist).forEach(function (tab) {
        tab.addEventListener("click", function (event) {
          event.preventDefault();
          state.tab = tab.getAttribute("data-tab");
          load(true);
        });
      });
    }

    window.addEventListener("popstate", function () {
      if (window.location.pathname !== "/studio") return;
      var params = new URLSearchParams(window.location.search);
      state.tab = params.get("status") || "new";
      state.q = params.get("q") || "";
      if (search) search.value = state.q;
      load(false);
    });

    if (detail) setUpDetail(detail, L, load, state);
  }

  function buildPill(status, L) {
    var pill = el("span", "pill pill-" + status);
    var dot = el("span", "pill-dot");
    dot.setAttribute("aria-hidden", "true");
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(L.status[status]));
    return pill;
  }

  function setUpDetail(detail, L, reloadQueue, state) {
    var heading = $("[data-status-heading]", detail);
    var actions = $("[data-actions]", detail);
    var alertBanner = $("[data-action-alert]", detail);
    var actionStatus = $("[data-action-status]", detail);
    var callTime = $("[data-call-time]", detail);
    var history = $("[data-detail-history]", detail);
    var callInput = $("[data-call-input]", detail);
    var callError = $("[data-call-error]", detail);
    var reasonInput = $("[data-reason-input]", detail);
    var reasonError = $("[data-reason-error]", detail);
    var keys = {};
    var openAction = null;

    function panelFor(action) {
      return detail.querySelector("[data-panel='" + action + "']");
    }

    function needsPanel(action) {
      return action === "book_call" || action === "reschedule_call" || action === "decline";
    }

    function clearFieldError(node, holder) {
      if (!node || !holder) return;
      node.removeAttribute("aria-invalid");
      node.removeAttribute("aria-describedby");
      holder.hidden = true;
      holder.textContent = "";
    }

    function showFieldError(node, holder, message) {
      if (!node || !holder) return;
      holder.textContent = message;
      holder.hidden = false;
      node.setAttribute("aria-invalid", "true");
      node.setAttribute("aria-describedby", holder.id);
      node.focus();
    }

    function closePanels(fold) {
      $$("[data-panel]", detail).forEach(function (panel) {
        if (panel.hidden) return;
        if (fold && !calm()) {
          panel.classList.add("is-folding");
          window.setTimeout(function () {
            panel.classList.remove("is-folding");
            panel.hidden = true;
          }, 450);
        } else {
          panel.hidden = true;
        }
      });
      clearFieldError(callInput, callError);
      clearFieldError(reasonInput, reasonError);
      openAction = null;
    }

    function hideAlert() {
      if (alertBanner) {
        alertBanner.hidden = true;
        alertBanner.textContent = "";
      }
    }

    function showAlert(message) {
      if (!alertBanner) return;
      alertBanner.textContent = message;
      alertBanner.hidden = false;
    }

    function buttonFor(action) {
      return actions.querySelector("[data-action='" + action + "']");
    }

    function openPanel(action) {
      closePanels(false);
      hideAlert();
      var panel = panelFor(action);
      if (!panel) return;
      panel.hidden = false;
      openAction = action;
      if (action === "decline") {
        reasonInput.value = "";
        reasonInput.focus();
      } else {
        callInput.value = "";
        callInput.focus();
      }
    }

    function keyFor(action) {
      if (!keys[action]) keys[action] = randomKey();
      return keys[action];
    }

    function setBusy(busy) {
      $$("[data-action]", actions).forEach(function (button) {
        button.disabled = busy;
      });
      $$("[data-confirm]", detail).forEach(function (button) {
        button.disabled = busy;
      });
    }

    function repaintActions(payload) {
      actions.textContent = "";
      payload.allowed_actions.forEach(function (action) {
        var button = el("button", "btn-solid action-button", L.actions[action]);
        button.type = "button";
        button.setAttribute("data-action", action);
        button.addEventListener("click", function () {
          run(action);
        });
        actions.appendChild(button);
      });
      var callPanel = panelFor("book_call") || panelFor("reschedule_call");
      if (callPanel) {
        var next =
          payload.allowed_actions.indexOf("reschedule_call") !== -1 ? "reschedule_call" : "book_call";
        callPanel.setAttribute("data-panel", next);
        callPanel.setAttribute("aria-label", L.actions[next]);
      }
    }

    function repaint(payload, action) {
      detail.setAttribute("data-version", String(payload.version));
      var pill = buildPill(payload.status, L);
      heading.textContent = "";
      heading.appendChild(pill);
      if (!calm()) pill.classList.add("is-fading");
      if (callTime) {
        if (payload.call_at) {
          callTime.hidden = false;
          callTime.textContent = "Call " + callTimeText(payload.call_at) + " Stockholm time";
        } else {
          callTime.hidden = true;
          callTime.textContent = "";
        }
      }
      if (history) {
        var latest = payload.history[payload.history.length - 1];
        var item = el("li", "history-item");
        item.appendChild(el("span", "history-status", L.actions[latest.action] || "Inquiry sent"));
        item.appendChild(el("span", "history-when", dateTimeText(latest.created_at)));
        item.appendChild(el("span", "history-actor", latest.actor_name || "Visitor"));
        if (!calm()) {
          item.classList.add("rise");
          history.appendChild(item);
          requestAnimationFrame(function () {
            item.classList.add("is-risen");
          });
        } else {
          history.appendChild(item);
        }
      }
      repaintActions(payload);
      if (actionStatus) {
        actionStatus.textContent =
          action === "reschedule_call"
            ? "Call moved to " + callTimeText(payload.call_at) + "."
            : "Status changed to " + L.status[payload.status] + ".";
      }
      closePanels(true);
      heading.focus();
      if (state.tab !== "all" && payload.status !== state.tab) {
        var row = document.querySelector("[data-row='" + detail.getAttribute("data-inquiry") + "']");
        if (row) {
          row.classList.add("is-leaving");
          window.setTimeout(function () {
            row.remove();
          }, calm() ? 0 : 450);
        }
      }
      reloadQueue(false, true);
    }

    function run(action) {
      if (needsPanel(action)) {
        openPanel(action);
        return;
      }
      confirmAction(action);
    }

    function confirmAction(action) {
      hideAlert();
      var body = { action: action, version: Number(detail.getAttribute("data-version")) };
      if (action === "book_call" || action === "reschedule_call") {
        body.call_at = callInput.value;
        clearFieldError(callInput, callError);
      }
      if (action === "decline") {
        body.decline_reason = reasonInput.value;
        clearFieldError(reasonInput, reasonError);
      }
      setBusy(true);
      if (actionStatus) actionStatus.textContent = "Saving...";
      api(
        "POST",
        "/api/studio/inquiries/" + detail.getAttribute("data-inquiry") + "/transition",
        body,
        keyFor(action)
      ).then(function (result) {
        setBusy(false);
        if (result.ok) {
          repaint(result.payload, action);
          keys[action] = null;
          return;
        }
        var refusal = refusalOf(result);
        if (actionStatus) actionStatus.textContent = "";
        if (refusal.field === "call_at") {
          showFieldError(callInput, callError, refusal.message);
          return;
        }
        if (refusal.field === "decline_reason") {
          showFieldError(reasonInput, reasonError, refusal.message);
          return;
        }
        showAlert(refusal.message);
        var button = buttonFor(action);
        if (button) button.focus();
      });
    }

    $$("[data-action]", actions).forEach(function (button) {
      button.addEventListener("click", function () {
        run(button.getAttribute("data-action"));
      });
    });

    $$("[data-confirm]", detail).forEach(function (button) {
      button.addEventListener("click", function () {
        confirmAction(button.closest("[data-panel]").getAttribute("data-panel"));
      });
    });

    detail.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && openAction) {
        var action = openAction;
        closePanels(false);
        var button = buttonFor(action);
        if (button) button.focus();
        return;
      }
      if (event.key === "Enter" && event.target === callInput) {
        event.preventDefault();
        confirmAction(callInput.closest("[data-panel]").getAttribute("data-panel"));
      }
    });

    setUpNotes(detail);
  }

  function setUpNotes(detail) {
    var input = $("[data-note-input]", detail);
    var button = $("[data-add-note]", detail);
    var status = $("[data-note-status]", detail);
    var error = $("[data-note-error]", detail);
    var list = $("[data-notes]", detail);
    if (!input || !button) return;
    button.addEventListener("click", function () {
      button.disabled = true;
      error.hidden = true;
      error.textContent = "";
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      if (status) status.textContent = "Adding note...";
      api("POST", "/api/studio/inquiries/" + detail.getAttribute("data-inquiry") + "/notes", {
        body: input.value
      }).then(function (result) {
        button.disabled = false;
        if (result.ok) {
          var item = el("li", "note");
          item.appendChild(
            el(
              "p",
              "note-meta",
              result.payload.author_name + " · " + dateTimeText(result.payload.created_at)
            )
          );
          item.appendChild(el("p", "note-body", result.payload.body));
          list.insertBefore(item, list.firstChild);
          input.value = "";
          if (status) status.textContent = "Note added.";
          return;
        }
        var refusal = refusalOf(result);
        if (refusal.field === "body") {
          error.textContent = refusal.message;
          error.hidden = false;
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", error.id);
          input.focus();
          if (status) status.textContent = "";
        } else if (status) {
          status.textContent = refusal.message;
        }
      });
    });
  }

  /* ---------------- start ---------------- */

  function boot() {
    setUpReveals(document);
    setUpRotator();
    setUpClientIndex();
    setUpFooter();
    setUpCookieCard();
    setUpMenu();
    setUpClocks();
    setUpComposer();
    bindCopyLink(document, $("[data-send-status]"));
    setUpStatusPage();
    setUpSignIn();
    setUpStudio();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
