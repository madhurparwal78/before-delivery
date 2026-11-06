/* Ivo Kastrel — progressive JavaScript. Every fetch goes to this origin only. */
(function () {
  "use strict";

  var THanks = "Thanks, your message is in. I reply within two working days.";
  var SENDING = "Sending your message…";
  var FAIL = "Your message could not be sent. Try again in a minute.";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------------------------------------------------------- motion state */

  function motionOn() {
    return localStorage.getItem("motion") !== "off";
  }

  function applyMotion() {
    var on = motionOn();
    document.body.classList.toggle("motion-on", on && !reducedMotion.matches);
    document.body.classList.toggle("motion-off", !on || reducedMotion.matches);
    document.querySelectorAll(".motion-button").forEach(function (button) {
      button.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function initMotionButton() {
    var button = document.querySelector(".motion-button");
    if (!button) return;
    button.addEventListener("click", function () {
      localStorage.setItem("motion", motionOn() ? "off" : "on");
      applyMotion();
    });
  }

  /* ---------------------------------------------------------- intro cover */

  function initIntroCover() {
    var cover = document.querySelector("[data-intro-cover]");
    if (!cover || sessionStorage.getItem("intro-played") || reducedMotion.matches) {
      if (cover) cover.remove();
      return;
    }
    cover.hidden = false;
    sessionStorage.setItem("intro-played", "1");
    window.setTimeout(function () { cover.classList.add("lifted"); }, 900);
    window.setTimeout(function () { cover.remove(); }, 1800);
  }

  /* ---------------------------------------------------------- split reveals */

  function splitHeading(heading) {
    var text = heading.textContent.trim();
    heading.setAttribute("aria-label", text);
    heading.textContent = "";
    text.split(/\s+/).forEach(function (word, index) {
      var span = document.createElement("span");
      span.className = "split-word";
      span.textContent = word;
      span.setAttribute("aria-hidden", "true");
      if (!reducedMotion.matches && motionOn()) {
        span.style.animationDelay = (index * 0.09) + "s";
      }
      heading.appendChild(span);
      heading.appendChild(document.createTextNode(" "));
    });
  }

  function initSplitReveals() {
    var headings = document.querySelectorAll("[data-split]");
    if (!headings.length || !("IntersectionObserver" in window)) {
      headings.forEach(function (h) { splitHeading(h); });
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("split-in");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    headings.forEach(function (heading) {
      splitHeading(heading);
      if (reducedMotion.matches || !motionOn()) {
        heading.classList.add("split-in");
      } else {
        heading.classList.add("reveal-pending");
        observer.observe(heading);
      }
    });
  }

  /* ---------------------------------------------------------- hero statement */

  function initHeroSlide() {
    var statement = document.querySelector("[data-hero-statement]");
    var hero = document.querySelector(".hero");
    if (!statement || !hero) return;
    if ("IntersectionObserver" in window) {
      var live = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          hero.classList.toggle("hero-live", entry.isIntersecting);
        });
      });
      live.observe(hero);
      var rail = document.querySelector(".rail");
      if (rail) {
        var railLive = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            rail.classList.toggle("rail-live", entry.isIntersecting);
          });
        });
        railLive.observe(rail);
      }
      var process = document.querySelector(".process-steps");
      if (process) {
        var processLive = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            process.classList.toggle("process-live", entry.isIntersecting);
          });
        });
        processLive.observe(process);
      }
    } else {
      hero.classList.add("hero-live");
      var railEl = document.querySelector(".rail");
      if (railEl) railEl.classList.add("rail-live");
      var processEl = document.querySelector(".process-steps");
      if (processEl) processEl.classList.add("process-live");
    }
    function onScroll() {
      if (reducedMotion.matches || !motionOn()) {
        statement.style.transform = "";
        return;
      }
      var rect = hero.getBoundingClientRect();
      var height = rect.height;
      var scrolled = Math.min(Math.max(-rect.top, 0), height);
      var progress = height ? scrolled / height : 0;
      var shift = progress * (window.innerWidth * 0.25);
      statement.style.transform = "translateX(" + (-shift) + "px)";
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------------------------------------------------------- menu */

  function initMenu() {
    var button = document.querySelector(".menu-button");
    var nav = document.getElementById("main-nav");
    if (!button || !nav) return;
    button.hidden = false;
    function setOpen(open) {
      nav.classList.toggle("open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    }
    button.addEventListener("click", function () {
      setOpen(!nav.classList.contains("open"));
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("open")) {
        setOpen(false);
        button.focus();
      }
    });
  }

  /* ---------------------------------------------------------- inquiry dialog */

  function trapFocus(dialog) {
    dialog.addEventListener("keydown", function (event) {
      if (event.key !== "Tab") return;
      var focusables = dialog.querySelectorAll(
        "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
  }

  function resetInquiryForm(form) {
    if (!form) return;
    form.reset();
    form.querySelectorAll(".field, .submit-button").forEach(function (el) { el.hidden = false; });
    form.querySelectorAll(".field-message").forEach(function (p) { p.textContent = ""; });
    form.querySelectorAll(".field.invalid").forEach(function (f) { f.classList.remove("invalid"); });
    var status = form.querySelector("[data-inquiry-status]");
    if (status) { status.textContent = ""; status.classList.remove("thanks"); }
    var alertBox = form.querySelector("[data-inquiry-errors]");
    if (alertBox) alertBox.hidden = true;
    var list = form.querySelector("[data-inquiry-error-list]");
    if (list) list.textContent = "";
  }

  function initConnectDialog() {
    var opener = document.querySelector("[data-connect]");
    var dialogRoot = document.querySelector("[data-dialog]");
    if (!opener || !dialogRoot) return;
    var panel = dialogRoot.querySelector(".connect-panel");
    trapFocus(panel);
    function open() {
      dialogRoot.hidden = false;
      resetInquiryForm(panel.querySelector("[data-inquiry-form]"));
      var name = panel.querySelector("input[name='name']");
      if (name) name.focus();
    }
    function close() {
      dialogRoot.hidden = true;
      opener.focus();
    }
    opener.addEventListener("click", open);
    dialogRoot.querySelectorAll("[data-dialog-close]").forEach(function (b) {
      b.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !dialogRoot.hidden) close();
    });
    dialogRoot.addEventListener("click", function (event) {
      if (event.target === dialogRoot) close();
    });
  }

  /* ---------------------------------------------------------- inquiry forms */

  function fieldWrap(form, name) {
    var input = form.querySelector("[name='" + name + "']");
    if (!input) return null;
    return input.closest(".field");
  }

  function clearErrors(form) {
    form.querySelectorAll(".field-message").forEach(function (p) { p.textContent = ""; });
    form.querySelectorAll(".field.invalid").forEach(function (f) { f.classList.remove("invalid"); });
    form.querySelectorAll("input, textarea, select").forEach(function (i) {
      i.removeAttribute("aria-invalid");
    });
    var alertBox = form.querySelector("[data-inquiry-errors]");
    if (alertBox) alertBox.hidden = true;
  }

  function showErrors(form, errors) {
    clearErrors(form);
    var alertBox = form.querySelector("[data-inquiry-errors]");
    var list = form.querySelector("[data-inquiry-error-list]");
    if (!alertBox || !list) return;
    list.textContent = "";
    Object.keys(errors).forEach(function (name) {
      var wrap = fieldWrap(form, name);
      if (wrap) {
        wrap.classList.add("invalid");
        var message = wrap.querySelector("[data-field-message]");
        if (message) message.textContent = errors[name];
        var input = wrap.querySelector("input, textarea, select");
        if (input) input.setAttribute("aria-invalid", "true");
      }
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = "#";
      link.textContent = name;
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var target = form.querySelector("[name='" + name + "']");
        if (target) target.focus();
      });
      item.appendChild(link);
      list.appendChild(item);
    });
    alertBox.hidden = false;
  }

  function showThanks(form) {
    var status = form.querySelector("[data-inquiry-status]");
    if (!status) return;
    form.querySelectorAll(".field, .submit-button").forEach(function (el) { el.hidden = true; });
    status.textContent = THanks;
    status.setAttribute("tabindex", "-1");
    status.classList.add("thanks");
    status.focus();
  }

  function initInquiryForms() {
    document.querySelectorAll("[data-inquiry-form]").forEach(function (form) {
      var status = form.querySelector("[data-inquiry-status]");
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var submit = form.querySelector("button[type='submit']");
        submit.disabled = true;
        if (status) status.textContent = SENDING;
        var payload = {};
        ["name", "phone", "email", "message"].forEach(function (name) {
          payload[name] = form.querySelector("[name='" + name + "']").value;
        });
        var type = form.querySelector("[name='project_type']");
        if (type && type.value) payload.project_type = type.value;
        fetch("/api/inquiries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        }).then(function (response) {
          submit.disabled = false;
          if (response.status === 201 || response.status === 200) {
            clearErrors(form);
            showThanks(form);
            return null;
          }
          return response.json().then(function (data) {
            if (data && data.errors) {
              showErrors(form, data.errors);
            } else {
              var alertBox = form.querySelector("[data-inquiry-errors]");
              if (alertBox) {
                alertBox.hidden = false;
                alertBox.textContent = FAIL;
              }
            }
          });
        }).catch(function () {
          submit.disabled = false;
          var alertBox = form.querySelector("[data-inquiry-errors]");
          if (alertBox) { alertBox.hidden = false; alertBox.textContent = FAIL; }
        });
      });
    });
  }

  /* ---------------------------------------------------------- discipline filter */

  function initFilter() {
    var list = document.querySelector("[data-work-list]");
    var filter = document.querySelector(".discipline-filter");
    if (!list || !filter) return;
    filter.addEventListener("click", function (event) {
      var link = event.target.closest("a");
      if (!link) return;
      event.preventDefault();
      var url = link.getAttribute("href");
      fetch("/api/cases" + (url.includes("?") ? url.slice(url.indexOf("?")) : ""))
        .then(function (response) { return response.json(); })
        .then(function (cases) { pushState(url); renderCards(cases, url); })
        .catch(function () { window.location.href = url; });
    });
    window.addEventListener("popstate", function () {
      var url = new URL(window.location.href);
      var discipline = url.searchParams.get("discipline");
      fetch("/api/cases" + (discipline ? "?discipline=" + encodeURIComponent(discipline) : ""))
        .then(function (response) { return response.json(); })
        .then(function (cases) { renderCards(cases, window.location.pathname + window.location.search); })
        .catch(function () { window.location.reload(); });
    });
    function pushState(url) {
      window.history.pushState({}, "", url);
    }
    function renderCards(cases, urlForMarker) {
      var labels = { "ui-ux": "UI/UX", "3d-web": "3D WEB", "frontend": "FRONTEND" };
      list.textContent = "";
      cases.forEach(function (one) {
        var li = document.createElement("li");
        li.className = "work-card";
        var anchor = document.createElement("a");
        anchor.href = "/work/" + one.slug;
        ["ordinal", "title", "discipline", "summary"].forEach(function (part) {
          var span = document.createElement("span");
          span.className = "card-" + part;
          span.textContent = part === "discipline" ? labels[one.discipline] : one[part];
          anchor.appendChild(span);
        });
        var cover = document.createElement("span");
        cover.className = "card-cover";
        cover.setAttribute("aria-hidden", "true");
        cover.style.background = coverStyle(one.slug);
        anchor.appendChild(cover);
        li.appendChild(anchor);
        list.appendChild(li);
      });
      var status = document.querySelector("[data-catalogue-status]");
      if (status) {
        status.textContent = cases.length === 1 ? "1 case study shown." : cases.length + " case studies shown.";
      }
      filter.querySelectorAll("a").forEach(function (a) {
        a.removeAttribute("aria-current");
      });
      var marker = urlForMarker || (window.location.pathname + window.location.search);
      var current = filter.querySelector("a[href='" + marker + "']");
      if (!current && marker === "/work") current = filter.querySelector("a[href='/work']");
      if (current) current.setAttribute("aria-current", "true");
    }
  }

  /* ---------------------------------------------------------- generated covers */

  function hashSeed(text) {
    var hash = 5381;
    for (var i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
    }
    return hash;
  }

  function coverStyle(seedText) {
    var seed = hashSeed(seedText);
    var angle = (seed % 90) + 110;
    var cx = 20 + (seed % 40);
    var cy = 20 + ((seed >> 3) % 40);
    return "linear-gradient(" + angle + "deg, #6d0d1c, #2a0810 60%, #14060a)," +
      " radial-gradient(circle at " + cx + "% " + cy + "%, rgba(230,32,58,0.55), transparent 58%)";
  }

  function initGeneratedCovers() {
    document.querySelectorAll("[data-generated-visual]").forEach(function (el) {
      el.style.background = coverStyle(el.getAttribute("data-generated-visual"));
    });
  }

  /* ---------------------------------------------------------- studio */

  function studioToken() {
    return sessionStorage.getItem("studio-token");
  }

  function studioFetch(path, options) {
    options = options || {};
    options.headers = Object.assign({ "Authorization": "Bearer " + studioToken() }, options.headers || {});
    return fetch(path, options).then(function (response) {
      if (response.status === 401) {
        sessionStorage.removeItem("studio-token");
        window.location.href = "/studio/login";
        return null;
      }
      return response;
    });
  }

  function initLogin() {
    var form = document.querySelector("[data-login-form]");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = form.querySelector("button[type='submit']");
      button.disabled = true;
      button.textContent = "Signing in…";
      var alertBox = form.querySelector("[data-signin-errors]");
      fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.querySelector("[name='email']").value,
          password: form.querySelector("[name='password']").value
        })
      }).then(function (response) {
        button.disabled = false;
        button.textContent = "Sign in";
        if (response.ok) {
          return response.json().then(function (data) {
            sessionStorage.setItem("studio-token", data.token);
            window.location.href = "/studio";
          });
        }
        if (response.status === 429 || response.status === 401) {
          return response.json().then(function (data) {
            alertBox.hidden = false;
            alertBox.textContent = data.error;
          });
        }
        alertBox.hidden = false;
        alertBox.textContent = "Sign-in is unavailable. Try again in a minute.";
      }).catch(function () {
        button.disabled = false;
        button.textContent = "Sign in";
        alertBox.hidden = false;
        alertBox.textContent = "Sign-in is unavailable. Try again in a minute.";
      });
    });
  }

  function initStudio() {
    var section = document.querySelector(".studio-section");
    if (!section) return;
    if (!studioToken()) { window.location.href = "/studio/login"; return; }

    var statusBox = section.querySelector("[data-studio-status]");
    var errorBox = section.querySelector("[data-studio-errors]");
    var casesRows = section.querySelector("[data-cases-rows]");
    var inquiriesList = section.querySelector("[data-inquiries-list]");
    var editor = section.querySelector("[data-case-editor]");
    var editingId = null;

    function setStatus(text) { if (statusBox) statusBox.textContent = text; }
    function setError(text) { if (errorBox) { errorBox.hidden = false; errorBox.textContent = text; } }

    function loadCases() {
      return studioFetch("/api/studio/cases").then(function (response) {
        if (!response) return null;
        return response.json();
      }).then(function (rows) {
        if (rows == null) return;
        casesRows.textContent = "";
        section.querySelector("[data-cases-empty]").hidden = rows.length > 0;
        rows.forEach(function (row) { casesRows.appendChild(renderCaseRow(row)); });
      });
    }

    function renderCaseRow(row) {
      var tr = document.createElement("tr");
      [["title", row.title], ["slug", row.slug], ["discipline", row.discipline],
       ["state", row.published ? "Published" : "Draft"],
       ["featured", row.featured ? "Yes" : "No"], ["position", row.position]].forEach(function (pair) {
        var td = document.createElement("td");
        td.className = "row-" + pair[0];
        td.textContent = pair[1];
        tr.appendChild(td);
      });
      var actions = document.createElement("td");
      actions.className = "row-actions";
      function action(label, handler) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "studio-action";
        button.textContent = label.split(" ")[0];
        button.setAttribute("aria-label", label + " " + row.title);
        button.addEventListener("click", handler);
        actions.appendChild(button);
      }
      action("Edit " + row.title, function () { openEditor(row); });
      if (row.published) {
        action("Unpublish " + row.title, function () { publish(row, false); });
      } else {
        action("Publish " + row.title, function () { publish(row, true); });
      }
      action("Delete " + row.title, function () { remove(row); });
      tr.appendChild(actions);
      return tr;
    }

    function loadInquiries() {
      return studioFetch("/api/studio/inquiries").then(function (response) {
        if (!response) return null;
        return response.json();
      }).then(function (rows) {
        if (rows == null) return;
        inquiriesList.textContent = "";
        section.querySelector("[data-inquiries-empty]").hidden = rows.length > 0;
        rows.forEach(function (row) {
          var li = document.createElement("li");
          var parts = [
            row.name, row.email, row.phone,
            row.project_type || "", row.message,
            new Date(row.received_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' }),
            row.status === "resolved" ? "Resolved" : "New"
          ].filter(Boolean);
          parts.forEach(function (text, index) {
            var p = document.createElement("p");
            if (index === 4) p.className = "inquiry-message";
            if (index === 6) p.className = "inquiry-status";
            p.textContent = text;
            li.appendChild(p);
          });
          if (row.status === "new") {
            var button = document.createElement("button");
            button.type = "button";
            button.className = "studio-action";
            button.textContent = "Mark resolved";
            button.setAttribute("aria-label", "Mark resolved " + row.name);
            button.addEventListener("click", function () { resolve(row, button); });
            li.appendChild(button);
          }
          inquiriesList.appendChild(li);
        });
      });
    }

    function resolve(row, button) {
      button.disabled = true;
      studioFetch("/api/studio/inquiries/" + row.id + "/resolve", { method: "POST" })
        .then(function (response) {
          if (!response) return;
          if (response.ok) { setStatus("Marked resolved."); return loadInquiries(); }
          return response.json().then(function (data) {
            setError(data.error || "That change could not be saved. Try again in a minute.");
            return loadInquiries();
          });
        });
    }

    function publish(row, target) {
      studioFetch("/api/studio/cases/" + row.id + "/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published: target })
      }).then(function (response) {
        if (!response) return;
        if (response.ok) { setStatus(target ? "Published." : "Unpublished."); return loadCases(); }
        return response.json().then(function (data) {
          setError(data.error || "That change could not be saved. Try again in a minute.");
          return loadCases();
        });
      });
    }

    function remove(row) {
      studioFetch("/api/studio/cases/" + row.id, { method: "DELETE" })
        .then(function (response) {
          if (!response) return;
          if (response.ok) { setStatus("Deleted."); return loadCases(); }
          return response.json().then(function (data) { setError(data.error); });
        });
    }

    function openEditor(row) {
      editingId = row ? row.id : null;
      editor.hidden = false;
      editor.querySelector("[data-editor-title]").textContent =
        row ? "Case study editor" : "Case study editor";
      var saveButton = editor.querySelector("[data-editor-save]");
      saveButton.textContent = row ? "Save" : "Save draft";
      var slugInput = editor.querySelector("[name='slug']");
      var slugStatic = editor.querySelector("[data-slug-static]");
      if (row) {
        slugInput.hidden = true;
        slugStatic.hidden = false;
        slugStatic.textContent = row.slug;
      } else {
        slugInput.hidden = false;
        slugStatic.hidden = true;
      }
      ["title", "summary", "challenge", "approach", "outcome", "stack"].forEach(function (name) {
        editor.querySelector("[name='" + name + "']").value = row ? row[name] : "";
      });
      editor.querySelector("[name='discipline']").value = row ? row.discipline : "ui-ux";
      editor.querySelector("[name='year']").value = row ? row.year : "";
      editor.querySelector("[name='position']").value = row ? row.position : "";
      editor.querySelector("[name='featured']").value = row && row.featured ? "true" : "false";
    }

    function editorPayload() {
      var payload = {};
      ["title", "slug", "summary", "challenge", "approach", "outcome", "stack"].forEach(function (name) {
        var field = editor.querySelector("[name='" + name + "']");
        if (field && !field.hidden && field.value !== "") payload[name] = field.value;
      });
      var discipline = editor.querySelector("[name='discipline']");
      payload.discipline = discipline.value;
      var year = editor.querySelector("[name='year']");
      if (year.value !== "") payload.year = parseInt(year.value, 10);
      var position = editor.querySelector("[name='position']");
      if (position.value !== "") payload.position = parseInt(position.value, 10);
      payload.featured = editor.querySelector("[name='featured']").value === "true";
      return payload;
    }

    function saveEditor(event) {
      event.preventDefault();
      var saveButton = editor.querySelector("[data-editor-save]");
      saveButton.disabled = true;
      var payload = editorPayload();
      var request;
      if (editingId === null) {
        request = studioFetch("/api/studio/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        request = studioFetch("/api/studio/cases/" + editingId, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      request.then(function (response) {
        saveButton.disabled = false;
        if (!response) return;
        if (response.ok) {
          setStatus(editingId === null ? "Draft created." : "Saved.");
          editingId = null;
          editor.hidden = true;
          return loadCases();
        }
        return response.json().then(function (data) {
          if (data && data.errors) {
            setError("Check the highlighted fields.");
            Object.keys(data.errors).forEach(function (name) {
              var message = editor.querySelector("[data-field-message='" + name + "']");
              if (message) message.textContent = data.errors[name];
            });
          } else {
            setError(data.error || "That change could not be saved. Try again in a minute.");
          }
        });
      });
    }

    var createButton = section.querySelector("[data-create-draft]");
    if (createButton) createButton.addEventListener("click", function () { openEditor(null); });
    if (editor) editor.addEventListener("submit", saveEditor);

    var signOut = section.querySelector("[data-sign-out]");
    if (signOut) signOut.addEventListener("click", function () {
      studioFetch("/api/auth/logout", { method: "POST" }).then(function () {
        sessionStorage.removeItem("studio-token");
        window.location.href = "/studio/login";
      });
    });

    loadCases();
    loadInquiries();
  }

  /* ---------------------------------------------------------- boot */

  document.addEventListener("DOMContentLoaded", function () {
    applyMotion();
    initMotionButton();
    initIntroCover();
    initSplitReveals();
    initHeroSlide();
    initMenu();
    initConnectDialog();
    initInquiryForms();
    initFilter();
    initGeneratedCovers();
    initLogin();
    initStudio();
  });
})();
