import { useCallback, useEffect, useState } from "react";
import { LIVE_DOWN_TEXT, type SessionDetail } from "../../shared/protocol";
import { call } from "../lib/api";
import { showNotice } from "../lib/store";
import { useAction } from "../lib/useAction";
import { Chip, Loading, Status } from "../ui/Bits";
import { Denied } from "./NotFound";
import { Room } from "./Room";

export function SessionPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<SessionDetail | null | undefined>(undefined);
  const join = useAction("Opening...");

  const load = useCallback(async (): Promise<void> => {
    const reply = await call<SessionDetail>("GET", `/api/sessions/${id}`);
    if (reply.ok) setDetail(reply.data);
    else if (reply.status === 503) {
      showNotice(LIVE_DOWN_TEXT);
      setDetail(undefined);
    } else setDetail(null);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (detail === undefined) return <Loading />;
  if (detail === null) return <Denied heading="This session isn't available." />;
  if (detail.people) return <Room detail={detail} />;
  const enter = async (): Promise<void> => {
    const reply = await join.run<SessionDetail>("POST", `/api/sessions/${id}/join`, undefined, () => "");
    if (reply.ok) setDetail(reply.data);
    else if (reply.error === LIVE_DOWN_TEXT) showNotice(LIVE_DOWN_TEXT);
  };
  return (
    <section className="panel narrow">
      <h1 tabIndex={-1}>{detail.roomName}</h1>
      <p>
        Hosted by {detail.hostName}. <Chip>{detail.visibility}</Chip> <Chip>{detail.count} of {detail.capacity} here</Chip>
      </p>
      <div className="row">
        <button type="button" className="button primary" onClick={() => void enter()} disabled={join.busy} aria-busy={join.busy}>
          Join session
        </button>
      </div>
      <Status name="Session result" result={join.result} />
    </section>
  );
}
