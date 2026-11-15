import { useEffect, useRef, useState } from "preact/hooks";
import type { Pen, ShelfLibrary, Visibility } from "../../shared/types";
import { api } from "../api";
import { Combobox, Dialog } from "../components";
import { unverifiedText } from "../format";
import { useAppState } from "../store";

const visibilityOptions: { value: Visibility; label: string }[] = [
  { value: "private", label: "Private" },
  { value: "unlisted", label: "Unlisted" },
  { value: "public", label: "Public" },
];

export function SettingsDialog(props: {
  pen: Pen;
  libraries: string[];
  status: string;
  onStatus: (text: string) => void;
  onPen: (pen: Pen) => void;
  onLibraries: (libraries: string[]) => void;
  onDelete: () => void;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const { user } = useAppState();
  const [shelf, setShelf] = useState<ShelfLibrary[]>([]);
  const [tagText, setTagText] = useState("");
  const { pen } = props;
  useEffect(() => {
    void api<{ libraries: ShelfLibrary[] }>("GET", "/api/shelf").then((result) => {
      if (result.ok) setShelf(result.data.libraries);
    });
  }, []);

  const patch = async (body: Record<string, unknown>, success: (pen: Pen) => string) => {
    const result = await api<Pen>("PATCH", `/api/pens/${pen.id}`, body);
    if (result.ok) {
      props.onPen(result.data);
      props.onStatus(success(result.data));
      return true;
    }
    if (result.error.error === "unverified") props.onStatus(unverifiedText(user?.email ?? ""));
    else props.onStatus(result.error.fields?.tags ?? result.error.fields?.visibility ?? result.error.message);
    return false;
  };

  const addTag = async () => {
    const tag = tagText.trim().toLowerCase();
    if (await patch({ tags: [...pen.tags, tag] }, () => `Added tag ${tag}`)) setTagText("");
  };

  return (
    <Dialog
        label="Pen settings"
        onClose={props.onClose}
        returnFocus={props.returnFocus}
        initialFocus={() => document.querySelector<HTMLElement>('.settings-dialog input[name="visibility"]:checked')}
        class="settings-dialog"
      >
        <h2>Pen settings</h2>
        <div role="radiogroup" aria-label="Visibility" class="radio-row">
          {visibilityOptions.map((option) => (
            <label key={option.value} class="radio">
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={pen.visibility === option.value}
                onChange={(event) => {
                  const group = event.currentTarget.closest('[role="radiogroup"]');
                  void patch({ visibility: option.value }, (updated) => `This pen is now ${updated.visibility}.`).then((saved) => {
                    const current = group?.querySelector<HTMLInputElement>(`input[value="${pen.visibility}"]`);
                    if (!saved && current) current.checked = true;
                  });
                }}
              />
              {option.label}
            </label>
          ))}
        </div>
        <h3>Libraries</h3>
        <ul class="chip-list" aria-label="Pen libraries">
          {props.libraries.map((library) => (
            <li key={library}>
              <span>{library}</span>
              <button type="button" class="quiet" onClick={() => props.onLibraries(props.libraries.filter((candidate) => candidate !== library))}>
                Remove {library}
              </button>
            </li>
          ))}
        </ul>
        <Combobox
          label="Add library"
          idPrefix="add-library"
          options={shelf.map((library) => ({ id: library.id, label: library.id }))}
          onPick={(option) => {
            if (!props.libraries.includes(option.label)) props.onLibraries([...props.libraries, option.label]);
            props.onStatus(`Added ${option.label}`);
          }}
          onUnmatched={(text) => props.onStatus(`${text} is not on the shelf. Pick a pinned library from the list.`)}
        />
        <h3>Tags</h3>
        <ul class="chip-list" aria-label="Pen tags">
          {pen.tags.map((tag) => (
            <li key={tag}>
              <span>{tag}</span>
              <button type="button" class="quiet" onClick={() => void patch({ tags: pen.tags.filter((candidate) => candidate !== tag) }, () => `Removed tag ${tag}`)}>
                Remove tag {tag}
              </button>
            </li>
          ))}
        </ul>
        <label class="field-label" for="add-tag">
          Add tag
        </label>
        <input
          id="add-tag"
          type="text"
          value={tagText}
          autocomplete="off"
          onInput={(event) => setTagText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void addTag();
            }
          }}
        />
        <p role="status" aria-label="Settings status" class="quiet-status">
          {props.status}
        </p>
        <div class="dialog-actions">
          <button type="button" class="danger" id="delete-pen-button" onClick={props.onDelete}>
            Delete pen
          </button>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </div>
      </Dialog>
  );
}

export function DeleteDialog(props: { title: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog
      role="alertdialog"
      label="Delete this pen?"
      describedBy="delete-pen-message"
      onClose={props.onCancel}
      returnFocus={() => document.getElementById("delete-pen-button")}
      initialFocus={() => document.getElementById("delete-pen-cancel")}
      class="delete-dialog"
    >
      <h2>Delete this pen?</h2>
      <p id="delete-pen-message">{`Delete "${props.title}" and all its versions? Its forks stay, but they will no longer link here.`}</p>
      <div class="dialog-actions">
        <button type="button" class="danger" onClick={props.onConfirm}>
          Delete
        </button>
        <button type="button" id="delete-pen-cancel" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </Dialog>
  );
}

type StartingTab = "html" | "css" | "js" | "result";

const startingTabs: { value: StartingTab; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "js", label: "JS" },
  { value: "result", label: "Result" },
];

function attribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

export function ShareDialog(props: { pen: Pen; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const [tab, setTab] = useState<StartingTab>("result");
  const [status, setStatus] = useState("");
  const linkRef = useRef<HTMLInputElement>(null);
  const link = `${location.origin}/embed/${props.pen.id}?tab=${tab}`;
  const code = `<iframe src="${link}" title="${attribute(props.pen.title)} on Ashlar" width="100%" height="400"></iframe>`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      linkRef.current?.select();
      document.execCommand("copy");
    }
    setStatus("Link copied");
  };
  return (
    <Dialog
      label="Share"
      onClose={props.onClose}
      returnFocus={props.returnFocus}
      initialFocus={() => document.querySelector<HTMLElement>('.share-dialog input[name="starting-tab"]:checked')}
      class="share-dialog"
    >
      <h2>Share</h2>
      {props.pen.visibility === "private" && (
        <p class="state-panel">This pen is private, so the embed shows a not-found page. Make it unlisted or public to embed it.</p>
      )}
      <div role="radiogroup" aria-label="Starting tab" class="radio-row">
        {startingTabs.map((option) => (
          <label key={option.value} class="radio">
            <input type="radio" name="starting-tab" value={option.value} checked={tab === option.value} onChange={() => setTab(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
      <label class="field-label" for="embed-link">
        Embed link
      </label>
      <input id="embed-link" ref={linkRef} type="text" readOnly value={link} />
      <label class="field-label" for="embed-code">
        Embed code
      </label>
      <textarea id="embed-code" readOnly value={code} rows={3} />
      <p role="status" aria-label="Share status" class="quiet-status">
        {status}
      </p>
      <div class="dialog-actions">
        <button type="button" class="primary" onClick={() => void copy()}>
          Copy link
        </button>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Dialog>
  );
}
