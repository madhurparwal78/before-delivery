import { useEffect, useRef, useState } from "react";
import { Ellipsis, Plus, Star } from "lucide-react";
import { shortDate } from "../domain/dates.ts";
import type { WorkspaceRecord } from "../domain/types.ts";
import { moveToTrash, newDocument, setDocumentDetails } from "../store/actions.ts";
import { announce, showConfirmation } from "../store/announcer.ts";
import type { Density, DocumentFilter, SavedFilter } from "../store/preferences.ts";
import { NO_FILTER, readDensity, readSavedFilters, writeDensity, writeSavedFilters } from "../store/preferences.ts";
import { navigate } from "../store/router.ts";
import { blocksOf, lastChanged, listedDocuments } from "../store/workspace.ts";
import { Dialog, Empty, Link, Menu } from "./common.tsx";
import { useViewport } from "./hooks.ts";

export const untitled = (title: string): string => title || "Untitled";

export function startNewDocument(): void {
  const id = newDocument();
  navigate(`/doc/${id}`, "title");
}

function matches(document: WorkspaceRecord<"document">, filter: DocumentFilter): boolean {
  const { title, folder, tags, starred } = document.fields;
  if (filter.folder && folder !== filter.folder) return false;
  if (filter.tag && !tags.includes(filter.tag)) return false;
  if (filter.starred && !starred) return false;
  if (!filter.search) return true;
  const wanted = filter.search.toLowerCase();
  return [title, ...tags, ...blocksOf(document.id).map((block) => block.fields.text)].some((text) => text.toLowerCase().includes(wanted));
}

const ALL_DOCUMENTS = "";

