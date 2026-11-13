// Author-only wiring: pin events, landmarks, reference, passes, share and
// subscribers. The share page never loads this module's behaviour.

import {
  formatMetLabel,
  formatSize,
  isDayOfYear,
  parseCoordinate,
  parseMetLabel,
  dayOfYearToEpochMs,
  epochMsToIso,
  epochMsToDayOfYear,
} from "../shared/format.js";
import { api, el, fieldErrorFor, requestKey, text } from "./browser.js";
import type { ConsoleState } from "./consoleApp.js";
import type { ApiEvent, ApiLandmark, ApiMission, ApiPass } from "./shapes.js";

export interface AuthorWiringOptions {
  state: ConsoleState;
  canvas: HTMLCanvasElement;
  onReload: () => Promise<void>;
  onSearchRefresh: () => void;
}

export function authorWiring(options: AuthorWiringOptions): (fromSlider: boolean) => void {
  const { state, canvas, onReload, onSearchRefresh } = options;
  const missionId = state.missionId as string;
  const consoleStatus = el("console-status");
  const uploadStatus = el("upload-status");
  const downloadStatus = el("download-status");

  function announce(message: string): void {
    consoleStatus.textContent = message;
  }

  function announceUpload(message: string): void {
    uploadStatus.textContent = message;
  }

  function announceDownload(message: string): void {
    downloadStatus.textContent = message;
  }

  function setField(errorEl: HTMLElement, input: HTMLElement, message: string | null): void {
    if (message === null) {
      errorEl.textContent = "";
      errorEl.hidden = true;
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-errormessage");
    } else {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-errormessage", errorEl.id);
    }
  }

  // ---- Pin event dialog ----

  const pinDialog = el<HTMLElement>("pin-dialog");
  const pinHeading = el("pin-heading");
  const pinMet = el<HTMLInputElement>("pin-met");
  const pinTitle = el<HTMLInputElement>("pin-title");
  const pinNote = el<HTMLInputElement>("pin-note");
  const pinMetError = el("pin-met-error");
  const pinTitleError = el("pin-title-error");
  const pinNoteError = el("pin-note-error");
  const saveEvent = el<HTMLButtonElement>("save-event");
  const cancelPin = el<HTMLButtonElement>("cancel-pin");
  const pinEventButton = el<HTMLButtonElement>("pin-event-button");
  let pinKey = "";
  let pinPending = false;
  let pinOpener: HTMLElement | null = null;

  function openPinDialog(fromSlider: boolean): void {
    const sample = state.samples[state.lensIndex];
    if (!sample) return;
    pinOpener = fromSlider ? canvas : pinEventButton;
    pinKey = requestKey();
    pinMet.value = sample.met_label;
    text(pinHeading, `Pin at ${sample.met_label}`);
    setField(pinMetError, pinMet, null);
    setField(pinTitleError, pinTitle, null);
    setField(pinNoteError, pinNote, null);
    pinDialog.hidden = false;
    pinTitle.focus();
  }

  function closePinDialog(): void {
    pinDialog.hidden = true;
    (pinOpener ?? canvas).focus();
  }

  pinEventButton.addEventListener("click", () => openPinDialog(false));

  pinDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePinDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusables = [pinMet, pinTitle, pinNote, saveEvent, cancelPin];
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  cancelPin.addEventListener("click", closePinDialog);

  pinTitle.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveEvent.click();
    }
  });

  saveEvent.addEventListener("click", () => {
    void (async () => {
      const metValue = parseMetLabel(pinMet.value);
      if (metValue === null) {
        setField(pinMetError, pinMet, "Use a MET like +000:01:00:00 or T-000:00:05:00.");
        pinMet.focus();
        return;
      }
      setField(pinMetError, pinMet, null);
      text(pinHeading, `Pin at ${formatMetLabel(metValue)}`);
      if (pinPending) return;
      pinPending = true;
      saveEvent.disabled = true;
      announce("Pinning event...");
      const result = await api<ApiEvent & { errors?: Record<string, string> }>(
        `/api/missions/${missionId}/events`,
        {
          method: "POST",
          headers: { "Idempotency-Key": pinKey },
          body: JSON.stringify({
            met: metValue,
            title: pinTitle.value,
            note: pinNote.value === "" ? undefined : pinNote.value,
          }),
        },
      );
      pinPending = false;
      saveEvent.disabled = false;
      if (result.ok && result.body?.id) {
        state.events.push(result.body);
        state.events.sort((a, b) => a.met - b.met);
        pinDialog.hidden = true;
        await onReload();
        onSearchRefresh();
        canvas.focus();
        return;
      }
      const errors = fieldErrorFor(result.body);
      if (errors.met) {
        setField(pinMetError, pinMet, errors.met);
        pinMet.focus();
      } else if (errors.title) {
        setField(pinTitleError, pinTitle, errors.title);
        pinTitle.focus();
      } else if (errors.note) {
        setField(pinNoteError, pinNote, errors.note);
        pinNote.focus();
      } else {
        setField(pinTitleError, pinTitle, "Enter a title of 1 to 120 characters.");
        pinTitle.focus();
      }
    })();
  });

  // ---- Landmarks ----

  const landmarkName = el<HTMLInputElement>("landmark-name");
  const landmarkLat = el<HTMLInputElement>("landmark-lat");
  const landmarkLon = el<HTMLInputElement>("landmark-lon");
  const landmarkNameError = el("landmark-name-error");
  const landmarkLatError = el("landmark-lat-error");
  const landmarkLonError = el("landmark-lon-error");
  const addLandmark = el<HTMLButtonElement>("add-landmark");
  const landmarksList = el<HTMLUListElement>("landmarks-list");

  function renderLandmarks(): void {
    landmarksList.textContent = "";
    if (state.landmarks.length === 0) {
      const li = document.createElement("li");
      text(li, "No landmarks");
      landmarksList.append(li);
    }
    for (const landmark of state.landmarks) {
      const li = document.createElement("li");
      const info = document.createElement("span");
      text(info, `${landmark.name} ${landmark.lat_deg}, ${landmark.lon_deg}`);
      li.append(info);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${landmark.name}`);
      remove.addEventListener("click", () => {
        void (async () => {
          const result = await api(`/api/missions/${missionId}/landmarks/${landmark.id}`, { method: "DELETE" });
          if (result.ok) {
            state.landmarks = state.landmarks.filter((l) => l.id !== landmark.id);
            renderLandmarks();
            await onReload();
            announce(`Landmark ${landmark.name} removed.`);
            landmarkName.focus();
          }
        })();
      });
      li.append(remove);
      landmarksList.append(li);
    }
  }

  function addLandmarkAction(): void {
    const latParse = parseCoordinate(landmarkLat.value, "lat");
    const lonParse = parseCoordinate(landmarkLon.value, "lon");
    let failed = false;
    if ("error" in latParse) {
      setField(landmarkLatError, landmarkLat, latParse.error);
      failed = true;
    } else {
      setField(landmarkLatError, landmarkLat, null);
    }
    if ("error" in lonParse) {
      setField(landmarkLonError, landmarkLon, lonParse.error);
      failed = true;
    } else {
      setField(landmarkLonError, landmarkLon, null);
    }
    if (failed) {
      if ("error" in latParse) landmarkLat.focus();
      else landmarkLon.focus();
      return;
    }
    const latitude = "value" in latParse ? latParse.value : 0;
    const longitude = "value" in lonParse ? lonParse.value : 0;
    void (async () => {
      const result = await api<ApiLandmark & { errors?: Record<string, string>; error?: string; message?: string }>(
        `/api/missions/${missionId}/landmarks`,
        {
          method: "POST",
          body: JSON.stringify({
            name: landmarkName.value,
            lat_deg: latitude,
            lon_deg: longitude,
          }),
        },
      );
      if (result.ok && result.body?.id) {
        state.landmarks.push(result.body);
        renderLandmarks();
        await onReload();
        announce(`Landmark ${result.body.name} added.`);
        landmarkName.value = "";
        landmarkLat.value = "";
        landmarkLon.value = "";
        landmarkName.focus();
        return;
      }
      const errors = fieldErrorFor(result.body);
      const bodyError = result.body as { error?: string; message?: string } | null;
      if (bodyError?.error === "landmark_limit" || bodyError?.error === "landmark_name_taken") {
        setField(landmarkNameError, landmarkName, bodyError.message ?? "");
        landmarkName.focus();
        return;
      }
      if (errors.name) {
        setField(landmarkNameError, landmarkName, errors.name);
        landmarkName.focus();
        return;
      }
      if (errors.lat_deg) {
        setField(landmarkLatError, landmarkLat, errors.lat_deg);
        landmarkLat.focus();
        return;
      }
      if (errors.lon_deg) {
        setField(landmarkLonError, landmarkLon, errors.lon_deg);
        landmarkLon.focus();
      }
    })();
  }

  addLandmark.addEventListener("click", addLandmarkAction);
  for (const input of [landmarkName, landmarkLat, landmarkLon]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addLandmarkAction();
      }
    });
  }

  // ---- Reference ----

  const referenceTarget = el<HTMLInputElement>("reference-target");
  const referenceTargetError = el("reference-target-error");
  const setReference = el<HTMLButtonElement>("set-reference");
  const refreshReference = el<HTMLButtonElement>("refresh-reference");
  const referenceLineText = el("reference-line");

  function renderReferenceLine(): void {
    if (!state.mission?.reference) {
      text(referenceLineText, "No reference target");
      refreshReference.hidden = true;
      return;
    }
    const reference = state.mission.reference;
    const vectorWord = reference.vector_count === 1 ? "1 vector" : `${reference.vector_count} vectors`;
    if (reference.state === "fetching") {
      text(referenceLineText, `Reference ${reference.target}: fetching`);
    } else if (reference.state === "unavailable") {
      text(referenceLineText, `Reference ${reference.target}: unavailable`);
    } else {
      text(referenceLineText, `Reference ${reference.target}: ready, ${vectorWord}`);
    }
    refreshReference.hidden = false;
  }

  async function setReferenceAction(): Promise<void> {
    const target = referenceTarget.value.trim();
    setReference.disabled = true;
    refreshReference.disabled = true;
    try {
      if (target === "") {
        const result = await api(`/api/missions/${missionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/merge-patch+json" },
          body: JSON.stringify({ reference_target: null }),
        });
        if (result.ok) {
          if (state.mission) state.mission.reference = null;
          renderReferenceLine();
          await onReload();
          announce("Reference cleared.");
        }
        return;
      }
      announce(`Fetching reference ${target}...`);
      const result = await api<{ mission: ApiMission; outcome: string } & { errors?: Record<string, string> }>(
        `/api/missions/${missionId}/reference`,
        { method: "PUT", body: JSON.stringify({ target }) },
      );
      if (result.ok && result.body?.mission) {
        state.mission = { ...state.mission, ...result.body.mission } as ApiMission;
        renderReferenceLine();
        await onReload();
        const vectorWord =
          state.mission.reference?.vector_count === 1
            ? "1 vector"
            : `${state.mission.reference?.vector_count ?? 0} vectors`;
        if (result.body.outcome === "updated") {
          announce(`Reference ${target} ready: ${vectorWord}.`);
        } else {
          announce(`Reference ${target} is unavailable. ΔR shows — until a refresh succeeds.`);
        }
        return;
      }
      const errors = fieldErrorFor(result.body);
      if (errors.target) {
        setField(referenceTargetError, referenceTarget, errors.target);
        referenceTarget.focus();
      }
    } finally {
      setReference.disabled = false;
      refreshReference.disabled = false;
    }
  }

  setReference.addEventListener("click", () => void setReferenceAction());
  referenceTarget.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void setReferenceAction();
    }
  });

  refreshReference.addEventListener("click", () => {
    void (async () => {
      const target = state.mission?.reference?.target;
      if (!target) return;
      setReference.disabled = true;
      refreshReference.disabled = true;
      announce(`Fetching reference ${target}...`);
      try {
        const result = await api<{ mission: ApiMission; outcome: string }>(
          `/api/missions/${missionId}/reference/refresh`,
          { method: "POST" },
        );
        if (result.ok && result.body?.mission) {
          state.mission = { ...state.mission, ...result.body.mission } as ApiMission;
          renderReferenceLine();
          await onReload();
          if (result.body.outcome === "updated") {
            const vectorWord =
              state.mission.reference?.vector_count === 1
                ? "1 vector"
                : `${state.mission.reference?.vector_count ?? 0} vectors`;
            announce(`Reference ${target} ready: ${vectorWord}.`);
          } else if (result.body.outcome === "unchanged") {
            announce(`Reference ${target} unchanged.`);
          } else {
            announce(`Reference ${target} is unavailable. ΔR shows — until a refresh succeeds.`);
          }
        }
      } finally {
        setReference.disabled = false;
        refreshReference.disabled = false;
      }
    })();
  });

  // ---- Passes and uploads ----

  const captureFile = el<HTMLInputElement>("capture-file");
  const passesList = el<HTMLOListElement>("passes-list");

  interface LocalPass {
    pass: ApiPass;
    progress: number;
  }
  const localPasses: LocalPass[] = [];

  function rejectionText(reason: string): string {
    const table: Record<string, string> = {
      line_too_long: "line is longer than 1024 bytes",
      unknown_record: "unknown record type",
      too_many_samples: "more than 50000 samples",
      bad_field: "a field cannot be read",
      out_of_order: "sample time is not after the previous sample",
      no_samples: "no sample lines",
      parser_failed: "the parser stopped unexpectedly",
    };
    return table[reason] ?? reason;
  }

  function passStateText(pass: ApiPass): string {
    if (pass.state === "uploading") return "Uploading";
    if (pass.state === "stored") return "Stored";
    if (pass.state === "parsed") {
      const samplesWord = pass.sample_count === 1 ? "1 sample" : `${pass.sample_count} samples`;
      return `Parsed: ${samplesWord}`;
    }
    if (pass.rejected_line !== null) {
      return `Rejected at line ${pass.rejected_line}: ${rejectionText(pass.rejected_reason ?? "")}`;
    }
    return `Rejected: ${rejectionText(pass.rejected_reason ?? "")}`;
  }

  function renderPasses(): void {
    passesList.textContent = "";
    for (const entry of localPasses) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "pass-name";
      text(name, entry.pass.filename);
      const stateText = document.createElement("span");
      stateText.className = "pass-state";
      text(stateText, passStateText(entry.pass));
      const size = document.createElement("span");
      size.className = "num";
      text(size, `${entry.pass.size_bytes} bytes`);
      li.append(name, stateText, size);
      const actions = document.createElement("div");
      actions.className = "pass-actions";
      if (entry.pass.state !== "uploading") {
        const download = document.createElement("a");
        download.className = "download-link";
        download.textContent = "Download";
        download.setAttribute("aria-label", `Download ${entry.pass.filename}`);
        download.href = `/api/passes/${entry.pass.id}/capture`;
        download.addEventListener("click", (event) => {
          event.preventDefault();
          void downloadCapture(download.href, entry.pass.filename);
        });
        actions.append(download);
      }
      if (entry.pass.state === "parsed" || entry.pass.state === "rejected") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Delete";
        remove.setAttribute("aria-label", `Delete ${entry.pass.filename}`);
        remove.addEventListener("click", () => openDeleteDialog(entry, remove));
        actions.append(remove);
      }
      li.append(actions);
      if (entry.pass.state === "uploading") {
        const rule = document.createElement("div");
        rule.className = "progress-rule";
        const fill = document.createElement("span");
        fill.style.width = `${entry.progress}%`;
        rule.append(fill);
        li.append(rule);
      }
      passesList.append(li);
    }
  }

  async function loadPasses(): Promise<void> {
    const result = await api<{ passes: ApiPass[] }>(`/api/missions/${missionId}`);
    const body = result.body as ApiMission | null;
    localPasses.length = 0;
    for (const pass of body?.passes ?? []) {
      localPasses.push({ pass, progress: 100 });
    }
    renderPasses();
  }

  async function downloadCapture(href: string, filename: string): Promise<void> {
    try {
      const response = await fetch(href);
      if (response.status === 410) {
        announceDownload(`${filename} is no longer available.`);
        return;
      }
      if (response.status === 503) {
        announceDownload(`${filename} was not downloaded. Capture storage is offline.`);
        return;
      }
      if (!response.ok) return;
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      announceDownload(`${filename} was not downloaded. Capture storage is offline.`);
    }
  }

  function checkPass(passId: string, filename: string): void {
    const timer = setInterval(() => {
      void (async () => {
        const result = await api<ApiPass>(`/api/passes/${passId}`);
        if (!result.ok || !result.body) return;
        const pass = result.body;
        const entry = localPasses.find((p) => p.pass.id === passId);
        if (!entry) return;
        entry.pass = pass;
        renderPasses();
        if (pass.state === "parsed") {
          clearInterval(timer);
          const linesWord =
            pass.transcript_line_count === 1 ? "1 transcript line" : `${pass.transcript_line_count} transcript lines`;
          announceUpload(`${filename} parsed: ${pass.sample_count} samples, ${linesWord}.`);
          void onReload().then(() => onSearchRefresh());
        } else if (pass.state === "rejected") {
          clearInterval(timer);
          if (pass.rejected_line !== null) {
            announceUpload(`${filename} rejected at line ${pass.rejected_line}: ${rejectionText(pass.rejected_reason ?? "")}.`);
          } else {
            announceUpload(`${filename} rejected: ${rejectionText(pass.rejected_reason ?? "")}.`);
          }
          void onReload().then(() => onSearchRefresh());
        }
      })();
    }, 1000);
  }

  captureFile.addEventListener("change", () => {
    const file = captureFile.files?.[0];
    if (!file) return;
    void (async () => {
      const key = requestKey();
      const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const sha = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      const placeholder: ApiPass = {
        id: `local-${key}`,
        mission_id: missionId,
        filename: file.name,
        state: "uploading",
        size_bytes: file.size,
        sha256: sha,
        sample_count: 0,
        transcript_line_count: 0,
        rejected_line: null,
        rejected_reason: null,
        created_at: new Date().toISOString(),
      };
      const entry: LocalPass = { pass: placeholder, progress: 10 };
      localPasses.push(entry);
      renderPasses();
      announceUpload(`Uploading ${file.name}...`);

      const send = async (): Promise<Response | null> => {
        try {
          return await fetch(`/api/missions/${missionId}/passes`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "Idempotency-Key": key,
              "X-Capture-Filename": encodeURIComponent(file.name),
              "X-Capture-SHA256": sha,
            },
            body: file,
          });
        } catch {
          return null;
        }
      };

      let response = await send();
      if (response === null) {
        entry.progress = 20;
        renderPasses();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        response = await send();
      }
      while (response !== null && response.status === 409) {
        const conflict = (await response.json().catch(() => null)) as { error?: string } | null;
        if (conflict?.error !== "idempotency_request_in_progress") break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        response = await send();
      }
      if (response === null) {
        announceUpload(`${file.name} was not stored. Capture storage is offline.`);
        const index = localPasses.indexOf(entry);
        if (index >= 0) localPasses.splice(index, 1);
        renderPasses();
        return;
      }
      const bodyText = await response.text();
      const body = bodyText === "" ? null : (JSON.parse(bodyText) as Record<string, unknown>);
      if (response.status === 202) {
        const pass = body as unknown as ApiPass;
        entry.pass = pass;
        entry.progress = 100;
        renderPasses();
        const statusResult = await api<{ queue: string }>("/api/status");
        const queued = statusResult.body?.queue === "down";
        announceUpload(
          queued
            ? `${file.name} stored, checksum verified. Queued for parsing...`
            : `${file.name} stored, checksum verified. Parsing...`,
        );
        checkPass(pass.id, file.name);
        return;
      }
      const conflict = body as { error?: string; message?: string; used_bytes?: number; quota_bytes?: number } | null;
      const index = localPasses.indexOf(entry);
      if (index >= 0) localPasses.splice(index, 1);
      renderPasses();
      if (response.status === 409 && conflict?.error === "duplicate_capture") {
        announceUpload(`${file.name} is already on this mission.`);
      } else if (response.status === 409 && conflict?.error === "quota_exceeded") {
        const used = conflict.used_bytes ?? 0;
        const quota = conflict.quota_bytes ?? 0;
        announceUpload(
          `${file.name} is over your Archive quota (${formatSize(used)} of ${formatSize(quota)}).`,
        );
      } else if (response.status === 413) {
        announceUpload(`${file.name} is over the 5,000,000-byte limit.`);
      } else if (response.status === 503) {
        announceUpload(`${file.name} was not stored. Capture storage is offline.`);
      } else if (response.status === 422) {
        const errors = (body as { errors?: Record<string, string> } | null)?.errors ?? {};
        const message = errors.body ?? errors.sha256 ?? errors.filename ?? "";
        announceUpload(`${file.name} was not uploaded: ${message}`);
      }
    })();
  });

  // ---- Delete pass dialog ----

  const deleteDialog = el<HTMLElement>("delete-dialog");
  const deleteLine = el("delete-line");
  const deleteConfirm = el<HTMLButtonElement>("delete-confirm");
  const deleteKeep = el<HTMLButtonElement>("delete-keep");
  let deleteEntry: LocalPass | null = null;
  let deleteOpener: HTMLElement | null = null;
  let deletePending = false;

  function openDeleteDialog(entry: LocalPass, opener: HTMLElement): void {
    deleteEntry = entry;
    deleteOpener = opener;
    text(
      deleteLine,
      `Delete ${entry.pass.filename}? Its samples, transcript lines, pinned events and stored capture are removed for good.`,
    );
    deleteDialog.hidden = false;
    deleteKeep.focus();
  }

  function closeDeleteDialog(): void {
    deleteDialog.hidden = true;
    (deleteOpener ?? passesList).focus();
  }

  deleteDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDeleteDialog();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    if (document.activeElement === deleteConfirm) deleteKeep.focus();
    else deleteConfirm.focus();
  });

  deleteKeep.addEventListener("click", closeDeleteDialog);

  deleteConfirm.addEventListener("click", () => {
    void (async () => {
      if (!deleteEntry || deletePending) return;
      deletePending = true;
      deleteConfirm.disabled = true;
      deleteKeep.disabled = true;
      announce(`Deleting ${deleteEntry.pass.filename}...`);
      const passId = deleteEntry.pass.id;
      const result = await api(`/api/passes/${passId}`, { method: "DELETE" });
      deletePending = false;
      deleteConfirm.disabled = false;
      deleteKeep.disabled = false;
      if (result.ok) {
        deleteDialog.hidden = true;
        const index = localPasses.indexOf(deleteEntry);
        if (index >= 0) localPasses.splice(index, 1);
        renderPasses();
        passesList.focus();
        announce(`${deleteEntry.pass.filename} deleted.`);
        await onReload();
        onSearchRefresh();
      } else {
        const body = result.body as { error?: string } | null;
        deleteDialog.hidden = true;
        if (body?.error === "pass_not_settled") {
          announce(`${deleteEntry.pass.filename} is still being processed.`);
        } else if (body?.error === "storage_unavailable") {
          announce(`${deleteEntry.pass.filename} was not deleted. Capture storage is offline.`);
        } else if (body?.error === "search_unavailable") {
          announce(`${deleteEntry.pass.filename} was not deleted. Transcript search is offline.`);
        } else {
          announce(`${deleteEntry.pass.filename} was not deleted. Capture storage is offline.`);
        }
        (deleteOpener ?? passesList).focus();
      }
    })();
  });

  // ---- Share ----

  const linkExpiry = el<HTMLInputElement>("link-expiry");
  const linkExpiryError = el("link-expiry-error");
  const createShareLink = el<HTMLButtonElement>("create-share-link");
  const shareCreate = el("share-create");
  const shareActiveBox = el("share-active");
  const shareLinkInput = el<HTMLInputElement>("share-link");
  const shareExpiryLine = el("share-expiry-line");
  const copyLink = el<HTMLButtonElement>("copy-link");
  const replaceShareLink = el<HTMLButtonElement>("replace-share-link");
  const revokeShareLink = el<HTMLButtonElement>("revoke-share-link");
  const readerCountLine = el("reader-count");

  function absoluteShareUrl(token: string): string {
    const origin = window.location.origin;
    return `${origin}/s/${token}`;
  }

  function renderShare(): void {
    const shareInfo = state.mission?.share;
    if (shareInfo) {
      shareCreate.hidden = true;
      shareActiveBox.hidden = false;
      shareLinkInput.value = absoluteShareUrl(shareInfo.token);
      text(shareExpiryLine, `Expires ${epochMsToDayOfYear(Date.parse(shareInfo.expires_utc))}`);
    } else {
      shareCreate.hidden = false;
      shareActiveBox.hidden = true;
    }
  }

  async function createShare(isReplace: boolean): Promise<void> {
    const value = linkExpiry.value;
    let expiresUtc: string | null = null;
    if (value !== "") {
      if (!isDayOfYear(value)) {
        setField(linkExpiryError, linkExpiry, "Use GMT day-of-year: YYYY-DDD/HH:MM:SS.");
        linkExpiry.focus();
        return;
      }
      const ms = dayOfYearToEpochMs(value);
      expiresUtc = ms === null ? null : epochMsToIso(ms);
    }
    setField(linkExpiryError, linkExpiry, null);
    const result = await api<{ token: string; expires_utc: string } & { errors?: Record<string, string>; error?: string }>(
      `/api/missions/${missionId}/share`,
      { method: "POST", body: expiresUtc === null ? undefined : JSON.stringify({ expires_utc: expiresUtc }) },
    );
    if (result.ok && result.body?.token) {
      if (state.mission) {
        state.mission.share = {
          token: result.body.token,
          url: `/s/${result.body.token}`,
          created_at: new Date().toISOString(),
          expires_utc: result.body.expires_utc,
        };
      }
      renderShare();
      const expiresGmt = epochMsToDayOfYear(Date.parse(result.body.expires_utc));
      announce(
        isReplace
          ? `New share link ready. The previous link no longer works. It expires ${expiresGmt}.`
          : `Share link ready. It expires ${expiresGmt}.`,
      );
      await onReload();
      return;
    }
    const errors = fieldErrorFor(result.body);
    if (errors.expires_utc) {
      setField(linkExpiryError, linkExpiry, errors.expires_utc);
      linkExpiry.focus();
    }
  }

  createShareLink.addEventListener("click", () => void createShare(false));
  replaceShareLink.addEventListener("click", () => void createShare(true));

  copyLink.addEventListener("click", () => {
    void navigator.clipboard.writeText(shareLinkInput.value);
  });

  revokeShareLink.addEventListener("click", () => {
    void (async () => {
      const result = await api(`/api/missions/${missionId}/share`, { method: "DELETE" });
      if (result.ok) {
        if (state.mission) state.mission.share = null;
        renderShare();
        announce("Share link revoked. It no longer works.");
        await onReload();
      }
    })();
  });

  // The reader count follows the author stream.
  function openAuthorStream(): void {
    const stream = new EventSource(`/api/missions/${missionId}/stream`);
    stream.addEventListener("readers", (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as { readers: number | null };
      text(readerCountLine, data.readers === null ? "unknown" : String(data.readers));
    });
  }

  // ---- Subscribers ----

  const subscriberUrl = el<HTMLInputElement>("subscriber-url");
  const subscriberUrlError = el("subscriber-url-error");
  const addSubscriber = el<HTMLButtonElement>("add-subscriber");
  const subscribersList = el<HTMLUListElement>("subscribers-list");

  function renderSubscribers(): void {
    subscribersList.textContent = "";
    const subs = state.subscribers ?? [];
    if (subs.length === 0) {
      const li = document.createElement("li");
      text(li, "No subscribers");
      subscribersList.append(li);
    }
    for (const subscriber of subs) {
      const li = document.createElement("li");
      const info = document.createElement("span");
      text(info, subscriber.url);
      li.append(info);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${subscriber.url}`);
      remove.addEventListener("click", () => {
        void (async () => {
          const result = await api(`/api/missions/${missionId}/subscribers/${subscriber.id}`, {
            method: "DELETE",
          });
          if (result.ok) {
            state.subscribers = state.subscribers.filter((s) => s.id !== subscriber.id);
            renderSubscribers();
            announce(`Subscriber ${subscriber.url} removed.`);
            subscriberUrl.focus();
          } else {
            announce("Subscribers could not be changed. Webhooks are offline.");
          }
        })();
      });
      li.append(remove);
      subscribersList.append(li);
    }
  }

  function addSubscriberAction(): void {
    const url = subscriberUrl.value.trim();
    if (addSubscriber.disabled) return;
    addSubscriber.disabled = true;
    void (async () => {
      const result = await api<{ id: string; url: string; created_at: string } & {
        errors?: Record<string, string>;
        error?: string;
        message?: string;
      }>(`/api/missions/${missionId}/subscribers`, {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      addSubscriber.disabled = false;
      if (result.ok && result.body?.id) {
        state.subscribers.push({
          id: result.body.id,
          url: result.body.url,
          created_at: result.body.created_at,
        });
        renderSubscribers();
        announce(`Subscriber ${result.body.url} added.`);
        subscriberUrl.value = "";
        return;
      }
      const errors = fieldErrorFor(result.body);
      const bodyError = result.body as { error?: string; message?: string } | null;
      if (bodyError?.error === "subscriber_limit" || bodyError?.error === "subscriber_exists") {
        setField(subscriberUrlError, subscriberUrl, bodyError.message ?? "");
        subscriberUrl.focus();
        return;
      }
      if (bodyError?.error === "webhooks_unavailable") {
        announce("Subscribers could not be changed. Webhooks are offline.");
        return;
      }
      if (errors.url) {
        setField(subscriberUrlError, subscriberUrl, errors.url);
        subscriberUrl.focus();
      }
    })();
  }

  addSubscriber.addEventListener("click", addSubscriberAction);
  subscriberUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSubscriberAction();
    }
  });

  // ---- Dossier download ----

  const dossierLink = el<HTMLAnchorElement>("dossier-link");
  dossierLink.addEventListener("click", (event) => {
    event.preventDefault();
    void (async () => {
      try {
        const response = await fetch(dossierLink.href);
        if (response.status === 503) {
          announceDownload("The dossier was not created. The PDF renderer is offline.");
          return;
        }
        if (!response.ok) return;
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${state.mission?.name ?? "mission"}-dossier.pdf`;
        anchor.click();
        URL.revokeObjectURL(url);
      } catch {
        announceDownload("The dossier was not created. The PDF renderer is offline.");
      }
    })();
  });

  async function refreshAll(): Promise<void> {
    await loadPasses();
    await loadSubscribers();
    renderShare();
    renderLandmarks();
    renderReferenceLine();
  }

  async function loadSubscribers(): Promise<void> {
    const result = await api<{ subscribers: Array<{ id: string; url: string; created_at: string }> }>(
      `/api/missions/${missionId}/subscribers`,
    );
    if (result.ok && result.body) {
      state.subscribers = result.body.subscribers;
    }
    renderSubscribers();
  }

  void refreshAll();

  openAuthorStream();
  void refreshAll().then(() => {
    renderShare();
    renderLandmarks();
    renderReferenceLine();
  });

  return openPinDialog;
}
