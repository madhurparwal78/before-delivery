import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { starterPens } from "../../shared/starters";
import type { CollectionDetail, CollectionListItem, LiveEvent, PenSummary } from "../../shared/types";
import { api } from "../api";
import { Combobox, PenRow, StageCrossfade, StatePanel, type ComboOption } from "../components";
import { pensFoundText } from "../format";
import { Page, startPen } from "../layout";
import { useLive } from "../live";
import { Link, navigate, replaceAddress } from "../router";
import { takeFlash, useAppState } from "../store";
import { NotFound } from "./simple";

function applyCounts(pens: PenSummary[], event: LiveEvent): PenSummary[] {
  if (event.type !== "counts") return pens;
  return pens.map((pen) => (pen.id === event.data.pen_id ? { ...pen, likes: event.data.likes, forks: event.data.forks } : pen));
}

function PenStage({ pen }: { pen: PenSummary | null }) {
  const fallback = starterPens[0];
  if (!pen) return <div class="stage">{fallback && <StageCrossfade source={{ files: fallback.files, libraries: fallback.libraries }} sourceKey="fallback" />}</div>;
  return (
    <div class="stage">
      <StageCrossfade source={{ penId: pen.id }} sourceKey={pen.id} />
    </div>
  );
}

function useSignedIn(): boolean {
  const { user } = useAppState();
  useEffect(() => {
    if (!user) navigate("/signin", { replace: true });
  }, [user]);
  return user !== null;
}

