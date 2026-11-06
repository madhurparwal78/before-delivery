// A bucket's object view (brief: Screens and layout, Centre; Console URLs; Interactions, Filtering, Paging,
// Selecting and bulk delete, Uploading, Lifecycle rules). The address bar holds the whole view state.
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatCount, formatTime } from "../shared/format";
import {
  ApiError,
  type Bucket,
  type DeleteBatch,
  type LifecycleRules,
  type ObjectMeta,
  type ObjectPage,
  type SearchItem,
  type StoredObject,
  type UndoResult,
  api,
  query,
} from "./api";
import type { Scope } from "./console";
import { Dialog, Field, Status, reducedMotion } from "./dialog";
import { Icon } from "./icons";
import { Inspector } from "./inspector";
import { type Place, follow, navigate } from "./router";
import { type UploadTarget, UploadDialog } from "./upload";

const TRUNCATED = "Showing the matches found so far. Narrow the filter or go to the next page.";
const DESKTOP = "(min-width: 1280px)";
const DELETE_ATTEMPTS = 3;

interface ViewQuery {
  prefix: string;
  tagFilter: string;
  cursor: string | null;
  prev: string[];
  object: string | null;
}

function readQuery(search: URLSearchParams): ViewQuery {
  return {
    prefix: search.get("prefix") ?? "",
    tagFilter: search.get("tag_filter") ?? "",
    cursor: search.get("cursor") || null,
    prev: search.getAll("prev"),
    object: search.get("object"),
  };
}

function viewHref(ws: string, bucket: string, q: ViewQuery): string {
  const search = new URLSearchParams();
  if (q.prefix) search.set("prefix", q.prefix);
  if (q.tagFilter) search.set("tag_filter", q.tagFilter);
  if (q.cursor) {
    search.set("cursor", q.cursor);
    for (const cursor of q.prev) search.append("prev", cursor);
  }
  if (q.object !== null) search.set("object", q.object);
  const text = search.toString();
  return `/console/${ws}/${bucket}${text ? `?${text}` : ""}`;
}

type Row = { kind: "folder"; prefix: string } | { kind: "object"; item: ObjectPage["items"][number] };

// Folder rows and object rows in one key order.
function rowsOf(page: ObjectPage): Row[] {
  const rows: Row[] = [];
  let f = 0;
  let o = 0;
  while (f < page.common_prefixes.length || o < page.items.length) {
    const folder = page.common_prefixes[f];
    const item = page.items[o];
    if (folder !== undefined && (item === undefined || folder < item.key)) {
      rows.push({ kind: "folder", prefix: folder });
      f++;
    } else if (item !== undefined) {
      rows.push({ kind: "object", item });
      o++;
    }
  }
  return rows;
}

