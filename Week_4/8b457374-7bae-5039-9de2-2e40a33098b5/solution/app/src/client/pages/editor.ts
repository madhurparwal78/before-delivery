import type { BackerPledge, Campaign, Media, Person, Settlement, Tier } from "../../shared/api.js";
import { COUNTRIES } from "../../shared/countries.js";
import { decimalPounds, parsePounds } from "../../shared/money.js";
import { api, download, heldKey, privateImage } from "../api.js";
import { openDialog } from "../dialog.js";
import { announce, h, uid } from "../dom.js";
import { emptyState, loading, stateMark, statusChip } from "../marks.js";
import { cover, field, money, moneyInput, title, type Field, type Page } from "../page.js";
import { PlateFill } from "../platefill.js";
import { startCampaign } from "./identity.js";
import { notFoundPage } from "./notfound.js";

// The campaign editor (brief: Screens and layout › Studio; Interactions › Studio, Editor fields; DP-02 to DP-10).

const MONEY_ERROR = "Enter an amount in pounds, for example 2400.00.";
const DEADLINE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/;

function zones(): string[] {
  const data = document.getElementById("time-zones")?.textContent ?? "[]";
  return JSON.parse(data) as string[];
}

function options(select: HTMLSelectElement, prompt: string, items: [string, string][], value: string): HTMLSelectElement {
  select.append(h("option", { value: "" }, prompt), ...items.map(([v, label]) => h("option", { value: v }, label)));
  select.value = value;
  return select;
}

interface Problem {
  target: HTMLElement;
  label: string;
  message: string;
}