export function Dashboard() {
  const signedIn = useSignedIn();
  const [pens, setPens] = useState<PenSummary[] | null>(null);
  const [staged, setStaged] = useState<PenSummary | null>(null);
  const [status] = useState(() => takeFlash("dashboard"));
  useEffect(() => {
    if (!signedIn) return;
    void api<{ pens: PenSummary[] }>("GET", "/api/pens").then((result) => {
      if (!result.ok) return;
      setPens(result.data.pens);
      setStaged(result.data.pens[0] ?? null);
    });
  }, [signedIn]);
  useLive(pens?.map((pen) => pen.id) ?? [], (event) => setPens((current) => (current ? applyCounts(current, event) : current)));
  if (!signedIn) return null;
  return (
    <Page class="split">
      <PenStage pen={staged} />
      <div class="column">
        <h1>Your pens</h1>
        <button type="button" class="primary" onClick={() => void startPen()}>
          Start a pen
        </button>
        <p role="status" aria-label="Dashboard status" class="quiet-status">
          {status}
        </p>
        {pens === null ? (
          <StatePanel>Loading your pens…</StatePanel>
        ) : pens.length === 0 ? (
          <StatePanel>You have no pens yet. Start one, and every save becomes a version you can go back to.</StatePanel>
        ) : (
          <ul aria-label="Your pens" class="pen-list">
            {pens.map((pen) => (
              <PenRow key={pen.id} pen={pen} onPreview={setStaged} />
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

export function Explore() {
  const { config } = useAppState();
  const [query, setQuery] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [results, setResults] = useState<{ total: number; pens: PenSummary[] } | null>(null);
  const [staged, setStaged] = useState<PenSummary | null>(null);
  const latest = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const search = (text: string) => {
    const request = ++latest.current;
    replaceAddress(text === "" ? "/explore" : `/explore?q=${encodeURIComponent(text)}`);
    if (text.trim() === "") {
      setResults(null);
      return;
    }
    void api<{ query: string; total: number; pens: PenSummary[] }>("GET", `/api/search?q=${encodeURIComponent(text)}`).then((result) => {
      if (!result.ok || request !== latest.current) return;
      setResults({ total: result.data.total, pens: result.data.pens });
      setStaged(result.data.pens[0] ?? null);
    });
  };

  useEffect(() => {
    if (query !== "") search(query);
    return () => window.clearTimeout(timer.current);
  }, []);
  useLive(results?.pens.map((pen) => pen.id) ?? [], (event) =>
    setResults((current) => (current ? { ...current, pens: applyCounts(current.pens, event) } : current)),
  );

  return (
    <Page class="split">
      <PenStage pen={staged} />
      <div class="column">
        <h1>Explore</h1>
        <label class="search-label" for="explore-search">
          Search pens
        </label>
        <input
          id="explore-search"
          type="search"
          value={query}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => {
            const text = event.currentTarget.value;
            setQuery(text);
            latest.current += 1;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => search(text), config.search_debounce_ms);
          }}
        />
        <p role="status" aria-label="Search results" class="quiet-status">
          {results ? pensFoundText(results.total) : ""}
        </p>
        {results === null ? (
          <StatePanel>Type to search public pens. Use tag:name to filter by tag.</StatePanel>
        ) : results.pens.length === 0 ? (
          <StatePanel>No pens match</StatePanel>
        ) : (
          <ul aria-label="Results" class="pen-list">
            {results.pens.map((pen) => (
              <PenRow key={pen.id} pen={pen} showOwner onPreview={setStaged} />
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

export function Collections() {
  const signedIn = useSignedIn();
  const [collections, setCollections] = useState<CollectionListItem[] | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    void api<{ collections: CollectionListItem[] }>("GET", "/api/collections").then((result) => {
      if (result.ok) setCollections(result.data.collections);
    });
  }, [signedIn]);
  if (!signedIn) return null;
  const create = async () => {
    const result = await api<CollectionDetail>("POST", "/api/collections", {});
    if (result.ok) navigate(`/collections/${result.data.id}`);
  };
  return (
    <Page class="split">
      <PenStage pen={null} />
      <div class="column">
        <h1>Collections</h1>
        <button type="button" class="primary" onClick={() => void create()}>
          New collection
        </button>
        {collections === null ? (
          <StatePanel>Loading your collections…</StatePanel>
        ) : collections.length === 0 ? (
          <StatePanel>No collections yet. Make one to keep related pens together.</StatePanel>
        ) : (
          <ul aria-label="Your collections" class="pen-list">
            {collections.map((collection) => (
              <li key={collection.id} class="pen-row">
                <Link href={`/collections/${collection.id}`} class="pen-title">
                  {collection.title}
                </Link>
                <span class="pen-meta figure">{collection.count === 1 ? "1 pen" : `${collection.count} pens`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Page>
  );
}

export function Collection({ id }: { id: string }) {
  const signedIn = useSignedIn();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [staged, setStaged] = useState<PenSummary | null>(null);
  const [candidates, setCandidates] = useState<PenSummary[]>([]);
  const [searched, setSearched] = useState<PenSummary[]>([]);
  const focusAfterMove = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    void api<CollectionDetail>("GET", `/api/collections/${id}`).then((result) => {
      if (!result.ok) {
        setMissing(true);
        return;
      }
      setCollection(result.data);
      setTitle(result.data.title);
      setStaged(result.data.pens[0] ?? null);
    });
    void api<{ pens: PenSummary[] }>("GET", "/api/pens").then((result) => {
      if (result.ok) setCandidates(result.data.pens);
    });
  }, [id, signedIn]);
  useLive(collection?.pens.map((pen) => pen.id) ?? [], (event) =>
    setCollection((current) => (current ? { ...current, pens: applyCounts(current.pens, event) } : current)),
  );
  useLayoutEffect(() => {
    if (focusAfterMove.current === null) return;
    document.querySelector<HTMLAnchorElement>(`[data-pen-row="${focusAfterMove.current}"] .pen-title`)?.focus();
    focusAfterMove.current = null;
  }, [collection]);
  if (!signedIn) return null;
  if (missing) return <NotFound />;
  if (!collection) {
    return (
      <Page class="split">
        <PenStage pen={null} />
        <div class="column">
          <StatePanel>Loading the collection…</StatePanel>
        </div>
      </Page>
    );
  }

  const saveTitle = async () => {
    if (title === collection.title) return;
    const result = await api<CollectionDetail>("PATCH", `/api/collections/${id}`, { title });
    if (result.ok) {
      setCollection(result.data);
      setStatus(`Renamed to ${result.data.title}`);
    } else {
      setStatus(result.error.fields?.title ?? result.error.message);
    }
  };

  const add = async (option: ComboOption) => {
    const pen = [...candidates, ...searched].find((candidate) => candidate.id === option.id);
    if (!pen) return;
    const result = await api<CollectionDetail>("POST", `/api/collections/${id}/pens`, { pen_id: pen.id });
    if (result.ok) {
      setCollection(result.data);
      setStatus(`Added ${pen.title}`);
    } else if (result.error.error === "duplicate") {
      setStatus(`${pen.title} is already in this collection.`);
    } else {
      setStatus(result.error.message);
    }
  };

  const remove = async (pen: PenSummary) => {
    const result = await api("DELETE", `/api/collections/${id}/pens/${pen.id}`);
    if (result.ok) {
      setCollection({ ...collection, pens: collection.pens.filter((candidate) => candidate.id !== pen.id) });
      setStatus(`Removed ${pen.title}`);
    }
  };

  const move = async (pen: PenSummary, delta: number) => {
    const from = collection.pens.findIndex((candidate) => candidate.id === pen.id);
    const to = from + delta;
    if (to < 0 || to >= collection.pens.length) return;
    const reordered = [...collection.pens];
    reordered.splice(from, 1);
    reordered.splice(to, 0, pen);
    setCollection({ ...collection, pens: reordered });
    setStatus(`Moved ${pen.title} to position ${to + 1} of ${reordered.length}`);
    focusAfterMove.current = pen.id;
    const result = await api<CollectionDetail>("PATCH", `/api/collections/${id}`, { order: reordered.map((candidate) => candidate.id) });
    if (!result.ok) setStatus(result.error.message);
  };

  const deleteCollection = async () => {
    const result = await api("DELETE", `/api/collections/${id}`);
    if (result.ok) navigate("/collections");
  };

  const lookup = (text: string) => {
    if (text.trim() === "") return;
    void api<{ pens: PenSummary[] }>("GET", `/api/search?q=${encodeURIComponent(text)}`).then((result) => {
      if (result.ok) setSearched(result.data.pens);
    });
  };

  const options = [...candidates, ...searched.filter((pen) => !candidates.some((candidate) => candidate.id === pen.id))].map((pen) => ({
    id: pen.id,
    label: pen.title,
  }));

  return (
    <Page class="split">
      <PenStage pen={staged} />
      <div class="column">
        <label for="collection-title" class="field-label">
          Collection title
        </label>
        <input
          id="collection-title"
          class="title-input"
          type="text"
          value={title}
          onInput={(event) => setTitle(event.currentTarget.value)}
          onBlur={() => void saveTitle()}
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveTitle();
          }}
        />
        <Combobox label="Add a pen" idPrefix="add-pen" options={options} onPick={(option) => void add(option)} onText={lookup} />
        <p role="status" aria-label="Collection status" class="quiet-status">
          {status}
        </p>
        {collection.pens.length === 0 ? (
          <StatePanel>This collection is empty. Add a pen with the box above.</StatePanel>
        ) : (
          <ul aria-label="Collection pens" class="pen-list">
            {collection.pens.map((pen) => (
              <PenRow
                key={pen.id}
                pen={pen}
                onPreview={setStaged}
                onLinkKeyDown={(event) => {
                  if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
                    event.preventDefault();
                    void move(pen, event.key === "ArrowUp" ? -1 : 1);
                  }
                }}
              >
                <button type="button" class="quiet" onClick={() => void remove(pen)}>
                  Remove {pen.title}
                </button>
              </PenRow>
            ))}
          </ul>
        )}
        <button type="button" class="danger" onClick={() => void deleteCollection()}>
          Delete collection
        </button>
      </div>
    </Page>
  );
}
