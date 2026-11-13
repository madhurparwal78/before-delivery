import { useEffect, useState } from "react";
import { api, ApiFailure } from "./api.js";
import { copy } from "../shared/copy.js";
import type { LinkInfoResponse, MeResponse } from "./types.js";
import { EditorPage } from "./editor.js";

export function LinkPage(props: { token: string; me: MeResponse | null; onMe: () => void }): JSX.Element {
  const [state, setState] = useState<"loading" | "active" | "expired" | "revoked" | "invalid">("loading");
  const [info, setInfo] = useState<LinkInfoResponse | null>(null);

  useEffect(() => {
    const run = async (): Promise<void> => {
      try {
        const result = await api<LinkInfoResponse>(`/api/links/${props.token}`);
        setInfo(result);
        setState("active");
      } catch (err) {
        if (err instanceof ApiFailure) {
          if (err.code === "link_expired") setState("expired");
          else if (err.code === "link_revoked") setState("revoked");
          else setState("invalid");
        }
      }
    };
    void run();
  }, [props.token]);

  if (state === "active") {
    return <EditorPage me={props.me} drawingId={info!.drawing.id} linkToken={props.token} onMe={props.onMe} />;
  }
  if (state === "loading") {
    return <main style={{ padding: 60, textAlign: "center" }}>Loading…</main>;
  }
  const heading =
    state === "expired" ? copy.linkExpiredHeading : state === "revoked" ? copy.linkRevokedHeading : copy.linkInvalidHeading;
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 20 }}>
      <div className="sr-only" role="status" aria-label="Announcements" aria-live="polite" />
      <div className="panel" style={{ padding: "40px 50px", textAlign: "center", maxWidth: 480 }}>
        <h1 style={{ fontSize: 24, marginBottom: 12 }}>{heading}</h1>
        {state === "expired" && info?.time_zone && (
          <p style={{ color: "#a7adb5" }}>({info.time_zone})</p>
        )}
        <p style={{ marginTop: 16 }}>
          <a className="btn btn-outline" href="/">Go to Corbel Works</a>
        </p>
      </div>
    </main>
  );
}
