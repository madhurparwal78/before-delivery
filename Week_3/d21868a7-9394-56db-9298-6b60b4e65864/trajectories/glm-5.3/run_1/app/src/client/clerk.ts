// The records clerk's packs, the contractors screen, and the reviewer's page.
import { api, errorOf, fieldErrorsOf, isNotSignedIn } from "./api.ts";
import type { PackRecord, ContractorRecord, TotalsChannel, WindowRecord } from "./types.ts";
import { h, clear, text, dec, statusRegion, group } from "./html.ts";
import { currentUser, goSignIn, navigate, startPolling, topBar, districtCounters, route } from "./app.ts";

const root = () => document.getElementById("root")!;

// --- packs list -------------------------------------------------------------------

route("/packs", async () => {
  const rootEl = root();
  clear(rootEl);
  const content = h("div");
  const counters = h("div");
  rootEl.append(topBar("/packs"), h("div", { class: "page" }, counters, h("h1", null, "Packs"), content));

  async function refresh(): Promise<void> {
    try {
      const [totals, packs] = await Promise.all([
        districtCounters(),
        api<{ packs: PackRecord[] }>("GET", "/api/packs"),
      ]);
      clear(counters);
      counters.append(h("div", { class: "lead-counter" },
        group("Committed ML", h("div", { class: "value num" }, dec(totals.committed))),
        group("Delivered ML", h("div", { class: "value num" }, dec(totals.delivered))),
      ));
      clear(content);
      if (packs.packs.length === 0) {
        content.append(h("p", { class: "hint" }, "No packs yet."));
        return;
      }
      const table = h("table", { "aria-label": "Packs" },
        h("thead", null, h("tr", null, h("th", null, "Number"), h("th", null, "Period"), h("th", null, "State"), h("th", null, "Signatory"), h("th", null, "Created"))));
      const tbody = h("tbody");
      for (const p of packs.packs) {
        tbody.append(h("tr", null,
          h("td", null, h("a", { href: `/packs/${p.id}` }, p.number)),
          h("td", null, `${p.from} to ${p.to}`),
          h("td", null, p.state),
          h("td", null, p.signatory),
          h("td", null, p.created_at),
        ));
      }
      table.append(tbody);
      content.append(table);
    } catch (e) {
      if (isNotSignedIn(e)) await goSignIn("/packs");
    }
  }
  await refresh();
  startPolling(refresh, 4000);
});

// --- new pack -----------------------------------------------------------------------

