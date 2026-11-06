/* Rungmark Rollout Ladder console. The server decides every limit: this
   code never trims, cuts short, blocks or rejects a value on its own. It
   sends exactly what is in its fields and shows exactly what the flag
   detail, evidence pack and promotion list routes last returned.

   The console is built once and then updated in place, so a reload never
   moves the operator's place on the page, never steals focus and never
   clears a field the operator is using. */

(function () {
  "use strict";

  var root = document.getElementById("console-root");
  if (!root) return;

  var flagCodes = (root.dataset.flagCodes || "").split(",").filter(Boolean);
  var cohortCodes = (root.dataset.cohortCodes || "").split(",").filter(Boolean);
  var deviceCodes = (root.dataset.deviceCodes || "").split(",").filter(Boolean);

  var state = {
    flags: {},
    packs: [],
    promotions: []
  };
  var cohortDetails = [];
  var inFlight = 0;

  // ---- API helpers ----

  function api(path, options) {
    return fetch(path, options).then(function (response) {
      return response.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
        return { status: response.status, body: body };
      });
    }, function () {
      return { status: 0, body: null }; // no response at all
    });
  }

  function randomKey() {
    var alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    var key = "rungl-";
    for (var i = 0; i < 20; i++) {
      key += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return key;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function none(value) {
    if (value === null || value === undefined || value === "") return "none";
    return String(value);
  }

  function rungCell(list) {
    if (!list || list.length === 0) return "none";
    return list.join(", ");
  }

  function fieldErrorMessage(errors) {
    var names = Object.keys(errors).sort();
    var lines = names.map(function (name) { return name + ": " + errors[name]; });
    return "Not accepted:" + (lines.length ? "\n" + lines.join("\n") : "");
  }

  // ---- build ----

  var refs = {
    flags: {},       // flag_code -> {rungs: [card elements], alert, cohort, reference, buttons}
    settingsAlert: null,
    eventForm: null,
    eventAlert: null,
    eventCode: null,
    packsBody: null,
    historyBody: null,
    status: null,
    maxInputs: {},   // flag_code -> input
    soakInputs: {}   // cohort_code -> input
  };

  function stateClass(stateWord) {
    return "state-" + stateWord.toLowerCase().replace(" ", "-");
  }

  function buildFlagRegion(detail) {
    var region = el("section", "flag-region");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", detail.flag_label);
    region.appendChild(el("h2", null, detail.flag_label));

    var ladder = el("ul", "ladder");
    ladder.setAttribute("aria-label", "Ladder");
    var cards = [];
    detail.rungs.forEach(function () { cards.push(null); });

    detail.rungs.forEach(function (rung, index) {
      var li = el("li", "rung-card");
      var title = el("p", "rung-title");
      li.appendChild(title);
      var head = el("p", "rung-head");
      var stateWord = el("span", "state-word", "");
      head.appendChild(stateWord);
      var attestedWord = el("span", "attested-word", "");
      head.appendChild(attestedWord);
      li.appendChild(head);
      li.appendChild(el("p", "rung-promotion"));
      li.appendChild(el("p", "rung-soak"));
      li.appendChild(el("p", "rung-rate"));
      li.appendChild(el("p", "rung-attestation"));
      cards[index] = { li: li, title: title, stateWord: stateWord, attestedWord: attestedWord };
      ladder.appendChild(li);
    });
    region.appendChild(ladder);

    var form = el("form", "promote-form");
    var cohort = el("select");
    cohort.setAttribute("aria-label", "Target cohort");
    // The five cohorts, by label.
    cohortCodes.forEach(function (code) {
      var option = el("option", null, labelForCohort(code));
      option.value = code;
      cohort.appendChild(option);
    });
    form.appendChild(cohort);

    var reference = el("input");
    reference.type = "text";
    reference.setAttribute("aria-label", "Attestation reference");
    reference.setAttribute("aria-describedby", "reference-hint-" + detail.flag_code);
    form.appendChild(reference);

    var hint = el("p", "helper-text", "Up to 64 characters");
    hint.id = "reference-hint-" + detail.flag_code;
    form.appendChild(hint);

    var promote = el("button", "primary", "Promote");
    promote.type = "submit";
    form.appendChild(promote);

    var force = el("button", "force", "Force enable");
    force.type = "button";
    form.appendChild(force);

    var rollback = el("button", "rollback", "Roll back");
    rollback.type = "button";
    form.appendChild(rollback);

    var alertBox = el("p", "alert");
    alertBox.setAttribute("role", "alert");
    form.appendChild(alertBox);

    region.appendChild(form);

    refs.flags[detail.flag_code] = {
      region: region,
      cards: cards,
      alert: alertBox,
      cohort: cohort,
      reference: reference,
      promote: promote,
      force: force,
      rollback: rollback
    };

    function promotePress() {
      startPending(promote);
      promoteAction(detail.flag_code, cohort.value, reference.value, false, promote, function () {
        reference.value = "";
      });
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      promotePress();
    });
    // Enter in the reference field submits that field's own action.
    reference.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        promotePress();
      }
    });
    force.addEventListener("click", function () {
      startPending(force);
      promoteAction(detail.flag_code, cohort.value, null, true, force, null);
    });
    rollback.addEventListener("click", function () {
      startPending(rollback);
      rollbackAction(detail.flag_code, rollback);
    });
    return region;
  }

  function buildEventForm() {
    var region = el("section", "console-section");
    var form = el("form", "event-form");
    form.setAttribute("aria-label", "Record adverse event");
    region.appendChild(el("h2", null, "Record adverse event"));

    var code = el("input");
    code.type = "text";
    code.setAttribute("aria-label", "Event code");
    code.setAttribute("aria-describedby", "event-code-hint");
    form.appendChild(code);
    var codeHint = el("p", "helper-text", "Up to 32 letters, digits or hyphens");
    codeHint.id = "event-code-hint";
    form.appendChild(codeHint);

    var device = el("select");
    device.setAttribute("aria-label", "Device");
    deviceCodes.forEach(function (d) {
      var option = el("option", null, d);
      option.value = d;
      device.appendChild(option);
    });
    form.appendChild(device);

    var flag = el("select");
    flag.setAttribute("aria-label", "Flag");
    flagCodes.forEach(function (f) {
      var option = el("option", null, f);
      option.value = f;
      flag.appendChild(option);
    });
    form.appendChild(flag);

    var band = el("select");
    band.setAttribute("aria-label", "Severity band");
    ["BAND-LOW", "BAND-MED", "BAND-HIGH"].forEach(function (b) {
      var option = el("option", null, b);
      option.value = b;
      band.appendChild(option);
    });
    form.appendChild(band);

    var occurred = el("input");
    occurred.type = "number";
    occurred.setAttribute("aria-label", "Occurred at (minutes)");
    form.appendChild(occurred);

    var submit = el("button", "primary", "Record adverse event");
    submit.type = "submit";
    form.appendChild(submit);

    var alertBox = el("p", "alert");
    alertBox.setAttribute("role", "alert");
    form.appendChild(alertBox);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      startPending(submit);
      // The console sends exactly what is in its fields: an empty minute
      // field is sent as null, and the server decides every limit.
      eventAction({
        event_code: code.value,
        device_code: device.value,
        flag_code: flag.value,
        occurred_at_minutes: occurred.value === "" ? null : Number(occurred.value),
        severity_band_code: band.value
      }, submit, code);
    });

    region.appendChild(form);
    refs.eventForm = form;
    refs.eventAlert = alertBox;
    refs.eventCode = code;
    return region;
  }

  function buildSettings() {
    var region = el("section", "console-section");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "Settings");
    region.appendChild(el("h2", null, "Settings"));

    var wrap = el("div", "settings-groups");
    flagCodes.forEach(function (code) {
      var group = el("fieldset", "settings-group");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", labelForFlag(code));
      group.appendChild(el("legend", null, labelForFlag(code)));
      var input = el("input");
      input.type = "number";
      input.min = "0";
      input.max = "10000";
      input.setAttribute("aria-label", "Maximum adverse rate (basis points)");
      input.setAttribute("aria-describedby", "max-hint-" + code);
      group.appendChild(input);
      var hint = el("p", "helper-text", "0 to 10000 basis points");
      hint.id = "max-hint-" + code;
      group.appendChild(hint);
      var save = el("button", null, "Save maximum");
      save.type = "button";
      group.appendChild(save);
      save.addEventListener("click", function () {
        startPending(save);
        settingsAction("PATCH", "/api/capability_flag/" + code,
          { max_adverse_rate_bp: Number(input.value) }, "max_adverse_rate_bp", save);
      });
      refs.maxInputs[code] = input;
      wrap.appendChild(group);
    });
    cohortCodes.forEach(function (code) {
      var group = el("fieldset", "settings-group");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", labelForCohort(code));
      group.appendChild(el("legend", null, labelForCohort(code)));
      var input = el("input");
      input.type = "number";
      input.min = "0";
      input.max = "525600";
      input.setAttribute("aria-label", "Minimum soak (minutes)");
      input.setAttribute("aria-describedby", "soak-hint-" + code);
      group.appendChild(input);
      var hint = el("p", "helper-text", "0 to 525600 minutes");
      hint.id = "soak-hint-" + code;
      group.appendChild(hint);
      var save = el("button", null, "Save soak");
      save.type = "button";
      group.appendChild(save);
      save.addEventListener("click", function () {
        startPending(save);
        settingsAction("PATCH", "/api/cohort/" + code,
          { min_soak_minutes: Number(input.value) }, "min_soak_minutes", save);
      });
      refs.soakInputs[code] = input;
      wrap.appendChild(group);
    });
    region.appendChild(wrap);

    var alertBox = el("p", "alert");
    alertBox.setAttribute("role", "alert");
    region.appendChild(alertBox);
    refs.settingsAlert = alertBox;
    return region;
  }

  function labelForFlag(code) {
    var detail = state.flags[code];
    return detail ? detail.flag_label : code;
  }

  function labelForCohort(code) {
    for (var i = 0; i < cohortDetails.length; i++) {
      if (cohortDetails[i].cohort_code === code) return cohortDetails[i].cohort_label;
    }
    return code;
  }

  function buildEvidencePack() {
    var region = el("section", "console-section");
    region.setAttribute("role", "region");
    region.setAttribute("aria-label", "Evidence pack");
    region.appendChild(el("h2", null, "Evidence pack"));
    var frame = el("div", "table-frame");
    var table = el("table");
    table.setAttribute("aria-label", "Evidence pack");
    var thead = el("thead");
    var headRow = el("tr");
    ["Flag", "Highest rung", "Gap rungs", "Soak satisfied rungs", "Rate satisfied rungs"].forEach(function (h) {
      headRow.appendChild(el("th", null, h));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el("tbody");
    table.appendChild(tbody);
    frame.appendChild(table);
    region.appendChild(frame);
    refs.packsBody = tbody;
    return region;
  }

  function buildHistory() {
    var region = el("section", "console-section");
    region.appendChild(el("h2", null, "Promotion history"));
    var frame = el("div", "table-frame");
    var table = el("table");
    table.setAttribute("aria-label", "Promotion history");
    var thead = el("thead");
    var headRow = el("tr");
    ["promotion_code", "flag_code", "cohort_code", "promoted_at_minutes", "demoted_at_minutes", "attestation_reference"].forEach(function (h) {
      headRow.appendChild(el("th", null, h));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = el("tbody");
    table.appendChild(tbody);
    frame.appendChild(table);
    region.appendChild(frame);
    refs.historyBody = tbody;
    return region;
  }

  function buildConsole() {
    var statusRegion = el("section", "console-section status-region");
    statusRegion.setAttribute("role", "region");
    statusRegion.setAttribute("aria-label", "Console status");
    var status = el("p");
    status.id = "console-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-label", "Console status");
    statusRegion.appendChild(status);
    refs.status = status;

    var flagsGrid = el("div", "flags-grid");
    flagCodes.forEach(function (code) {
      var detail = state.flags[code];
      if (detail) flagsGrid.appendChild(buildFlagRegion(detail));
    });

    root.textContent = "";
    root.appendChild(flagsGrid);
    root.appendChild(buildEventForm());
    root.appendChild(buildSettings());
    root.appendChild(buildEvidencePack());
    root.appendChild(buildHistory());
    root.appendChild(statusRegion);
  }

  // ---- in-place updates ----

  function updateRungCard(card, rung) {
    card.li.className = "rung-card " + stateClass(rung.state);
    card.title.textContent = "Rung " + rung.rung_index_count + " · " + rung.cohort_label;
    card.stateWord.textContent = rung.state;
    card.stateWord.className = "state-word " + stateClass(rung.state);
    card.attestedWord.textContent = rung.attested ? "Attested" : "";
    var paragraphs = card.li.querySelectorAll("p:not(.rung-head):not(.rung-title)");
    var promotionLine = "Promoted at minute " + none(rung.promoted_at_minutes);
    if (rung.demoted_at_minutes !== null && rung.demoted_at_minutes !== undefined) {
      promotionLine += ", demoted at minute " + rung.demoted_at_minutes;
    }
    paragraphs[0].textContent = promotionLine;
    paragraphs[1].textContent = "Soak " + none(rung.soak_elapsed_minutes) + " minutes of " + rung.min_soak_minutes + " minutes";
    paragraphs[2].textContent = "Rate " + rung.rate_bp + " basis points from " + rung.event_count +
      " events on " + rung.device_count + " devices, maximum " + rung.max_adverse_rate_bp + " basis points";
    paragraphs[3].textContent = "Attestation " + none(rung.attestation_reference);
  }

  function updateFigures() {
    flagCodes.forEach(function (code) {
      var detail = state.flags[code];
      var ref = refs.flags[code];
      if (!detail || !ref) return;
      detail.rungs.forEach(function (rung, index) {
        updateRungCard(ref.cards[index], rung);
      });
      // Settings inputs follow live state only while the operator is not
      // editing them.
      var maxInput = refs.maxInputs[code];
      if (maxInput && document.activeElement !== maxInput) {
        maxInput.value = detail.max_adverse_rate_bp;
      }
    });
    cohortDetails.forEach(function (cohort) {
      var input = refs.soakInputs[cohort.cohort_code];
      if (input && document.activeElement !== input) {
        input.value = cohort.min_soak_minutes;
      }
    });

    refs.packsBody.textContent = "";
    // One row per flag in seed order, whatever order the route returned.
    flagCodes.forEach(function (code) {
      var pack = null;
      state.packs.forEach(function (candidate) {
        if (candidate.flag_code === code) pack = candidate;
      });
      if (!pack) return;
      var row = el("tr");
      row.appendChild(el("td", null, pack.flag_code));
      row.appendChild(el("td", null, String(pack.highest_rung_index_count)));
      row.appendChild(el("td", null, rungCell(pack.gap_rung_index_counts)));
      row.appendChild(el("td", null, rungCell(pack.soak_satisfied_rung_index_counts)));
      row.appendChild(el("td", null, rungCell(pack.rate_satisfied_rung_index_counts)));
      refs.packsBody.appendChild(row);
    });

    refs.historyBody.textContent = "";
    state.promotions.forEach(function (p) {
      var row = el("tr");
      row.appendChild(el("td", null, p.promotion_code));
      row.appendChild(el("td", null, p.flag_code));
      row.appendChild(el("td", null, p.cohort_code));
      row.appendChild(el("td", null, String(p.promoted_at_minutes)));
      row.appendChild(el("td", null, p.demoted_at_minutes === null ? "none" : String(p.demoted_at_minutes)));
      row.appendChild(el("td", null, p.attestation_reference === null ? "none" : p.attestation_reference));
      refs.historyBody.appendChild(row);
    });
  }

  function reloadAll() {
    var loads = [];
    flagCodes.forEach(function (code) {
      loads.push(api("/api/capability_flag/" + code).then(function (result) {
        if (result.status === 200) state.flags[code] = result.body;
      }));
    });
    loads.push(api("/api/evidence_pack").then(function (result) {
      if (result.status === 200) state.packs = result.body;
    }));
    loads.push(api("/api/promotion").then(function (result) {
      if (result.status === 200) state.promotions = result.body;
    }));
    loads.push(api("/api/cohort").then(function (result) {
      if (result.status === 200) cohortDetails = result.body;
    }));
    return Promise.all(loads).then(function () {
      updateFigures();
    });
  }

  // ---- pending state ----

  function startPending(button) {
    button.dataset.label = button.textContent;
    button.textContent = "Working…";
    button.disabled = true;
    inFlight++;
  }

  function endPending(button) {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
    inFlight--;
  }

  function announce(message) {
    refs.status.textContent = message;
  }

  function showFlagAlert(flagCode, message) {
    var ref = refs.flags[flagCode];
    if (ref) ref.alert.textContent = message;
  }

  function outageCopy() {
    return "The rollout store did not answer. Check the promotion history before trying again.";
  }

  // ---- actions ----

  // Every press sends a fresh idempotency key. If the request gets no
  // response at all, the console resends it once with the same key and the
  // same body.
  function sendWithRetry(path, body, onDone) {
    var key = randomKey();
    function send() {
      api(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body)
      }).then(function (result) {
        if (result.status === 0 && !send.retried) {
          send.retried = true;
          send();
          return;
        }
        onDone(result);
      });
    }
    send();
  }

  function rungOfCohort(flagCode, cohortCode) {
    var detail = state.flags[flagCode];
    if (!detail) return 0;
    for (var i = 0; i < detail.rungs.length; i++) {
      if (detail.rungs[i].cohort_code === cohortCode) return detail.rungs[i].rung_index_count;
    }
    return 0;
  }

  function alertCopy(result) {
    if (result.status === 503 || result.status === 0) return outageCopy();
    if (result.status === 422 && result.body && result.body.errors) {
      return fieldErrorMessage(result.body.errors);
    }
    if (result.body && result.body.error) return result.body.error;
    return "";
  }

  function promoteAction(flagCode, cohortCode, reference, force, button, onSuccess) {
    var body = { flag_code: flagCode, cohort_code: cohortCode };
    if (!force) body.attestation_reference = reference;
    var path = force ? "/api/promotion/force-enable" : "/api/promotion";
    sendWithRetry(path, body, function (result) {
      endPending(button);
      // The console reloads first, then announces from the fresh state, so
      // the rung cards, the evidence pack row and the history match the
      // server within 2 seconds of the response.
      reloadAll().then(function () {
        if (result.status === 201 || result.status === 200) {
          var detail = state.flags[flagCode];
          var rung = rungOfCohort(flagCode, cohortCode);
          if (detail) {
            announce(force
              ? "Force enabled " + detail.flag_label + " at rung " + rung + "."
              : "Promoted " + detail.flag_label + " to rung " + rung + ".");
          }
          if (onSuccess) onSuccess();
        } else {
          showFlagAlert(flagCode, alertCopy(result));
        }
      });
    });
  }

  function rollbackAction(flagCode, button) {
    sendWithRetry("/api/promotion/rollback", { flag_code: flagCode }, function (result) {
      endPending(button);
      reloadAll().then(function () {
        if (result.status === 200 || result.status === 201) {
          var detail = state.flags[flagCode];
          if (detail) {
            announce("Rolled back " + detail.flag_label + " to rung " + detail.highest_rung_index_count + ".");
          }
        } else {
          showFlagAlert(flagCode, alertCopy(result));
        }
      });
    });
  }

  function eventAction(body, button, codeField) {
    api("/api/adverse_event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (result) {
      endPending(button);
      // The console reloads every flag's detail and the evidence pack, so
      // rates, states and any breach cascade appear on the same page.
      reloadAll().then(function () {
        if (result.status === 201 && result.body) {
          announce("Recorded adverse event " + result.body.event_code + ".");
          codeField.value = "";
          refs.eventAlert.textContent = "";
        } else {
          refs.eventAlert.textContent = alertCopy(result);
        }
      });
    });
  }

  function settingsAction(method, path, body, button) {
    api(path, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (result) {
      endPending(button);
      // After any response, every flag's detail and the evidence pack are
      // reloaded.
      reloadAll().then(function () {
        if (result.status === 200) {
          announce("Saved.");
          refs.settingsAlert.textContent = "";
        } else {
          refs.settingsAlert.textContent = alertCopy(result);
        }
      });
    });
  }

  // ---- boot ----

  reloadAll().then(function () {
    buildConsole();
    updateFigures();
  });

  // A regular reload every 10 seconds, so changes made from a second console
  // appear within 10 seconds.
  setInterval(function () {
    if (inFlight === 0) reloadAll();
  }, 10000);
})();