export const editorPage: Page = (main, id, onLeave) => {
  title("Studio");
  if (!heldKey()) {
    const open = h("button", { type: "button", class: "btn" }, "New campaign");
    open.addEventListener("click", () => startCampaign(open));
    main.append(h("section", { class: "page narrow" }, h("div", { class: "page-head" }, h("h1", {}, "Studio"), open),
      emptyState("Use your Dotgain key to open your campaigns.")));
    return;
  }
  const result = h("div", { class: "result", role: "status", "aria-live": "polite", "aria-label": "Studio result" });
  const problems = h("div", { class: "problems-host" });
  const body = h("div", { class: "editor-body" });
  main.append(h("section", { class: "page editor" }, result, problems, body));
  if (id === "new") {
    render(null);
    return;
  }
  body.append(loading());
  void Promise.all([api<Campaign>("GET", `/api/campaigns/${id}`), api<Person>("GET", "/api/me")]).then(([found, me]) => {
    if (!found.ok || !me.ok || found.data.creator.id !== me.data.id) {
      main.replaceChildren();
      notFoundPage(main, "", onLeave);
      return;
    }
    render(found.data);
  });

  function showProblems(list: Problem[]): void {
    if (!list.length) {
      problems.replaceChildren();
      return;
    }
    announce(result, "Check the highlighted fields.");
    problems.replaceChildren(h("section", { class: "problems", "aria-labelledby": "problems-title" },
      h("h2", { id: "problems-title" }, "Check these fields"),
      h("ul", {}, ...list.map((p) => h("li", {}, h("a", { href: `#${p.target.id}` }, `${p.label}: ${p.message}`))))));
  }

  async function reload(): Promise<Campaign | null> {
    const found = await api<Campaign>("GET", `/api/campaigns/${id === "new" ? location.pathname.split("/").pop() : id}`);
    return found.ok ? found.data : null;
  }

  function render(campaign: Campaign | null): void {
    const draft = !campaign || campaign.status === "draft";
    title(campaign ? campaign.title : "New campaign");
    const disabled = !draft;
    const titleField = field("ed-title", "Title", h("input", { type: "text", maxlength: 120, value: campaign?.title ?? "", disabled }));
    const storyField = field("ed-story", "Story", h("textarea", { rows: 8, maxlength: 20_000, disabled }, campaign?.story ?? ""));
    const goalField = field("ed-goal", "Goal (£)", moneyInput(campaign ? decimalPounds(campaign.goal) : ""), "The printer's minimum run, in pounds");
    const runField = field("ed-run", "Minimum run (copies)", h("input", { type: "number", min: 10, max: 100_000, step: 1, value: campaign?.min_run_copies ?? "", disabled }));
    const shipsField = field("ed-ships", "Ships from", options(h("select", { disabled }), "Choose a country", COUNTRIES.map((c) => [c.code, c.name]), campaign?.ships_from ?? ""));
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zoneList = zones();
    const zoneField = field("ed-zone", "Time zone", options(h("select", { disabled }), "Choose a time zone", zoneList.map((z) => [z, z]),
      campaign?.time_zone ?? (zoneList.includes(here) ? here : "Europe/London")));
    const shownDeadline = campaign ? campaign.deadline_local.replace("T", " ").replace(/:00$/, "") : "";
    const deadlineField = field("ed-deadline", "Deadline", h("input", { type: "text", placeholder: "YYYY-MM-DD HH:MM", value: shownDeadline, disabled }),
      "Local date and 24-hour time in the campaign's time zone");
    goalField.input.disabled = disabled;

    // Stretch break points
    const points: { group: HTMLFieldSetElement; copies: Field; amount: Field }[] = [];
    const pointsHost = h("div", { class: "points" });
    const addPoint = h("button", { type: "button", class: "btn btn-quiet", id: uid("add-point"), disabled }, "Add break point");
    const renumber = () => {
      points.forEach((p, n) => {
        const legend = p.group.querySelector("legend");
        if (legend) legend.textContent = `Break point ${n + 1}`;
      });
      addPoint.disabled = disabled || points.length >= 3;
    };
    const pointGroup = (copies = "", amount = "") => {
      const copiesField = field(uid("pt-copies"), "Copies", h("input", { type: "number", min: 1, step: 1, value: copies, disabled }));
      const amountField = field(uid("pt-amount"), "Amount (£)", moneyInput(amount));
      amountField.input.disabled = disabled;
      const remove = disabled ? null : h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Remove break point");
      const group = h("fieldset", { class: "group" }, h("legend", {}, ""), h("div", { class: "pair" }, copiesField.wrap, amountField.wrap), remove);
      const entry = { group, copies: copiesField, amount: amountField };
      remove?.addEventListener("click", () => {
        points.splice(points.indexOf(entry), 1);
        group.remove();
        renumber();
        addPoint.focus();
      });
      points.push(entry);
      pointsHost.append(group);
      renumber();
      return entry;
    };
    for (const p of campaign?.stretch ?? []) pointGroup(String(p.copies), decimalPounds(p.amount));
    addPoint.addEventListener("click", () => pointGroup().copies.input.focus());

    const save = h("button", { type: "submit", class: "btn" }, "Save draft");
    const form = h("form", { class: "editor-form", novalidate: true },
      titleField.wrap, storyField.wrap, h("div", { class: "pair" }, goalField.wrap, runField.wrap),
      h("div", { class: "pair" }, shipsField.wrap, zoneField.wrap), deadlineField.wrap,
      h("fieldset", { class: "group group-plain" }, h("legend", {}, "Stretch break points"), pointsHost,
        disabled ? h("p", { class: "hint" }, "Details and break points are locked once the campaign is live.") : addPoint),
      draft ? h("div", { class: "actions" }, save) : null);
    const allFields = () => [titleField, storyField, goalField, runField, shipsField, zoneField, deadlineField, ...points.flatMap((p) => [p.copies, p.amount])];

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      for (const f of allFields()) f.set(null);
      const list: Problem[] = [];
      const flag = (f: Field, label: string, message: string) => {
        f.set(message);
        list.push({ target: f.input, label, message });
      };
      const goal = parsePounds(goalField.input.value);
      if (goal === null) flag(goalField, "Goal (£)", MONEY_ERROR);
      const amounts = points.map((p, n) => {
        const pence = parsePounds(p.amount.input.value);
        if (pence === null) flag(p.amount, `Break point ${n + 1} amount`, MONEY_ERROR);
        return pence;
      });
      const deadline = DEADLINE.exec(deadlineField.input.value.trim());
      if (!deadline) flag(deadlineField, "Deadline", "Enter the deadline as YYYY-MM-DD HH:MM, for example 2026-12-01 20:00.");
      if (list.length) {
        showProblems(list);
        list[0].target.focus();
        return;
      }
      const payload = {
        title: titleField.input.value,
        story: storyField.input.value,
        goal,
        min_run_copies: runField.input.value.trim() === "" ? null : Number(runField.input.value),
        stretch: points.map((p, n) => ({ copies: Number(p.copies.input.value), amount: amounts[n] })),
        ships_from: shipsField.input.value,
        time_zone: zoneField.input.value,
        deadline_local: `${deadline?.[1]}T${deadline?.[2]}`,
      };
      showProblems([]);
      save.disabled = true;
      announce(result, "Saving draft.");
      const saved = campaign
        ? await api<Campaign>("PATCH", `/api/campaigns/${campaign.id}`, { body: payload })
        : await api<Campaign>("POST", "/api/campaigns", { body: payload });
      save.disabled = false;
      if (saved.ok) {
        if (!campaign) history.replaceState(null, "", `/studio/campaigns/${saved.data.id}`);
        render(saved.data);
        announce(result, "Draft saved.");
        return;
      }
      const fields = saved.error.fields ?? {};
      const map: [string, Field | undefined, string][] = [
        ["title", titleField, "Title"], ["story", storyField, "Story"], ["goal", goalField, "Goal (£)"],
        ["min_run_copies", runField, "Minimum run (copies)"], ["stretch", points[0]?.copies, "Stretch break points"],
        ["ships_from", shipsField, "Ships from"], ["time_zone", zoneField, "Time zone"], ["deadline_local", deadlineField, "Deadline"],
      ];
      const serverList: Problem[] = [];
      for (const [key, f, label] of map) {
        if (!fields[key]) continue;
        f?.set(fields[key]);
        serverList.push({ target: f?.input ?? addPoint, label, message: fields[key] });
      }
      if (serverList.length) {
        showProblems(serverList);
        serverList[0].target.focus();
      } else announce(result, saved.error.error === "campaign_not_draft" ? "This campaign is live, so its details are locked." : "The draft could not be saved. Try again.");
    });

    // Live preview: the cover circle and an empty Plate Fill
    const previewTitle = h("p", { class: "preview-title" }, campaign?.title || "Your title");
    titleField.input.addEventListener("input", () => {
      previewTitle.textContent = titleField.input.value || "Your title";
    });
    const coverRow = campaign?.media.find((m) => m.kind === "cover" && m.status === "stored");
    const previewCover = h("div", { class: "preview-cover" }, cover(null, "", "lead"));
    if (coverRow) {
      void (draft ? privateImage(`/api/media/${coverRow.id}`) : Promise.resolve(`/api/media/${coverRow.id}`)).then((src) => {
        if (src) previewCover.replaceChildren(cover(src, "Cover preview", "lead"));
      });
    }
    const previewGauge = new PlateFill(campaign?.goal || 10_000, (campaign?.stretch ?? []).map((p) => p.amount),
      draft ? 0 : campaign?.total ?? 0, draft ? 0 : campaign?.percent ?? 0, " of the minimum run");

    const sections: (HTMLElement | null)[] = [form];
    if (campaign) {
      if (draft) sections.push(tiersSection(campaign), imagesSection(campaign));
      const launch = h("button", { type: "button", class: "btn btn-wide" }, "Launch campaign");
      launch.addEventListener("click", () => void doLaunch(campaign, launch, { cover: "cover-input", tiers: "add-tier", deadline_local: deadlineField.input.id }));
      if (draft) sections.push(h("div", { class: "actions launch" }, launch));
      if (campaign.status === "live") sections.push(cancelControl(campaign));
    }
    body.replaceChildren(
      h("div", { class: "page-head" }, h("h1", {}, campaign ? campaign.title : "New campaign"), campaign ? statusChip(campaign.status) : null),
      h("div", { class: "editor-grid" },
        h("div", { class: "editor-main" }, ...sections),
        h("aside", { class: "editor-preview", "aria-label": "Preview" }, previewCover, previewTitle, previewGauge.el)));
    if (campaign && !draft) body.append(backersSection(campaign), settlementSection(campaign));
  }

  function tiersSection(campaign: Campaign): HTMLElement {
    const host = h("div", { class: "tiers-edit" });
    const groups: HTMLFieldSetElement[] = [];
    const add = h("button", { type: "button", class: "btn btn-quiet", id: "add-tier" }, "Add tier");
    const renumber = () => {
      groups.forEach((g, n) => {
        const legend = g.querySelector("legend");
        if (legend) legend.textContent = `Tier ${n + 1}`;
      });
      add.disabled = groups.length >= 8;
    };
    const tierGroup = (tier: Tier | null) => {
      let saved = tier;
      const tTitle = field(uid("tier-title"), "Tier title", h("input", { type: "text", maxlength: 80, value: tier?.title ?? "" }));
      const tDesc = field(uid("tier-desc"), "Description", h("textarea", { rows: 3, maxlength: 1000 }, tier?.description ?? ""));
      const tPrice = field(uid("tier-price"), "Price (£)", moneyInput(tier ? decimalPounds(tier.price) : ""));
      const tCopies = field(uid("tier-copies"), "Copies available", h("input", { type: "number", min: 1, max: 100_000, step: 1, value: tier?.quantity ?? "" }),
        "Leave blank for an open edition");
      const ship = (label: string, pence: number | undefined) => field(uid("tier-ship"), label, moneyInput(pence === undefined ? "0.00" : decimalPounds(pence)));
      const tDom = ship("Domestic shipping (£)", tier?.shipping.domestic);
      const tEur = ship("Europe shipping (£)", tier?.shipping.europe);
      const tRow = ship("Rest of world shipping (£)", tier?.shipping.rest_of_world);
      const saveTier = h("button", { type: "button", class: "btn btn-small" }, "Save tier");
      const removeTier = h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Remove tier");
      const group = h("fieldset", { class: "group" }, h("legend", {}, ""), tTitle.wrap, tDesc.wrap,
        h("div", { class: "pair" }, tPrice.wrap, tCopies.wrap),
        h("div", { class: "triple" }, tDom.wrap, tEur.wrap, tRow.wrap),
        h("div", { class: "actions" }, saveTier, removeTier));
      const fields = [tTitle, tDesc, tPrice, tCopies, tDom, tEur, tRow];
      saveTier.addEventListener("click", async () => {
        for (const f of fields) f.set(null);
        const n = groups.indexOf(group) + 1;
        const list: Problem[] = [];
        const pence = (f: Field, label: string) => {
          const value = parsePounds(f.input.value);
          if (value === null) {
            f.set(MONEY_ERROR);
            list.push({ target: f.input, label: `Tier ${n} ${label}`, message: MONEY_ERROR });
          }
          return value;
        };
        const price = pence(tPrice, "price");
        const shipping = { domestic: pence(tDom, "domestic shipping"), europe: pence(tEur, "Europe shipping"), rest_of_world: pence(tRow, "rest of world shipping") };
        if (list.length) {
          showProblems(list);
          list[0].target.focus();
          return;
        }
        const payload = {
          title: tTitle.input.value, description: tDesc.input.value, price,
          quantity: tCopies.input.value.trim() === "" ? null : Number(tCopies.input.value), shipping,
        };
        saveTier.disabled = true;
        const done = saved
          ? await api<Tier>("PATCH", `/api/tiers/${saved.id}`, { body: payload })
          : await api<Tier>("POST", `/api/campaigns/${campaign.id}/tiers`, { body: payload });
        saveTier.disabled = false;
        if (done.ok) {
          saved = done.data;
          showProblems([]);
          announce(result, "Tier saved.");
          return;
        }
        const errs = done.error.fields ?? {};
        const map: [string, Field, string][] = [["title", tTitle, "title"], ["description", tDesc, "description"], ["price", tPrice, "price"],
          ["quantity", tCopies, "copies available"], ["shipping.domestic", tDom, "domestic shipping"], ["shipping.europe", tEur, "Europe shipping"],
          ["shipping.rest_of_world", tRow, "rest of world shipping"]];
        const serverList: Problem[] = map.filter(([key]) => errs[key]).map(([key, f, label]) => {
          f.set(errs[key]);
          return { target: f.input, label: `Tier ${n} ${label}`, message: errs[key] };
        });
        if (errs.tiers) serverList.push({ target: add, label: "Reward tiers", message: errs.tiers });
        if (serverList.length) {
          showProblems(serverList);
          serverList[0].target.focus();
        } else announce(result, "The tier could not be saved. Try again.");
      });
      removeTier.addEventListener("click", async () => {
        if (saved) {
          const gone = await api<null>("DELETE", `/api/tiers/${saved.id}`);
          if (!gone.ok) {
            announce(result, "The tier could not be removed. Try again.");
            return;
          }
        }
        groups.splice(groups.indexOf(group), 1);
        group.remove();
        renumber();
        announce(result, "Tier removed.");
        add.focus();
      });
      groups.push(group);
      host.append(group);
      renumber();
      return tTitle;
    };
    for (const tier of campaign.tiers) tierGroup(tier);
    add.addEventListener("click", () => tierGroup(null).input.focus());
    return h("section", { class: "editor-section", "aria-labelledby": "tiers-title" }, h("h2", { id: "tiers-title" }, "Reward tiers"), host, add);
  }

  function imagesSection(campaign: Campaign): HTMLElement {
    const list = h("ul", { class: "image-list", "aria-label": "Images" });
    const uploading = new Map<string, HTMLLIElement>();
    const STATUS = { stored: "Stored", failed: "Not stored", uploading: "Uploading" } as const;
    const paint = (media: Media[]) => {
      list.replaceChildren(...media.map((m) => {
        const thumb = h("span", { class: "thumb" }, cover(null, "", "small"));
        if (m.status === "stored") {
          void privateImage(`/api/media/${m.id}`).then((src) => {
            if (src) thumb.replaceChildren(cover(src, m.kind === "cover" ? "Cover art" : "Spread preview", "small"));
          });
        }
        const remove = h("button", { type: "button", class: "btn btn-quiet btn-small" }, "Remove image");
        remove.addEventListener("click", async () => {
          const gone = await api<null>("DELETE", `/api/media/${m.id}`);
          if (gone.ok) announce(result, "Image removed.");
          await refreshMedia();
        });
        return h("li", { class: `image-row status-${m.status}` }, thumb,
          h("span", { class: "image-kind" }, m.kind === "cover" ? "Cover" : "Spread"),
          h("span", { class: "image-size" }, `${Math.ceil(m.bytes / 1024).toLocaleString("en-GB")} KB`),
          h("span", { class: "image-status" }, STATUS[m.status]), remove);
      }), ...uploading.values());
    };
    const refreshMedia = async () => {
      const fresh = await reload();
      if (fresh) paint(fresh.media);
    };
    const upload = async (file: File, kind: "cover" | "spread") => {
      const key = uid("up");
      uploading.set(key, h("li", { class: "image-row status-uploading" }, h("span", { class: "thumb" }, cover(null, "", "small")),
        h("span", { class: "image-kind" }, file.name), h("span", { class: "image-status" }, "Uploading")));
      await refreshMedia();
      announce(result, `Uploading ${file.name}.`);
      const sent = await api<Media>("POST", `/api/campaigns/${campaign.id}/media?kind=${kind}`, {
        bytes: file, headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      uploading.delete(key);
      await refreshMedia();
      if (sent.ok) announce(result, kind === "cover" ? "Cover stored." : "Image stored.");
      else if (sent.status === 503) announce(result, "Media storage is unavailable. The image was not stored.");
      else if (sent.status === 415) announce(result, "Use a PNG, JPEG or WebP image.");
      else if (sent.status === 413) announce(result, "That image is larger than 5 MB.");
      else announce(result, sent.error.fields?.media ?? "The image could not be uploaded.");
    };
    const coverInput = h("input", { type: "file", id: "cover-input", accept: "image/png,image/jpeg,image/webp" });
    const spreadInput = h("input", { type: "file", id: "spread-input", accept: "image/png,image/jpeg,image/webp", multiple: true });
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files?.[0];
      coverInput.value = "";
      if (file) await upload(file, "cover");
    });
    spreadInput.addEventListener("change", async () => {
      const files = [...(spreadInput.files ?? [])];
      spreadInput.value = "";
      for (const file of files) await upload(file, "spread");
    });
    paint(campaign.media);
    return h("section", { class: "editor-section", "aria-labelledby": "images-title" }, h("h2", { id: "images-title" }, "Images"),
      h("div", { class: "pair" },
        h("div", { class: "field" }, h("label", { for: "cover-input" }, "Cover art"), h("p", { class: "hint" }, "One PNG, JPEG or WebP image"), coverInput),
        h("div", { class: "field" }, h("label", { for: "spread-input" }, "Spread previews"), h("p", { class: "hint" }, "Up to six images"), spreadInput)),
      list);
  }

  async function doLaunch(campaign: Campaign, button: HTMLButtonElement, targets: Record<string, string>): Promise<void> {
    button.disabled = true;
    const launched = await api<Campaign>("POST", `/api/campaigns/${campaign.id}/launch`);
    button.disabled = false;
    if (launched.ok) {
      showProblems([]);
      render(launched.data);
      announce(result, "Campaign launched.");
      return;
    }
    if (launched.error.error === "media_not_stored") {
      announce(result, "Launch needs every image stored. Re-upload or remove the images marked Not stored.");
      return;
    }
    const fields = launched.error.fields ?? {};
    const labels: Record<string, string> = { cover: "Cover art", tiers: "Reward tiers", deadline_local: "Deadline" };
    const list = Object.keys(labels).filter((k) => fields[k]).map((k) => ({
      target: document.getElementById(targets[k]) ?? button, label: labels[k], message: fields[k],
    }));
    if (list.length) showProblems(list);
    else announce(result, "The campaign could not be launched. Try again.");
  }

  function cancelControl(campaign: Campaign): HTMLElement {
    const opener = h("button", { type: "button", class: "btn btn-quiet" }, "Cancel campaign");
    opener.addEventListener("click", () => {
      const yes = h("button", { type: "button", class: "btn" }, "Yes, release every card");
      const keep = h("button", { type: "button", class: "btn btn-quiet" }, "Keep campaign");
      const dialog = h("dialog", { class: "dialog", "aria-labelledby": "cc-title" }, h("h2", { id: "cc-title" }, "Cancel campaign"),
        h("div", { class: "dialog-form" },
          h("p", {}, `Cancelling ${campaign.title} ends it now. Every held card is released and nobody is charged.`),
          h("div", { class: "actions" }, yes, keep)));
      const open = openDialog(dialog, opener, keep);
      keep.addEventListener("click", () => open.close());
      yes.addEventListener("click", async () => {
        yes.disabled = true;
        const done = await api<Campaign>("POST", `/api/campaigns/${campaign.id}/cancel`);
        yes.disabled = false;
        if (done.ok) {
          open.close(null);
          render(done.data);
          announce(result, "Campaign cancelled. Every held card was released.");
          return;
        }
        open.close();
        announce(result, done.status === 503 ? "Payment service unavailable. The campaign is still live." : "This campaign can no longer be cancelled.");
      });
    });
    return h("div", { class: "actions" }, opener);
  }

  function backersSection(campaign: Campaign): HTMLElement {
    const host = h("div", { class: "table-host" }, loading());
    void api<BackerPledge[]>("GET", `/api/campaigns/${campaign.id}/pledges`).then((found) => {
      const pledges = found.ok ? found.data : [];
      const replaced = new Set(pledges.map((p) => p.replaces).filter(Boolean));
      const current = pledges.filter((p) => !replaced.has(p.id));
      const tierTitle = (tierId: string) => campaign.tiers.find((t) => t.id === tierId)?.title ?? "";
      const cell = (label: string, ...content: (Node | string)[]) => h("td", { role: "cell", "data-label": label }, ...content);
      host.replaceChildren(current.length
        ? h("table", { class: "backers", role: "table" },
          h("caption", {}, "Backers"),
          h("thead", {}, h("tr", { role: "row" }, ...["Backer", "Email", "Tier", "Amount", "State"].map((c) => h("th", { role: "columnheader", scope: "col" }, c)))),
          h("tbody", {}, ...current.map((p) => h("tr", { role: "row" },
            cell("Backer", p.backer.name), cell("Email", p.backer.email), cell("Tier", tierTitle(p.tier_id)),
            cell("Amount", h("span", { class: "figure-inline" }, money(p.amount))), cell("State", stateMark(p.state))))))
        : emptyState("No backers yet."));
    });
    return h("section", { class: "editor-section", "aria-labelledby": "backers-title" }, h("h2", { id: "backers-title" }, "Backers"), host);
  }

  function settlementSection(campaign: Campaign): HTMLElement {
    const host = h("div", { class: "settlement-body" }, loading());
    void api<Settlement>("GET", `/api/campaigns/${campaign.id}/settlement`).then((found) => {
      if (!found.ok) {
        host.replaceChildren(h("p", {}, "The settlement appears once the run is funded."));
        return;
      }
      const s = found.data;
      const line = (label: string, value: string) => [h("dt", {}, label), h("dd", { class: "figure-inline" }, value)];
      let sheet: HTMLElement;
      if (s.pdf === "ready") {
        sheet = h("a", { href: `/api/campaigns/${campaign.id}/settlement.pdf`, class: "btn" }, "Download settlement sheet");
        sheet.addEventListener("click", (event) => {
          event.preventDefault();
          void download(`/api/campaigns/${campaign.id}/settlement.pdf`, `dotgain-settlement-${campaign.id}.pdf`);
        });
      } else {
        sheet = h("p", { class: "pending-note" }, s.pdf === "pending" ? "Settlement sheet being prepared" : "The sheet is drawn up once every pledge is collected.");
      }
      host.replaceChildren(
        h("dl", { class: "settlement-lines" },
          ...line("Gross", money(s.gross)), ...line("Platform fees", money(s.platform_fee)),
          ...line("Processing fees", money(s.processing_fee)), ...line("Net to creator", money(s.net)),
          ...line("Captured pledges", String(s.captured_count)), ...line("Needs fixing", String(s.errored_count)),
          ...line("Dropped pledges", String(s.dropped_count))),
        sheet);
    });
    return h("section", { class: "editor-section settlement", "aria-labelledby": "settle-title" }, h("h2", { id: "settle-title" }, "Settlement"), host);
  }
};
