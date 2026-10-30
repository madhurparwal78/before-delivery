import { api, ApiProblem } from "./api.ts";
import type { Sheet, SheetBlock } from "./api.ts";
import { announceProblem, announceUpdate, busyButton, clear, clearFieldErrors, h, openDialog, showFieldErrors } from "./ui.ts";
import { makeBlockReadout, makeOdometer, tierPattern, type BlockReadout } from "./odometer.ts";
import { formatDateTimeText, formatMoney } from "./format.ts";

/**
 * The inspection sheet at `/inspect/<token>`: no sign-in, one compact plat
 * map, one section per block, the add-sample form, the payable figure and the
 * sign button. Sample changes roll the readout; refusals roll it back.
 */
interface BlockSectionRefs {
  needed: HTMLElement;
  samplesArea: HTMLElement;
}

interface SheetState {
  token: string;
  sheet: Sheet;
  readouts: Map<string, BlockReadout>;
  payable: ReturnType<typeof makeOdometer> | null;
  payableCents: number;
  sections: Map<string, BlockSectionRefs>;
}

export async function renderInspect(app: HTMLElement, token: string): Promise<void> {
  clear(app);
  let sheet: Sheet;
  try {
    const response = await api<Sheet>(`/api/inspect/${encodeURIComponent(token)}`);
    sheet = response.body;
  } catch (error) {
    renderDeadLink(app, error);
    return;
  }
  const state: SheetState = {
    token,
    sheet,
    readouts: new Map(),
    payable: null,
    payableCents: sheet.payable_cents,
    sections: new Map(),
  };
  renderSheet(state, app);

  const poll = window.setInterval(async () => {
    try {
      const response = await api<Sheet>(`/api/inspect/${encodeURIComponent(token)}`);
      state.sheet = response.body;
      updateFigures(state, { announce: true });
      for (const block of state.sheet.blocks) {
        updateBlockSection(state, block);
      }
    } catch {
      window.clearInterval(poll);
    }
  }, 3000);
  window.addEventListener("popstate", () => window.clearInterval(poll), { once: true });
}

function renderDeadLink(app: HTMLElement, error: unknown): void {
  const problem = error instanceof ApiProblem ? error : null;
  const signed = problem?.code === "link_signed";
  clear(app);
  app.append(h("main", { class: "dead-link" },
    h("h1", { text: "This inspection link no longer works" }),
    h("p", { text: signed ? "The report for this orchard has been signed." : "Ask the broker for a new link." }),
  ));
}

