import { useCallback, useEffect, useState } from "react";
import { api, apiMessage } from "../api";
import { Chip } from "../components/Chip";
import { TagMark } from "../components/TagMark";
import { useTick } from "../hooks";
import { schedules } from "../permissions";
import { notify } from "../store";
import { formatWhen } from "../../shared/when";
import type { Channel, Me, Scheduled } from "../types";

const REFRESH_MS = 5_000;

// Scheduled posts with their next fire time, state and upcoming occurrences. Refreshes when it
// opens, after a schedule or cancel here, and every few seconds so a firing shows promptly.
export function ScheduledPanel({ channel, me, refreshKey }: { channel: Channel; me: Me; refreshKey: number }) {
  const zone = me.workspace.time_zone;
  const [posts, setPosts] = useState<Scheduled[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const tick = useTick(REFRESH_MS);

  const load = useCallback(() => {
    api<{ scheduled: Scheduled[] }>("GET", `/api/channels/${channel.id}/scheduled`).then(
      (body) => {
        setPosts(body.scheduled);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, [channel.id]);
  useEffect(load, [load, refreshKey, tick]);

  const cancel = async (post: Scheduled) => {
    setCancelling(post.id);
    try {
      await api("DELETE", `/api/scheduled/${post.id}`);
      notify("Scheduled post cancelled.");
    } catch (error) {
      notify(apiMessage(error));
    } finally {
      setCancelling(null);
      load();
    }
  };

  return (
    <section className="panel" aria-labelledby="panel-scheduled">
      <h2 id="panel-scheduled" className="panel-title">
        Scheduled posts
      </h2>
      {posts === null && !failed ? <p className="panel-note">Loading scheduled posts…</p> : null}
      {failed ? <p className="panel-note">Could not load the scheduled posts.</p> : null}
      {posts?.length === 0 ? (
        <div className="empty-state">
          <TagMark size={48} />
          <p>Nothing is scheduled in #{channel.name}.</p>
        </div>
      ) : null}
      {posts && posts.length > 0 ? (
        <ul className="scheduled" aria-label="Scheduled posts">
          {posts.map((post) => (
            <li key={post.id} className="scheduled-item">
              <p className="scheduled-text">{post.text}</p>
              <p className="scheduled-meta">
                <StateChip state={post.state} />
                <span className="stamp">{post.next_fire_at ? formatWhen(zone, post.next_fire_at) : "Nothing left to fire"}</span>
                <span className="muted">{post.repeat === "weekly" ? "Weekly" : "One-off"}</span>
              </p>
              {post.upcoming_local.length > 0 ? (
                <>
                  <h3 className="scheduled-sub">Upcoming</h3>
                  <ul className="upcoming" aria-label="Upcoming">
                    {post.upcoming_local.map((local) => (
                      <li key={local} className="stamp">
                        {formatWhen(zone, local)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {schedules(me.user.role) && post.state === "scheduled" ? (
                <button className="button button-quiet" type="button" disabled={cancelling === post.id} onClick={() => void cancel(post)}>
                  {cancelling === post.id ? "Cancelling…" : "Cancel scheduled post"}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function StateChip({ state }: { state: Scheduled["state"] }) {
  if (state === "sent") return <Chip kind="sent" label="Sent" />;
  if (state === "cancelled") return <Chip kind="cancelled" label="Cancelled" />;
  return <Chip kind="scheduled" label="Scheduled" active />;
}
