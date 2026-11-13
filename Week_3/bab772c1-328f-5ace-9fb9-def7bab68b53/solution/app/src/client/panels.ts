/** The Events, Landmarks, Reference, Passes, Captures, Share and Subscribers regions. */

import { formatDoy, parseDoyToIso } from "../shared/doy.js";
import { consoleCopy, fieldErrors, passStateText, referenceLine } from "../shared/copy.js";
import { formatDistance, formatLatitude, formatLongitude, formatSpeed } from "../shared/units.js";
import { parseLatitude, parseLongitude } from "../shared/coords.js";
import { parseIsoInstant } from "../shared/doy.js";
import type { Landmark, Mission, ShareLink, Subscriber } from "../shared/model.js";
import { clear, el, fieldError } from "./dom.js";
import { request } from "./api.js";
import { captureRefusal, dossierRefusal, downloadLink, eventListRefusal } from "./downloads.js";
import { openDeletePassDialog } from "./dialogs.js";
import type { Host, Panel } from "./host.js";

export function eventsPanel(host: Host): Panel {
  const table = el("table", { class: "events", "aria-label": "Events" });
  const head = el("thead");
  const body = el("tbody");
  table.append(head, body);
  const scroller = table;
  const links = el("p", { class: "region-links" });
  const element = el("section", { class: "region events-region table-scroll", "aria-label": "Events", tabindex: "0" }, [
    el("h2", { text: "Events" }),
    scroller,
    links,
  ]);

  const update = (): void => {
    const columns = ["MET", "Title", "Altitude", "Speed", ...(host.mode === "author" ? ["Note"] : [])];
    clear(head);
    head.append(
      el(
        "tr",
        {},
        columns.map((column) => el("th", { scope: "col", text: column })),
      ),
    );
    clear(body);
    for (const event of host.events()) {
      const cells = [
        event.met_label,
        event.title,
        formatDistance(event.sample.altitude_m, host.distanceUnit()),
        formatSpeed(event.sample.speed_m_s, host.speedUnit()),
        ...(host.mode === "author" ? [event.note ?? ""] : []),
      ];
      body.append(
        el(
          "tr",
          {},
          cells.map((cell, index) =>
            el("td", { class: index === 1 || index === 4 ? "" : "mono", text: cell }),
          ),
        ),
      );
    }
    clear(links);
    if (host.mode === "share") {
      links.append(
        downloadLink({
          name: "Download event list",
          text: "Download event list",
          href: () =>
            `${host.apiBase}/events.csv?distance=${host.distanceUnit()}&speed=${host.speedUnit()}`,
          filename: () => "events.csv",
          status: (message) => host.downloadStatus(message),
          refusal: eventListRefusal,
        }),
      );
    }
    links.append(
      downloadLink({
        name: "Download dossier",
        text: "Download dossier",
        href: () =>
          host.mode === "share"
            ? `${host.apiBase}/dossier.pdf?distance=${host.distanceUnit()}&speed=${host.speedUnit()}`
            : `${host.apiBase}/dossier.pdf`,
        filename: () => `${host.mission().name}-dossier.pdf`,
        status: (message) => host.downloadStatus(message),
        refusal: dossierRefusal,
      }),
    );
  };

  return { element, update };
}