route("/packs/new", async () => {
  const rootEl = root();
  clear(rootEl);
  const statusEl = statusRegion("Pack status", "pack-status");
  const fromInput = h("input", { type: "text", id: "from", "aria-label": "From" }) as HTMLInputElement;
  const toInput = h("input", { type: "text", id: "to", "aria-label": "To" }) as HTMLInputElement;
  const signatoryInput = h("input", { type: "text", id: "signatory", "aria-label": "Signatory" }) as HTMLInputElement;
  const previewBox = h("div", { class: "preview-box", role: "region", "aria-label": "Pack preview", hidden: true });
  const submitBtn = h("button", { class: "primary", "aria-disabled": "true" }, "Sign and submit pack") as HTMLButtonElement;
  let previewedDoc: string | null = null;
  const fromErr = h("div", { class: "err" });
  const toErr = h("div", { class: "err" });
  const signatoryErr = h("div", { class: "err" });

  const counters = h("div");

  const form = h("form", { "aria-label": "New pack", onsubmit: async (ev: Event) => {
    ev.preventDefault();
    if (!previewedDoc) return;
    clear(statusEl);
    statusEl.append(text("Storing and mailing the pack."));
    try {
      const r = await api<{ pack: PackRecord }>("POST", "/api/packs", {
        from: fromInput.value.trim(),
        to: toInput.value.trim(),
        signatory: signatoryInput.value.trim(),
        document: previewedDoc,
      });
      navigate(`/packs/${r.pack.id}`);
    } catch (e) {
      const shape = errorOf(e);
      clear(statusEl);
      if (shape.code === "pack_stale") {
        statusEl.append(text("The records changed since your preview. Preview again before signing."));
        previewedDoc = null;
        submitBtn.setAttribute("aria-disabled", "true");
      } else {
        const fields = fieldErrorsOf(e);
        statusEl.append(text(fields.from ?? fields.to ?? fields.signatory ?? "Something went wrong."));
      }
    }
  } },
    h("div", { class: "field" }, h("label", { for: "from" }, "From"), fromInput, fromErr),
    h("div", { class: "field" }, h("label", { for: "to" }, "To"), toInput, toErr),
    h("div", { class: "field" }, h("label", { for: "signatory" }, "Signatory"), signatoryInput, signatoryErr),
    h("div", { style: "display:flex;gap:10px" },
      h("button", { type: "button", onclick: async () => {
        clear(fromErr); clear(toErr); clear(signatoryErr);
        try {
          const params = new URLSearchParams({ from: fromInput.value.trim(), to: toInput.value.trim(), signatory: signatoryInput.value.trim() });
          const doc = await api<string>("GET", `/api/packs/preview?${params.toString()}`, undefined, { raw: true });
          previewedDoc = doc;
          previewBox.hidden = false;
          clear(previewBox);
          previewBox.append(text(doc));
          submitBtn.setAttribute("aria-disabled", "false");
        } catch (e) {
          const fields = fieldErrorsOf(e);
          previewedDoc = null;
          previewBox.hidden = true;
          submitBtn.setAttribute("aria-disabled", "true");
          if (fields.from) fromErr.append(text(fields.from));
          if (fields.to) toErr.append(text(fields.to));
          if (fields.signatory) signatoryErr.append(text(fields.signatory));
        }
      } }, "Preview pack"),
      submitBtn,
    ),
    h("div", { style: "margin-top:12px" }, previewBox),
  );

  rootEl.append(topBar("/packs/new"), h("div", { class: "page" }, counters, h("h1", null, "New pack"), form, statusEl));

  try {
    const totals = await districtCounters();
    clear(counters);
    counters.append(h("div", { class: "lead-counter" },
      group("Committed ML", h("div", { class: "value num" }, dec(totals.committed))),
      group("Delivered ML", h("div", { class: "value num" }, dec(totals.delivered))),
    ));
  } catch {
    // the counters catch up on the next poll
  }
});

// --- pack page ------------------------------------------------------------------------

