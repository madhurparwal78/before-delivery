import { useEffect, useRef, useState } from "react";
import type { Collection, CollectionSummary, PenSummary } from "../../shared/types.js";
import { ApiFailure, api, messageOf } from "../api.js";
import { Combobox, type Choice } from "../components/combobox.js";
import { CrossfadeStage } from "../components/crossfade-stage.js";
import { PenRowItem, StatePanel } from "../components/panels.js";
import { Shell } from "../components/shell.js";
import { countLabel } from "../format.js";
import { Link, navigate } from "../router.js";
import { useRequireUser } from "../use-user.js";

export function CollectionsPage(): React.JSX.Element {
  const user = useRequireUser();
  const [collections, setCollections] = useState<CollectionSummary[] | null>(null);

  useEffect(() => {
    if (user === null) return;
    void api.get<{ collections: CollectionSummary[] }>("/api/collections").then((answer) => setCollections(answer.collections));
  }, [user]);

  const create = (): void => {
    void api.post<Collection>("/api/collections", {}).then((made) => navigate(`/collections/${made.id}`));
  };

  return (
    <Shell>
      <section className="wide-page narrow-measure">
        <h1>Collections</h1>
        <button type="button" className="button primary" onClick={create}>
          New collection
        </button>
        {collections === null ? (
          <StatePanel drawing={false}>Loading your collections…</StatePanel>
        ) : collections.length === 0 ? (
          <StatePanel>No collections yet. Make one to keep related pens together.</StatePanel>
        ) : (
          <ul aria-label="Your collections" className="rows">
            {collections.map((collection) => (
              <li key={collection.id} className="row">
                <Link to={`/collections/${collection.id}`} className="row-title">
                  {collection.title}
                </Link>
                <span className="row-meta tabular">{countLabel(collection.count, "pen")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}

function rearranged(pens: PenSummary[], id: string, step: number): PenSummary[] | null {
  const from = pens.findIndex((pen) => pen.id === id);
  const to = from + step;
  const moved = pens[from];
  if (from < 0 || to < 0 || to >= pens.length || moved === undefined) return null;
  const next = pens.filter((pen) => pen.id !== id);
  next.splice(to, 0, moved);
  return next;
}

export function CollectionPage({ id }: { id: string }): React.JSX.Element {
  const user = useRequireUser();
  const [collection, setCollection] = useState<Collection | null>(null);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [mine, setMine] = useState<PenSummary[]>([]);
  const [found, setFound] = useState<PenSummary[]>([]);
  const [text, setText] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  const links = useRef(new Map<string, HTMLAnchorElement>());
  const typed = useRef(0);

  useEffect(() => {
    if (user === null) return;
    void api.get<Collection>(`/api/collections/${id}`).then(
      (loaded) => {
        setCollection(loaded);
        setTitle(loaded.title);
      },
      () => navigate("/collections", { replace: true }),
    );
    void api.get<{ pens: PenSummary[] }>("/api/pens").then((answer) => setMine(answer.pens));
  }, [user, id]);

  useEffect(() => {
    if (refocus !== null) links.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus]);

  const pens = collection?.pens ?? [];

  const type = (value: string): void => {
    setText(value);
    const token = ++typed.current;
    if (value.trim() === "") {
      setFound([]);
      return;
    }
    void api.get<{ pens: PenSummary[] }>(`/api/search?q=${encodeURIComponent(value)}`).then((answer) => {
      if (token === typed.current) setFound(answer.pens);
    });
  };

  const choices: Choice[] = [...mine, ...found]
    .filter((pen, index, all) => all.findIndex((other) => other.id === pen.id) === index)
    .filter((pen) => pen.title.toLowerCase().includes(text.trim().toLowerCase()))
    .map((pen) => ({ id: pen.id, label: pen.title }));

  const add = async (choice: Choice): Promise<void> => {
    try {
      setCollection(await api.post<Collection>(`/api/collections/${id}/pens`, { pen_id: choice.id }));
      setStatus(`Added ${choice.label}`);
      setText("");
    } catch (error) {
      setStatus(messageOf(error));
    }
  };

  const remove = async (pen: PenSummary): Promise<void> => {
    await api.delete(`/api/collections/${id}/pens/${pen.id}`);
    setCollection((current) => (current ? { ...current, pens: current.pens.filter((other) => other.id !== pen.id) } : current));
  };

  const move = async (pen: PenSummary, step: number): Promise<void> => {
    const next = rearranged(pens, pen.id, step);
    if (next === null) return;
    const saved = await api.patch<Collection>(`/api/collections/${id}`, { order: next.map((entry) => entry.id) });
    setCollection(saved);
    setRefocus(pen.id);
    setStatus(`Moved ${pen.title} to position ${saved.pens.findIndex((entry) => entry.id === pen.id) + 1} of ${saved.pens.length}`);
  };

  const rename = async (): Promise<void> => {
    if (collection === null || title === collection.title) return;
    try {
      const saved = await api.patch<Collection>(`/api/collections/${id}`, { title });
      setCollection(saved);
      setTitle(saved.title);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof ApiFailure ? error.body.message : messageOf(error));
    }
  };

  return (
    <Shell>
      <div className="split">
        <div className="split-stage">
          <CrossfadeStage penId={previewing ?? pens.find((pen) => pen.head > 0)?.id ?? null} label="Preview of the highlighted pen" />
        </div>
        <section className="split-column">
          <label htmlFor="collection-title" className="field-label">
            Collection title
          </label>
          <input
            id="collection-title"
            type="text"
            className="title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void rename();
            }}
          />
          <Combobox label="Add a pen" choices={choices} text={text} onText={type} onPick={(choice) => void add(choice)} />
          <p role="status" aria-label="Collection status" className="status-line">
            {status}
          </p>
          {collection !== null && pens.length === 0 ? (
            <StatePanel>This collection is empty. Add a pen with the box above.</StatePanel>
          ) : (
            <ul aria-label="Collection pens" className="rows">
              {pens.map((pen) => (
                <PenRowItem
                  key={pen.id}
                  pen={pen}
                  onPreview={setPreviewing}
                  linkRef={(element) => {
                    if (element) links.current.set(pen.id, element);
                    else links.current.delete(pen.id);
                  }}
                  onLinkKeyDown={(event) => {
                    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                      event.preventDefault();
                      void move(pen, event.key === "ArrowUp" ? -1 : 1);
                    }
                  }}
                  extra={
                    <button type="button" className="button quiet" aria-label={`Remove ${pen.title}`} onClick={() => void remove(pen)}>
                      Remove
                    </button>
                  }
                />
              ))}
            </ul>
          )}
          <button
            type="button"
            className="button danger-quiet"
            onClick={() => void api.delete(`/api/collections/${id}`).then(() => navigate("/collections"))}
          >
            Delete collection
          </button>
        </section>
      </div>
    </Shell>
  );
}
