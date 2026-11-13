import { api, connectLive, disconnectLive, onLiveMessage, el, clear, appEl, navigate, setPageNotice, setPageError, state, ApiFailure, upload, statusRegions } from "../app.js";
import type { Entrant, Match, Tournament } from "../../shared/types.js";
import { emptyState } from "../objects.js";

interface SetupData {
  tournament: Tournament;
  entrants: Entrant[];
}

export async function renderSetup(tid: string): Promise<() => void> {
  document.title = "Setup · Cupfold";
  const app = appEl();
  clear(app);
  let data: SetupData;
  try {
    const t = await api<{ tournament: Tournament }>("GET", `/api/tournaments/${tid}`);
    const es = await api<{ entrants: Entrant[] }>("GET", `/api/tournaments/${tid}/entrants`);
    data = { tournament: t.tournament, entrants: es.entrants };
  } catch {
    navigate("/t", true);
    return () => {};
  }
  if (data.tournament.my_role !== "organizer" && data.tournament.my_role !== "co_organizer") {
    navigate(`/t/${tid}/bracket`, true);
    return () => {};
  }
  const isOrganizer = data.tournament.my_role === "organizer";
  const redraw = (): void => {
    clear(app);
    app.appendChild(build(data, tid, isOrganizer, redraw));
  };
  connectLive(tid, null, () => { state.liveDown = true; }, () => { state.liveDown = false; });
  // a local write already redraws with the server's answer; skip live echoes of
  // the same change so focus is never clobbered by a redundant redraw
  const off = onLiveMessage((msg) => {
    // stop reacting once the route has moved on
    if (!location.pathname.startsWith(`/t/${tid}/setup`)) return;
    if (Date.now() < skipEchoUntil) return;
    if (msg.type === "entrants.updated" && msg.data.entrants) {
      void api<{ entrants: Entrant[] }>("GET", `/api/tournaments/${tid}/entrants`).then((r) => {
        data.entrants = r.entrants;
        redraw();
      });
    } else if (msg.type === "tournament.updated" && msg.data.tournament) {
      void api<{ tournament: Tournament }>("GET", `/api/tournaments/${tid}`).then((r) => {
        data.tournament = r.tournament;
        redraw();
      });
    } else if (msg.type === "checkin.updated") {
      void api<{ tournament: Tournament }>("GET", `/api/tournaments/${tid}`).then((r) => {
        data.tournament = r.tournament;
        redraw();
      });
    }
  });
  redraw();
  return () => {
    off();
    disconnectLive();
  };
}

function build(data: SetupData, tid: string, isOrganizer: boolean, redraw: () => void): HTMLElement {
  const t = data.tournament;
  const isPhone = window.innerWidth < 768;
  const left = el("div", { class: "stack" });
  const right = el("div", { class: "stack" });

  // seeding list
  const seedingList = el("ul", { class: "list-plain", attrs: { role: "list", "aria-label": "Seeding" } });
  if (data.entrants.length === 0) {
    left.appendChild(emptyState(t.format, "No entrants yet. Upload a roster or add names one by one."));
  } else {
    for (const e of data.entrants) {
      seedingList.appendChild(seedingItem(e, data, tid, redraw));
    }
    left.appendChild(seedingList);
  }
  const nameInput = el("input", { attrs: { name: "name" }, ariaLabel: "Entrant name" }) as HTMLInputElement;
  const addForm = el("form", { class: "row" }, [
    nameInput,
    el("button", { class: "btn", type: "submit" }, ["Add entrant"]),
  ]);
  addForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await api("POST", `/api/tournaments/${tid}/entrants`, { name: nameInput.value });
      nameInput.value = "";
      const r = await api<{ entrants: Entrant[] }>("GET", `/api/tournaments/${tid}/entrants`);
      data.entrants = r.entrants;
      redraw();
    } catch (e) {
      if (e instanceof ApiFailure) setPageError(e.body.fields?.name ?? e.body.message);
    }
  });
  left.appendChild(addForm);

  // round 1 preview
  right.appendChild(previewRegion(tid, data));

  // roster
  right.appendChild(rosterControls(tid, data, redraw));

  // logo
  right.appendChild(logoControls(tid, t, redraw));

  // co-organizers (organizer only)
  if (isOrganizer) {
    right.appendChild(coOrganizerControls(tid, t, redraw));
  }

  // check-in controls
  right.appendChild(checkinControls(tid, t, isOrganizer, redraw));

  // share
  right.appendChild(shareControls(t));

  const main = el("main", { class: "page" }, [
    statusRegions("setup"),
    el("div", { class: "stack" }, [
      el("h1", {}, [t.name]),
      isPhone ? el("div", { class: "stack" }, [left, right]) : el("div", { class: "two-col" }, [left, right]),
    ]),
  ]);
  return main;
}

