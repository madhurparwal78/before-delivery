// The Packet screen: status panel, rows, check, render, send, preview
// (DP-38, DP-39, DP-40, DP-42, DP-44, DP-66, DP-73, DP-84, DP-96, DP-97).
import { app, navigate, persist } from "../app.js";
import { el, focusable } from "../dom.js";
import { apiGet, apiPost, ApiError } from "../api.js";
import { renderConnection, shell } from "./shell.js";
import { packetSentences, packetStateLabels, connectionSentences } from "../../shared/sentences.js";
import type { Packet, PacketRow, ProgramDetail } from "../../shared/api.js";
import { skyToScreen } from "../../shared/projection.js";
import { parseStrokeFileText, type StrokeFile } from "../../shared/strokes.js";
import type { TrainId } from "../../shared/optics.js";

interface PacketMessage {
  readonly sentence: string | null;
}

const packetMessages = new Map<string, PacketMessage>();
const inFlightSend = new Set<string>();

export async function renderPacket(root: HTMLElement, packetId: string): Promise<void> {
  const accountId = app.state.signedInAccountId ?? (app.account ? app.account.id : null)!;
  const store = app.state.stores[accountId];
  let packet: Packet | null = store?.packets[packetId] ?? null;
  if (navigator.onLine) {
    try {
      packet = await apiGet.packet(packetId);
      const accountStore = app.state.stores[accountId] ??= {
        kit: null, sites: [], programs: [], programDetails: {}, sessions: {}, sessionOrder: [],
        histories: {}, observations: {}, strokes: {}, packets: {}, lastRefreshAt: 0,
      };
      accountStore.packets[packetId] = packet;
      persist();
    } catch (error) {
      const apiError = error as ApiError;
      if (apiError?.status === 404 && !packet) {
        const parts = shell("Not found", []);
        parts.column.append(el("p", { class: "notfound", text: "We couldn't find that here." }));
        root.append(parts.column);
        return;
      }
      if (apiError?.status === 401) {
        const parts = shell("Packet", []);
        parts.connection.textContent = "";
        parts.connection.append(el("p", { class: "banner", text: connectionSentences.signedOutWaiting(0).replace(" 0 ", " ") }));
        root.append(parts.column);
        return;
      }
    }
  }
  if (!packet) {
    if (store?.packets[packetId]) {
      packet = store.packets[packetId]!;
    } else {
      const parts = shell("Packet", []);
      parts.connection.append(el("p", { class: "banner", text: connectionSentences.notOnDevice }));
      root.append(parts.column);
      return;
    }
  }

  const program = store?.programDetails[packet.program_id] ?? null;
  const programName = program?.name ?? "Program";
  const parts = shell(`Packet ${packet.number} · ${programName}`, []);
  const column = parts.column;

  // ---- Packet status panel (DP-38, DP-85) --------------------------------
  const statusPanel = focusable(el("div", { class: "status packet-status", role: "status", "aria-label": "Packet status" }));
  const message = packetMessages.get(packetId) ?? { sentence: null };
  let highestRevision = packet.revision;

  const sentenceFor = (p: Packet): string => {
    if (message.sentence) return message.sentence;
    switch (p.state) {
      case "draft": return p.returned_to_draft ? packetSentences.returnedToDraft : packetSentences.draft;
      case "checked": return packetSentences.checked(p.rows.length);
      case "rendering": return packetSentences.rendering(p.number);
      case "rendered": return p.pdf ? packetSentences.rendered(p.number, p.pdf.pages) : packetSentences.rendered(p.number, 0);
      case "render_failed": return p.failure === "storage_unavailable" ? packetSentences.renderFailedStorage : packetSentences.renderFailedRenderer;
      case "sending": return packetSentences.sending(p.number, program?.coordinator_name ?? "the coordinator");
      case "sent": return packetSentences.sent(p.number, program?.coordinator_name ?? "the coordinator");
      case "send_failed": return packetSentences.sendFailed(p.number);
      default: return packetSentences.draft;
    }
  };

  const writeStatus = (p: Packet): void => {
    const label = packetStateLabels[p.state];
    const sentence = sentenceFor(p);
    const next = `${label}\n${sentence}`;
    if (statusPanel.textContent !== next) statusPanel.textContent = next;
  };
  statusPanel.classList.add("packet-status-line");
  writeStatus(packet);

  const applyPacket = (p: Packet, focusTarget?: HTMLElement): void => {
    if (p.revision >= highestRevision) {
      highestRevision = p.revision;
      packet = p;
      writeStatus(p);
    }
    // Polling runs while that packet's screen is open and the packet is
    // rendering or sending, with one timer and one request in flight (DP-85).
    ensurePolling();
    if (focusTarget) focusTarget.focus();
  };

  // ---- Rows ----------------------------------------------------------------
  const rowsRegion = el("ul", { class: "rows", role: "list", "aria-label": "Packet rows" });
  const rowsStatus = el("div", { class: "status", role: "status", "aria-label": "Packet rows status" });
  const problemsList = focusable(el("ul", { class: "rows problems", role: "list", "aria-label": "Packet problems", hidden: "hidden" }));

  let actionInFlight = false;

  const renderRows = (): void => {
    rowsRegion.textContent = "";
    if (!packet) return;
    const observationById = new Map<string, { designation: string; evening_date: string }>();
    for (const row of packet.rows) {
      observationById.set(row.observation_id, { designation: row.designation, evening_date: row.evening_date });
    }
    const listed = packet.rows.length > 0
      ? packet.rows
      : (store?.packets[packetId]?.observation_ids ?? packet.observation_ids).map((id) => {
          // Before a first check, rows come from the cited observations.
          const detail = findObservation(id);
          return { observation_id: id, designation: detail?.designation ?? id, evening_date: detail?.evening_date ?? "", edition: 0, strokes_sha256: null } as PacketRow;
        });
    listed.forEach((row, index) => {
      const open = el("a", { class: "row-ink link", text: row.designation, href: `/objects/${objectIdOf(row.observation_id)}`, onclick: (event: MouseEvent) => { event.preventDefault(); navigate(`/objects/${objectIdOf(row.observation_id)}`); } });
      const moveUp = index > 0 && listed.length > 1 ? el("button", { class: "button ghost", text: `Move ${row.designation} up` }) : null;
      const moveDown = index < listed.length - 1 && listed.length > 1 ? el("button", { class: "button ghost", text: `Move ${row.designation} down` }) : null;
      const canRemove = listed.length > 1 && (packet!.state === "draft" || packet!.state === "checked");
      const remove = canRemove ? el("button", { class: "button ghost", text: `Remove ${row.designation}` }) : null;
      const performRowsAction = async (ids: string[], pressed: HTMLElement, focusAfter: HTMLElement | null): Promise<void> => {
        if (actionInFlight) return;
        actionInFlight = true;
        pressed.focus();
        try {
          const updated = await apiPost.packetRows(packetId, { revision: packet!.revision, observation_ids: ids });
          applyPacket(updated);
          renderRows();
          if (focusAfter) focusAfter.focus();
        } catch (error) {
          handlePacketActionError(error, statusPanel);
        } finally {
          actionInFlight = false;
        }
      };
      if (remove) {
        remove.addEventListener("click", async () => {
          if (actionInFlight) return;
          actionInFlight = true;
          remove.focus();
          try {
            const remaining = listed.filter((candidate) => candidate.observation_id !== row.observation_id).map((candidate) => candidate.observation_id);
            const updated = await apiPost.packetRows(packetId, { revision: packet!.revision, observation_ids: remaining });
            applyPacket(updated);
            renderRows();
            // Focus moves to the next row's Remove, else the previous, else Check packet.
            const nextIndex = Math.min(index, listed.length - 2);
            const nextRemove = rowsRegion.querySelectorAll("li")[nextIndex]?.querySelector('button[class*="ghost"]');
            if (nextIndex >= 0 && nextRemove) {
              (nextRemove as HTMLElement).focus();
            } else {
              checkButton?.focus();
            }
          } catch (error) {
            handlePacketActionError(error, statusPanel);
          } finally {
            actionInFlight = false;
          }
        });
      }
      if (moveUp) {
        moveUp.addEventListener("click", () => {
          const ids = listed.map((candidate) => candidate.observation_id);
          const target = ids[index]!;
          ids[index] = ids[index - 1]!;
          ids[index - 1] = target;
          void performRowsAction(ids, moveUp, null).then(() => {
            rowsStatus.textContent = packetSentences.rowMoved(row.designation, index, listed.length);
          });
        });
      }
      if (moveDown) {
        moveDown.addEventListener("click", () => {
          const ids = listed.map((candidate) => candidate.observation_id);
          const target = ids[index]!;
          ids[index] = ids[index + 1]!;
          ids[index + 1] = target;
          void performRowsAction(ids, moveDown, null).then(() => {
            rowsStatus.textContent = packetSentences.rowMoved(row.designation, index + 2, listed.length);
          });
        });
      }
      rowsRegion.append(el("li", { class: "row" },
        el("div", { class: "row-main" },
          el("span", { class: "row-ink", text: `${index + 1}. ${row.designation}` }),
          el("span", { class: "row-muted", text: row.evening_date }),
        ),
        el("div", { class: "row-actions" }, moveUp, moveDown, remove),
      ));
    });
  };

  const findObservation = (id: string): { designation: string; evening_date: string; object_id: string } | null => {
    for (const history of Object.values(store?.histories ?? {})) {
      for (const observation of history.observations) {
        if (observation.id === id) {
          return { designation: observation.designation, evening_date: observation.evening_date, object_id: observation.object_id };
        }
      }
    }
    return null;
  };
  const objectIdOf = (id: string): string => findObservation(id)?.object_id ?? "m13";

  renderRows();

  // ---- Action buttons (DP-33, DP-40, DP-41, DP-84) --------------------------
  let checkButton: HTMLElement | null = null;
  const actions = el("div", { class: "packet-actions" });

  const rebuildActions = (): void => {
    actions.textContent = "";
    if (!packet) return;
    const state = packet.state;
    if (state === "draft") {
      checkButton = el("button", { class: "button primary", text: "Check packet" });
      (checkButton as HTMLElement).addEventListener("click", async () => {
        if (actionInFlight) return;
        actionInFlight = true;
        (checkButton as HTMLElement).focus();
        try {
          const updated = await apiPost.packetCheck(packetId, { revision: packet!.revision });
          applyPacket(updated);
          clearProblems();
          rebuildActions();
          statusPanel.focus();
        } catch (error) {
          const apiError = error as ApiError;
          if (apiError?.status === 422 && apiError.extra?.["reasons"]) {
            showProblems(apiError.extra["reasons"] as { message: string }[]);
            problemsList.focus();
          } else {
            handlePacketActionError(error, statusPanel);
          }
        } finally {
          actionInFlight = false;
        }
      });
      actions.append(checkButton);
    }
    if (state === "checked") {
      const render = el("button", { class: "button primary", text: "Render packet" });
      render.addEventListener("click", async () => {
        if (actionInFlight) return;
        actionInFlight = true;
        render.focus();
        try {
          const updated = await apiPost.packetRender(packetId, { revision: packet!.revision });
          applyPacket(updated);
          rebuildActions();
          statusPanel.focus();
        } catch (error) {
          handlePacketActionError(error, statusPanel);
        } finally {
          actionInFlight = false;
        }
      });
      actions.append(render);
    }
    if (state === "render_failed") {
      const retry = el("button", { class: "button primary", text: "Try again" });
      retry.addEventListener("click", async () => {
        if (actionInFlight) return;
        actionInFlight = true;
        retry.focus();
        try {
          const updated = await apiPost.packetRender(packetId, { revision: packet!.revision });
          applyPacket(updated);
          rebuildActions();
          statusPanel.focus();
        } catch (error) {
          handlePacketActionError(error, statusPanel);
        } finally {
          actionInFlight = false;
        }
      });
      actions.append(retry);
    }
    if ((state === "rendered" || state === "send_failed") && !inFlightSend.has(packetId)) {
      const send = el("button", { class: "button primary", text: "Send to coordinator" });
      send.addEventListener("click", () => openSendDialog(send));
      actions.append(send);
    }
    if (state === "rendered" || state === "sending" || state === "sent" || state === "send_failed") {
      const download = el("a", { class: "button link", text: "Download PDF", href: `/api/packets/${packetId}/pdf` });
      actions.append(download);
    }
  };
  rebuildActions();

  const clearProblems = (): void => {
    problemsList.setAttribute("hidden", "hidden");
    problemsList.textContent = "";
  };
  const showProblems = (reasons: readonly { message: string }[]): void => {
    problemsList.textContent = "";
    for (const reason of reasons) {
      problemsList.append(el("li", { class: "row problem-row", text: reason.message }));
    }
    problemsList.removeAttribute("hidden");
  };

  const openSendDialog = (opener: HTMLElement): void => {
    const coordinator = program?.coordinator_name ?? "the coordinator";
    const dialog = el("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": "Send packet" },
      el("p", { class: "dialog-text", text: `Send this packet to ${coordinator} (${program?.coordinator_name ? coordinatorName(program) : ""})?` }),
      el("div", { class: "dialog-actions" },
        el("button", { class: "button", text: "Cancel" }),
        el("button", { class: "button primary", text: "Send now" }),
      ),
    );
    const buttons = Array.from(dialog.querySelectorAll("button")) as HTMLElement[];
    const [cancel, sendNow] = [buttons[0]!, buttons[1]!];
    const close = (): void => {
      dialog.remove();
      opener.focus();
    };
    const performSend = async (): Promise<void> => {
      dialog.remove();
      inFlightSend.add(packetId);
      // The panel shows Sending with no Send to coordinator button, and the
      // browser makes exactly one send request (DP-66).
      if (packet) {
        statusPanel.textContent = `${packetStateLabels.sending}\n${packetSentences.sending(packet.number, coordinator)}`;
      }
      rebuildActions();
      statusPanel.focus();
      const revision = packet!.revision;
      try {
        const answer = await apiPost.packetSend(packetId, { revision });
        inFlightSend.delete(packetId);
        packetMessages.delete(packetId);
        applyPacket(answer);
        rebuildActions();
        renderPreview();
      } catch (error) {
        inFlightSend.delete(packetId);
        const apiError = error as ApiError;
        if (apiError?.status === 503) {
          if (apiError.code === "mail_unavailable") {
            packetMessages.set(packetId, { sentence: packetSentences.mailOutage(packet!.number) });
          } else {
            packetMessages.set(packetId, { sentence: packetSentences.sendStorageOutage(packet!.number) });
          }
          // The packet keeps its previous state and revision.
          const refreshed = await apiGet.packet(packetId).catch(() => null);
          if (refreshed) {
            packet = refreshed;
            highestRevision = Math.max(highestRevision, refreshed.revision);
            writeStatus(refreshed);
          } else {
            writeStatus(packet!);
          }
          rebuildActions();
        } else if (apiError?.status === 502) {
          packetMessages.delete(packetId);
          const refreshed = await apiGet.packet(packetId).catch(() => null);
          if (refreshed) {
            packet = refreshed;
            writeStatus(refreshed);
          } else {
            packet = { ...packet!, state: "send_failed" };
            writeStatus(packet);
          }
          rebuildActions();
        } else if (apiError?.status === 412 || apiError?.status === 409) {
          packetMessages.set(packetId, { sentence: packetSentences.staleAction });
          const refreshed = (apiError.extra?.["packet"] as Packet | undefined) ?? await apiGet.packet(packetId).catch(() => null);
          if (refreshed) {
            packet = refreshed;
            highestRevision = Math.max(highestRevision, refreshed.revision);
            writeStatus(refreshed);
            renderRows();
          }
          rebuildActions();
        } else {
          handlePacketActionError(error, statusPanel);
          rebuildActions();
        }
      } finally {
        inFlightSend.delete(packetId);
      }
    };
    sendNow.addEventListener("click", performSend);
    cancel.addEventListener("click", close);
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index === buttons.length - 1 ? 0 : index + 1);
        buttons[next]!.focus();
      }
    });
    document.body.append(dialog);
    sendNow.focus();
  };

  // ---- Paper preview (DP-39, DP-97) -----------------------------------------
  const previewRegion = el("section", { class: "paper-preview", role: "region", "aria-label": "Paper preview" });
  const renderPreview = (): void => {
    previewRegion.textContent = "";
    if (!packet?.pdf || !packet.rows.length) return;
    const total = packet.pdf.pages;
    // Cover plus one page per row, in PDF order.
    const cover = previewPage(1, total, `Observing log packet ${packet.number}`, true, null);
    previewRegion.append(cover);
    packet.rows.forEach((row, index) => {
      previewRegion.append(previewPage(index + 2, total, `${row.designation}`, false, row));
    });
  };
  const previewPage = (number: number, total: number, title: string, isCover: boolean, row: PacketRow | null): HTMLElement => {
    const page = el("article", { class: "paper-page", "aria-label": `Page ${number} of ${total}` });
    page.append(el("p", { class: "paper-title", text: title }));
    if (isCover) {
      page.append(
        el("p", { class: "paper-line", text: programName }),
        el("p", { class: "paper-line", text: `Observer: ${app.account?.display_name ?? ""} (${app.account?.email ?? ""})` }),
        el("p", { class: "paper-line", text: `Objects: ${packet!.rows.length}` }),
        el("p", { class: "paper-line", text: `Coordinator: ${program?.coordinator_name ?? ""}` }),
      );
      return page;
    }
    const observation = findObservationFull(row!.observation_id);
    if (observation) {
      page.append(
        el("p", { class: "paper-line", text: `UT: ${observation.observed_at ? `${observation.observed_at.slice(0, 10)} ${observation.observed_at.slice(11, 16)} UT` : "—"}` }),
        el("p", { class: "paper-line", text: `Site: ${observation.site.name}` }),
        el("p", { class: "paper-line", text: `Seeing: ${observation.seeing ?? "—"}/10` }),
        el("p", { class: "paper-line", text: `Transparency: NELM ${observation.transparency_nelm ?? "—"}` }),
        el("p", { class: "paper-line", text: `Telescope: ${telescopeNameOf(observation)}, ${observation.derived.aperture_mm} mm aperture` }),
        el("p", { class: "paper-line", text: `Eyepiece: ${eyepieceNameOf(observation)} at ${observation.derived.magnification}×` }),
        el("p", { class: "paper-line", text: `True field: ${observation.derived.true_field_arcmin}′ · Exit pupil: ${observation.derived.exit_pupil_mm.toFixed(1)} mm` }),
        el("p", { class: "paper-line", text: `Orientation: ${observation.derived.orientation.sentence}` }),
        el("p", { class: "paper-line", text: `Program rules: edition ${row!.edition}` }),
      );
      const sketchText = store?.strokes[row!.observation_id] ?? null;
      if (sketchText) {
        page.append(previewSketch(sketchText, observation.optics.train, observation.derived.true_field_arcmin));
      }
      const description = el("p", { class: "paper-description" });
      description.textContent = `Description: ${observation.description}`;
      page.append(description);
    }
    return page;
  };

  const findObservationFull = (id: string): import("../../shared/api.js").Observation | null => {
    for (const history of Object.values(store?.histories ?? {})) {
      for (const observation of history.observations) {
        if (observation.id === id) return observation;
      }
    }
    return null;
  };
  const telescopeNameOf = (observation: import("../../shared/api.js").Observation): string =>
    store?.kit?.telescopes.find((t) => t.id === observation.optics.telescope_id)?.name ?? "";
  const eyepieceNameOf = (observation: import("../../shared/api.js").Observation): string =>
    store?.kit?.eyepieces.find((e) => e.id === observation.optics.eyepiece_id)?.name ?? "";

  const previewSketch = (strokesText: string, train: TrainId, trueField: number): HTMLElement => {
    const file: StrokeFile | null = parseStrokeFileText(strokesText);
    const wrap = el("div", { class: "paper-sketch" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.classList.add("paper-sketch-svg");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "60");
    circle.setAttribute("cy", "60");
    circle.setAttribute("r", "56");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "#101623");
    svg.append(circle);
    if (file) {
      for (const stroke of file.strokes) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", stroke.points.map((point, index) => {
          const { x, y } = skyToScreen(point, train, trueField);
          return `${index === 0 ? "M" : "L"}${(60 + x * 56).toFixed(1)},${(60 + y * 56).toFixed(1)}`;
        }).join(" "));
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#101623");
        path.setAttribute("stroke-width", stroke.width === "broad" ? "1.8" : stroke.width === "medium" ? "1.1" : "0.6");
        svg.append(path);
      }
      for (const star of file.stars) {
        const { x, y } = skyToScreen(star.at, train, trueField);
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", String(60 + x * 56));
        dot.setAttribute("cy", String(60 + y * 56));
        dot.setAttribute("r", String(0.8 + star.brightness * 0.3));
        dot.setAttribute("fill", "#101623");
        svg.append(dot);
      }
    }
    wrap.append(svg, el("p", { class: "paper-compass", text: trainSentence(train) }));
    return wrap;
  };

  const trainSentence = (train: TrainId): string => {
    if (train === "mirror_diagonal") return "North up, east right.";
    if (train === "erecting_prism") return "North up, east left.";
    return "North down, east right.";
  };

  const coordinatorName = (p: ProgramDetail): string => p.coordinator_name;

  renderPreview();

  column.append(statusPanel, rowsRegion, rowsStatus, problemsList, actions, previewRegion);
  root.append(column);
  renderConnection(parts.connection);

  // Poll once a second while rendering or sending (DP-85).
  let pollTimer: number | null = null;
  let pollInFlight = false;
  const poll = async (): Promise<void> => {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const refreshed = await apiGet.packet(packetId);
      if (refreshed.revision >= highestRevision || refreshed.state === "sent") {
        if (refreshed.revision > highestRevision) {
          packetMessages.delete(packetId);
        }
        highestRevision = Math.max(highestRevision, refreshed.revision);
        packet = refreshed;
        writeStatus(refreshed);
        rebuildActions();
        if (refreshed.state !== "rendering" && refreshed.state !== "sending") {
          if (pollTimer !== null) window.clearInterval(pollTimer);
          pollTimer = null;
          renderPreview();
          renderRows();
        }
      }
    } catch {
      // Offline: stop polling until the screen is reopened.
    } finally {
      pollInFlight = false;
    }
  };
  const ensurePolling = (): void => {
    if (pollTimer !== null) return;
    if (!packet || (packet.state !== "rendering" && packet.state !== "sending")) return;
    pollTimer = window.setInterval(() => void poll(), 1000);
    void poll();
  };
  ensurePolling();
}

function handlePacketActionError(error: unknown, statusPanel: HTMLElement): void {
  const apiError = error as ApiError;
  if (apiError?.status === 0) {
    statusPanel.append(el("p", { class: "banner", text: "That needs signal. Nothing was changed." }));
    return;
  }
  if (apiError?.status === 412 || apiError?.status === 409) {
    packetMessages.set("", { sentence: packetSentences.staleAction });
    statusPanel.append(el("p", { class: "banner", text: packetSentences.staleAction }));
    return;
  }
  if (apiError?.status === 500) {
    statusPanel.append(el("p", { class: "banner", text: "Something went wrong on our side. Nothing was lost; try again." }));
    return;
  }
  statusPanel.append(el("p", { class: "banner", text: "Something went wrong on our side. Nothing was lost; try again." }));
}
