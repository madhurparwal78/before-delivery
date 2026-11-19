import type { JSX } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { GARMENTS } from "../../shared/catalog";
import type { CataloguePreview, Label, Style, StyleRow } from "../../shared/api";
import { announce, api, focusHeading, navigate, place, post, pushAddress, useResource, useTitle } from "../lib";
import { Button, Field, Hidden, Modal, Problems, TableFrame, useDialog, useForm, type DialogControl } from "../ui";
import { RefreshLine } from "../frame";
import { Heading } from "./public";

const STATE_NAMES: Record<StyleRow["state"], string> = { draft: "Draft", worked: "Worked", published: "Published", archived: "Archived" };

function NewStyleDialog({ control, labels }: { control: DialogControl; labels: Label[] }): JSX.Element {
  return (
    <Modal name="New style" control={control}>
      <NewStyleForm control={control} labels={labels} />
    </Modal>
  );
}

function NewStyleForm({ control, labels }: { control: DialogControl; labels: Label[] }): JSX.Element {
  const form = useForm("new-style", {
    labelId: labels[0]?.id ?? "",
    name: "",
    styleCode: "",
    season: "",
    gtin: "",
    garment: "tshirt",
    washes: "30",
    repair: "null",
    rangeSize: "",
    notes: "",
  });
  const { values } = form;
  const save = (event: Event): void => {
    event.preventDefault();
    void form.submit(async () => {
      const style = await post<Style>("/api/styles", {
        labelId: values.labelId,
        name: values.name,
        season: values.season,
        gtin: values.gtin,
        garment: values.garment,
        ...(values.styleCode.trim() ? { styleCode: values.styleCode } : {}),
        ...(values.washes.trim() ? { washes: Number(values.washes) } : {}),
        repairService: values.repair === "null" ? null : values.repair === "true",
        ...(values.rangeSize.trim() ? { rangeSize: Number(values.rangeSize) } : {}),
        ...(values.notes.trim() ? { notes: values.notes } : {}),
      });
      control.hide();
      navigate(`/styles/${style.id}`);
      announce(`Style ${style.name} added.`);
    });
  };
  return (
    <form onSubmit={save} noValidate>
      <h2>New style</h2>
      <Problems form={form} />
      <Field form={form} name="labelId" label="Label" value={values.labelId} onValue={(value) => form.set("labelId", value)} options={labels.map((label) => ({ value: label.id, label: label.name }))} />
      <Field form={form} name="name" label="Name" value={values.name} onValue={(value) => form.set("name", value)} />
      <Field form={form} name="styleCode" label="Style code" value={values.styleCode} onValue={(value) => form.set("styleCode", value)} />
      <Field form={form} name="season" label="Season" value={values.season} onValue={(value) => form.set("season", value)} />
      <Field form={form} name="gtin" label="GTIN" inputMode="numeric" value={values.gtin} onValue={(value) => form.set("gtin", value)} />
      <Field form={form} name="garment" label="Garment" value={values.garment} onValue={(value) => form.set("garment", value)} options={GARMENTS.map((garment) => ({ value: garment.id, label: garment.name }))} />
      <Field form={form} name="washes" label="Washes" inputMode="numeric" value={values.washes} onValue={(value) => form.set("washes", value)} />
      <Field
        form={form}
        name="repairService"
        label="Repair service offered"
        value={values.repair}
        onValue={(value) => form.set("repair", value)}
        options={[
          { value: "null", label: "Not stated" },
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ]}
      />
      <Field form={form} name="rangeSize" label="Range size" inputMode="numeric" value={values.rangeSize} onValue={(value) => form.set("rangeSize", value)} />
      <Field form={form} name="notes" label="Notes" rows={3} value={values.notes} onValue={(value) => form.set("notes", value)} />
      <div class="dialog-actions">
        <Button type="submit" green busy={form.busy}>
          Save style
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </form>
  );
}

function CatalogueDialog({ control, labels, onSaved }: { control: DialogControl; labels: Label[]; onSaved: () => Promise<void> }): JSX.Element {
  return (
    <Modal name="Bring in catalogue" control={control}>
      <CatalogueForm control={control} labels={labels} onSaved={onSaved} />
    </Modal>
  );
}