// local writes redraw immediately; live echoes arriving within this window are skipped
// so a redundant redraw never steals focus from the moved entrant
let skipEchoUntil = 0;

function seedingItem(e: Entrant, data: SetupData, tid: string, redraw: () => void): HTMLElement {
  const item = el("li", { class: "seeding-item", attrs: { tabindex: "0", role: "listitem" }, ariaLabel: `${e.seed}. ${e.name}`, data: { entrantId: e.id } });
  const saveOrder = async (order: string[]): Promise<void> => {
    skipEchoUntil = Date.now() + 1500;
    try {
      const r = await api<{ entrants: Entrant[]; seeding_version: number }>("PUT", `/api/tournaments/${tid}/seeding`, {
        order,
        seeding_version: data.tournament.seeding_version,
      });
      data.entrants = r.entrants;
      data.tournament.seeding_version = r.seeding_version;
      const action = document.getElementById("your-action");
      if (action) action.textContent = `${e.name} moved to seed ${e.seed}`;
      redraw();
    } catch (err) {
      if (err instanceof ApiFailure && err.status === 409) {
        data.entrants = err.body.entrants ?? data.entrants;
        setPageError(err.body.message);
        redraw();
      }
    }
  };
  const move = async (delta: number): Promise<void> => {
    const ids = data.entrants.map((x) => x.id);
    const idx = ids.indexOf(e.id);
    const to = idx + delta;
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(idx, 1);
    next.splice(to, 0, moved!);
    await saveOrder(next);
    // focus stays on the moved entrant
    const list = document.querySelector<HTMLElement>('[role="list"][aria-label="Seeding"]');
    const target = Array.from(list?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? []).find(
      (n) => n.getAttribute("data-entrant-id") === e.id
    );
    if (target) {
      target.setAttribute("tabindex", "0");
      target.focus();
    }
  };
  item.addEventListener("keydown", async (ev) => {
    if (!ev.altKey) return;
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      await move(-1);
    } else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      await move(1);
    }
  });
  const seedInput = el("input", {
    class: "seed-input",
    type: "number",
    attrs: { min: "1", max: String(data.entrants.length), value: String(e.seed) },
    ariaLabel: `Seed for ${e.name}`,
    data: { entrantId: e.id },
  }) as HTMLInputElement;
  const applySeed = async (): Promise<void> => {
    const target = Number(seedInput.value);
    if (!Number.isInteger(target) || target < 1 || target > data.entrants.length) {
      setPageError(`Enter a seed from 1 to ${data.entrants.length}.`);
      return;
    }
    const ids = data.entrants.map((x) => x.id);
    const idx = ids.indexOf(e.id);
    const next = [...ids];
    const [moved] = next.splice(idx, 1);
    next.splice(target - 1, 0, moved!);
    await saveOrder(next);
  };
  seedInput.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      void applySeed();
    }
  });
  seedInput.addEventListener("change", () => void applySeed());
  const accountInput = el("input", {
    class: "account-input",
    attrs: { value: e.username ?? "" },
    ariaLabel: `Account for ${e.name}`,
  }) as HTMLInputElement;
  accountInput.addEventListener("change", async () => {
    try {
      await api("PATCH", `/api/entrants/${e.id}`, { username: accountInput.value || null });
      setPageNotice("Account linked.");
      redraw();
    } catch (err) {
      if (err instanceof ApiFailure) setPageError(err.body.fields?.username ?? err.body.message);
    }
  });
  const removeBtn = el("button", {
    class: "btn btn--secondary",
    ariaLabel: `Remove ${e.name}`,
    on: {
      click: async () => {
        try {
          await api("DELETE", `/api/entrants/${e.id}`);
          const r = await api<{ entrants: Entrant[] }>("GET", `/api/tournaments/${tid}/entrants`);
          data.entrants = r.entrants;
          redraw();
        } catch (err) {
          if (err instanceof ApiFailure) setPageError(err.body.message);
        }
      },
    },
  }, ["Remove"]);
  item.appendChild(el("span", { class: "seed-no num" }, [`${e.seed}.`]));
  item.appendChild(el("span", { class: "grow" }, [e.name]));
  item.appendChild(seedInput);
  item.appendChild(accountInput);
  item.appendChild(removeBtn);
  return item;
}