export function landmarksPanel(host: Host): Panel {
  const list = el("ul", { class: "landmarks", "aria-label": "Landmarks" });
  const empty = el("p", { text: "No landmarks" });
  const children: (Node | string)[] = [el("h2", { text: "Landmarks" })];
  const nameInput = el("input", {
    id: "landmark-name",
    type: "text",
    class: "text",
    placeholder: "Tessera-3 landing site",
    "aria-label": "Landmark name",
  });
  const latInput = el("input", {
    id: "landmark-lat",
    type: "text",
    class: "text mono",
    placeholder: "12.5\u00b0 S",
    "aria-label": "Latitude",
  });
  const lonInput = el("input", {
    id: "landmark-lon",
    type: "text",
    class: "text mono",
    placeholder: "45.25\u00b0 W",
    "aria-label": "Longitude",
  });
  const addButton = el("button", { type: "submit", class: "primary", text: "Add landmark" });
  const form = el("form", { class: "landmark-form" }, [
    el("div", { class: "form-field" }, [el("label", { for: "landmark-name", text: "Landmark name" }), nameInput]),
    el("div", { class: "form-field" }, [el("label", { for: "landmark-lat", text: "Latitude" }), latInput]),
    el("div", { class: "form-field" }, [el("label", { for: "landmark-lon", text: "Longitude" }), lonInput]),
    addButton,
  ]);
  if (host.mode === "author") {
    children.push(form);
  }
  children.push(list, empty);
  const element = el("section", { class: "region", "aria-label": "Landmarks" }, children);

  const submit = async (): Promise<void> => {
    fieldError(latInput, null);
    fieldError(lonInput, null);
    fieldError(nameInput, null);
    const latitude = parseLatitude(latInput.value);
    if (latitude === null) {
      fieldError(latInput, fieldErrors.latitude);
      latInput.focus();
      return;
    }
    const longitude = parseLongitude(lonInput.value);
    if (longitude === null) {
      fieldError(lonInput, fieldErrors.longitude);
      lonInput.focus();
      return;
    }
    const result = await request<Landmark>("POST", `${host.apiBase}/landmarks`, {
      body: { name: nameInput.value.trim(), lat_deg: latitude, lon_deg: longitude },
    });
    if (result.ok) {
      host.consoleStatus(consoleCopy.landmarkAdded(result.data.name));
      nameInput.value = "";
      latInput.value = "";
      lonInput.value = "";
      await host.reload();
      nameInput.focus();
      return;
    }
    if (result.code === "landmark_limit" || result.code === "landmark_name_taken") {
      fieldError(nameInput, result.message ?? "");
      nameInput.focus();
      return;
    }
    if (result.code === "validation") {
      const fields: [string, HTMLElement][] = [
        ["name", nameInput],
        ["lat_deg", latInput],
        ["lon_deg", lonInput],
      ];
      let focused = false;
      for (const [field, input] of fields) {
        const message = result.errors[field];
        if (message) {
          fieldError(input, message);
          if (!focused) {
            input.focus();
            focused = true;
          }
        }
      }
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  const update = (): void => {
    const landmarks = host.mission().landmarks;
    clear(list);
    empty.hidden = landmarks.length > 0;
    for (const landmark of landmarks) {
      const text = `${landmark.name} ${formatLatitude(landmark.lat_deg)}, ${formatLongitude(
        landmark.lon_deg,
      )}`;
      const item = el("li", {}, [el("span", { class: "mono", text })]);
      if (host.mode === "author") {
        const remove = el("button", {
          type: "button",
          "aria-label": `Remove ${landmark.name}`,
          text: "Remove",
        });
        remove.addEventListener("click", () => {
          void (async () => {
            const result = await request<void>(
              "DELETE",
              `${host.apiBase}/landmarks/${landmark.id}`,
            );
            if (result.ok) {
              host.consoleStatus(consoleCopy.landmarkRemoved(landmark.name));
              await host.reload();
              nameInput.focus();
            }
          })();
        });
        item.append(remove);
      }
      list.append(item);
    }
  };

  return { element, update };
}

export function referencePanel(host: Host): Panel {
  const input = el("input", {
    id: "reference-target",
    type: "text",
    class: "text mono",
    placeholder: "TESSERA-3",
    "aria-label": "Reference target",
  });
  const setButton = el("button", { type: "submit", class: "primary", text: "Set reference" });
  const refreshButton = el("button", { type: "button", text: "Refresh reference" });
  const line = el("p", { class: "reference-line" });
  const form = el("form", { class: "reference-form" }, [
    el("label", { for: "reference-target", text: "Reference target" }),
    input,
    setButton,
    refreshButton,
  ]);
  const element = el("section", { class: "region", "aria-label": "Reference" }, [
    el("h2", { text: "Reference" }),
    form,
    line,
  ]);

  const disable = (pending: boolean): void => {
    setButton.disabled = pending;
    refreshButton.disabled = pending;
  };

  type ReferenceAnswer = { mission: Mission; outcome: string };

  const apply = (result: ReferenceAnswer, target: string): void => {
    if (result.outcome === "updated") {
      host.consoleStatus(
        consoleCopy.referenceReady(target, result.mission.reference?.vector_count ?? 0),
      );
    } else if (result.outcome === "unchanged") {
      host.consoleStatus(consoleCopy.referenceUnchanged(target));
    } else {
      host.consoleStatus(consoleCopy.referenceUnavailable(target));
    }
  };

  const send = async (): Promise<void> => {
    fieldError(input, null);
    const target = input.value.trim();
    disable(true);
    if (target.length === 0) {
      const cleared = await request<Mission>("PATCH", `${host.apiBase}`, {
        body: { reference_target: null },
        contentType: "application/merge-patch+json",
      });
      disable(false);
      if (cleared.ok) {
        host.consoleStatus(consoleCopy.referenceCleared);
        await host.reload();
      }
      return;
    }
    host.consoleStatus(consoleCopy.referenceFetching(target));
    const result = await request<ReferenceAnswer>("PUT", `${host.apiBase}/reference`, {
      body: { target },
    });
    disable(false);
    if (result.ok) {
      apply(result.data, target);
      await host.reload();
      return;
    }
    if (result.code === "validation" && result.errors.target) {
      fieldError(input, result.errors.target);
      input.focus();
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void send();
  });

  refreshButton.addEventListener("click", () => {
    void (async () => {
      const target = host.mission().reference?.target ?? "";
      disable(true);
      host.consoleStatus(consoleCopy.referenceFetching(target));
      const result = await request<{ mission: Mission; outcome: string }>(
        "POST",
        `${host.apiBase}/reference/refresh`,
      );
      disable(false);
      if (result.ok) {
        apply(result.data, target);
        await host.reload();
      }
    })();
  });

  const update = (): void => {
    const reference = host.mission().reference;
    line.textContent = referenceLine(reference);
    refreshButton.hidden = reference === null;
    if (document.activeElement !== input) {
      input.value = reference?.target ?? "";
    }
  };

  return { element, update };
}

export type PassesPanel = Panel & { setProgress: (fraction: number) => void };

export function passesPanel(
  host: Host,
  onFileChosen: (file: File) => void,
): PassesPanel {
  const fileInput = el("input", {
    id: "capture-file",
    type: "file",
    "aria-label": "Capture file",
  });
  const list = el("ul", { class: "passes", "aria-label": "Passes", tabindex: "-1" });
  const progress = el("div", { class: "upload-progress" }, [
    el("span", { class: "upload-progress-rule" }),
  ]);
  const element = el("section", { class: "region", "aria-label": "Passes" }, [
    el("h2", { text: "Passes" }),
    el("label", { for: "capture-file", text: "Capture file" }),
    fileInput,
    progress,
    list,
  ]);

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) {
      onFileChosen(file);
      fileInput.value = "";
    }
  });

  const update = (): void => {
    clear(list);
    for (const pass of host.mission().passes) {
      const state =
        pass.state === "parsed"
          ? passStateText.parsed(pass.sample_count)
          : pass.state === "rejected"
            ? pass.rejected_line !== null && pass.rejected_reason !== null
              ? passStateText.rejectedAtLine(pass.rejected_line, pass.rejected_reason)
              : passStateText.rejected(pass.rejected_reason ?? "parser_failed")
            : pass.state === "stored"
              ? passStateText.stored
              : passStateText.uploading;
      const item = el("li", {}, [
        el("span", { class: "pass-name", text: pass.filename }),
        el("span", { class: "pass-state", text: state }),
        el("span", { class: "mono", text: `${pass.size_bytes} bytes` }),
      ]);
      if (pass.state !== "uploading") {
        item.append(
          downloadLink({
            name: `Download ${pass.filename}`,
            text: "Download",
            href: () => `/api/passes/${pass.id}/capture`,
            filename: () => pass.filename,
            status: (message) => host.downloadStatus(message),
            refusal: captureRefusal(pass.filename),
          }),
        );
      }
      if (pass.state === "parsed" || pass.state === "rejected") {
        const remove = el("button", {
          type: "button",
          "aria-label": `Delete ${pass.filename}`,
          text: "Delete",
        });
        remove.addEventListener("click", () => {
          openDeletePassDialog({
            filename: pass.filename,
            passId: pass.id,
            status: (message) => host.consoleStatus(message),
            onDeleted: () => {
              void host.reloadTrack().then(() => {
                list.focus();
                host.refreshSearch();
              });
            },
            onKept: () => remove.focus(),
          });
        });
        item.append(remove);
      }
      list.append(item);
    }
  };

  const setProgress = (fraction: number): void => {
    const rule = progress.firstElementChild as HTMLElement;
    rule.style.width = `${Math.round(fraction * 100)}%`;
  };

  return { element, update, setProgress };
}

