import { useEffect, useState, type ReactNode } from "react";
import type { ChapterSummary } from "../../shared/api.ts";
import { get } from "../lib/api.ts";
import { useTitle } from "../lib/focus.ts";
import { Link } from "../lib/router.tsx";
import { Loading } from "../ui/Feedback.tsx";
import "../figures/figures.css";

interface RuleRow {
  identifier: string;
  chapter: string;
  text: string;
  version: number;
}

/** `/rules`: every live identifier grouped under its chapter title, each a link. */
export function RuleIndex(_props: { params: string[] }): ReactNode {
  useTitle("Rule index");
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  useEffect(() => {
    void get<{ rules: RuleRow[] }>("/api/rules").then((r) => setRules(r.rules));
    void get<{ chapters: ChapterSummary[] }>("/api/chapters").then((r) => setChapters(r.chapters));
  }, []);
  if (rules === null) return <Loading />;
  return (
    <>
      <header className="cell cell-pad chapter-head" data-frame>
        <h1>Rule index</h1>
        <p className="prose muted">{rules.length} live rules. Each name can be cited in a request.</p>
      </header>
      <div className="rule-groups">
        {chapters.map((chapter) => {
          const own = rules.filter((r) => r.chapter === chapter.slug || r.chapter === chapter.title);
          return (
            <section key={chapter.slug} className="cell cell-pad" data-frame aria-label={chapter.title}>
              <h2 className="cell-label">{chapter.title}</h2>
              <ul className="rule-links">
                {own.map((r) => (
                  <li key={r.identifier}>
                    <Link to={`/rules/${r.identifier}`}>{r.identifier}</Link>
                    <span className="muted">{r.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