async function refreshPreview(tid: string, host: HTMLElement): Promise<void> {
  try {
    const r = await api<{ matches: { number: number; upper: string | null; lower: string | null }[] }>(
      "GET",
      `/api/tournaments/${tid}/preview`
    );
    clear(host);
    for (const m of r.matches) {
      const upper = m.upper ?? "bye";
      const lower = m.lower ?? "bye";
      host.appendChild(el("li", { class: "small" }, [`Match ${m.number}: ${m.upper ? upper : upper} vs ${m.lower ? lower : "bye"}`]));
    }
  } catch {
    /* preview unavailable before entrants exist */
  }
}

function previewRegion(tid: string, data: SetupData): HTMLElement {
  void data;
  const list = el("ul", { class: "list-plain", attrs: { role: "list", "aria-label": "Round 1 preview" } });
  void refreshPreview(tid, list);
  return el("section", { class: "card stack", attrs: { role: "region", "aria-label": "Bracket preview" } }, [
    el("h3", {}, ["Bracket preview"]),
    list,
  ]);
}

function rosterControls(tid: string, data: SetupData, redraw: () => void): HTMLElement {
  const host = el("section", { class: "card stack" });
  host.appendChild(el("h3", {}, ["Roster"]));
  const errorsHost = el("div", {});
  const uploadBtn = el("button", {
    class: "btn",
    on: {
      click: () => {
        const input = el("input", { type: "file", ariaLabel: "Roster file", attrs: { accept: ".cupfold.txt,text/plain" } }) as HTMLInputElement;
        const submit = el("button", { class: "btn", on: { click: async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const res = await upload(`/api/tournaments/${tid}/roster`, file) as { file_name: string; entrants: Entrant[] };
            const dlg = document.querySelector<HTMLDialogElement>("dialog[open]");
            dlg?.close();
            setPageNotice(`Added ${res.entrants.length} entrants from ${res.file_name}.`);
            data.entrants = res.entrants;
            redraw();
          } catch (e) {
            if (e instanceof ApiFailure) {
              if (e.body.errors) {
                // list "Roster errors" headed by the roster_invalid message; focus moves to the heading
                closeTopDialog();
                errorsHost.textContent = "";
                const heading = el("h2", { attrs: { tabindex: "0" } }, [e.body.message]);
                const list = el("ul", { class: "list-plain small", attrs: { role: "list", "aria-label": "Roster errors" } });
                for (const line of e.body.errors) list.appendChild(el("li", {}, [line]));
                errorsHost.appendChild(heading);
                errorsHost.appendChild(list);
                heading.focus();
              } else {
                setPageError(e.body.message);
              }
            }
          }
        } } }, ["Add roster"]);
        openSimpleSheet("Upload roster", [input, submit]);
      },
    },
  }, ["Upload roster"]);
  host.appendChild(uploadBtn);
  host.appendChild(errorsHost);
  // download when a roster has been accepted
  const downloadBtn = el("button", {
    class: "btn btn--secondary",
    on: {
      click: async () => {
        const res = await fetch(`/api/tournaments/${tid}/roster`, { credentials: "same-origin" });
        if (res.ok) {
          const blob = await res.blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "roster.cupfold.txt";
          a.click();
          URL.revokeObjectURL(a.href);
        } else {
          const body = await res.json().catch(() => ({ message: "No roster file has been added." }));
          setPageError(body.message);
        }
      },
    },
  }, ["Download roster file"]);
  host.appendChild(downloadBtn);
  return host;
}