export function capturesPanel(host: Host): Panel {
  const list = el("ul", { class: "passes", "aria-label": "Captures" });
  const element = el("section", { class: "region", "aria-label": "Captures" }, [
    el("h2", { text: "Captures" }),
    list,
  ]);
  const update = (): void => {
    clear(list);
    for (const pass of host.mission().sharePasses) {
      list.append(
        el("li", {}, [
          el("span", { class: "pass-name", text: pass.filename }),
          el("span", { class: "mono", text: `${pass.size_bytes} bytes` }),
          downloadLink({
            name: `Download ${pass.filename}`,
            text: "Download",
            href: () => `${host.apiBase}/captures/${pass.id}`,
            filename: () => pass.filename,
            status: (message) => host.downloadStatus(message),
            refusal: captureRefusal(pass.filename),
          }),
        ]),
      );
    }
  };
  return { element, update };
}

export type SharePanel = Panel & { setReaders: (count: number | null) => void };

export function sharePanel(host: Host): SharePanel {
  const expiryInput = el("input", {
    id: "share-expiry",
    type: "text",
    class: "text mono",
    placeholder: "2026-103/00:00:00",
    "aria-label": "Link expiry (GMT)",
  });
  const createButton = el("button", { type: "button", class: "primary", text: "Create share link" });
  const linkInput = el("input", {
    id: "share-link",
    type: "text",
    class: "text mono",
    readonly: true,
    "aria-label": "Share link",
  });
  const expiryText = el("p", { class: "mono" });
  const copyButton = el("button", { type: "button", text: "Copy link" });
  const replaceButton = el("button", { type: "button", text: "Replace share link" });
  const revokeButton = el("button", { type: "button", text: "Revoke share link" });
  const readers = el("p", { class: "mono readers", text: "Readers now: 0" });
  const controls = el("div", { class: "share-controls" }, [
    linkInput,
    copyButton,
    replaceButton,
    revokeButton,
  ]);
  const element = el("section", { class: "region", "aria-label": "Share" }, [
    el("h2", { text: "Share" }),
    el("label", { for: "share-expiry", text: "Link expiry (GMT)" }),
    expiryInput,
    createButton,
    controls,
    expiryText,
    readers,
  ]);

  const createOrReplace = async (replace: boolean): Promise<void> => {
    fieldError(expiryInput, null);
    const typed = expiryInput.value;
    let body: Record<string, string> | undefined;
    if (typed.length > 0) {
      const iso = parseDoyToIso(typed);
      if (iso === null) {
        fieldError(expiryInput, fieldErrors.dayOfYear);
        expiryInput.focus();
        return;
      }
      body = { expires_utc: iso };
    }
    const result = await request<ShareLink>("POST", `${host.apiBase}/share`, {
      ...(body ? { body } : { body: {} }),
    });
    if (result.ok) {
      const gmt = formatDoy(parseIsoInstant(result.data.expires_utc) as number);
      host.consoleStatus(
        replace ? consoleCopy.shareReplaced(gmt) : consoleCopy.shareCreated(gmt),
      );
      await host.reload();
      return;
    }
    if (result.code === "validation" && result.errors.expires_utc) {
      fieldError(expiryInput, result.errors.expires_utc);
      expiryInput.focus();
    }
  };

  createButton.addEventListener("click", () => void createOrReplace(false));
  replaceButton.addEventListener("click", () => void createOrReplace(true));
  revokeButton.addEventListener("click", () => {
    void (async () => {
      const result = await request<void>("DELETE", `${host.apiBase}/share`);
      if (result.ok) {
        host.consoleStatus(consoleCopy.shareRevoked);
        await host.reload();
      }
    })();
  });
  copyButton.addEventListener("click", () => {
    void navigator.clipboard?.writeText(linkInput.value).catch(() => undefined);
  });

  const update = (): void => {
    const share = host.mission().share;
    createButton.hidden = share !== null;
    controls.hidden = share === null;
    expiryText.hidden = share === null;
    if (share) {
      linkInput.value = new URL(share.url, window.location.origin).toString();
      expiryText.textContent = `Expires ${formatDoy(
        parseIsoInstant(share.expires_utc) as number,
      )}`;
    }
  };

  const setReaders = (count: number | null): void => {
    readers.textContent = `Readers now: ${count === null ? "unknown" : count}`;
  };

  return { element, update, setReaders };
}