function renderSheet(state: SheetState, app: HTMLElement): void {
  const sheet = state.sheet;
  const wrap = h("main", { class: "inspect-wrap" });
  wrap.append(h("header", { class: "inspect-header" },
    h("h1", { text: `${sheet.orchard.name} · ${sheet.order.ref}` }),
    h("p", { text: `${sheet.orchard.county} County` }),
    h("p", { class: "expiry", text: `Link expires ${formatDateTimeText(sheet.link.expires_at)} Pacific` }),
  ));

  const platGrid = h("div", { class: "plat-grid" });
  const platBlockByName = new Map<string, HTMLElement>();
  for (const block of sheet.blocks) {
    const readout = makeBlockReadout(block, { average_frames: block.average_frames, tier: block.tier });
    state.readouts.set(block.id, readout);
    const platBlock = h("div", { class: `block ${tierPattern(block.tier)}`, style: "flex-grow: 1" },
      h("span", { class: "block-name", text: block.name }),
      readout.container,
    );
    platBlockByName.set(block.name, platBlock);
    platGrid.append(platBlock);
  }
  wrap.append(h("section", {
    class: "plat",
    role: "group",
    "aria-label": `Plat map, ${sheet.orchard.name}`,
  }, platGrid));

  for (const block of sheet.blocks) {
    const samplesArea = h("ul", { class: "sample-list", "aria-label": `Samples, ${block.name}` });
    const needed = h("p", { class: "num", text: `Samples needed: ${block.sample_count} of ${block.samples_required}` });
    const section = h("section", { class: "block-section", id: `block-${block.id}` },
      h("h2", { text: block.name }),
      needed,
      h("p", { text: `Yards: ${block.yards.map((yard) => `${yard.yard_name} (${yard.hives} hives)`).join(", ") || "—"}` }),
      samplesArea,
    );
    state.sections.set(block.id, { needed, samplesArea });
    updateBlockSection(state, block);
    wrap.append(section);
  }

  const blockSelect = h("select", { "data-field": "block_id", id: "sample-block" });
  for (const block of sheet.blocks) {
    blockSelect.append(h("option", { value: block.id, text: block.name }));
  }
  const yardSelect = h("select", { "data-field": "drop_id", id: "sample-yard" });
  const colony = h("input", { type: "text", "data-field": "colony_label", id: "sample-colony" });
  const frames = h("input", { type: "number", "data-field": "frames", id: "sample-frames", min: "0", max: "20", step: "0.1" });
  const file = h("input", { type: "file", "data-field": "photo", id: "sample-photo", accept: "image/jpeg,image/png,image/webp", capture: "environment" });
  const refreshYards = (): void => {
    clear(yardSelect);
    const block = sheet.blocks.find((entry) => entry.id === blockSelect.value);
    for (const yard of block?.yards ?? []) {
      yardSelect.append(h("option", { value: yard.drop_id, text: yard.yard_name }));
    }
  };
  refreshYards();
  blockSelect.addEventListener("change", refreshYards);
  const submit = h("button", { type: "submit", class: "primary", text: "Add sample" });
  const form = h("form", { class: "add-sample", "aria-label": "Add sample", novalidate: "" },
    h("h2", { text: "Add sample" }),
    h("div", { class: "row" },
      h("div", { class: "field" }, h("label", { for: "sample-block", text: "Block" }), blockSelect),
      h("div", { class: "field" }, h("label", { for: "sample-yard", text: "Yard" }), yardSelect),
      h("div", { class: "field" }, h("label", { for: "sample-colony", text: "Colony" }), colony),
      h("div", { class: "field" }, h("label", { for: "sample-frames", text: "Frames of bees" }), frames),
      h("div", { class: "field" }, h("label", { for: "sample-photo", text: "Frame photo" }), file),
      submit,
    ),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    await addSample(state, {
      blockId: blockSelect.value,
      dropId: yardSelect.value,
      colonyLabel: colony.value,
      frames: Number(frames.value),
      photo: file.files?.[0] ?? null,
      submit,
      form,
    });
    colony.value = "";
    frames.value = "";
    file.value = "";
  });
  wrap.append(form);

  const payableOdometer = makeOdometer(sheet.payable_cents, (cents) => formatMoney(cents));
  state.payable = payableOdometer;
  const signButton = h("button", { type: "button", class: "primary", text: "Sign report" });
  signButton.addEventListener("click", () => openSignDialog(state, signButton, app));
  wrap.append(h("div", { class: "docked" },
    h("p", { class: "payable" }, "Payable ", payableOdometer.element),
    signButton,
  ));

  app.append(wrap);
}

function currentBlock(state: SheetState, blockId: string): SheetBlock | undefined {
  return state.sheet.blocks.find((entry) => entry.id === blockId);
}

function updateBlockSection(state: SheetState, block: SheetBlock): void {
  const refs = state.sections.get(block.id);
  if (!refs) return;
  refs.needed.textContent = `Samples needed: ${block.sample_count} of ${block.samples_required}`;
  clear(refs.samplesArea);
  for (const sample of block.samples) {
    const photos = h("span", { class: "sample-photos" });
    for (const photo of sample.photos) {
      photos.append(h("img", { src: photo.url, alt: `Frame photo for colony ${sample.colony_label}` }));
    }
    refs.samplesArea.append(h("li", {},
      h("span", { text: `Colony ${sample.colony_label}` }),
      h("span", { class: "frames", text: `${sample.frames.toFixed(1)} frames` }),
      photos,
      h("button", {
        type: "button",
        text: `Add photo to ${sample.colony_label}`,
        onclick: (event: Event) => pickPhoto(state, sample.id, sample.colony_label, event.target as HTMLButtonElement),
      }),
      h("button", {
        type: "button",
        text: `Remove sample ${sample.colony_label}`,
        onclick: (event: Event) => removeSample(state, sample.id, sample.colony_label, block, event.target as HTMLButtonElement),
      }),
    ));
  }
}

/** The browser's provisional average and tier for a not-yet-accepted sample. */
function provisionalFigures(block: SheetBlock, frames: number): { average: number | null; tier: string | null } {
  const known = block.samples.map((sample) => sample.frames).concat([frames]);
  const average = Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10;
  const tier = average < 6.0 ? "none" : average < 8.0 ? "reduced" : average < 10.0 ? "standard" : "bonus";
  return { average, tier };
}