function CatalogueForm({ control, labels, onSaved }: { control: DialogControl; labels: Label[]; onSaved: () => Promise<void> }): JSX.Element {
  const form = useForm(null, { labelId: labels[0]?.id ?? "" });
  const [preview, setPreview] = useState<CataloguePreview | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [savingBusy, setSavingBusy] = useState(false);

  const body = async (): Promise<ArrayBuffer | null> => {
    const chosen = file.current?.files?.[0];
    if (!chosen) {
      form.refuse("Give a value here.", { file: "Give a value here." });
      return null;
    }
    return chosen.arrayBuffer();
  };

  const runPreview = (): void => {
    void form.submit(async () => {
      const bytes = await body();
      if (!bytes) return;
      setPreview(null);
      const answer = await api<CataloguePreview>(`/api/labels/${form.values.labelId}/catalogue/preview`, { method: "POST", raw: bytes, type: "text/csv" });
      setPreview(answer);
      announce(`Preview ready: ${answer.newCount} new, ${answer.matchedCount} matched, ${answer.refusedCount} refused.`);
    });
  };

  const save = (): void => {
    setSavingBusy(true);
    void form
      .submit(async () => {
        const bytes = await body();
        if (!bytes) return;
        const answer = await api<CataloguePreview>(`/api/labels/${form.values.labelId}/catalogue/save`, { method: "POST", raw: bytes, type: "text/csv" });
        await onSaved();
        control.hide();
        announce(`Catalogue saved: ${answer.newCount} new, ${answer.matchedCount} matched, ${answer.refusedCount} refused.`);
      })
      .finally(() => setSavingBusy(false));
  };

  return (
    <div>
      <h2>Bring in catalogue</h2>
      <Problems form={form} />
      <Field form={form} name="labelId" label="Label" value={form.values.labelId} onValue={(value) => form.set("labelId", value)} options={labels.map((label) => ({ value: label.id, label: label.name }))} />
      <div class="field">
        <label for="field-file">Catalogue file</label>
        <input ref={file} id="field-file" type="file" accept=".csv,text/csv" aria-invalid={form.problems.fields.file ? "true" : undefined} onChange={() => setPreview(null)} />
      </div>
      {preview ? (
        <div class="table-frame" role="region" aria-label="Catalogue rows" tabIndex={0}>
          <table aria-label="Catalogue preview">
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Style code</th>
                <th scope="col">Name</th>
                <th scope="col">Outcome</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.row}>
                  <td>{row.row}</td>
                  <td>{row.styleCode}</td>
                  <td>{row.name}</td>
                  <td>{row.outcome === "new" ? "New" : row.outcome === "matched" ? "Matched" : "Refused"}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div class="dialog-actions">
        <Button busy={form.busy && !savingBusy} onPress={runPreview}>
          Preview
        </Button>
        <Button green busy={savingBusy} onPress={save}>
          Save catalogue
        </Button>
        <Button onPress={control.hide}>Close</Button>
      </div>
    </div>
  );
}

function RowMenu({ row, reload }: { row: StyleRow; reload: () => Promise<void> }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const position = (): void => {
    const anchor = button.current?.getBoundingClientRect();
    const size = menu.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = size?.width ?? 180;
    const height = size?.height ?? 150;
    const fitsBelow = anchor.bottom + height + 8 <= innerHeight;
    setBox({
      top: fitsBelow ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4),
      left: Math.max(8, Math.min(anchor.right - width, innerWidth - width - 8)),
    });
  };

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    position();
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onPress = (event: Event): void => {
      if (!menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) close(false);
    };
    const onMove = (): void => position();
    document.addEventListener("pointerdown", onPress);
    addEventListener("resize", onMove);
    addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      removeEventListener("resize", onMove);
      removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  const onKey = (event: KeyboardEvent): void => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(at + 1) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(at - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const duplicate = async (): Promise<void> => {
    close(false);
    try {
      const copy = await post<Style>(`/api/styles/${row.id}/duplicate`);
      navigate(`/styles/${copy.id}`);
      announce(`Style ${copy.name} added.`);
    } catch (error) {
      setProblem((error as Error).message);
      announce((error as Error).message);
      button.current?.focus();
    }
  };

  const archive = async (): Promise<void> => {
    close(false);
    try {
      await post<Style>(`/api/styles/${row.id}/archive`);
      await reload();
      focusHeading();
      announce(`Style ${row.name} archived.`);
    } catch (error) {
      setProblem((error as Error).message);
      announce((error as Error).message);
      button.current?.focus();
    }
  };

  return (
    <>
      <button ref={button} type="button" class="button button-small" aria-haspopup="menu" aria-expanded={open ? "true" : "false"} onClick={() => (open ? close(false) : setOpen(true))}>
        Actions<Hidden> for {row.name}</Hidden>
      </button>
      {problem ? <p class="row-problem">{problem}</p> : null}
      {open
        ? createPortal(
            <div ref={menu} class="row-menu" role="menu" aria-label={`Actions for ${row.name}`} style={box ? { top: `${box.top}px`, left: `${box.left}px` } : { top: "0px", left: "0px" }} onKeyDown={onKey}>
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => navigate(`/styles/${row.id}`, { restoreFocus: row.id })}>
                Open
              </button>
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => void duplicate()}>
                Duplicate
              </button>
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => void archive()}>
                Archive
              </button>
            </div>,
            document.getElementById("overlays") as HTMLElement,
          )
        : null}
    </>
  );
}

