// Curator profile (brief: Screens > Curator profile; Interactions > Follow).
import { useEffect, useState } from "react";
import type { Curator, FollowResult } from "../../shared/api.js";
import { api } from "../lib/api.js";
import { LiveRegion, useLive } from "../lib/live.js";
import { linkClick, navigate } from "../lib/router.js";
import { useSession } from "../lib/session.js";
import { Empty, Thumb } from "../components/bits.js";
import { EXPLORE_COLUMNS, Masonry } from "../components/Masonry.js";
import { NotFound } from "./NotFound.js";

export function Profile({ handle }: { handle: string }) {
  const { account } = useSession();
  const live = useLive();
  const [curator, setCurator] = useState<Curator | null | undefined>(undefined);
  const [following, setFollowing] = useState(false);
  const [count, setCount] = useState(0);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void (async () => {
      const answer = await api<Curator>("GET", `/api/curators/${encodeURIComponent(handle)}`);
      if (!answer.ok) return setCurator(null);
      setCurator(answer.data);
      setCount(answer.data.followerCount);
    })();
  }, [handle]);

  // The curator shape carries no follow state for the viewer, so the button starts unpressed and every
  // answer (follow and unfollow are both idempotent) settles it to what the server says.
  if (curator === null) return <NotFound />;
  if (curator === undefined) {
    return (
      <main className="profile" id="main">
        <div className="skeleton-block" aria-hidden="true" />
      </main>
    );
  }

  const own = account?.handle === curator.handle;
  const toggle = async (): Promise<void> => {
    if (account === null) {
      navigate(`/signin?next=${encodeURIComponent(`/@${curator.handle}`)}`);
      return;
    }
    if (pending) return;
    const before = { following, count };
    const next = !following;
    setFollowing(next);
    setCount(count + (next ? 1 : -1));
    setPending(true);
    const answer = await api<FollowResult>(next ? "POST" : "DELETE", `/api/curators/${encodeURIComponent(curator.handle)}/follow`);
    setPending(false);
    if (answer.ok) {
      setFollowing(answer.data.following);
      setCount(answer.data.followerCount);
      live.say(`${answer.data.following ? "Following" : "Unfollowed"} ${curator.displayName}. ${answer.data.followerCount} followers.`);
    } else {
      setFollowing(before.following);
      setCount(before.count);
      live.say(`Could not update the follow. ${before.count} followers.`, true);
    }
  };

  return (
    <main className="profile" id="main">
      <header className="profile__head">
        <h1 className="page-title">{curator.displayName}</h1>
        <p className="profile__handle">@{curator.handle}</p>
        <p className="profile__count mono-figures">
          <span className="mono">{count}</span> followers
        </p>
        {!own && (
          <button type="button" className={following ? "btn btn--pressed" : "btn btn--primary"} aria-pressed={following} onClick={() => void toggle()}>
            {following ? "Following" : "Follow"}
          </button>
        )}
        <LiveRegion live={live} name="Profile status" />
      </header>
      <h2 className="section-title">Public clusters</h2>
      {curator.clusters.length ? (
        <Masonry
          className="profile__grid"
          label="Public clusters"
          columns={EXPLORE_COLUMNS}
          items={curator.clusters.map((c) => ({
            key: c.id,
            render: (style, ref) => (
              <li key={c.id} className="feed-card" style={style} ref={ref as React.Ref<HTMLLIElement>}>
                {c.coverUrl ? <Thumb src={c.coverUrl} kind="image" alt="" className="feed-card__cover" cover /> : <div className="thumb thumb--missing feed-card__cover" />}
                <div className="feed-card__body">
                  <h3 className="feed-card__title">
                    <a href={`/c/${c.id}`} onClick={(e) => linkClick(e, `/c/${c.id}`)}>
                      {c.title}
                    </a>
                  </h3>
                  <p className="feed-card__meta">
                    <span className="mono">{c.publicItemCount} items</span>
                  </p>
                </div>
              </li>
            ),
          }))}
        />
      ) : (
        <Empty>No public clusters yet.</Empty>
      )}
    </main>
  );
}