async function addSample(state: SheetState, input: {
  blockId: string;
  dropId: string;
  colonyLabel: string;
  frames: number;
  photo: File | null;
  submit: HTMLButtonElement;
  form: HTMLElement;
}): Promise<void> {
  const block = currentBlock(state, input.blockId);
  if (!block) return;
  const readout = state.readouts.get(block.id);
  if (Number.isFinite(input.frames)) {
    const provisional = provisionalFigures(block, input.frames);
    readout?.update({ average_frames: provisional.average, tier: provisional.tier }, { provisional: true });
  }

  const restore = busyButton(input.submit);
  announceUpdate(`Saving sample ${input.colonyLabel}…`);
  try {
    const response = await api<{
      sample: { id: string };
      block: { id: string; sample_count: number; average_frames: number | null; tier: string | null; payable_cents: number };
      payable_cents: number;
    }>(`/api/inspect/${encodeURIComponent(state.token)}/samples`, {
      method: "POST",
      body: {
        block_id: input.blockId,
        drop_id: input.dropId,
        colony_label: input.colonyLabel,
        frames: input.frames,
      },
    });
    applyServerFigures(state, block.id, response.body.block, response.body.payable_cents, { announce: true });
    announceUpdate(`Sample ${input.colonyLabel} saved.`);
    await refreshSheetData(state);
    const freshBlock = currentBlock(state, block.id);
    if (freshBlock) updateBlockSection(state, freshBlock);
    if (input.photo) {
      await uploadPhoto(state, response.body.sample.id, input.photo, input.colonyLabel, input.submit);
    }
  } catch (error) {
    readout?.average.rollback();
    const problem = error instanceof ApiProblem ? error : null;
    if (problem?.fields && Object.keys(problem.fields).length > 0) {
      showFieldErrors(input.form, problem.fields);
    } else {
      announceProblem(problem?.message ?? "Bloom Desk can't reach its server. Check your connection and try again.");
    }
  } finally {
    restore();
  }
}

async function refreshSheetData(state: SheetState): Promise<void> {
  const response = await api<Sheet>(`/api/inspect/${encodeURIComponent(state.token)}`);
  state.sheet = response.body;
}

async function removeSample(state: SheetState, sampleId: string, colonyLabel: string, block: SheetBlock, button: HTMLButtonElement): Promise<void> {
  const restore = busyButton(button);
  announceUpdate(`Removing sample ${colonyLabel}…`);
  try {
    const response = await api<{
      block: { average_frames: number | null; tier: string | null; payable_cents: number };
      payable_cents: number;
    }>(`/api/inspect/${encodeURIComponent(state.token)}/samples/${sampleId}`, { method: "DELETE" });
    applyServerFigures(state, block.id, response.body.block, response.body.payable_cents, { announce: true });
    announceUpdate(`Sample ${colonyLabel} removed.`);
    await refreshSheetData(state);
    const freshBlock = currentBlock(state, block.id);
    if (freshBlock) updateBlockSection(state, freshBlock);
  } catch (error) {
    const problem = error instanceof ApiProblem ? error : null;
    announceProblem(problem?.message ?? "Bloom Desk can't reach its server. Check your connection and try again.");
  } finally {
    restore();
  }
}

async function pickPhoto(state: SheetState, sampleId: string, colonyLabel: string, opener: HTMLButtonElement): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    await uploadPhoto(state, sampleId, file, colonyLabel, opener);
  });
  input.click();
}

async function uploadPhoto(state: SheetState, sampleId: string, file: File, colonyLabel: string, button: HTMLButtonElement): Promise<void> {
  const restore = busyButton(button);
  announceUpdate("Uploading photo…");
  const formData = new FormData();
  formData.append("photo", file);
  try {
    await api(`/api/inspect/${encodeURIComponent(state.token)}/samples/${sampleId}/photos`, { formData });
    announceUpdate(`Photo added to sample ${colonyLabel}.`);
    await refreshSheetData(state);
    for (const block of state.sheet.blocks) {
      updateBlockSection(state, block);
    }
  } catch (error) {
    const problem = error instanceof ApiProblem ? error : null;
    if (problem?.status === 413) {
      announceProblem("Photos must be 8,000,000 bytes or smaller.");
    } else if (problem?.status === 415) {
      announceProblem("Photos must be JPEG, PNG or WebP images.");
    } else if (problem?.status === 503) {
      announceProblem("Photo storage is unreachable. The sample is saved without this photo; try again in a minute.");
    } else {
      announceProblem(problem?.message ?? "Bloom Desk can't reach its server. Check your connection and try again.");
    }
  } finally {
    restore();
  }
}

