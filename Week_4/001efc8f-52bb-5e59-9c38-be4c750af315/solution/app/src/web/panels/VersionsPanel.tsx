import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { MessageText } from "../components/MessageText";
import { useLiveEvent } from "../hooks";
import { useMe } from "../store";
import { formatWhen } from "../../shared/when";
import type { VersionEntry } from "../types";

// Every saved version of a message, oldest first, with its editor and time.
export function VersionsPanel({ messageId }: { messageId: string }) {
  const zone = useMe().workspace.time_zone;
  const [versions, setVersions] = useState<VersionEntry[] | "loading" | "not_found">("loading");
  const load = useCallback(() => {
    api<{ versions: VersionEntry[] }>("GET", `/api/messages/${messageId}/versions`).then(
      (body) => setVersions(body.versions),
      () => setVersions("not_found"),
    );
  }, [messageId]);
  useEffect(load, [load]);
  useLiveEvent((event) => {
    const data = event.data as { message?: { id: string }; message_id?: string };
    if (event.name === "stream.reset" || data.message?.id === messageId || data.message_id === messageId) load();
  });

  return (
    <section className="panel" aria-labelledby="panel-versions">
      <h2 id="panel-versions" className="panel-title">
        Version history
      </h2>
      {versions === "loading" ? <p className="panel-note">Loading versions…</p> : null}
      {versions === "not_found" ? <p className="panel-note">That was not found.</p> : null}
      {Array.isArray(versions) ? (
        <ol className="versions" aria-label="Versions">
          {versions.map((v) => (
            <li key={v.version} className="version">
              <p className="version-head">
                <span className="version-tag">v{v.version}</span>
                <span className="author">{v.edited_by.name}</span>
                <time className="stamp" dateTime={v.created_at}>
                  {formatWhen(zone, v.created_at)}
                </time>
              </p>
              <MessageText text={v.text} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
