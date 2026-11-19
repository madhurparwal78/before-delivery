import { useCallback, useEffect, useState } from "react";
import { call } from "../lib/api";
import { Link } from "../lib/router";
import { useAction } from "../lib/useAction";
import { Chip, Loading, Status } from "../ui/Bits";
import { NotFound } from "./NotFound";

interface Occurrence {
  startsAt: string;
  display: string;
  status: string;
  note: string | null;
}

interface GatheringDetail {
  id: string;
  communityId: string;
  title: string;
  durationMinutes: number;
  recurrence: string;
  limit: number;
  attendingCount: number;
  attending: boolean;
  occurrences: Occurrence[];
}

export function Gathering({ id }: { id: string }) {
  const [gathering, setGathering] = useState<GatheringDetail | null | undefined>(undefined);
  const action = useAction("Saving...");
  const load = useCallback(async (): Promise<void> => {
    const reply = await call<GatheringDetail>("GET", `/api/gatherings/${id}`);
    setGathering(reply.ok ? reply.data : null);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  if (gathering === undefined) return <Loading />;
  if (gathering === null) return <NotFound />;
  const attend = async (): Promise<void> => {
    const path = `/api/communities/${gathering.communityId}/gatherings/${id}/attend`;
    const reply = await action.run(gathering.attending ? "DELETE" : "POST", path, undefined, () => (gathering.attending ? "You're no longer attending." : "You're attending."));
    if (reply.ok) await load();
  };
  return (
    <>
      <h1 tabIndex={-1}>{gathering.title}</h1>
      <p className="muted">
        {gathering.durationMinutes} minutes, {gathering.recurrence === "weekly" ? "every week" : "one time"}. {gathering.attendingCount} of {gathering.limit} places taken.
      </p>
      <p>
        <Link to={`/communities/${gathering.communityId}`} className="button">
          Back to the community
        </Link>
      </p>
      <section className="panel">
        <h2>Occurrences</h2>
        <ul aria-label="Occurrences" className="cards">
          {gathering.occurrences.map((occurrence) => (
            <li key={occurrence.startsAt} data-status={occurrence.status} className="row-card">
              <div>
                <strong>{occurrence.display}</strong>
                <div className="row tight">
                  <Chip tone={occurrence.status === "open" ? "calm" : occurrence.status === "ended" ? "plain" : "accent"}>{occurrence.status}</Chip>
                </div>
                {occurrence.note ? <p className="note">{occurrence.note}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="row">
        {gathering.attending ? (
          <button type="button" className="button" onClick={() => void attend()} disabled={action.busy}>
            Stop attending
          </button>
        ) : (
          <button type="button" className="button primary" onClick={() => void attend()} disabled={action.busy}>
            Attend
          </button>
        )}
      </div>
      <Status name="Gathering result" result={action.result} />
    </>
  );
}