route("/packs/<id>", async (m) => {
  const id = m.params.id!;
  const me = currentUser()!;
  const rootEl = root();
  clear(rootEl);
  const statusEl = statusRegion("Pack status", "pack-status");
  const content = h("div");
  const counters = h("div");
  rootEl.append(topBar(""), h("div", { class: "page" }, counters, content, statusEl));

  let announcedComplete = false;
  async function refresh(): Promise<void> {
    try {
      const [totals, r] = await Promise.all([
        districtCounters(),
        api<{ pack: PackRecord }>("GET", `/api/packs/${id}`),
      ]);
      clear(counters);
      counters.append(h("div", { class: "lead-counter" },
        group("Committed ML", h("div", { class: "value num" }, dec(totals.committed))),
        group("Delivered ML", h("div", { class: "value num" }, dec(totals.delivered))),
      ));
      const p = r.pack;
      clear(content);
      content.append(
        h("h1", null, `Pack ${p.number}`),
        h("dl", null,
          h("div", null, h("dt", null, "Period"), h("dd", null, `${p.from} to ${p.to}`)),
          h("div", null, h("dt", null, "State"), h("dd", null, p.state)),
          h("div", null, h("dt", null, "Signatory"), h("dd", null, p.signatory)),
          h("div", null, h("dt", null, "Created"), h("dd", null, p.created_at)),
        ),
      );
      if (p.sha256) {
        content.append(group("Pack digest", h("div", { class: "num" }, `SHA-256 ${p.sha256}`)));
      }
      if (p.stalled_on === "store") {
        content.append(h("p", { class: "banner" }, "The evidence store is not answering. The pack will be stored and mailed when it returns."));
      }
      if (p.stalled_on === "mail") {
        content.append(h("p", { class: "banner" }, "The mail service is not answering. The pack is stored and will be mailed when it returns."));
      }
      if (p.state === "stored" || p.state === "mailed") {
        content.append(h("p", null, h("a", { href: `/api/packs/${id}/document` }, "Download pack")));
      }
      if (me.role === "clerk" && p.state !== "mailed" && p.state !== "withdrawn") {
        content.append(h("button", {
          onclick: async () => {
            clear(statusEl);
            statusEl.append(text("Withdrawing."));
            try {
              const w = await api<{ pack: PackRecord }>("DELETE", `/api/packs/${id}`);
              clear(statusEl);
              statusEl.append(text(`Pack ${w.pack.number} withdrawn. Nothing was mailed.`));
              await refresh();
            } catch (e) {
              const shape = errorOf(e);
              clear(statusEl);
              statusEl.append(text(shape.code === "pack_mailed" ? "This pack has already been mailed." : "Something went wrong."));
            }
          },
        }, "Withdraw pack"));
      }
      if (p.state === "mailed" && !announcedComplete) {
        clear(statusEl);
        statusEl.append(text(`Pack ${p.number} stored and mailed to the regulator.`));
        announcedComplete = true;
      }
    } catch (e) {
      if (isNotSignedIn(e)) {
        await goSignIn(location.pathname);
      } else {
        const shape = errorOf(e);
        if (shape.code === "not_found") {
          clear(content);
          content.append(h("h1", null, "Page not found"));
        }
      }
    }
  }
  await refresh();
  startPolling(refresh, 3000);
});

// --- contractors ---------------------------------------------------------------------------

