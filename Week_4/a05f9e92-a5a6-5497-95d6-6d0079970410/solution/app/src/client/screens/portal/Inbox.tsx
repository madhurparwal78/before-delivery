import { useEffect, useState } from "react";
import { homeScreen } from "../../../shared/types.js";
import { failureText, get, post, put } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { Link, navigate } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, Page, Rest, StateScreen, StatusBlock, useLoad } from "../../lib/ui.js";
import { formatLocalIso } from "../../../shared/tz.js";

interface InboxItem {
  id: number;
  event: string;
  text: string;
  record: string | null;
  at: string;
  read: boolean;
}

type Digest = "immediate" | "daily";

const DIGESTS: Array<{ value: Digest; label: string }> = [
  { value: "immediate", label: "Immediately" },
  { value: "daily", label: "Daily digest" },
];

function DigestChoice(): JSX.Element {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void get<{ digest: Digest }>("/api/inbox").then((inbox) => setDigest(inbox.digest));
  }, []);
  const choose = (next: Digest): void => {
    const previous = digest;
    setProblem(null);
    setDigest(next);
    put("/api/inbox/settings", { digest: next }).catch((error: unknown) => {
      setDigest(previous);
      setProblem(failureText(error));
    });
  };
  return (
    <div className="digest">
      <h2>Digest</h2>
      <div role="radiogroup" aria-label="Digest" className="digest-choices">
        {DIGESTS.map((choice) => (
          <label key={choice.value} className="digest-choice">
            <input type="radio" name="digest" value={choice.value} checked={digest === choice.value} onChange={() => choose(choice.value)} />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
      {problem ? <p className="form-error">{problem}</p> : null}
    </div>
  );
}

export function Inbox(): JSX.Element {
  const session = useSession();
  const zone = session.user?.time_zone ?? "UTC";
  const toDesk = (session.user?.roles ?? []).some((role) => role !== "requester");
  const { state, reload } = useLoad(() => get<{ items: InboxItem[]; unread: number }>("/api/inbox"), [session.accessVersion]);
  const [problem, setProblem] = useState<string | null>(null);
  useTopics(["inbox"], reload);

  if (state.status === "error") return <StateScreen line="Switchyard could not load this. Try again." button="Try again" onClick={reload} />;
  if (state.status === "loading") return <StateScreen line="Loading Inbox..." button="Cancel" onClick={() => history.back()} />;
  const { items } = state.data;
  if (items.length === 0) return <StateScreen line="Your inbox is empty." button="Back to your desk" onClick={() => navigate(homeScreen(session.user?.roles ?? []))} />;

  const markAll = (): void => {
    setProblem(null);
    post("/api/inbox/read-all").then(reload, (error: unknown) => setProblem(failureText(error)));
  };
  const markOne = (id: number): void => void post(`/api/inbox/${id}/read`).then(reload, () => undefined);

  return (
    <Page subject="Inbox">
      <Rest narrow className="portal-column">
        <div className="row">
          <Button variant="outline" onClick={markAll}>
            Mark all read
          </Button>
        </div>
        {problem ? <p className="form-error">{problem}</p> : null}
        <ul className="inbox-list" aria-label="Inbox">
          {items.map((item) => (
            <li key={item.id} className={`inbox-item ${item.read ? "" : "inbox-unread"}`}>
              <div className="inbox-main">
                <span className="inbox-text">{item.text}</span>
                <span className="inbox-meta">
                  <time dateTime={item.at}>{formatLocalIso(item.at, zone)}</time>
                  {item.record && toDesk ? (
                    <Link to={`/desk/records/${item.record}`} onClick={() => markOne(item.id)}>
                      Open {item.record}
                    </Link>
                  ) : null}
                </span>
              </div>
              {item.read ? null : <StatusBlock>Unread</StatusBlock>}
            </li>
          ))}
        </ul>
      </Rest>
      <Rest narrow className="portal-column">
        <DigestChoice />
      </Rest>
    </Page>
  );
}
