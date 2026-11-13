import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { announce } from "../announce";
import { get, post } from "../api";
import { ActionButton } from "../components/ui";
import { useAction, useLoad } from "../hooks";
import { isRecovering, useLive, useLiveReload } from "../live";
import { Link } from "../router";
import { Loading, NotFound, Screen } from "../shell/Page";
import { monthYear } from "../../shared/reference";
import type { Channel as ChannelRecord, ChannelPost } from "../../shared/api";

export function Channels() {
  const channels = useLoad(() => get<{ channels: ChannelRecord[] }>("/api/channels"), []);
  return (
    <Screen title="Channels">
      <h1 className="page-title">Channels</h1>
      <ul className="items" aria-label="Channels">
        {(channels.data?.channels ?? []).map((channel) => (
          <li key={channel.slug}>
            <Link className="item-title" to={`/channels/${channel.slug}`}>{channel.name}</Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function PostArticle({ post }: { post: ChannelPost }) {
  return (
    <article data-id={post.id}>
      <p className="meta">{post.author_label} · {monthYear(post.posted_month)}</p>
      <p className="text">{post.body}</p>
      {post.quote && "removed" in post.quote ? <blockquote>Quoted review removed.</blockquote> : null}
      {post.quote && "title" in post.quote ? (
        <blockquote>
          <Link to={`/companies/${post.quote.company_slug}/reviews/${post.quote.review_id}`}>{post.quote.title}</Link>
          <br />
          {post.quote.excerpt}
        </blockquote>
      ) : null}
    </article>
  );
}

export function Channel({ slug }: { slug: string }) {
  const channels = useLoad(() => get<{ channels: ChannelRecord[] }>("/api/channels"), []);
  const posts = useLoad(() => get<{ posts: ChannelPost[] }>(`/api/channels/${slug}/posts`), [slug]);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | undefined>();
  const composer = useRef<HTMLTextAreaElement>(null);
  const missed = useRef<ChannelPost[]>([]);
  const { busy, run } = useAction();
  const name = channels.data?.channels.find((channel) => channel.slug === slug)?.name;

  const add = (incoming: ChannelPost[]) =>
    posts.patch((data) => ({ posts: [...data.posts, ...incoming.filter((post) => !data.posts.some((known) => known.id === post.id))] }));

  useLive("channel.post", (event) => {
    if (event.channel_slug !== slug || !name) return;
    if (isRecovering()) {
      missed.current.push(event.post);
      return;
    }
    add([event.post]);
    announce(`New post in ${name}`);
  });
  useLive("hello", (event) => {
    if (event.replay !== "complete" || missed.current.length === 0 || !name) return;
    const replayed = missed.current;
    missed.current = [];
    add(replayed);
    announce(replayed.length === 1 ? `1 new post in ${name}` : `${replayed.length} new posts in ${name}`);
  });
  useLiveReload(posts.reload);

  const count = posts.data?.posts.length ?? 0;
  useEffect(() => {
    if (count > 0) document.querySelector("[role=log] article:last-child")?.scrollIntoView({ block: "nearest" });
  }, [count]);

  async function send() {
    setError(undefined);
    const result = await run(() => post<ChannelPost>(`/api/channels/${slug}/posts`, { body }));
    if (result.ok) {
      add([result.data]);
      setBody("");
      announce(`Posted in ${name ?? slug}.`);
      composer.current?.focus();
    } else {
      setError(result.message);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  if (channels.data && !name) return <NotFound />;
  // Wait for the posts too, or they arrive above the composer and push it down.
  if (!name || posts.loading) return <Loading />;
  return (
    <Screen title={name}>
      <h1 className="page-title">{name}</h1>
      <div className="log" role="log" aria-label={`Posts in ${name}`}>
        {(posts.data?.posts ?? []).map((entry) => (
          <PostArticle key={entry.id} post={entry} />
        ))}
      </div>
      <form className="form-narrow" onSubmit={(event) => { event.preventDefault(); void send(); }} noValidate>
        <div className="field">
          <label htmlFor="composer">Write a post</label>
          <textarea
            id="composer"
            ref={composer}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={onKeyDown}
            aria-describedby={error ? "composer-error" : undefined}
            aria-invalid={error ? true : undefined}
          />
          {error ? <p className="error" id="composer-error">{error}</p> : null}
        </div>
        <ActionButton type="submit" busy={busy}>Post</ActionButton>
      </form>
    </Screen>
  );
}