route("/contractors", async (m) => {
  const me = currentUser()!;
  const rootEl = root();
  clear(rootEl);
  const statusEl = statusRegion("Contractor status", "contractor-status");
  const content = h("div");
  const counters = h("div");
  rootEl.append(topBar("/contractors"), h("div", { class: "page" }, counters, h("h1", null, "Contractors"), content, statusEl));

  async function refresh(): Promise<void> {
    try {
      const [totals, r] = await Promise.all([
        districtCounters(),
        api<{ contractors: ContractorRecord[] }>("GET", "/api/contractors"),
      ]);
      clear(counters);
      counters.append(h("div", { class: "lead-counter" },
        group("Committed ML", h("div", { class: "value num" }, dec(totals.committed))),
        group("Delivered ML", h("div", { class: "value num" }, dec(totals.delivered))),
      ));
      clear(content);
      const table = h("table", { "aria-label": "Contractors" },
        h("thead", null, h("tr", null,
          h("th", null, "Code"), h("th", null, "Name"), h("th", null, "Phone"), h("th", null, "State"),
          me.role === "clerk" ? h("th", null, "Erase") : null,
        )));
      const tbody = h("tbody");
      for (const c of r.contractors) {
        const eraseBtn = h("button", {
          "aria-label": `Erase ${c.code}`,
          onclick: () => {
            // a spent (erased) erase button sends nothing, by pointer or key
            if (c.erased) return;
            openEraseDialog(c);
          },
        }, "Erase") as HTMLButtonElement;
        if (c.erased) eraseBtn.setAttribute("aria-disabled", "true");
        const tr = h("tr", null,
          h("td", null, c.code),
          h("td", null, c.name ?? `Operator ${c.code}`),
          h("td", null, c.phone ?? ""),
          h("td", null, c.erased ? "Erased" : "Active"),
          me.role === "clerk" ? h("td", null, eraseBtn) : null,
        );
        tbody.append(tr);
      }
      table.append(tbody);
      content.append(table);
    } catch (e) {
      if (isNotSignedIn(e)) await goSignIn("/contractors");
    }
  }

  function openEraseDialog(c: ContractorRecord): void {
    const cancelBtn = h("button", {}, "Cancel");
    const eraseBtn = h("button", { class: "primary" }, "Erase for good");
    const dlg = h("dialog", { class: "alert-dialog", "aria-label": `Erase contractor ${c.code}` },
      h("div", { class: "dialog-body" },
        h("h2", null, `Erase contractor ${c.code}`),
        h("p", null, `This erases ${c.name ?? `Operator ${c.code}`}'s name, phone and email from every stored record. Their deliveries keep the operator code.`),
      ),
      h("div", { class: "dialog-actions" }, cancelBtn, eraseBtn),
    ) as HTMLDialogElement;
    document.body.append(dlg);
    dlg.showModal();
    cancelBtn.focus();

    cancelBtn.addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      dlg.remove();
      refresh().then(() => {
        const btn = document.querySelector(`button[aria-label="Erase ${c.code}"]`) as HTMLButtonElement | null;
        btn?.focus();
      });
    });
    dlg.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        dlg.close();
        return;
      }
      if (ev.key === "Tab") {
        const focusables = [cancelBtn, eraseBtn];
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    });
    eraseBtn.addEventListener("click", async () => {
      clear(statusEl);
      statusEl.append(text("Erasing."));
      try {
        await api("DELETE", `/api/contractors/${c.code}`);
        dlg.close();
        clear(statusEl);
        statusEl.append(text(`Contractor ${c.code} erased. Their deliveries now show only the operator code.`));
        await refresh();
        const btn = document.querySelector(`button[aria-label="Erase ${c.code}"]`) as HTMLButtonElement | null;
        btn?.focus();
      } catch (e) {
        const shape = errorOf(e);
        clear(statusEl);
        statusEl.append(text(shape.code === "already_erased" ? "This contractor has already been erased." : "Something went wrong."));
        dlg.close();
      }
    });
  }

  await refresh();
  startPolling(refresh, 3000);
});

// --- review ---------------------------------------------------------------------------------

