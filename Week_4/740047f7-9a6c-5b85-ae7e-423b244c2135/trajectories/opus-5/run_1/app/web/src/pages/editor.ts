import { ApiFailure, del, get, patch, post, upload } from "../api";
import { copy } from "../copy";
import { confirmDialog } from "../dialog";
import { clear, graphemeCount, h, icon, setText } from "../dom";
import { Defect, Pen } from "../types";

const LOCK_REFRESH_MS = 10000;
const STILL_LIMIT = 8_000_000;

export interface EditorHost {
  pen(): Pen;
  defect(id: string): Defect | undefined;
  applyPen(pen: Pen): void;
  announce(message: string): void;
  focusAfterClose(defectId: string | null, deleted: boolean): void;
  onClosed(): void;
}

export interface EditorHandle {
  defectId: string | null;
  element: HTMLElement;
  session: number;
  close(): void;
  remoteChanged(): void;
  showLockLost(): void;
}

let sessionCounter = 0;

const SIZE_FIELDS: Record<string, [string, string][]> = {
  hole: [
    ["width_cm", "Width (cm)"],
    ["height_cm", "Height (cm)"],
  ],
  tear: [
    ["length_cm", "Length (cm)"],
    ["gap_cm", "Gap (cm)"],
  ],
  chafe: [
    ["length_cm", "Length (cm)"],
    ["width_cm", "Width (cm)"],
  ],
  fouling: [
    ["width_m", "Width (m)"],
    ["height_m", "Height (m)"],
  ],
};

const METHODS: [string, string][] = [
  ["patch", "Patch"],
  ["lace", "Lace"],
  ["replace_panel", "Replace panel"],
  ["clean", "Clean"],
];

interface EditorOptions {
  defectId: string | null;
  wallPoint?: { x_m: number; y_m: number; z_m: number };
  readOnlyLock?: string | null;
}

