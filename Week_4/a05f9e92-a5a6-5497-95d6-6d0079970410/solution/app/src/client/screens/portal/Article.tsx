import { useState } from "react";
import { failureText, get, put } from "../../lib/api.js";
import { useSession } from "../../lib/session.js";
import { Button, Page, Rest, useLoad } from "../../lib/ui.js";
import { gate, PortalActions } from "./common.js";

interface ArticleJson {
  number: string;
  title: string;
  body: string;
  helpful_yes: number;
  helpful_no: number;
}

export function Article({ number }: { number: string }): JSX.Element {
  const session = useSession();
  const [votes, setVotes] = useState<{ helpful_yes: number; helpful_no: number } | null>(null);
  const [voted, setVoted] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { state, reload } = useLoad(async () => (await get<{ article: ArticleJson }>(`/api/knowledge/articles/${encodeURIComponent(number)}`)).article, [number, session.accessVersion]);
  if (state.status !== "ready") return gate(state, number, reload);
  const article = state.data;
  const shown = votes ?? article;

  const vote = (helpful: boolean): void => {
    setProblem(null);
    put<{ helpful_yes: number; helpful_no: number }>(`/api/knowledge/articles/${encodeURIComponent(article.number)}/vote`, { helpful }).then(
      (counts) => {
        setVotes(counts);
        setVoted(helpful);
      },
      (error: unknown) => setProblem(failureText(error)),
    );
  };

  return (
    <Page subject={article.title}>
      <PortalActions />
      <Rest narrow className="portal-column">
        <p className="muted">{article.number}</p>
        <div className="article-body">
          {article.body.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </Rest>
      <Rest narrow className="portal-column">
        <h2>Was this helpful?</h2>
        <div className="row">
          <Button variant={voted === true ? "solid" : "outline"} aria-pressed={voted === true} onClick={() => vote(true)}>
            Helpful
          </Button>
          <Button variant={voted === false ? "solid" : "outline"} aria-pressed={voted === false} onClick={() => vote(false)}>
            Not helpful
          </Button>
        </div>
        <p>
          {shown.helpful_yes} found this helpful, {shown.helpful_no} did not.
        </p>
        {problem ? <p className="form-error">{problem}</p> : null}
      </Rest>
    </Page>
  );
}