route("/review", async (m) => {
  const rootEl = root();
  clear(rootEl);
  const statusEl = statusRegion("Review status", "review-status");
  const fromInput = h("input", { type: "text", id: "review-from", "aria-label": "From", value: m.query.get("from") ?? "" }) as HTMLInputElement;
  const toInput = h("input", { type: "text", id: "review-to", "aria-label": "To", value: m.query.get("to") ?? "" }) as HTMLInputElement;
  const fromErr = h("div", { class: "err" });
  const toErr = h("div", { class: "err" });
  const totalsWrap = h("div");
  const packsWrap = h("div");
  const counters = h("div");

  async function showTotals(): Promise<void> {
    // the period is optional, but only as a pair: one date alone answers 422
    const from = fromInput.value.trim();
    const to = toInput.value.trim();
    const hasPeriod = from !== "" || to !== "";
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    try {
      const res = await api<{ channels: TotalsChannel[] }>("GET", `/api/totals${q.toString() ? `?${q.toString()}` : ""}`);
      if (hasPeriod && from && to) {
        // a valid period becomes part of the address with exactly one history entry
        history.pushState(null, "", `/review?${q.toString()}`);
      }
      clear(totalsWrap);
      renderTotals(res.channels);
      clear(fromErr); clear(toErr);
    } catch (e) {
      // an invalid period shows its message under the field; the address, the
      // history and the table stay as they were
      const fields = fieldErrorsOf(e);
      clear(fromErr); clear(toErr);
      if (fields.from) fromErr.append(text(fields.from));
      if (fields.to) toErr.append(text(fields.to));
    }
  }

  function renderTotals(channels: TotalsChannel[]): void {
    const table = h("table", { "aria-label": "Channel totals", class: "stacked-totals" },
      h("thead", null, h("tr", null,
        h("th", null, "Channel"), h("th", null, "Window"),
        h("th", { class: "num" }, "Cap volume (ML)"), h("th", { class: "num" }, "Committed (ML)"),
        h("th", { class: "num" }, "Delivered (ML)"), h("th", { class: "num" }, "Remaining (ML)"),
      )));
    const tbody = h("tbody");
    for (const c of channels) {
      for (const w of c.windows) {
        tbody.append(h("tr", null,
          h("td", { "data-label": "Channel" }, channelName(c.channel_id)),
          h("td", { "data-label": "Window" }, w.label),
          h("td", { class: "num", "data-label": "Cap volume" }, dec(w.cap_volume_ml)),
          h("td", { class: "num", "data-label": "Committed" }, dec(w.committed_ml)),
          h("td", { class: "num", "data-label": "Delivered" }, dec(w.delivered_ml)),
          h("td", { class: "num", "data-label": "Remaining" }, dec(w.remaining_ml)),
        ));
      }
    }
    table.append(tbody);
    totalsWrap.append(table);
  }

  const channelNames = new Map<string, string>();
  function channelName(id: string): string {
    return channelNames.get(id) ?? id;
  }

  const form = h("form", { "aria-label": "Review period", onsubmit: async (ev: Event) => {
    ev.preventDefault();
    await showTotals();
  } },
    h("div", { class: "row" },
      h("div", { class: "field grow" }, h("label", { for: "review-from" }, "From"), fromInput, fromErr),
      h("div", { class: "field grow" }, h("label", { for: "review-to" }, "To"), toInput, toErr),
      h("button", { type: "submit" }, "Show totals"),
    ),
  );

  rootEl.append(topBar("/review"), h("div", { class: "page" },
    counters,
    h("h1", null, "Review"),
    form,
    h("div", { class: "review-layout" },
      h("div", null, h("h2", null, "Channel totals"), totalsWrap),
      h("div", null, h("h2", null, "Mailed packs"), packsWrap),
    ),
    statusEl,
  ));

  async function refresh(): Promise<void> {
    try {
      const [channels, totals, packs] = await Promise.all([
        api<{ channels: Array<{ id: string; name: string }> }>("GET", "/api/channels"),
        districtCounters(),
        api<{ packs: PackRecord[] }>("GET", "/api/packs"),
      ]);
      for (const c of channels.channels) channelNames.set(c.id, c.name);
      clear(counters);
      counters.append(h("div", { class: "lead-counter" },
        group("Committed ML", h("div", { class: "value num" }, dec(totals.committed))),
        group("Delivered ML", h("div", { class: "value num" }, dec(totals.delivered))),
      ));
      const known = new Set<string>();
      clear(packsWrap);
      const list = h("ul", { class: "mailed-packs", role: "list", "aria-label": "Mailed packs" });
      for (const p of packs.packs.filter((x) => x.state === "mailed")) {
        known.add(p.id);
        list.append(h("li", null,
          h("span", null, `${p.number} · ${p.from} to ${p.to} · ${p.mailed_at}`),
          h("a", { href: `/api/packs/${p.id}/document`, "aria-label": `Download ${p.number}` }, `Download ${p.number}`),
        ));
      }
      packsWrap.append(list);
      // announce newly appeared packs
      const fresh = packs.packs.find((p) => p.state === "mailed" && !seenPackIds.has(p.id));
      if (fresh) {
        clear(statusEl);
        statusEl.append(text(`Pack ${fresh.number} received from the district.`));
      }
      for (const p of packs.packs.filter((x) => x.state === "mailed")) seenPackIds.add(p.id);
      await showTotals();
    } catch (e) {
      if (isNotSignedIn(e)) await goSignIn("/review");
    }
  }
  const seenPackIds = new Set<string>();
  await refresh();
  startPolling(refresh, 4000);
});