const shortEtag = (etag: string): string => etag.replace(/"/g, "").slice(0, 8);

// The date and the time stay whole; a narrow column breaks between them.
function ModifiedTime({ at }: { at: string }): JSX.Element {
  const [date, ...time] = formatTime(at).split(" ");
  return (
    <>
      <span>{date}</span> <span>{time.join(" ")}</span>
    </>
  );
}
const fieldMessage = (error: unknown): string | null =>
  error instanceof ApiError && error.code === "validation_failed" ? Object.values(error.body.errors ?? {})[0] ?? null : null;

interface DeleteState {
  results: string[];
  batchId: string | null;
  undoUntil: string | null;
  undoOpen: boolean;
}

interface ObjectViewProps {
  scope: Scope;
  bucket: Bucket;
  place: Place;
  notices: JSX.Element;
}

// A bucket just created in this tab: its view opens with focus on the heading.
let headingToFocus: string | null = null;
export function focusHeadingOf(bucket: string): void {
  headingToFocus = bucket;
}

export function ObjectView({ scope, bucket, place, notices }: ObjectViewProps): JSX.Element {
  const q = readQuery(place.search);
  const heading = useRef<HTMLHeadingElement>(null);
  const wantsFocus = useRef(headingToFocus === bucket.name);
  if (wantsFocus.current) headingToFocus = null;
  const focusFrame = useRef(0);
  // The heading first renders once the first page settles, so focus moves on the commit that shows it.
  useLayoutEffect(() => {
    const target = heading.current;
    if (!wantsFocus.current || !target) return;
    wantsFocus.current = false;
    target.focus();
    // The closing dialog hands focus back to its opener; claim it again once the frame settles
    // unless the user has already moved into the view.
    focusFrame.current = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (target.isConnected && (!active || active === document.body || !target.closest("main")?.contains(active))) target.focus();
    });
  });
  useLayoutEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  const base = `/api/w/${scope.ws}/buckets/${bucket.name}`;
  const canWrite = scope.role !== "viewer";
  const go = (next: Partial<ViewQuery>, replace = false): void => navigate(viewHref(scope.ws, bucket.name, { ...q, ...next }), replace);

  const [page, setPage] = useState<ObjectPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [search, setSearch] = useState<{ items: SearchItem[]; truncated: boolean } | null>(null);
  const [searchText, setSearchText] = useState("");
  const [prefixInput, setPrefixInput] = useState(q.prefix);
  const [tagInput, setTagInput] = useState(q.tagFilter);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletion, setDeletion] = useState<DeleteState | null>(null);
  const [deleteStatus, setDeleteStatus] = useState("");
  const [upload, setUpload] = useState<{ files: File[]; target: UploadTarget } | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [stored, setStored] = useState<StoredObject | null>(null);
  const [rules, setRules] = useState<LifecycleRules | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState("");
  const [dropping, setDropping] = useState(false);
  const [open, setOpen] = useState<ObjectMeta | null>(null);
  const [closing, setClosing] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  // The first paint waits for the first page and for an object named in the address, so rows arriving or the
  // inspector opening never push or rewrap what is already on screen.
  const [listSettled, setListSettled] = useState(false);
  const [openSettled, setOpenSettled] = useState(q.object === null);
  const focusInspector = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const listKey = `${q.prefix}\n${q.tagFilter}\n${q.cursor ?? ""}`;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setListError(null);
    setSelected([]);
    api<ObjectPage>("GET", `${base}/objects${query({ prefix: q.prefix || undefined, delimiter: "/", tag_filter: q.tagFilter || undefined, cursor: q.cursor ?? undefined })}`).then(
      (result) => {
        if (!live) return;
        setPage(result);
        setLoading(false);
        setListSettled(true);
      },
      (error: unknown) => {
        if (!live) return;
        const message = fieldMessage(error);
        setPage(null);
        setListError(message === null ? scope.report(error) : `Filter not accepted: ${message}`);
        setLoading(false);
        setListSettled(true);
      },
    );
    return () => {
      live = false;
    };
  }, [listKey, reloads]);

  useEffect(() => {
    setPrefixInput(q.prefix);
    setTagInput(q.tagFilter);
    setSearch(null);
  }, [q.prefix, q.tagFilter]);

  // The inspector follows `object` in the address bar; an unknown key leaves it closed.
  useEffect(() => {
    if (q.object === null) {
      setMissing(null);
      focusInspector.current = false;
      if (open && !closing) {
        setStored(null);
        if (reducedMotion()) setOpen(null);
        else setClosing(true);
      }
      return;
    }
    if (open?.key === q.object && !closing) return;
    let live = true;
    api<ObjectMeta>("GET", `${base}/object${query({ key: q.object })}`).then(
      (meta) => {
        if (!live) return;
        setMissing(null);
        setClosing(false);
        setOpen(meta);
        setOpenSettled(true);
      },
      (error: unknown) => {
        if (!live) return;
        setOpen(null);
        setOpenSettled(true);
        if (error instanceof ApiError && error.status === 404) setMissing(q.object);
        else setListError(scope.report(error));
      },
    );
    return () => {
      live = false;
    };
  }, [q.object]);

  const openObject = (key: string): void => {
    focusInspector.current = true;
    go({ object: key }, true);
  };
  const closeInspector = (): void => {
    const key = open?.key;
    go({ object: null }, true);
    if (key !== undefined) document.querySelector<HTMLElement>(`[data-open-key="${CSS.escape(key)}"]`)?.focus();
  };

  useEffect(() => {
    if (!open || closing) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !event.defaultPrevented) closeInspector();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closing, q.object]);

  // Undo delete disappears when the browser's clock reaches the batch's undo-until time.
  useEffect(() => {
    if (!deletion?.undoOpen || !deletion.undoUntil) return;
    const timer = window.setTimeout(() => setDeletion((d) => d && { ...d, undoOpen: false }), Date.parse(deletion.undoUntil) - Date.now());
    return () => clearTimeout(timer);
  }, [deletion?.batchId, deletion?.undoOpen]);

  const applyFilters = (event: Event): void => {
    event.preventDefault();
    go({ prefix: prefixInput, tagFilter: tagInput.trim() ? tagInput : "", cursor: null, prev: [] });
    setSearch(null);
  };

  const runSearch = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (!searchText) {
      setSearch(null);
      return;
    }
    setLoading(true);
    setListError(null);
    try {
      setSearch(await api<{ items: SearchItem[]; truncated: boolean }>("GET", `/api/w/${scope.ws}/search${query({ q: searchText })}`));
    } catch (error) {
      const message = fieldMessage(error);
      setListError(message === null ? scope.report(error) : `Filter not accepted: ${message}`);
    }
    setLoading(false);
  };

  const rows = page ? rowsOf(page) : [];
  const objectKeys = rows.flatMap((r) => (r.kind === "object" ? [r.item.key] : []));
  const allSelected = objectKeys.length > 0 && objectKeys.every((k) => selected.includes(k));

  const resultsText = ((): string => {
    if (listError) return listError;
    if (loading) return "Loading objects…";
    if (missing !== null) return `No object ${missing} in ${bucket.name}.`;
    const shown = search ? search.items.length : rows.length;
    if (search ? search.truncated : page?.truncated) return TRUNCATED;
    return shown === 0 ? "No objects match." : `${formatCount(shown)} objects on this page`;
  })();

  const deleteSelected = async (): Promise<void> => {
    const keys = selected;
    setConfirmingDelete(false);
    setDeleteStatus(`Deleting ${formatCount(keys.length)} objects…`);
    const idempotencyKey = crypto.randomUUID();
    let batch: DeleteBatch | null = null;
    for (let n = 1; n <= DELETE_ATTEMPTS && batch === null; n++) {
      try {
        batch = await api<DeleteBatch>("POST", `${base}/objects/delete`, { keys }, { "Idempotency-Key": idempotencyKey });
      } catch (error) {
        if (error instanceof ApiError || n === DELETE_ATTEMPTS) {
          setDeleteStatus(scope.report(error));
          return;
        }
      }
    }
    if (batch === null) return;
    const deleted = batch.results.filter((r) => r.outcome === "deleted").map((r) => r.key);
    const gone = batch.results.length - deleted.length;
    setDeletion({
      results: batch.results.map((r) => `${r.key}: ${r.outcome === "deleted" ? "deleted" : "already gone"}`),
      batchId: batch.batch_id,
      undoUntil: batch.undo_until,
      undoOpen: batch.batch_id !== null,
    });
    setDeleteStatus(
      [
        `Deleted ${formatCount(deleted.length)} objects.`,
        gone ? `${formatCount(gone)} were already gone.` : "",
        batch.undo_until ? `Undo until ${formatTime(batch.undo_until)}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
    setSelected([]);
    setPage((p) => p && { ...p, items: p.items.filter((i) => !deleted.includes(i.key)) });
    if (open && deleted.includes(open.key)) closeInspector();
  };

  const undo = async (): Promise<void> => {
    if (!deletion?.batchId) return;
    setDeleteStatus("Restoring…");
    try {
      const result = await api<UndoResult>("POST", `/api/w/${scope.ws}/batches/${deletion.batchId}/undo`);
      const count = (outcome: string): number => result.results.filter((r) => r.outcome === outcome).length;
      const kept = count("newer_version");
      const removed = count("gone");
      setDeleteStatus(
        `Restored ${formatCount(count("restored"))} objects.` +
          (kept ? ` ${formatCount(kept)} kept their newer version.` : "") +
          (removed ? ` ${formatCount(removed)} were removed for good.` : ""),
      );
      const words = { restored: "restored", newer_version: "kept newer version", gone: "removed for good" } as const;
      setDeletion({ ...deletion, undoOpen: false, results: result.results.map((r) => `${r.key}: ${words[r.outcome]}`) });
      setReloads((n) => n + 1);
    } catch (error) {
      setDeletion({ ...deletion, undoOpen: false });
      if (error instanceof ApiError && error.code === "undo_expired") setDeleteStatus("The undo window has closed.");
      else if (error instanceof ApiError && error.code === "invalid_transition") setDeleteStatus("This delete was already undone.");
      else setDeleteStatus(scope.report(error));
    }
  };

  const openRules = async (): Promise<void> => {
    try {
      setRules(await api<LifecycleRules>("GET", `${base}/lifecycle`));
    } catch (error) {
      setLifecycleStatus(scope.report(error));
    }
  };

  const startUpload = (files: File[]): void => {
    if (files.length) setUpload({ files, target: { kind: "files", prefix: q.prefix } });
  };

  const dragProps = canWrite
    ? {
        onDragEnter: (event: DragEvent) => {
          if (!matchMedia(DESKTOP).matches || !event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDropping(true);
        },
        onDragOver: (event: DragEvent) => {
          if (!matchMedia(DESKTOP).matches || !event.dataTransfer?.types.includes("Files")) return;
          event.preventDefault();
          setDropping(true);
        },
        onDragLeave: (event: DragEvent) => {
          const to = event.relatedTarget;
          if (!(to instanceof Node && (event.currentTarget as HTMLElement).contains(to))) setDropping(false);
        },
        onDrop: (event: DragEvent) => {
          if (!matchMedia(DESKTOP).matches) return;
          event.preventDefault();
          setDropping(false);
          startUpload([...(event.dataTransfer?.files ?? [])]);
        },
      }
    : {};

  const segments = q.prefix.split("/").filter(Boolean);
  const showSelect = canWrite && !search;

  if (!listSettled || !openSettled) return <div class="objects" />;
  return (
    <div class={open ? "objects objects--inspecting" : "objects"}>
      <div class="objects__content">
        <h2 ref={heading} class="objects__title" tabIndex={-1}>
          {bucket.name}
        </h2>
        {/* The breadcrumb is a pointer shortcut outside the published Tab order; keyboard users reach the
            same prefixes through the folder rows and the Prefix field. */}
        <nav class="crumbs" aria-label="Breadcrumb">
          {segments.length === 0 ? (
            <span class="crumbs__here">{bucket.name}</span>
          ) : (
            <>
              <a href={viewHref(scope.ws, bucket.name, { ...q, prefix: "", cursor: null, prev: [] })} tabIndex={-1}
                onClick={(e) => follow(e, viewHref(scope.ws, bucket.name, { ...q, prefix: "", cursor: null, prev: [] }))}>
                {bucket.name}
              </a>
              <span class="crumbs__sep" aria-hidden="true">/</span>
              {segments.map((segment, i) => {
                const prefix = segments.slice(0, i + 1).join("/") + "/";
                const href = viewHref(scope.ws, bucket.name, { ...q, prefix, cursor: null, prev: [] });
                return i === segments.length - 1 ? (
                  <span key={prefix} class="crumbs__here">
                    {segment}/
                  </span>
                ) : (
                  <a key={prefix} href={href} tabIndex={-1} onClick={(e) => follow(e, href)}>
                    {segment}/
                  </a>
                );
              })}
            </>
          )}
        </nav>
        <div class="objects__slot">{notices}</div>
        <div class="toolbar">
          <form class="toolbar__search" role="search" onSubmit={runSearch}>
            <Icon name="search" />
            <input type="search" aria-label="Search objects" placeholder="Search objects" value={searchText}
              onInput={(e) => setSearchText(e.currentTarget.value)} />
          </form>
          <form class="toolbar__filters" onSubmit={applyFilters}>
            <label class="toolbar__field">
              <span>Prefix</span>
              <input class="mono-input" value={prefixInput} spellcheck={false} onInput={(e) => setPrefixInput(e.currentTarget.value)} />
            </label>
            <label class="toolbar__field toolbar__field--tag">
              <span>Tag filter</span>
              <input class="mono-input" value={tagInput} spellcheck={false} placeholder="env=qa and not team=art"
                onInput={(e) => setTagInput(e.currentTarget.value)} />
            </label>
            <button type="submit" class="button">
              Apply filters
            </button>
          </form>
          {canWrite && (
            <div class="toolbar__actions">
              <button type="button" class="button button--primary" onClick={() => fileInput.current?.click()}>
                <Icon name="upload" />
                Upload files
              </button>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => {
                const files = [...(e.currentTarget.files ?? [])];
                e.currentTarget.value = "";
                startUpload(files);
              }} />
              <button type="button" class="button" disabled={selected.length === 0} onClick={() => setConfirmingDelete(true)}>
                <Icon name="trash-2" />
                Delete selected
              </button>
              <button type="button" class="button" onClick={() => void openRules()}>
                <Icon name="settings-2" />
                Lifecycle rules
              </button>
            </div>
          )}
        </div>
        <div class="notices">
          <Status label="Upload status" text={uploadStatus} />
          <Status label="Lifecycle status" text={lifecycleStatus} />
        </div>
        <div class="deletion">
          {deletion && (
            <ul class="deletion__results" aria-label="Delete results">
              {deletion.results.map((line) => (
                <li key={line} class="mono">
                  {line}
                </li>
              ))}
            </ul>
          )}
          {deletion?.undoOpen && (
            <button type="button" class="button" onClick={() => void undo()}>
              <Icon name="undo-2" />
              Undo delete
            </button>
          )}
          <Status label="Delete status" text={deleteStatus} />
        </div>
        <div class={dropping ? "table-area table-area--drop" : "table-area"} {...dragProps}>
          {dropping && (
            <p class="table-area__drop">
              Drop to upload to {bucket.name}/{q.prefix}
            </p>
          )}
          <div class="table-frame">
            <table class="table objects__table" aria-label="Objects">
              <thead>
                <tr>
                  {showSelect && (
                    <th scope="col" class="cell--select">
                      <label class="hit">
                        <input type="checkbox" aria-label="Select all on this page" checked={allSelected}
                          disabled={objectKeys.length === 0}
                          onChange={(e) => setSelected(e.currentTarget.checked ? objectKeys : [])} />
                      </label>
                    </th>
                  )}
                  <th scope="col" class="col--key">Key</th>
                  {search && <th scope="col">Bucket</th>}
                  <th scope="col" class="num">
                    Size (bytes)
                  </th>
                  <th scope="col" class="col--wide">
                    Last modified (UTC)
                  </th>
                  {!search && (
                    <>
                      <th scope="col" class="num">
                        Regions (settled/placed)
                      </th>
                      <th scope="col" class="col--wide col--etag">
                        ETag<span class="vh"> (first 8 hex characters)</span>
                      </th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {search
                  ? search.items.map((item) => {
                      const href = `/console/${scope.ws}/${item.bucket}${query({ object: item.key })}`;
                      return (
                        <tr key={`${item.bucket}/${item.key}`}>
                          <td class="cell--key">
                            <button type="button" class="row-open" aria-label={`Open ${item.key}`} onClick={() => {
                              focusInspector.current = true;
                              navigate(href);
                            }}>
                              <Icon name="file" />
                              <span class="mono">{item.key}</span>
                            </button>
                          </td>
                          <td>{item.bucket}</td>
                          <td class="num">{formatCount(item.size)}</td>
                          <td class="mono col--wide cell--time">
                            <ModifiedTime at={item.last_modified} />
                          </td>
                        </tr>
                      );
                    })
                  : rows.map((row) =>
                      row.kind === "folder" ? (
                        <tr key={`f:${row.prefix}`} class="row--folder">
                          {showSelect && <td class="cell--select" />}
                          <td class="cell--key">
                            <button type="button" class="row-open" aria-label={`Open folder ${row.prefix}`}
                              onClick={() => go({ prefix: row.prefix, cursor: null, prev: [] })}>
                              <Icon name="folder" />
                              <span class="mono">{row.prefix.slice(q.prefix.length)}</span>
                            </button>
                          </td>
                          <td class="num" />
                          <td class="col--wide" />
                          <td class="num" />
                          <td class="col--wide col--etag" />
                        </tr>
                      ) : (
                        <tr key={`o:${row.item.key}`} class={open?.key === row.item.key ? "row--open" : undefined}>
                          {showSelect && (
                            <td class="cell--select">
                              <label class="hit">
                                <input type="checkbox" aria-label={`Select ${row.item.key}`} checked={selected.includes(row.item.key)}
                                  onChange={(e) =>
                                    setSelected(e.currentTarget.checked ? [...selected, row.item.key] : selected.filter((k) => k !== row.item.key))
                                  } />
                              </label>
                            </td>
                          )}
                          <td class="cell--key">
                            <button type="button" class="row-open" aria-label={`Open ${row.item.key}`} data-open-key={row.item.key}
                              onClick={() => openObject(row.item.key)}>
                              <Icon name="file" />
                              <span class="mono">{row.item.key.slice(q.prefix.length)}</span>
                            </button>
                          </td>
                          <td class="num">{formatCount(row.item.size)}</td>
                          <td class="mono col--wide cell--time">
                            <ModifiedTime at={row.item.last_modified} />
                          </td>
                          <td class="num">
                            {row.item.replicas_settled}/{row.item.replicas_total}
                          </td>
                          <td class="mono col--wide col--etag">{shortEtag(row.item.etag)}</td>
                        </tr>
                      ),
                    )}
              </tbody>
            </table>
          </div>
        </div>
        <div class="paging">
          <button type="button" class="button" disabled={!q.cursor || !!search} onClick={() => {
            const prev = [...q.prev];
            const cursor = prev.pop() || null;
            go({ cursor, prev });
          }}>
            <Icon name="chevron-left" />
            Previous page
          </button>
          <button type="button" class="button" disabled={!page?.next_cursor || !!search} onClick={() =>
            go({ cursor: page?.next_cursor ?? null, prev: [...q.prev, q.cursor ?? ""] })
          }>
            Next page
            <Icon name="chevron-right" />
          </button>
          <Status label="Results status" text={resultsText} class="paging__status" />
        </div>
      </div>
      {open && (
        <Inspector
          key={open.key}
          scope={scope}
          bucket={bucket}
          meta={open}
          focusOnOpen={focusInspector.current}
          closing={closing}
          stored={stored}
          onClose={closeInspector}
          onClosed={() => {
            setOpen(null);
            setClosing(false);
            setStored(null);
          }}
          onDeleted={() => {
            closeInspector();
            setReloads((n) => n + 1);
          }}
          onUploadVersion={(file, meta) => setUpload({ files: [file], target: { kind: "version", key: meta.key, etag: meta.etag } })}
        />
      )}
      {upload && (
        <UploadDialog
          scope={scope}
          bucket={bucket}
          files={upload.files}
          target={upload.target}
          status={uploadStatus}
          onStatus={setUploadStatus}
          onStored={(result) => {
            setStored(result);
            setReloads((n) => n + 1);
          }}
          onClose={() => setUpload(null)}
        />
      )}
      {confirmingDelete && (
        <Dialog title="Delete objects" onClose={() => setConfirmingDelete(false)}>
          <ul class="dialog__keys">
            {selected.map((key) => (
              <li key={key} class="mono">
                {key}
              </li>
            ))}
          </ul>
          <div class="form__actions">
            <button type="button" class="button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button type="button" class="button button--primary" onClick={() => void deleteSelected()}>
              <Icon name="trash-2" />
              Delete objects
            </button>
          </div>
        </Dialog>
      )}
      {rules && (
        <LifecycleDialog scope={scope} bucket={bucket} rules={rules} onStatus={setLifecycleStatus} onClose={() => setRules(null)} />
      )}
    </div>
  );
}

const RULE_FIELDS = [
  ["noncurrent_days", "Expire noncurrent versions after (days)", "Empty means off."],
  ["keep_newest_noncurrent", "Keep newest noncurrent versions", undefined],
  ["abort_multipart_days", "Abort incomplete uploads after (days)", "Empty means off."],
] as const;

type RuleField = (typeof RULE_FIELDS)[number][0];

interface LifecycleDialogProps {
  scope: Scope;
  bucket: Bucket;
  rules: LifecycleRules;
  onStatus: (text: string) => void;
  onClose: () => void;
}

function LifecycleDialog({ scope, bucket, rules, onStatus, onClose }: LifecycleDialogProps): JSX.Element {
  const [values, setValues] = useState<Record<RuleField, string>>({
    noncurrent_days: rules.noncurrent_days === null ? "" : String(rules.noncurrent_days),
    keep_newest_noncurrent: String(rules.keep_newest_noncurrent),
    abort_multipart_days: rules.abort_multipart_days === null ? "" : String(rules.abort_multipart_days),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = async (event: Event): Promise<void> => {
    event.preventDefault();
    setErrors({});
    onStatus("Saving rules…");
    const days = (text: string): number | null => (text.trim() === "" ? null : Number(text));
    try {
      await api<LifecycleRules>("PUT", `/api/w/${scope.ws}/buckets/${bucket.name}/lifecycle`, {
        noncurrent_days: days(values.noncurrent_days),
        keep_newest_noncurrent: days(values.keep_newest_noncurrent) ?? 0,
        abort_multipart_days: days(values.abort_multipart_days),
      });
      onStatus(`Lifecycle rules saved for ${bucket.name}.`);
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.code === "validation_failed") {
        setErrors(error.body.errors ?? {});
        onStatus("Rules not saved. Fix the highlighted fields.");
      } else {
        onStatus(scope.report(error));
      }
    }
  };

  return (
    <Dialog title="Lifecycle rules" onClose={onClose}>
      <form class="form" onSubmit={save}>
        <p class="dialog__lead">
          Rules for <span class="mono">{bucket.name}</span>. A version under retention or legal hold is always kept.
        </p>
        {RULE_FIELDS.map(([name, label, hint]) => (
          <Field key={name} label={label} hint={hint} error={errors[name]}>
            {(described, id) => (
              <input id={id} type="number" inputMode="numeric" min={0} step={1} class="mono-input" value={values[name]}
                aria-describedby={described} aria-invalid={errors[name] ? true : undefined}
                onInput={(e) => setValues({ ...values, [name]: e.currentTarget.value })} />
            )}
          </Field>
        ))}
        <div class="form__actions">
          <button type="button" class="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="button button--primary">
            Save rules
          </button>
        </div>
      </form>
    </Dialog>
  );
}