function closeTopDialog(): void {
  const dlg = document.querySelector<HTMLDialogElement>("dialog[open]");
  dlg?.close();
  dlg?.remove();
}

function openSimpleSheet(title: string, fields: HTMLElement[]): void {
  // minimal modal with Cancel
  const overlays = document.getElementById("overlays")!;
  const dialog = el("dialog", { class: "sheet" }) as HTMLDialogElement;
  dialog.setAttribute("aria-labelledby", "sheet-title");
  const cancel = el("button", { class: "btn btn--secondary", on: { click: () => { dialog.close(); dialog.remove(); } } }, ["Cancel"]);
  dialog.appendChild(
    el("div", { class: "sheet-body" }, [
      el("h2", { class: "sheet-title", id: "sheet-title" }, [title]),
      ...fields,
      el("div", { class: "sheet-actions" }, [cancel]),
    ])
  );
  overlays.appendChild(dialog);
  dialog.showModal();
}

function logoControls(tid: string, t: Tournament, redraw: () => void): HTMLElement {
  const host = el("section", { class: "card stack" });
  host.appendChild(el("h3", {}, ["Logo"]));
  if (t.logo_url) {
    const img = el("img", { attrs: { src: t.logo_url, alt: `${t.name} logo` }, class: "" }) as HTMLImageElement;
    img.style.maxWidth = "220px";
    img.style.borderRadius = "12px";
    host.appendChild(img);
  }
  host.appendChild(el("button", {
    class: "btn",
    on: {
      click: () => {
        const input = el("input", { type: "file", ariaLabel: "Logo image", attrs: { accept: "image/png,image/jpeg" } }) as HTMLInputElement;
        const submit = el("button", { class: "btn", on: { click: async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            await upload(`/api/tournaments/${tid}/logo`, file);
            const dlg = document.querySelector<HTMLDialogElement>("dialog[open]");
            dlg?.close();
            dlg?.remove();
            setPageNotice("Logo updated.");
            redraw();
          } catch (e) {
            if (e instanceof ApiFailure) {
              const dlg = document.querySelector<HTMLDialogElement>("dialog[open]");
              dlg?.appendChild(el("p", { class: "field-error" }, [e.body.message]));
            }
          }
        } } }, ["Add logo"]);
        openSimpleSheet("Upload logo", [input, submit]);
      },
    },
  }, ["Upload logo"]));
  return host;
}