/// The defect editor. Opening it takes the edit lock and refreshes it while the
/// editor stays open.
export function openEditor(
  container: HTMLElement,
  host: EditorHost,
  options: EditorOptions,
): EditorHandle {
  const session = ++sessionCounter;
  const existing = options.defectId ? host.defect(options.defectId) : undefined;
  const isNew = options.defectId === null;
  let defectType = existing?.type ?? "hole";
  let version = existing?.version ?? 1;
  let lockHeld = false;
  let closed = false;
  let positionFromWall = Boolean(options.wallPoint);
  let refreshTimer = 0;
  let inFlight = false;

  const status = h("div", { role: "status", "aria-label": "Editor status" });
  const heading = h("h2", {}, isNew ? "New defect" : `Edit ${options.defectId}`);
  const lockLine = h("div", { class: "label hidden" });
  const fields = h("div", {});
  const readouts = h("div", { class: "readouts num" });
  const stillsList = h("ul", { class: "list", "aria-label": "Stills" });
  const historyList = h("ul", { class: "list", "aria-label": "History" });

  const typeSelect = h("select", { "aria-label": "Type" });
  for (const name of Object.keys(SIZE_FIELDS)) {
    typeSelect.appendChild(h("option", { value: name }, name));
  }
  typeSelect.value = defectType;

  const bearing = textField("Bearing (°)", existing?.bearing_deg ?? "");
  const depth = textField("Depth (m)", existing?.depth_m ?? "");
  const sizeA = textField("", "");
  const sizeB = textField("", "");
  const note = areaField("Note", existing?.note ?? "");
  const privateNote = areaField("Private note", existing?.private_note ?? "");
  const repairMethod = h("select", { "aria-label": "Repair method" });
  for (const [value, label] of METHODS) {
    repairMethod.appendChild(h("option", { value }, label));
  }
  const repairNote = areaField("Repair note", "");

  const save = h("button", { type: "button" }, "Save");
  const closeButton = h("button", { type: "button" }, "Close editor");
  const deleteButton = h("button", { type: "button" }, "Delete defect");
  const attachStill = h("button", { type: "button" }, "Attach still");
  const recordRepair = h("button", { type: "button" }, "Record repair");
  const stillChooser = h("input", {
    type: "file",
    accept: "image/jpeg,image/png",
    class: "sr-only",
    "aria-hidden": "true",
    tabindex: "-1",
  });

  const root = h("section", { class: "editor", "aria-label": "Defect editor" }, [
    heading,
    lockLine,
    isNew
      ? h("label", { class: "field" }, [h("span", {}, "Type"), typeSelect])
      : null,
    positionFromWall ? h("div", { class: "label" }, "From the net wall") : null,
    bearing.wrapper,
    depth.wrapper,
    fields,
    note.wrapper,
    privateNote.wrapper,
    readouts,
    status,
    h("div", { class: "actions" }, [save, closeButton, isNew ? null : deleteButton]),
    isNew
      ? null
      : h("div", {}, [
          h("div", { class: "panel-title" }, "Stills"),
          h("div", { class: "actions" }, [attachStill, stillChooser]),
          stillsList,
          h("div", { class: "panel-title" }, "Repair"),
          h("label", { class: "field" }, [h("span", {}, "Repair method"), repairMethod]),
          repairNote.wrapper,
          h("div", { class: "actions" }, [recordRepair]),
          h("div", { class: "panel-title" }, "History"),
          historyList,
        ]),
  ]);
  container.appendChild(root);
  container.classList.add("editing");

  function textField(label: string, value: string | number) {
    const input = h("input", { type: "text", "aria-label": label });
    input.value = String(value);
    const error = h("div", { class: "field-error hidden" });
    const span = h("span", {}, label);
    const wrapper = h("label", { class: "field" }, [span, input, error]);
    return { wrapper, input, error, span };
  }

  function areaField(label: string, value: string) {
    const input = h("textarea", { "aria-label": label });
    input.value = value;
    const counter = h("span", { class: "label num" }, copy.noteCounter(graphemeCount(value)));
    const error = h("div", { class: "field-error hidden" });
    const wrapper = h("label", { class: "field" }, [
      h("span", {}, label),
      input,
      counter,
      error,
    ]);
    input.addEventListener("input", () => {
      const count = graphemeCount(input.value);
      setText(counter, copy.noteCounter(count));
      if (count > 500) showFieldError(error, copy.noteTooLong);
      else hideFieldError(error);
    });
    return { wrapper, input, error, counter };
  }

  function showFieldError(node: HTMLElement, message: string): void {
    node.classList.remove("hidden");
    clear(node);
    node.appendChild(icon("alert"));
    node.appendChild(document.createTextNode(message));
  }

  function hideFieldError(node: HTMLElement): void {
    node.classList.add("hidden");
    clear(node);
  }

  function renderSizeFields(): void {
    clear(fields);
    const [[, labelA], [, labelB]] = [SIZE_FIELDS[defectType][0], SIZE_FIELDS[defectType][1]];
    setText(sizeA.span, labelA);
    setText(sizeB.span, labelB);
    sizeA.input.setAttribute("aria-label", labelA);
    sizeB.input.setAttribute("aria-label", labelB);
    fields.appendChild(sizeA.wrapper);
    fields.appendChild(sizeB.wrapper);
    const size = host.defect(options.defectId ?? "")?.size;
    if (size) {
      sizeA.input.value = String(size[SIZE_FIELDS[defectType][0][0]] ?? "");
      sizeB.input.value = String(size[SIZE_FIELDS[defectType][1][0]] ?? "");
    }
  }

  function renderReadouts(): void {
    clear(readouts);
    const defect = options.defectId ? host.defect(options.defectId) : undefined;
    if (!defect || defect.removed) return;
    const rows: [string, string][] = [
      ["Chart x", `${(defect.chart_x_m ?? 0).toFixed(2)} m`],
      ["Chart y", `${(defect.chart_y_m ?? 0).toFixed(2)} m`],
      ["Cell", defect.cell ?? ""],
    ];
    if (defect.type === "fouling") {
      rows.push(["Patch area", `${(defect.patch_area_m2 ?? 0).toFixed(1)} m²`]);
    } else {
      rows.push(["Area", `${defect.area_cm2 ?? 0} cm²`]);
    }
    for (const [label, value] of rows) {
      readouts.appendChild(h("div", {}, [h("div", { class: "label" }, label), h("div", {}, value)]));
    }
  }

  function renderStills(): void {
    clear(stillsList);
    const defect = options.defectId ? host.defect(options.defectId) : undefined;
    for (const still of defect?.stills ?? []) {
      stillsList.appendChild(
        h("li", {}, [
          h(
            "a",
            {
              href: `/api/stills/${still.id}/raw`,
              download: still.file_name,
              "aria-label": `Download still ${still.id}`,
            },
            `Download still ${still.id}`,
          ),
        ]),
      );
    }
  }

  async function renderHistory(): Promise<void> {
    if (!options.defectId) return;
    try {
      const payload = await get(`/api/defects/${options.defectId}/history`);
      if (closed) return;
      clear(historyList);
      for (const entry of payload.history as Record<string, any>[]) {
        const lines: (Node | string)[] = [
          h(
            "div",
            { class: "num" },
            `${String(entry["at"]).slice(11, 16)} UTC \u00b7 ${entry["device_name"]} \u00b7 ${entry["action"]}`,
          ),
        ];
        for (const [field, change] of Object.entries(
          entry["changes"] as Record<string, { before: unknown; after: unknown }>,
        )) {
          lines.push(
            h(
              "div",
              { class: "label num" },
              `${field}: ${format(change.before)} \u2192 ${format(change.after)}`,
            ),
          );
        }
        if (entry["detail"]) lines.push(h("div", { class: "label" }, String(entry["detail"])));
        historyList.appendChild(h("li", {}, lines));
      }
    } catch {
      /* the list simply stays as it was */
    }
  }

  function format(value: unknown): string {
    if (value === null || value === undefined) return "—";
    return String(value);
  }

  function setPending(message: string): void {
    inFlight = true;
    setText(status, message);
    save.setAttribute("disabled", "");
  }

  function clearPending(): void {
    inFlight = false;
    save.removeAttribute("disabled");
  }

  function sizeBody(): Record<string, number> {
    const keys = SIZE_FIELDS[defectType];
    return {
      [keys[0][0]]: Number(sizeA.input.value),
      [keys[1][0]]: Number(sizeB.input.value),
    };
  }

  function applyFailure(failure: unknown): void {
    clearPending();
    if (!(failure instanceof ApiFailure)) {
      setText(status, copy.unreachable);
      return;
    }
    for (const [field, message] of Object.entries(failure.fields)) {
      const target =
        field === "note"
          ? note.error
          : field === "private_note"
            ? privateNote.error
            : field === "bearing_deg"
              ? bearing.error
              : field === "depth_m"
                ? depth.error
                : field.endsWith(SIZE_FIELDS[defectType][0][0])
                  ? sizeA.error
                  : field.endsWith(SIZE_FIELDS[defectType][1][0])
                    ? sizeB.error
                    : null;
      if (target) showFieldError(target, message);
    }
    setText(status, failure.message);
  }

  async function doSave(): Promise<void> {
    if (inFlight) return;
    hideFieldError(note.error);
    hideFieldError(privateNote.error);
    hideFieldError(bearing.error);
    hideFieldError(depth.error);
    hideFieldError(sizeA.error);
    hideFieldError(sizeB.error);
    setPending(copy.saving);
    try {
      if (isNew) {
        const body: Record<string, unknown> = {
          type: defectType,
          size: sizeBody(),
          note: note.input.value,
          private_note: privateNote.input.value,
        };
        if (positionFromWall && options.wallPoint) {
          body["wall_point"] = options.wallPoint;
        } else {
          body["bearing_deg"] = Number(bearing.input.value);
          body["depth_m"] = Number(depth.input.value);
        }
        const payload = await post(`/api/pens/${host.pen().id}/defects`, body);
        clearPending();
        host.applyPen(payload.pen as Pen);
        const created = payload.defect as Defect;
        options.defectId = created.id;
        version = created.version ?? 1;
        setText(status, copy.saved(created.id));
        host.announce(copy.saved(created.id));
        close();
        return;
      }
      const payload = await patch(`/api/defects/${options.defectId}`, {
        version,
        bearing_deg: Number(bearing.input.value),
        depth_m: Number(depth.input.value),
        size: sizeBody(),
        note: note.input.value,
        private_note: privateNote.input.value,
      });
      clearPending();
      host.applyPen(payload.pen as Pen);
      version = (payload.defect as Defect).version ?? version;
      setText(status, copy.saved(String(options.defectId)));
      renderReadouts();
      void renderHistory();
    } catch (failure) {
      applyFailure(failure);
    }
  }

  async function takeLock(): Promise<void> {
    if (!options.defectId) return;
    try {
      await post(`/api/defects/${options.defectId}/lock`);
      lockHeld = true;
      scheduleRefresh();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.status === 423) {
        setReadOnly(failure.lockedDevice() ?? "another device");
      }
    }
  }

  /// A lock-refresh timer from an earlier session never refreshes a lock that
  /// session already released.
  function scheduleRefresh(): void {
    refreshTimer = window.setTimeout(async () => {
      if (closed || !lockHeld || session !== sessionCounter) return;
      try {
        await post(`/api/defects/${options.defectId}/lock`);
        scheduleRefresh();
      } catch {
        if (closed || session !== sessionCounter) return;
        lockHeld = false;
        setText(status, copy.lockLost);
      }
    }, LOCK_REFRESH_MS);
  }

  function setReadOnly(deviceName: string): void {
    lockLine.classList.remove("hidden");
    setText(lockLine, copy.lockedOn(deviceName));
    for (const button of [save, deleteButton, attachStill, recordRepair]) {
      button.setAttribute("disabled", "");
    }
  }

  function close(): void {
    if (closed) return;
    closed = true;
    window.clearTimeout(refreshTimer);
    const released = lockHeld;
    lockHeld = false;
    if (released && options.defectId) {
      void del(`/api/defects/${options.defectId}/lock`).catch(() => undefined);
    }
    root.remove();
    container.classList.remove("editing");
    host.onClosed();
  }

  save.addEventListener("click", () => void doSave());
  closeButton.addEventListener("click", () => {
    const id = options.defectId;
    close();
    host.focusAfterClose(id, false);
  });
  for (const input of [bearing.input, depth.input, sizeA.input, sizeB.input]) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void doSave();
      }
    });
  }
  // Typing a bearing or depth replaces the tapped net-wall point.
  for (const input of [bearing.input, depth.input]) {
    input.addEventListener("input", () => {
      positionFromWall = false;
    });
  }
  typeSelect.addEventListener("change", () => {
    defectType = typeSelect.value;
    renderSizeFields();
  });

  deleteButton.addEventListener("click", () => {
    confirmDialog({
      name: "Delete defect",
      heading: `Delete ${options.defectId}`,
      confirmLabel: "Delete",
      onConfirm: async (handle) => {
        setText(status, copy.removing);
        try {
          const payload = await del(`/api/defects/${options.defectId}`);
          handle.close();
          host.applyPen(payload.pen as Pen);
          const id = options.defectId;
          host.announce(copy.removed(String(id)));
          lockHeld = false;
          close();
          host.focusAfterClose(id, true);
        } catch (failure) {
          handle.close();
          applyFailure(failure);
        }
      },
    });
  });

  attachStill.addEventListener("click", () => stillChooser.click());
  stillChooser.addEventListener("change", async () => {
    const file = stillChooser.files?.[0];
    if (!file) return;
    if (file.size > STILL_LIMIT) {
      setText(status, copy.stillTooLarge);
      return;
    }
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setText(status, copy.stillWrongType);
      return;
    }
    setText(status, copy.uploadingStill);
    try {
      const payload = await upload(
        `/api/defects/${options.defectId}/stills`,
        file,
        file.name,
        file.type,
      );
      setText(status, copy.attachedStill(payload.still.id as string));
      const refreshed = await get(`/api/pens/${host.pen().id}`);
      host.applyPen(refreshed.pen as Pen);
      renderStills();
      void renderHistory();
    } catch (failure) {
      applyFailure(failure);
    }
  });

  recordRepair.addEventListener("click", async () => {
    setText(status, copy.recordingRepair);
    try {
      const payload = await post(`/api/defects/${options.defectId}/repairs`, {
        method: repairMethod.value,
        note: repairNote.input.value,
      });
      host.applyPen(payload.pen as Pen);
      setText(status, copy.repairRecorded(String(options.defectId)));
      renderReadouts();
      void renderHistory();
    } catch (failure) {
      applyFailure(failure);
    }
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      const id = options.defectId;
      close();
      host.focusAfterClose(id, false);
    }
  });

  renderSizeFields();
  renderReadouts();
  renderStills();
  if (options.wallPoint) {
    bearing.input.value = "";
    depth.input.value = "";
  }
  if (!isNew) {
    void renderHistory();
    if (options.readOnlyLock) setReadOnly(options.readOnlyLock);
    else void takeLock();
    window.setTimeout(() => bearing.input.focus(), 0);
  } else {
    window.setTimeout(() => (isNew ? typeSelect : bearing.input).focus(), 0);
  }

  return {
    get defectId() {
      return options.defectId;
    },
    element: root,
    session,
    close,
    remoteChanged(): void {
      // The editor keeps the inspector's unsaved input.
      renderReadouts();
      renderStills();
    },
    showLockLost(): void {
      if (session !== sessionCounter) return;
      lockHeld = false;
      setText(status, copy.lockLost);
    },
  };
}
