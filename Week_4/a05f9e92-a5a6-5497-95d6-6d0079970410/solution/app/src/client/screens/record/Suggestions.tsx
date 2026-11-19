import { useEffect, useState } from "react";
import { get } from "../../lib/api.js";
import { Link } from "../../lib/router.js";

interface Suggested {
  number: string;
  title: string;
}

const SUGGEST_MS = 300;

/** The articles suggested for a short description, refreshed 300 milliseconds after typing stops. */
export function useSuggestions(typed: string | null): Suggested[] {
  const [suggested, setSuggested] = useState<Suggested[]>([]);
  useEffect(() => {
    if (typed === null) return undefined;
    let current = true;
    const timer = setTimeout(() => {
      if (typed.trim() === "") {
        setSuggested([]);
        return;
      }
      get<{ articles: Suggested[] }>(`/api/knowledge/suggest?text=${encodeURIComponent(typed)}`).then(
        (found) => current && setSuggested(found.articles),
        () => undefined,
      );
    }, SUGGEST_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed]);
  return suggested;
}

export function Suggestions({ articles }: { articles: Suggested[] }): JSX.Element | null {
  if (articles.length === 0) return null;
  return (
    <div className="rf-wide rf-suggest">
      <p className="rf-suggest-title">Suggested articles</p>
      <ul aria-label="Suggested articles">
        {articles.map((article) => (
          <li key={article.number}>
            <Link to={`/portal/knowledge/${article.number}`}>{article.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
