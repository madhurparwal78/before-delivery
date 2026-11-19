import { ExternalLink, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecipeSummary } from "../../shared/api";
import { api, ApiFailure } from "../api";
import { onLiveCatchUp, onLiveMessage } from "../live";
import { Link } from "../router";
import { session } from "../session";
import { useStore } from "../store";
import { Screen } from "../ui/Screen";
import { pluralize } from "../workbench/InputPane";

const SEARCH_DEBOUNCE_MS = 250;

export function Library() {
  const user = useStore(session, (state) => state.user);
  const [all, setAll] = useState<RecipeSummary[] | null>(null);
  const [results, setResults] = useState<RecipeSummary[] | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const answer = await api<{ recipes: RecipeSummary[] }>("GET", "/api/recipes");
    setAll(answer.recipes);
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    const offMessage = onLiveMessage((message) => {
      if (message.type === "membership_changed") {
        void load();
      } else {
        const update = (list: RecipeSummary[] | null): RecipeSummary[] | null =>
          list && list.map((recipe) => (recipe.id === message.recipeId ? { ...recipe, name: message.name, latestVersion: message.version } : recipe));
        setAll(update);
        setResults(update);
        void load();
      }
    });
    const offCatchUp = onLiveCatchUp(() => void load());
    return () => {
      offMessage();
      offCatchUp();
    };
  }, [load]);

  const search = useCallback(async (text: string): Promise<void> => {
    const ticket = ++latest.current;
    try {
      const answer = await api<{ results: RecipeSummary[] }>("GET", `/api/search?q=${encodeURIComponent(text)}`);
      if (ticket !== latest.current) return;
      setResults(answer.results);
      setNotice(null);
    } catch (error) {
      if (ticket !== latest.current) return;
      if (!(error instanceof ApiFailure) || error.code !== "search_unavailable") throw error;
      setResults(null);
      setNotice(error.message);
    }
  }, []);

  useEffect(() => {
    if (query.trim() === "") {
      latest.current++;
      setResults(null);
      setNotice(null);
      return;
    }
    const wait = setTimeout(() => void search(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(wait);
  }, [query, search]);

  const shown = results ?? all ?? [];
  const status = pluralize(shown.length, results ? "result" : "recipe");
  const empty = all !== null && shown.length === 0;

  return (
    <Screen
      label="Library"
      title="Library"
      strip={<div role="status" aria-label="Library status" aria-live="polite">{all ? status : ""}</div>}
    >
      {!user ? (
        <p className="empty">
          <Link to="/signin">Sign in</Link> to see your recipes.
        </p>
      ) : (
        <>
          <div className="finder library-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search recipes"
              placeholder="Search recipes…"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && query.trim() !== "") void search(query);
              }}
            />
          </div>
          {notice && <p role="alert" className="pane-alert">{notice}</p>}
          <ul role="list" aria-label="Recipes" className="rows">
            {shown.map((recipe) => (
              <li key={recipe.id} aria-label={recipe.name} className="row">
                <Link to={`/library/${recipe.id}`} className="row-name">{recipe.name}</Link>
                <span className="row-meta">
                  {recipe.owner.type === "team" ? recipe.owner.name : "Personal"} · version {recipe.latestVersion}
                  {recipe.tags.length > 0 && ` · ${recipe.tags.join(", ")}`}
                </span>
                <Link to={`/w?recipe=${recipe.id}`} className="row-open" aria-label={`Open ${recipe.name} in workbench`}>
                  <ExternalLink size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {empty && <p className="empty">{results ? `No recipes match ${query}.` : "No recipes yet. Save one from the workbench."}</p>}
        </>
      )}
    </Screen>
  );
}
