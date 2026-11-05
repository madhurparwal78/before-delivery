import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { api, RequestError } from "../lib/api";
import { Link } from "../lib/router";
import { COPY } from "../../shared/copy";
import { longDate, type Entry, type EntrySummary } from "../../shared/domain";
import { FoldMotif } from "./FoldMotif";
import { NotFound } from "./Missing";

export function Journal() {
  const [posts, setPosts] = useState<EntrySummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    api<{ entries: EntrySummary[] }>("/api/journal")
      .then((body) => setPosts(body.entries))
      .catch(() => setFailed(true));
  }, []);
  return (
    <section className="page page--journal">
      <p className="eyebrow">Journal</p>
      <h1>Notes from the studio</h1>
      <p className="lede">How we price, build and look after small sites, written down as we go.</p>
      {failed ? (
        <p className="notice notice--seam">{COPY.cmsOutage}</p>
      ) : posts === null ? (
        <ul className="journal-list" aria-hidden="true">
          {[0, 1].map((i) => <li key={i} className="journal-item journal-item--skeleton" />)}
        </ul>
      ) : posts.length === 0 ? (
        <div className="empty">
          <FoldMotif />
          <p>The first journal post is on its way.</p>
        </div>
      ) : (
        <ul className="journal-list" aria-label="Journal posts">
          {posts.map((post) => (
            <li key={post.slug} className="journal-item">
              <p className="journal-item__date mono">{longDate(post.publishedAt)}</p>
              <h2 className="journal-item__title">
                <Link href={`/journal/${post.slug}`}>{post.title}</Link>
              </h2>
              <p>{post.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function JournalPost({ slug }: { slug: string }) {
  const [post, setPost] = useState<Entry | null>(null);
  const [state, setState] = useState<"loading" | "missing" | "failed" | "ok">("loading");
  useEffect(() => {
    api<Entry>(`/api/journal/${encodeURIComponent(slug)}`)
      .then((body) => {
        setPost(body);
        setState("ok");
      })
      .catch((error) => setState(error instanceof RequestError && error.status === 404 ? "missing" : "failed"));
  }, [slug]);
  if (state === "missing") return <NotFound />;
  return (
    <article className="page page--post">
      <Link href="/journal" className="back-link">
        <ArrowLeft aria-hidden="true" size={18} />
        All journal posts
      </Link>
      {state === "failed" ? <p className="notice notice--seam">{COPY.cmsOutage}</p> : null}
      {post ? (
        <>
          <p className="eyebrow mono">{longDate(post.publishedAt)}</p>
          <h1>{post.title}</h1>
          <p className="lede">{post.summary}</p>
          <div className="prose">
            {post.body.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </>
      ) : null}
    </article>
  );
}