function SaveFilterDialog({ filters, onSave, onClose }: { filters: SavedFilter[]; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const save = (): void => {
    const trimmed = name.trim();
    const problem = !trimmed
      ? "Enter a filter name."
      : ["All documents", ...filters.map((filter) => filter.name)].some((used) => used.toLowerCase() === trimmed.toLowerCase())
        ? "That filter name is already used."
        : "";
    if (problem) {
      setError(problem);
      announce(problem);
      field.current?.focus();
    } else onSave(trimmed);
  };
  return (
    <Dialog name="Save filter" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); save(); }}>
        <label className="field">
          <span>Filter name</span>
          <input ref={field} value={name} onChange={(event) => setName(event.target.value)} aria-describedby="filter-error" />
        </label>
        <p id="filter-error" className="field-error">{error}</p>
        <div className="dialog-actions">
          <button type="submit" className="button">Save filter</button>
          <button type="button" className="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function Row({ document, density, phone, onMenu }: {
  document: WorkspaceRecord<"document">;
  density: Density;
  phone: boolean;
  onMenu: (document: WorkspaceRecord<"document">, opener: HTMLElement) => void;
}) {
  const { title, folder, tags, starred } = document.fields;
  const name = untitled(title);
  const firstLine = blocksOf(document.id).find((block) => block.fields.text)?.fields.text ?? "";
  return (
    <li className="row">
      <div className="row-main">
        <Link href={`/doc/${document.id}`} className="row-title">{name}</Link>
        {density !== "List" && firstLine && <p className="row-line">{firstLine}</p>}
        <div className="row-meta">
          {!phone && <span className="row-folder">{folder}</span>}
          {!phone && <span className="row-tags">{tags.map((tag) => <span key={tag} className="tag">{tag}</span>)}</span>}
          <span className="row-date">{shortDate(lastChanged(document))}</span>
        </div>
      </div>
      <div className="row-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={`Star ${name}`}
          aria-pressed={starred}
          onClick={() => setDocumentDetails(document.id, { starred: !starred })}
        >
          <Star aria-hidden="true" fill={starred ? "currentColor" : "none"} />
        </button>
        <button type="button" className="icon-button" aria-label={`Actions for ${name}`} aria-haspopup="menu" onClick={(event) => onMenu(document, event.currentTarget)}>
          <Ellipsis aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function DocumentList() {
  const viewport = useViewport();
  const [filter, setFilter] = useState<DocumentFilter>(NO_FILTER);
  const [savedChoice, setSavedChoice] = useState(ALL_DOCUMENTS);
  const [savedFilters, setSavedFilters] = useState(readSavedFilters);
  const [saving, setSaving] = useState(false);
  const [density, setDensity] = useState(readDensity);
  const [menu, setMenu] = useState<{ document: WorkspaceRecord<"document">; opener: HTMLElement } | null>(null);
  const saveOpener = useRef<HTMLButtonElement>(null);
  const listed = listedDocuments();
  const shown = listed.filter((document) => matches(document, filter));
  const folders = [...new Set(listed.map((document) => document.fields.folder).filter(Boolean))].sort();
  const tags = [...new Set(listed.flatMap((document) => document.fields.tags))].sort();
  const announced = useRef(`${shown.length}/${listed.length}`);
  useEffect(() => {
    const counted = `${shown.length}/${listed.length}`;
    if (announced.current !== counted) announce(`Showing ${shown.length} of ${listed.length} documents.`);
    announced.current = counted;
  }, [shown.length, listed.length]);

  const chooseSaved = (name: string): void => {
    setSavedChoice(name);
    const saved = savedFilters.find((candidate) => candidate.name === name);
    const { search, folder, tag, starred } = saved ?? NO_FILTER;
    setFilter({ search, folder, tag, starred });
  };
  const saveFilter = (name: string): void => {
    const next = [...savedFilters, { ...filter, name }];
    setSavedFilters(next);
    writeSavedFilters(next);
    setSavedChoice(name);
    setSaving(false);
    showConfirmation(`Saved filter "${name}".`);
  };
  const chooseDensity = (next: Density): void => {
    setDensity(next);
    writeDensity(next);
  };

  return (
    <div className="screen">
      <h1 className="screen-title">Documents</h1>
      <section className="paper list-panel">
        <div className="list-tools">
          <button type="button" className="button" onClick={startNewDocument}><Plus aria-hidden="true" />New document</button>
          <input type="search" className="input grow" aria-label="Search documents" placeholder="Search documents" value={filter.search} onChange={(event) => setFilter({ ...filter, search: event.target.value })} />
          <select className="input" aria-label="Folder filter" value={filter.folder} onChange={(event) => setFilter({ ...filter, folder: event.target.value })}>
            <option value="">All folders</option>
            {folders.map((folder) => <option key={folder}>{folder}</option>)}
          </select>
          <select className="input" aria-label="Tag filter" value={filter.tag} onChange={(event) => setFilter({ ...filter, tag: event.target.value })}>
            <option value="">All tags</option>
            {tags.map((tag) => <option key={tag}>{tag}</option>)}
          </select>
          <select className="input" aria-label="Saved filter" value={savedChoice} onChange={(event) => chooseSaved(event.target.value)}>
            <option value={ALL_DOCUMENTS}>All documents</option>
            {savedFilters.map((saved) => <option key={saved.name}>{saved.name}</option>)}
          </select>
          <button ref={saveOpener} type="button" className="button" onClick={() => setSaving(true)}>Save this filter</button>
        </div>
        <div className="list-summary">
          <div role="radiogroup" aria-label="List density" className="segments">
            {(["List", "Card", "Grid"] as const).map((option) => (
              <label key={option} className="segment">
                <input type="radio" name="density" checked={density === option} onChange={() => chooseDensity(option)} />
                <span>{option}</span>
              </label>
            ))}
          </div>
          <span role="status" aria-label="Document count" className="count">{shown.length} of {listed.length} documents</span>
        </div>
        {shown.length === 0 ? (
          <Empty text={listed.length === 0 ? "No documents yet." : "No documents match."} />
        ) : (
          <ul aria-label="Documents" className={`rows rows-${density.toLowerCase()}`}>
            {shown.map((document) => (
              <Row key={document.id} document={document} density={density} phone={viewport === "phone"} onMenu={(chosen, opener) => setMenu({ document: chosen, opener })} />
            ))}
          </ul>
        )}
      </section>
      {saving && <SaveFilterDialog filters={savedFilters} onSave={saveFilter} onClose={() => setSaving(false)} />}
      {menu && (
        <Menu
          label={`Actions for ${untitled(menu.document.fields.title)}`}
          opener={menu.opener}
          onClose={() => setMenu(null)}
          items={[
            { label: "Open", choose: () => navigate(`/doc/${menu.document.id}`) },
            {
              label: menu.document.fields.starred ? "Unstar" : "Star",
              choose: () => setDocumentDetails(menu.document.id, { starred: !menu.document.fields.starred }),
            },
            {
              label: "Move to trash",
              choose: () => {
                moveToTrash(menu.document.id, untitled(menu.document.fields.title));
                document.getElementById("main")?.focus();
              },
            },
          ]}
        />
      )}
    </div>
  );
}