function coOrganizerControls(tid: string, t: Tournament, redraw: () => void): HTMLElement {
  const host = el("section", { class: "card stack" });
  host.appendChild(el("h3", {}, ["Co-organizers"]));
  const list = el("ul", { class: "list-plain", attrs: { role: "list", "aria-label": "Co-organizers" } });
  for (const co of t.co_organizers ?? []) {
    list.appendChild(el("li", { class: "row" }, [
      co,
      el("button", {
        class: "btn btn--secondary",
        ariaLabel: `Remove ${co}`,
        on: {
          click: async () => {
            try {
              await api("DELETE", `/api/tournaments/${tid}/co-organizers/${co}`);
              redraw();
            } catch (e) {
              if (e instanceof ApiFailure) setPageError(e.body.message);
            }
          },
        },
      }, ["Remove"]),
    ]));
  }
  host.appendChild(list);
  const input = el("input", { ariaLabel: "Co-organizer username" }) as HTMLInputElement;
  const form = el("form", { class: "row" }, [input, el("button", { class: "btn", type: "submit" }, ["Add co-organizer"])]);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await api("POST", `/api/tournaments/${tid}/co-organizers`, { username: input.value });
      input.value = "";
      redraw();
    } catch (e) {
      if (e instanceof ApiFailure) setPageError(e.body.fields?.username ?? e.body.message);
    }
  });
  host.appendChild(form);
  return host;
}