export function Styles(): JSX.Element {
  useTitle("Styles");
  const here = place.use();
  const query = new URLSearchParams(here.search);
  const list = useResource<{ styles: StyleRow[]; nextCursor: string | null }>(`/api/styles${here.search}`);
  const labels = useResource<{ labels: Label[] }>("/api/labels");
  const seasonSource = useResource<{ styles: StyleRow[] }>("/api/styles");
  const newStyle = useDialog("new-style");
  const catalogue = useDialog();
  const [search, setSearch] = useState(query.get("q") ?? "");
  const committed = query.get("q") ?? "";
  const announceNext = useRef(false);

  useEffect(() => setSearch(committed), [committed]);

  const seasons = useRef<Set<string>>(new Set());
  seasonSource.data?.styles.forEach((style) => seasons.current.add(style.season));
  list.data?.styles.forEach((style) => seasons.current.add(style.season));
  const seasonNow = query.get("season");
  if (seasonNow) seasons.current.add(seasonNow);

  const commit = (changes: Record<string, string | null>): void => {
    const next = new URLSearchParams(here.search);
    next.delete("cursor");
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    announceNext.current = true;
    const text = next.toString();
    pushAddress(text ? `?${text}` : "");
  };

  useLayoutEffect(() => {
    if (!list.data || !announceNext.current) return;
    announceNext.current = false;
    const count = list.data.styles.length;
    announce(count === 1 ? "1 style shown." : `${count} styles shown.`);
  }, [list.data]);

  useLayoutEffect(() => {
    if (!here.restore || !list.data) return;
    scrollTo({ top: here.restore.scrollY, behavior: "instant" });
    if (here.restore.focus) {
      document.querySelector<HTMLElement>(`[data-restore="${CSS.escape(here.restore.focus)}"]`)?.focus({ preventScroll: true });
    }
  }, [here.restore, Boolean(list.data)]);

  const openLabels = (labels.data?.labels ?? []).filter((label) => label.state === "open");

  return (
    <main class="desk-main">
      <Heading>Styles</Heading>
      <RefreshLine />
      <div class="filters">
        <div class="field">
          <label for="filter-label">Label</label>
          <select id="filter-label" value={query.get("label") ?? ""} onChange={(event) => commit({ label: event.currentTarget.value })}>
            <option value="">All labels</option>
            {(labels.data?.labels ?? []).filter((label) => label.state !== "erased").map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="filter-season">Season</label>
          <select id="filter-season" value={query.get("season") ?? ""} onChange={(event) => commit({ season: event.currentTarget.value })}>
            <option value="">All seasons</option>
            {[...seasons.current].sort().map((season) => (
              <option key={season} value={season}>
                {season}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="filter-state">State</label>
          <select id="filter-state" value={query.get("state") ?? ""} onChange={(event) => commit({ state: event.currentTarget.value })}>
            <option value="">All states</option>
            {Object.entries(STATE_NAMES).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="filter-sort">Sort by</label>
          <select id="filter-sort" value={query.get("sort") ?? "name"} onChange={(event) => commit({ sort: event.currentTarget.value })}>
            <option value="name">Name</option>
            <option value="climate">Climate figure</option>
          </select>
        </div>
        <div class="field filter-search">
          <label for="filter-search">Search styles</label>
          <input
            id="filter-search"
            type="search"
            value={search}
            onInput={(event) => setSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && search !== committed) commit({ q: search.trim() });
            }}
            onBlur={() => {
              if (search !== committed) commit({ q: search.trim() });
            }}
          />
        </div>
      </div>
      <div class="screen-actions">
        <Button onPress={catalogue.show}>Bring in catalogue</Button>
        <div class="action-bar">
          <Button green onPress={newStyle.show}>
            New style
          </Button>
        </div>
      </div>
      <TableFrame name="Styles table">
        <table class="table-sticky">
          <thead>
            <tr>
              <th scope="col">Style</th>
              <th scope="col">Label</th>
              <th scope="col">Season</th>
              <th scope="col">State</th>
              <th scope="col">Suppliers</th>
              <th scope="col" class="figure">
                Climate
              </th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.styles ?? []).map((row) => (
              <tr key={row.id}>
                <td class="cell-wide">
                  <a class="cell-link" href={`/styles/${row.id}`} data-restore={row.id}>
                    {row.name}
                  </a>
                </td>
                <td class="cell-wide">{row.labelName}</td>
                <td>{row.season}</td>
                <td>{STATE_NAMES[row.state]}</td>
                <td class="cell-wide cell-suppliers">
                  {row.suppliers.map((name, index) => (
                    <>
                      {index ? " " : ""}
                      <span class="supplier-name">
                        {name}
                        {index < row.suppliers.length - 1 ? "," : ""}
                      </span>
                    </>
                  ))}
                </td>
                <td class="figure">{row.climateShown ?? "Not worked out"}</td>
                <td>
                  <RowMenu row={row} reload={list.reload} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      {list.data && !list.data.styles.length ? (
        <div class="empty-state">
          <div class="fragment fragment-empty" aria-hidden="true">
            <span class="fake-button">New style</span>
          </div>
          <p>No styles here yet. Press New style to add the first one.</p>
        </div>
      ) : null}
      <div class="after-table">
        <Button inactive={!list.data?.nextCursor} onPress={() => list.data?.nextCursor && commit({ cursor: list.data.nextCursor })}>
          Next page
        </Button>
        {list.data && !list.data.nextCursor ? <p>No more styles</p> : null}
      </div>
      <NewStyleDialog control={newStyle} labels={openLabels} />
      <CatalogueDialog control={catalogue} labels={openLabels} onSaved={list.reload} />
    </main>
  );
}
