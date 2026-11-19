import { useEffect, useState } from "react";
import { VISIBILITIES, type Pen, type ShelfLibrary, type Visibility } from "../../shared/types.js";
import { ApiFailure, api, messageOf } from "../api.js";
import { loadShelf } from "../config.js";
import { navigate } from "../router.js";
import { useDialog } from "../use-dialog.js";
import { Combobox } from "./combobox.js";
import { Icon } from "./icons.js";

const VISIBILITY_LABEL: Record<Visibility, string> = { private: "Private", unlisted: "Unlisted", public: "Public" };

interface Props {
  open: boolean;
  onClose: () => void;
  pen: Pen;
  libraries: string[];
  onPen: (pen: Pen) => void;
  onAddLibrary: (id: string) => void;
  onRemoveLibrary: (id: string) => void;
}

export function SettingsDialog({ open, onClose, pen, libraries, onPen, onAddLibrary, onRemoveLibrary }: Props): React.JSX.Element {
  const [status, setStatus] = useState("");
  const [shelf, setShelf] = useState<ShelfLibrary[]>([]);
  const [library, setLibrary] = useState("");
  const [tag, setTag] = useState("");
  const [confirming, setConfirming] = useState(false);

  const main = useDialog(open, onClose, (dialog) => dialog.querySelector<HTMLElement>("input[name=visibility]:checked"));
  const confirm = useDialog(confirming, () => setConfirming(false), (dialog) => dialog.querySelector<HTMLElement>("[data-cancel]"));

  useEffect(() => {
    void loadShelf().then(setShelf);
  }, []);

  const change = async (changes: { visibility?: Visibility; tags?: string[] }): Promise<boolean> => {
    try {
      onPen(await api.patch<Pen>(`/api/pens/${pen.id}`, changes));
      return true;
    } catch (error) {
      setStatus(messageOf(error));
      return false;
    }
  };

  const choices = shelf
    .filter((entry) => entry.id.toLowerCase().includes(library.trim().toLowerCase()))
    .map((entry) => ({ id: entry.id, label: entry.id }));

  const remove = async (): Promise<void> => {
    try {
      await api.delete(`/api/pens/${pen.id}`);
      navigate("/dashboard", { flash: `Deleted "${pen.title}"` });
    } catch (error) {
      setConfirming(false);
      setStatus(error instanceof ApiFailure ? error.body.message : messageOf(error));
    }
  };

  return (
    <>
    <dialog ref={main.ref} aria-labelledby="settings-title" className="dialog" {...main.props}>
      <h2 id="settings-title">Pen settings</h2>
      <div role="radiogroup" aria-label="Visibility" className="choice-group">
        {VISIBILITIES.map((value) => (
          <label key={value} className="choice">
            <input
              type="radio"
              name="visibility"
              checked={pen.visibility === value}
              onChange={() => {
                void change({ visibility: value }).then((saved) => {
                  if (saved) setStatus(`This pen is now ${value}.`);
                });
              }}
            />
            <span>{VISIBILITY_LABEL[value]}</span>
          </label>
        ))}
      </div>

      <h3>Libraries</h3>
      <Combobox
        label="Add library"
        choices={choices}
        text={library}
        onText={setLibrary}
        onPick={(choice) => {
          onAddLibrary(choice.id);
          setLibrary("");
          setStatus("");
        }}
        onNoMatch={(typed) => setStatus(`${typed} is not on the shelf. Pick a pinned library from the list.`)}
      />
      <ul className="chips">
        {libraries.map((id) => (
          <li key={id}>
            <span className="mono">{id}</span>
            <button type="button" className="button quiet" aria-label={`Remove ${id}`} onClick={() => onRemoveLibrary(id)}>
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>

      <h3>Tags</h3>
      <label htmlFor="add-tag" className="field-label">
        Add tag
      </label>
      <input
        id="add-tag"
        type="text"
        value={tag}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setTag(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void change({ tags: [...pen.tags, tag.trim().toLowerCase()] }).then((saved) => {
            if (saved) {
              setTag("");
              setStatus("");
            }
          });
        }}
      />
      <ul className="chips">
        {pen.tags.map((existing) => (
          <li key={existing}>
            <span>{existing}</span>
            <button
              type="button"
              className="button quiet"
              aria-label={`Remove tag ${existing}`}
              onClick={() => void change({ tags: pen.tags.filter((other) => other !== existing) })}
            >
              <Icon name="close" />
            </button>
          </li>
        ))}
      </ul>

      <p role="status" aria-label="Settings status" className="status-line">
        {status}
      </p>
      <div className="dialog-actions">
        <button type="button" className="button danger-quiet" onClick={() => setConfirming(true)}>
          <Icon name="trash" />
          Delete pen
        </button>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>

    </dialog>
    <dialog ref={confirm.ref} role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-copy" className="dialog confirm" {...confirm.props}>
      <h2 id="delete-title">Delete this pen?</h2>
      <p id="delete-copy">{`Delete "${pen.title}" and all its versions? Its forks stay, but they will no longer link here.`}</p>
      <div className="dialog-actions">
        <button type="button" className="button" data-cancel onClick={() => setConfirming(false)}>
          Cancel
        </button>
        <button type="button" className="button danger" onClick={() => void remove()}>
          Delete
        </button>
      </div>
    </dialog>
    </>
  );
}