function checkinControls(tid: string, t: Tournament, isOrganizer: boolean, redraw: () => void): HTMLElement {
  const host = el("section", { class: "card stack" });
  host.appendChild(el("h3", {}, ["Check-in"]));
  if (t.state === "checkin_open" || t.state === "checkin_closed") {
    host.appendChild(el("div", { class: "small", attrs: { role: "status", "aria-label": "Check-in count" } }, [
      `${t.checked_in_count} of ${t.entrant_count} checked in`,
    ]));
    const boxes = el("ul", { class: "list-plain" });
    for (const e of (t as Tournament & { entrants?: Entrant[] }).entrants ?? []) {
      boxes.appendChild(el("li", { class: "row" }, [
        el("input", {
          type: "checkbox",
          attrs: e.checked_in ? { checked: "checked" } : {},
          ariaLabel: `Checked in: ${e.name}`,
          on: { change: async (ev) => {
            const cb = ev.target as HTMLInputElement;
            try {
              await api("PUT", `/api/entrants/${e.id}/checkin`, { checked_in: cb.checked });
              redraw();
            } catch (err) {
              if (err instanceof ApiFailure) setPageError(err.body.message);
            }
          } },
        }),
        e.name,
      ]));
    }
    host.appendChild(boxes);
  }
  const actions = el("div", { class: "row" });
  if (t.state === "draft") {
    actions.appendChild(el("button", {
      class: "btn",
      on: {
        click: () => {
          const input = el("input", { ariaLabel: "Check-in closes", attrs: { placeholder: "YYYY-MM-DD HH:MM" } }) as HTMLInputElement;
          const err = el("p", { class: "field-error" });
          const submit = el("button", { class: "btn", on: { click: async () => {
            const raw = input.value.trim();
            let closesAt: string | undefined;
            if (raw !== "") {
              const m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
              if (!m) {
                err.textContent = "Enter the time as YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS.";
                return;
              }
              // convert from the tournament's zone to UTC
              const local = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}Z`);
              closesAt = zonedTimeToUtc(local, t.time_zone);
            }
            try {
              await api("POST", `/api/tournaments/${tid}/checkin/open`, closesAt ? { closes_at: closesAt } : {});
              const dlg = document.querySelector<HTMLDialogElement>("dialog[open]");
              dlg?.close();
              dlg?.remove();
              redraw();
            } catch (e) {
              if (e instanceof ApiFailure) err.textContent = e.body.fields?.closes_at ?? e.body.message;
            }
          } } }, ["Start check-in"]);
          openSimpleSheet("Open check-in", [input, err, submit]);
        },
      },
    }, ["Open check-in"]));
  }
  if (t.state === "checkin_open") {
    actions.appendChild(el("button", {
      class: "btn",
      on: {
        click: async () => {
          try {
            await api("POST", `/api/tournaments/${tid}/checkin/close`);
            redraw();
          } catch (e) {
            if (e instanceof ApiFailure) setPageError(e.body.message);
          }
        },
      },
    }, ["Close check-in"]));
    actions.appendChild(el("button", {
      class: "btn btn--secondary",
      on: {
        click: async () => {
          try {
            await api("POST", `/api/tournaments/${tid}/draft`);
            redraw();
          } catch (e) {
            if (e instanceof ApiFailure) setPageError(e.body.message);
          }
        },
      },
    }, ["Back to draft"]));
  }
  if (t.state === "checkin_closed") {
    actions.appendChild(el("button", {
      class: "btn btn--secondary",
      on: {
        click: async () => {
          try {
            await api("POST", `/api/tournaments/${tid}/draft`);
            redraw();
          } catch (e) {
            if (e instanceof ApiFailure) setPageError(e.body.message);
          }
        },
      },
    }, ["Back to draft"]));
  }
  if (t.state === "draft" || t.state === "checkin_closed") {
    actions.appendChild(el("button", {
      class: "btn",
      on: {
        click: async () => {
          try {
            const res = await api<{ removed: string[] }>("POST", `/api/tournaments/${tid}/start`);
            const n = res.removed.length;
            setPageNotice(
              n === 0
                ? "The tournament has started"
                : n === 1
                  ? `Removed 1 no-show: ${res.removed[0]}.`
                  : `Removed ${n} no-shows: ${res.removed.join(", ")}.`
            );
            navigate(`/t/${tid}/bracket`);
          } catch (e) {
            if (e instanceof ApiFailure) setPageError(e.body.message);
          }
        },
      },
    }, ["Start tournament"]));
  }
  if (isOrganizer && (t.state === "draft" || t.state === "checkin_open" || t.state === "checkin_closed")) {
    actions.appendChild(el("button", {
      class: "btn btn--danger",
      on: {
        click: async () => {
          try {
            await api("DELETE", `/api/tournaments/${tid}`);
            navigate("/t");
          } catch (e) {
            if (e instanceof ApiFailure) setPageError(e.body.message);
          }
        },
      },
    }, ["Delete tournament"]));
  }
  host.appendChild(actions);
  return host;
}

function zonedTimeToUtc(base: Date, zone: string): string {
  // interpret base (already constructed as if UTC) in the zone, then return the true UTC instant
  const guessOffset = (d: Date): number => {
    const dtf = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const parts = dtf.formatToParts(d);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "0";
    const asUTC = Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day")), Number(get("hour")) % 24, Number(get("minute")), Number(get("second")));
    return asUTC - d.getTime();
  };
  let utc = base.getTime();
  for (let i = 0; i < 2; i++) {
    utc = base.getTime() - guessOffset(new Date(utc));
  }
  return new Date(utc).toISOString();
}

function shareControls(t: Tournament): HTMLElement {
  const host = el("section", { class: "card stack" });
  host.appendChild(el("h3", {}, ["Share"]));
  host.appendChild(el("button", {
    class: "btn",
    on: {
      click: () => {
        const link = el("input", { attrs: { value: t.share_url ?? "", readonly: "readonly" }, ariaLabel: "Share link" }) as HTMLInputElement;
        const copy = el("button", { class: "btn", on: { click: async () => {
          await navigator.clipboard.writeText(t.share_url ?? "");
          setPageNotice("Link copied");
        } } }, ["Copy link"]);
        const replace = el("button", { class: "btn btn--secondary", on: { click: async () => {
          const res = await api<{ share_url: string }>("POST", `/api/tournaments/${t.id}/share/rotate`);
          link.value = res.share_url;
          setPageNotice("Link replaced. The old link no longer works.");
          t.share_url = res.share_url;
        } } }, ["Replace link"]);
        openSimpleSheet("Share tournament", [link, el("div", { class: "sheet-actions" }, [copy, replace])]);
      },
    },
  }, ["Share"]));
  return host;
}

export function setupMatchesOnlyForPreview(): void {
  void ({} as Match);
}
