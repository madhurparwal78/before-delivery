/* The roll page: upload, strips, alignment, contact sheet, shooting log. */
"use strict";

(function () {
  const E = window.Edgeprint;
  const A = E.app;
  const S = E.screens;
  const { el, $, fmtSigned, fmtPlain, DASH, MINUS, previewText, Api } =
    Object.assign({}, E, E.ui || {});
  const UI = E.ui;
  const announce = UI.announce;

  async function rollScreen(root, rollId) {
    let roll;
    try { roll = await Api.get(`/api/rolls/${rollId}`); }
    catch (error) { return A.notFound(root); }
    const scansBody = await Api.get(`/api/rolls/${rollId}/scans`);
    const entries = (await Api.get(`/api/rolls/${rollId}/entries`)).entries;

    const content = el("div", { class: "rollpage" });
    content.append(rollHead(roll));

    const counters = el("section", { class: "panel", "aria-label": "Roll counters",
                                     role: "region" }, [UI.counterNodes(roll.counters)]);
    content.append(counters);
    content.append(uploadForm(roll));
    content.append(stripsList(roll, scansBody.scans));
    content.append(alignmentControls(roll));
    content.append(await contactSheet(roll));
    content.append(shootingLog(roll, entries));
    root.append(...UI.shell([content], A.getMe(), A.isStorageDown()));
  }

  function rollHead(roll) {
    return el("header", { class: "rollhead" }, [
      el("h1", { text: roll.name }),
      el("div", { class: "meta" }, [
        el("span", { text: roll.stock }),
        el("span", { text: `EI ${roll.ei}` }),
        el("span", { text: `Push or pull ${fmtSigned(roll.push_pull, 0)}` }),
        el("span", { class: "tabular",
                     text: `Reciprocity exponent ${roll.reciprocity_p.toFixed(2)}` }),
        el("span", { text: roll.development_note }),
        el("span", { text: roll.state }),
        el("a", { href: `/rolls/${roll.id}/edit`, text: "Edit roll" }),
      ]),
    ]);
  }

  function uploadForm(roll) {
    const file = el("input", { type: "file", id: "strip_scan", accept: "image/png,image/tiff" });
    const dpi = el("input", { type: "number", id: "scan_dpi", min: 300, max: 10000,
                              step: 1, value: 1200 });
    const firstEdge = el("input", { type: "number", id: "first_edge", min: 0, max: 99,
                                   step: 1, value: 1 });
    const errors = { size: errorSlot("size"), sha256: errorSlot("sha256"),
                     file: errorSlot("file"), dpi: errorSlot("dpi"),
                     first_edge: errorSlot("first_edge") };
    const submit = el("button", { class: "btn", text: "Upload strip" });
    const progressWrap = el("div", { class: "progress hidden",
                                     role: "progressbar", "aria-label": "Upload progress",
                                     "aria-valuemin": 0, "aria-valuemax": 100,
                                     "aria-valuenow": 0 });
    const bar = el("span", { class: "bar" });
    progressWrap.append(bar);

    const form = el("form", { class: "form", onsubmit: async (event) => {
      event.preventDefault();
      const chosen = file.files[0];
      const markFileError = (message) => {
        errors.file.textContent = message;
        errors.file.classList.remove("hidden");
        file.setAttribute("aria-invalid", "true");
        announce(message);
        file.focus();
      };
      if (!chosen) return;
      if (chosen.size > 60000000) {
        markFileError("This scan is larger than 60,000,000 bytes.");
        return;
      }
      for (const slot of Object.values(errors)) { slot.classList.add("hidden"); }
      file.removeAttribute("aria-invalid");
      submit.disabled = true;
      progressWrap.classList.remove("hidden");
      bar.style.width = "0%";
      progressWrap.setAttribute("aria-valuenow", "0");
      announce(`Uploading ${chosen.name}…`);
      const bytes = await chosen.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
      const params = new URLSearchParams({
        dpi: dpi.value, first_edge: firstEdge.value, filename: chosen.name });
      const response = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/rolls/${roll.id}/scans?${params}`);
        xhr.withCredentials = true;
        xhr.setRequestHeader("X-Scan-Size", String(chosen.size));
        xhr.setRequestHeader("X-Scan-SHA256", sha256);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          const percent = Math.floor((event.loaded / event.total) * 100);
          bar.style.width = `${percent}%`;
          progressWrap.setAttribute("aria-valuenow", String(percent));
        });
        xhr.addEventListener("load", () => resolve(xhr));
        xhr.addEventListener("error", () => reject(new Error("network")));
        xhr.addEventListener("abort", () => reject(new Error("network")));
        xhr.send(chosen);
      }).catch(() => null);
      progressWrap.classList.add("hidden");
      submit.disabled = false;
      if (response === null) {
        announce("Upload failed: the connection was lost. Nothing was stored; try again.");
        return;
      }
      const body = await (() => {
        try { return JSON.parse(response.responseText); }
        catch (error) { return {}; }
      })();
      if (response.status === 201) {
        announce(`Stored ${chosen.name}: size and checksum confirmed.`);
        history.pushState({}, "", location.pathname);
        UI.render();
        return;
      }
      if (response.status === 409) {
        announce("This strip is already on this roll.");
        return;
      }
      if (response.status === 401) {
        announce("Your session ended. Sign in to keep this exposure.");
        location.href = "/signin?next=" +
          encodeURIComponent(location.pathname + location.search);
        return;
      }
      if (response.status === 413 || response.status === 415) {
        markFileError(body.message || "Only PNG or TIFF scans can be stored.");
        return;
      }
      if (response.status === 503) {
        announce("Storage is unreachable. Nothing was stored; try again when it is back.");
        UI.render();
        return;
      }
      if (response.status === 422 && body.fields) {
        for (const key of Object.keys(body.fields)) {
          if (errors[key]) {
            errors[key].textContent = body.fields[key];
            errors[key].classList.remove("hidden");
          }
        }
        announce(Object.values(body.fields)[0]);
        if (errors.file && !errors.file.classList.contains("hidden")) file.setAttribute("aria-invalid", "true");
        return;
      }
      announce("Upload failed: the connection was lost. Nothing was stored; try again.");
    } }, [
      el("label", { for: "strip_scan", text: "Strip scan" }), file,
      errors.size, errors.sha256, errors.file,
      el("div", { class: "row" }, [
        el("div", {}, [el("label", { for: "scan_dpi", text: "Scan DPI" }), dpi, errors.dpi]),
        el("div", {}, [el("label", { for: "first_edge", text: "First edge number" }),
                      firstEdge, errors.first_edge]),
      ]),
      submit, progressWrap,
    ]);
    return el("section", { class: "panel" }, [form]);
  }

  function errorSlot(key) {
    return el("div", { class: "field-error hidden", "data-error": key });
  }

  function stripsList(roll, scans) {
    const list = el("ul", { class: "strips", "aria-label": "Strips" });
    if (!scans.length) {
      return el("section", { class: "panel" }, [
        el("p", { text: "No strips yet." }),
      ]);
    }
    for (const scan of scans) {
      list.append(el("li", {}, [
        el("a", { href: `/rolls/${roll.id}/scans/${scan.id}`,
                  text: `Strip ${scan.position}` }),
        el("span", { text: scan.state }),
        el("span", { class: "tabular", text: `${scan.size} bytes` }),
        el("span", { class: "tabular", text: scan.sha256.slice(0, 12) }),
        el("a", { href: `/api/scans/${scan.id}/original`,
                  text: "Download original" }),
      ]));
    }
    return el("section", { class: "panel" }, [list]);
  }

  function alignmentControls(roll) {
    let alignment = null;
    let proposal = null;
    const sentence = el("p", { class: "meta", "aria-live": "polite" });
    const proposeButton = el("button", { class: "btn", text: "Propose alignment",
      onclick: async () => {
        announce("Comparing notes with frames…");
        try {
          proposal = await Api.post(`/api/rolls/${roll.id}/alignment/proposal`);
          acceptButton.disabled = proposal.proposed_offset === null;
          if (proposal.proposed_offset === null) {
            sentence.textContent = "Not enough exposed frames to propose an offset. Choose one in Override alignment.";
            announce("Not enough exposed frames to propose an offset. Choose one in Override alignment.");
          } else if (proposal.proposed_slip_after !== null) {
            sentence.textContent = `Proposed offset ${UI.signedOffset(proposal.proposed_offset)}, slip after note ${proposal.proposed_slip_after}.`;
            announce(`Proposed offset ${UI.signedOffset(proposal.proposed_offset)}, slip after note ${proposal.proposed_slip_after}.`);
          } else {
            sentence.textContent = `Proposed offset ${UI.signedOffset(proposal.proposed_offset)}.`;
            announce(`Proposed offset ${UI.signedOffset(proposal.proposed_offset)}.`);
          }
        } catch (error) { announce(error.message || "Find frames first."); }
      } });
    const acceptButton = el("button", { class: "btn", text: "Accept proposed offset",
                                        disabled: true, onclick: async () => {
      announce("Saving alignment…");
      try {
        await Api.put(`/api/rolls/${roll.id}/alignment`, {
          version: alignment ? alignment.version : 0,
          offset: proposal.proposed_offset,
          slip_after: proposal.proposed_slip_after,
        });
        announce("Alignment saved.");
        UI.render();
      } catch (error) { handleAlignmentRefusal(error); }
    } });
    const overrideButton = el("button", { class: "btn",
                                          text: "Override alignment",
                                          onclick: async () => {
      const dialog = await overrideDialog(roll, overrideButton);
      document.body.append(dialog);
      dialog.showModal();
      dialog.querySelector("#dialog_offset").focus();
    } });
    const section = el("section", { class: "panel" }, [
      proposeButton, acceptButton, overrideButton, sentence,
    ]);
    Api.get(`/api/rolls/${roll.id}/alignment`).then((body) => {
      alignment = body;
      if (body.proposal && body.proposal.proposed_offset !== null) {
        acceptButton.disabled = false;
        sentence.textContent = `Proposed offset ${UI.signedOffset(body.proposal.proposed_offset)}.`;
      }
    }).catch(() => {});
    return section;
  }

  function handleAlignmentRefusal(error) {
    if (error.status === 412) {
      announce("This alignment changed in another tab. Reload it before saving.");
    } else {
      announce(error.message || "Find frames first.");
    }
  }

  async function overrideDialog(roll, opener) {
    const entries = (await Api.get(`/api/rolls/${roll.id}/entries`)).entries;
    const frames = (await Api.get(`/api/rolls/${roll.id}/contact-sheet`)).frames;
    const alignment = await Api.get(`/api/rolls/${roll.id}/alignment`);
    const savedOverride = {};
    for (const row of alignment.overrides || []) {
      savedOverride[row.entry_id] = row.frame_id;
    }

    const offset = el("select", { id: "dialog_offset" });
    for (const value of [-2, -1, 0, 1, 2]) {
      offset.append(el("option", { value: String(value), text: UI.signedOffset(value) }));
    }
    offset.value = String(alignment.offset === null
      ? (alignment.proposal && alignment.proposal.proposed_offset !== null
         ? alignment.proposal.proposed_offset : 0)
      : alignment.offset);

    const slip = el("select", { id: "dialog_slip" });
    slip.append(el("option", { value: "", text: "No slip" }));
    for (const entry of entries) {
      slip.append(el("option", { value: String(entry.counter),
                                 text: `Note ${entry.counter}` }));
    }
    const savedSlip = alignment.slip_after === null
      ? (alignment.proposal && alignment.proposal.proposed_slip_after !== null
         ? alignment.proposal.proposed_slip_after : "")
      : alignment.slip_after;
    slip.value = savedSlip === null ? "" : String(savedSlip);

    const frameSelects = entries.map((entry) => {
      const select = el("select", { id: `dialog_note_${entry.counter}` });
      select.append(el("option", { value: "follow", text: "Follow offset" }));
      select.append(el("option", { value: "unmatched", text: "Unmatched" }));
      for (const frame of frames) {
        select.append(el("option", { value: frame.id, text: `Frame ${frame.number}` }));
      }
      const saved = savedOverride[entry.id];
      if (saved === undefined) select.value = "follow";
      else if (saved === null) select.value = "unmatched";
      else select.value = saved;
      return { entry, select };
    });

    const saveButton = el("button", { class: "btn", text: "Save alignment" });
    const cancelButton = el("button", { class: "linkish", text: "Cancel" });
    const dialog = el("dialog", { "aria-label": "Override alignment",
                                  role: "dialog" }, [
      el("h2", { text: "Override alignment" }),
      el("label", { for: "dialog_offset", text: "Offset" }), offset,
      el("label", { for: "dialog_slip", text: "Slip after note" }), slip,
      el("div", { class: "frame-selects" },
        frameSelects.map(({ entry, select }) =>
          el("div", {}, [
            el("label", { for: `dialog_note_${entry.counter}`,
                          text: `Frame for note ${entry.counter}` }), select]))),
      saveButton, cancelButton,
    ]);

    saveButton.addEventListener("click", async () => {
      announce("Saving alignment…");
      const overrides = [];
      for (const { entry, select } of frameSelects) {
        if (select.value === "unmatched") {
          overrides.push({ entry_id: entry.id, frame_id: null });
        } else if (select.value !== "follow") {
          overrides.push({ entry_id: entry.id, frame_id: select.value });
        }
      }
      try {
        await Api.put(`/api/rolls/${roll.id}/alignment`, {
          version: alignment.version,
          offset: parseInt(offset.value, 10),
          slip_after: slip.value === "" ? null : parseInt(slip.value, 10),
          overrides,
        });
        announce("Alignment saved.");
        dialog.close();
        UI.render();
      } catch (error) {
        if (error.status === 412) {
          announce("This alignment changed in another tab. Reload it before saving.");
          saveButton.focus();
        } else { handleValidation(error, dialog); }
      }
    });
    cancelButton.addEventListener("click", () => dialog.close());

    // Escape closes without saving; focus returns to the opener either way.
    dialog.addEventListener("close", () => { opener.focus(); });
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusables = [offset, slip,
        ...frameSelects.map(({ select }) => select),
        saveButton, cancelButton];
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    });
    return dialog;
  }

  async function contactSheet(roll) {
    const body = await Api.get(`/api/rolls/${roll.id}/contact-sheet`);
    const list = el("ul", { class: "contact", "aria-label": "Contact sheet" });
    const entryByFrame = {};
    for (const entry of body.entries) if (entry.frame_id) entryByFrame[entry.frame_id] = entry;
    if (!body.frames.length) {
      return el("section", { class: "panel" }, [
        el("h2", { text: "Contact sheet" }),
        el("p", { text: "No strips yet." }),
      ]);
    }
    for (const frame of body.frames) {
      const entry = entryByFrame[frame.id];
      const scanId = frame.scan_id;
      const badges = [];
      if (frame.unexposed) badges.push("Unexposed");
      if (frame.flag === "flagged") badges.push("Flagged");
      if (frame.blank_slot) badges.push("Blank slot");
      if (entry && entry.match === "override") badges.push("Manual");
      list.append(el("li", {}, [
        el("a", { href: `/rolls/${roll.id}/scans/${scanId}?frame=${frame.number}`,
                  text: `Open frame ${frame.number}` }, [
          S.negativeCanvas(`/api/scans/${scanId}/preview/0`,
                           frame.x0, frame.x1, 0, 4 / 5),
        ]),
        el("div", { class: "meta" }, [
          el("span", { text: `Frame ${frame.number}` }),
          el("span", { text: `Edge ${frame.edge_number}` }),
          frame.title ? el("span", { text: frame.title }) : null,
          el("span", { text: entry ? `Note ${entry.counter}` : "No note" }),
          ...badges.map((label) => el("span", { class: "badge", text: label })),
        ]),
      ]));
    }
    return el("section", { class: "panel" }, [
      el("h2", { text: "Contact sheet" }), list,
    ]);
  }

  function shootingLog(roll, entries) {
    const list = el("ul", { class: "log", "aria-label": "Shooting log" });
    for (const entry of entries) {
      list.append(entryRow(roll, entry));
    }
    if (!entries.length) list.append(el("li", { text: "No notes yet." }));
    return el("section", { class: "panel" }, [
      el("h2", { text: "Shooting log" }), list,
    ]);
  }

  function entryRow(roll, entry, recent) {
    const badges = [];
    if (entry.misfire) badges.push("Misfire");
    if (entry.match === "override") badges.push("Manual");
    const matchText = (entry.match === "override" || entry.match === "offset")
      ? (entry.frame_id ? "Frame " + (entry.frame_id && entry.frame_number
            ? entry.frame_number : "") : "No frame")
      : (entry.match === "unmatched" ? "Marked unmatched" : "No frame");
    const row = el("li", {}, [
      el("span", { text: `Note ${entry.counter}` }),
      el("span", { class: "tabular", text: `f/${entry.aperture}` }),
      el("span", { text: entry.shutter }),
      el("span", { class: "tabular", text: `EV ${entry.metered_ev}` }),
      el("span", { class: "tabular", text: `${fmtSigned(entry.relative_stops, 2)} stops` }),
      el("span", { text: entry.note }),
      el("span", { text: matchText }),
      ...badges.map((label) => el("span", { class: "badge", text: label })),
    ]);
    if (!recent) {
      const editButton = el("button", { class: "linkish",
        text: `Edit note ${entry.counter}` });
      editButton.addEventListener("click", () => editInline(roll, entry, row));
      const deleteButton = el("button", { class: "linkish",
        text: `Delete note ${entry.counter}` });
      deleteButton.addEventListener("click", async () => {
        announce("Saving note…");
        await Api.del(`/api/entries/${entry.id}`);
        announce(`Note ${entry.counter} deleted.`);
        UI.render();
      });
      row.append(editButton, deleteButton);
    }
    return row;
  }

  function editInline(roll, entry, row) {
    const fields = inlineEditFields(roll, entry);
    const save = el("button", { class: "btn", text: `Save note ${entry.counter}` });
    const cancel = el("button", { class: "linkish", text: "Cancel edit" });
    const editor = el("li", { class: "edit" }, [
      ...fields.nodes, save, cancel,
    ]);
    row.replaceWith(editor);
    save.addEventListener("click", async () => {
      announce("Saving note…");
      try {
        await Api.patch(`/api/entries/${entry.id}`, fields.values());
        announce(`Note ${entry.counter} saved.`);
        UI.render();
      } catch (error) {
        if (error.status === 401) {
          keepNoteDraft(roll, entry, fields);
          return;
        }
        handleValidation(error, editor);
      }
    });
    cancel.addEventListener("click", () => UI.render());
  }

  function inlineEditFields(roll, entry) {
    const aperture = el("select", { "aria-label": "Aperture" });
    for (const value of E.APERTURES) {
      aperture.append(el("option", { value, text: `f/${value}`,
                                     selected: value === entry.aperture }));
    }
    const shutter = el("input", { value: entry.shutter, "aria-label": "Shutter" });
    const ev = el("input", { type: "number", step: "any", value: entry.metered_ev,
                             "aria-label": "Metered EV" });
    const note = el("input", { value: entry.note, "aria-label": "Note" });
    const misfire = el("input", { type: "checkbox", checked: entry.misfire,
                                  "aria-label": "Misfire" });
    const preview = el("div", { class: "preview",
      role: "status", "aria-label": `Exposure preview for note ${entry.counter}` });
    const update = () => {
      preview.textContent = previewText(roll, aperture.value, shutter.value, ev.value);
    };
    for (const field of [aperture, shutter, ev]) {
      field.addEventListener("input", update);
      field.addEventListener("change", update);
    }
    update();
    const nodes = [
      el("label", { text: "Aperture" }), aperture,
      el("label", { text: "Shutter" }), shutter,
      el("label", { text: "Metered EV" }), ev, preview,
      el("label", { text: "Note" }), note,
      el("label", {}, [misfire, el("span", { text: " Misfire" })]),
    ];
    return {
      nodes,
      values: () => ({
        aperture: aperture.value,
        shutter: shutter.value,
        metered_ev: parseFloat(ev.value),
        note: note.value,
        misfire: misfire.checked,
      }),
      fields: { aperture, shutter, ev, note, misfire },
    };
  }

  function keepNoteDraft(roll, entry, fields) {
    const values = fields.values();
    const draft = {
      entryId: entry.id, rollId: roll.id,
      aperture: values.aperture, shutter: values.shutter,
      ev: String(fields.fields.ev.value), note: values.note,
      misfire: values.misfire,
    };
    sessionStorage.setItem("edgeprint_draft", JSON.stringify(draft));
    sessionStorage.setItem("edgeprint_draft_target",
                           location.pathname + location.search);
    announce("Your session ended. Sign in to keep this note.");
    location.href = "/signin?next=" +
      encodeURIComponent(location.pathname + location.search);
  }

  function handleValidation(error, container) {
    if (error && error.fields) {
      for (const key of Object.keys(error.fields)) {
        const slot = container.querySelector(`[data-error="${key}"]`);
        if (slot) {
          slot.textContent = error.fields[key];
          slot.classList.remove("hidden");
        }
      }
      announce(Object.values(error.fields)[0]);
    } else if (error && error.message) {
      announce(error.message);
    }
  }

  window.Edgeprint.rollscreen = { rollScreen, entryRow, errorSlot, editInline,
                                  shootingLog, handleValidation };
})();