export function subscribersPanel(host: Host): Panel {
  const input = el("input", {
    id: "subscriber-url",
    type: "text",
    class: "text",
    placeholder: "https://club.example/hooks/perilune",
    "aria-label": "Subscriber URL",
  });
  const addButton = el("button", { type: "submit", class: "primary", text: "Add subscriber" });
  const list = el("ul", { class: "subscribers", "aria-label": "Subscribers" });
  const empty = el("p", { text: "No subscribers" });
  const form = el("form", { class: "subscriber-form" }, [
    el("label", { for: "subscriber-url", text: "Subscriber URL" }),
    input,
    addButton,
  ]);
  const element = el("section", { class: "region", "aria-label": "Subscribers" }, [
    el("h2", { text: "Subscribers" }),
    form,
    list,
    empty,
  ]);

  let subscribers: Subscriber[] = [];

  const load = async (): Promise<void> => {
    const result = await request<{ subscribers: Subscriber[] }>(
      "GET",
      `${host.apiBase}/subscribers`,
    );
    if (result.ok) {
      subscribers = result.data.subscribers;
      render();
    }
  };

  const render = (): void => {
    clear(list);
    empty.hidden = subscribers.length > 0;
    for (const subscriber of subscribers) {
      const remove = el("button", {
        type: "button",
        "aria-label": `Remove ${subscriber.url}`,
        text: "Remove",
      });
      remove.addEventListener("click", () => {
        void (async () => {
          const result = await request<void>(
            "DELETE",
            `${host.apiBase}/subscribers/${subscriber.id}`,
          );
          if (result.ok) {
            host.consoleStatus(consoleCopy.subscriberRemoved(subscriber.url));
            await load();
            input.focus();
            return;
          }
          host.consoleStatus(consoleCopy.subscribersOffline);
          remove.focus();
        })();
      });
      list.append(
        el("li", {}, [el("span", { class: "mono", text: subscriber.url }), remove]),
      );
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      fieldError(input, null);
      addButton.disabled = true;
      const url = input.value.trim();
      const result = await request<Subscriber>("POST", `${host.apiBase}/subscribers`, {
        body: { url },
      });
      addButton.disabled = false;
      if (result.ok) {
        host.consoleStatus(consoleCopy.subscriberAdded(result.data.url));
        input.value = "";
        await load();
        input.focus();
        return;
      }
      if (result.code === "webhooks_unavailable") {
        host.consoleStatus(consoleCopy.subscribersOffline);
        return;
      }
      const message = result.message ?? result.errors.url ?? null;
      if (message) {
        fieldError(input, message);
        input.focus();
      }
    })();
  });

  return { element, update: () => void load() };
}
