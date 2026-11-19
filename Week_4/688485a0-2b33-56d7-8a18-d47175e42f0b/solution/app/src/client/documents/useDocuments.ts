import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { JsonObject } from "../../shared/json.js";
import { asFailure, post } from "../api.js";
import { queryErrorText } from "../copy.js";
import { collectionPath, navigate } from "../router.js";
import { useShell } from "../shell/ProjectShell.js";

/** The Documents screen state: the query bar, the last run's outcome, live refresh and the open document. */

export interface QueryAnswer {
  matched: number;
  page: number;
  page_size: number;
  documents: JsonObject[];
  ids: string[];
  plan: { kind: "index" | "full_scan"; index: string | null; docs_examined: number; returned: number };
}

type Outcome = { state: "pending"; previous: QueryAnswer | null } | { state: "refused"; message: string } | { state: "ok"; answer: QueryAnswer };

export interface QueryForm {
  filter: string;
  projection: string;
  sort: string;
  limit: string;
}

export type ViewName = "list" | "table" | "json";

const INITIAL_FORM: QueryForm = { filter: "{}", projection: "", sort: "", limit: "" };
const FIELDS: [keyof QueryForm, string][] = [
  ["filter", "Filter"],
  ["projection", "Projection"],
  ["sort", "Sort"],
];

/** The request body a query form stands for, or the copy explaining why it cannot be sent. */
export function bodyFromForm(form: QueryForm): { body: JsonObject } | { error: string } {
  const body: JsonObject = {};
  for (const [key, label] of FIELDS) {
    const text = form[key].trim();
    if (text === "" && key !== "filter") continue;
    try {
      body[key] = JSON.parse(text === "" ? "{}" : text);
    } catch {
      return { error: `${label} is not valid JSON` };
    }
  }
  const limit = form.limit.trim();
  if (limit !== "") body["limit"] = Number.isNaN(Number(limit)) ? limit : Number(limit);
  return { body };
}

function firstResult(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[aria-label="Documents"] [data-doc-id], [aria-label="JSON results"] [data-doc-id]');
}

export interface DocumentsState {
  form: QueryForm;
  setForm: (form: QueryForm) => void;
  view: ViewName;
  setView: (view: ViewName) => void;
  outcome: Outcome;
  run: (page?: number) => void;
  /** The same applied query for another page. */
  goToPage: (page: number) => void;
  applied: RefObject<JsonObject | null>;
  inserting: boolean;
  startInsert: (opener: HTMLElement | null) => void;
  openDocument: (id: string, opener: HTMLElement | null) => void;
  closeEditor: () => void;
  /** The editor saved a document; a first save moves the address to the new document. */
  documentSaved: (document: JsonObject, version: number) => void;
  /** The open document was deleted: close the editor and focus the first result. */
  documentDeleted: () => void;
  refresh: () => void;
  editorOpen: boolean;
  did: string | null;
  /** A document saved from the editor, kept so the new route does not reload it. */
  preload: RefObject<{ id: string; document: JsonObject; version: number } | null>;
}

export function useDocuments(did: string | null): DocumentsState {
  const { project, collection } = useShell();
  const cid = collection?.id ?? "";
  const base = `/api/projects/${project.id}/collections/${cid}`;
  const [form, setForm] = useState<QueryForm>(INITIAL_FORM);
  const [view, setView] = useState<ViewName>("list");
  const [outcome, setOutcome] = useState<Outcome>({ state: "pending", previous: null });
  const [inserting, setInserting] = useState(false);
  const applied = useRef<JsonObject | null>(null);
  const appliedPage = useRef(1);
  const latest = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const preload = useRef<{ id: string; document: JsonObject; version: number } | null>(null);
  const answerRef = useRef<QueryAnswer | null>(null);

  const send = useCallback(
    async (body: JsonObject, page: number, quiet: boolean): Promise<void> => {
      const ticket = ++latest.current;
      if (!quiet) setOutcome({ state: "pending", previous: answerRef.current });
      try {
        const answer = await post<QueryAnswer>(`${base}/query`, { ...body, page });
        if (ticket !== latest.current) return;
        answerRef.current = answer;
        applied.current = body;
        appliedPage.current = page;
        setOutcome({ state: "ok", answer });
      } catch (error) {
        if (ticket !== latest.current) return;
        const failure = asFailure(error);
        answerRef.current = null;
        setOutcome({ state: "refused", message: queryErrorText(failure.body) });
      }
    },
    [base],
  );

  const run = useCallback(
    (page = 1): void => {
      const parsed = bodyFromForm(form);
      if ("error" in parsed) {
        latest.current++;
        answerRef.current = null;
        setOutcome({ state: "refused", message: parsed.error });
        return;
      }
      void send(parsed.body, page, false);
    },
    [form, send],
  );

  const goToPage = useCallback(
    (page: number): void => {
      void send(applied.current ?? { filter: {} }, page, false);
    },
    [send],
  );

  const refresh = useCallback((): void => {
    if (applied.current) void send(applied.current, appliedPage.current, true);
  }, [send]);

  useEffect(() => {
    if (!cid) return;
    setForm(INITIAL_FORM);
    applied.current = null;
    answerRef.current = null;
    void send({ filter: {} }, 1, false);
  }, [cid, send]);

  const shell = useShell();
  useEffect(() => shell.onChange(refresh), [shell, refresh]);

  const editorOpen = did !== null || inserting;

  const startInsert = useCallback((from: HTMLElement | null): void => {
    opener.current = from;
    setInserting(true);
  }, []);

  const openDocument = useCallback(
    (id: string, from: HTMLElement | null): void => {
      opener.current = from;
      setInserting(false);
      navigate(collectionPath(project.id, cid, `/d/${id}`));
    },
    [project.id, cid],
  );

  const closeEditor = useCallback((): void => {
    const target = opener.current;
    opener.current = null;
    flushSync(() => {
      setInserting(false);
      navigate(collectionPath(project.id, cid));
    });
    (target?.isConnected ? target : firstResult())?.focus();
  }, [project.id, cid]);

  const documentSaved = useCallback(
    (document: JsonObject, version: number): void => {
      if (did === null) {
        const id = document["_id"] as string;
        preload.current = { id, document, version };
        flushSync(() => {
          setInserting(false);
          navigate(collectionPath(project.id, cid, `/d/${id}`));
        });
      }
      refresh();
    },
    [did, project.id, cid, refresh],
  );

  const documentDeleted = useCallback((): void => {
    opener.current = null;
    closeEditor();
    refresh();
  }, [closeEditor, refresh]);

  return { form, setForm, view, setView, outcome, run, goToPage, applied, inserting, startInsert, openDocument, closeEditor, documentSaved, documentDeleted, refresh, editorOpen, did, preload };
}