function applyServerFigures(
  state: SheetState,
  blockId: string,
  block: { average_frames: number | null; tier: string | null },
  payableCents: number,
  options: { announce: boolean },
): void {
  const readout = state.readouts.get(blockId);
  readout?.update(block, {
    provisional: false,
    announce: options.announce,
    payableText: formatMoney(payableCents),
    onTierSettled: (tier) => {
      const platBlock = Array.from(document.querySelectorAll<HTMLElement>(".plat-grid .block"))
        .find((node) => node.querySelector(".block-name")?.textContent === readout?.blockName);
      if (platBlock) platBlock.className = `block ${tierPattern(tier)}`;
    },
  });
  state.payableCents = payableCents;
  state.payable?.settle(payableCents);
}

function updateFigures(state: SheetState, options: { announce: boolean }): void {
  const sheet = state.sheet;
  if (state.payableCents !== sheet.payable_cents) {
    state.payableCents = sheet.payable_cents;
    state.payable?.settle(sheet.payable_cents);
  }
  for (const block of sheet.blocks) {
    const readout = state.readouts.get(block.id);
    if (!readout) continue;
    if (readout.currentAverage !== block.average_frames || readout.currentTier !== block.tier) {
      readout.update(block, {
        provisional: false,
        announce: options.announce,
        payableText: formatMoney(sheet.payable_cents),
        onTierSettled: (tier) => {
          const platBlock = Array.from(document.querySelectorAll<HTMLElement>(".plat-grid .block"))
            .find((node) => node.querySelector(".block-name")?.textContent === block.name);
          if (platBlock) platBlock.className = `block ${tierPattern(tier)}`;
        },
      });
    }
  }
}

function openSignDialog(state: SheetState, opener: HTMLButtonElement, app: HTMLElement): void {
  const sheet = state.sheet;
  const missing = sheet.blocks
    .filter((block) => block.hives_delivered > 0 && block.sample_count < block.samples_required)
    .map((block) => `${block.name} needs ${block.samples_required - block.sample_count} more samples`);
  const name = h("input", { type: "text", "data-field": "inspector_name", id: "sign-name" });
  const attest = h("input", { type: "checkbox", "data-field": "attest", id: "sign-attest" });
  const submit = h("button", { type: "submit", class: "primary", text: "Sign and send" });
  const form = h("form", { novalidate: "" },
    h("h2", { text: "Sign report" }),
    missing.length > 0 ? h("p", { class: "message", text: missing.join("; ") }) : "",
    h("div", { class: "field" }, h("label", { for: "sign-name", text: "Full name" }), name),
    h("div", { class: "field" },
      h("label", { for: "sign-attest" }, attest, h("span", { text: " I counted these colonies and these figures are true" }))),
    h("div", { class: "dialog-actions" }, submit),
  );
  const dialog = openDialog({ label: "Sign report", content: [form], opener });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors(form);
    const restore = busyButton(submit);
    announceUpdate("Signing report…");
    const key = `sign-${crypto.randomUUID()}`;
    try {
      await api(`/api/inspect/${encodeURIComponent(state.token)}/sign`, {
        method: "POST",
        idempotencyKey: key,
        body: { inspector_name: name.value, attest: attest.checked },
      });
      announceUpdate("Report signed. The grower's notice is on its way.");
      restore();
      dialog.close();
      opener.focus();
      renderDeadLink(app, new ApiProblem(410, "link_signed", "", {}));
    } catch (error) {
      restore();
      const problem = error instanceof ApiProblem ? error : null;
      if (problem?.fields && Object.keys(problem.fields).length > 0) {
        showFieldErrors(form, problem.fields);
      } else if (problem?.status === 503) {
        const storageDown = problem.code === "storage_unavailable";
        announceProblem(storageDown
          ? "Report storage is unreachable, so nothing was signed. Your samples are saved; try again in a minute."
          : "Billing is unreachable, so nothing was signed. Your samples are saved; try again in a minute.");
      } else {
        announceProblem(problem?.message ?? "Bloom Desk can't reach its server. Check your connection and try again.");
      }
    }
  });
}
