import { useEffect, useState } from "react";
import { counted } from "../../shared/relativeTime";
import { api, GENERIC_ERROR } from "../lib/api";
import { announce, showAlert } from "../lib/feedback";
import { useLive } from "../lib/hooks";
import { watch } from "../lib/live";
import { Grid } from "../components/Grid";
import { EmptyState } from "../components/EmptyState";
import { usePinActions } from "../components/usePinActions";
import { Button } from "../ui/Button";
import type { FeedPin } from "../../shared/types";

/** The home feed. New pins that arrive wait behind a button; they never shift the grid under the reader. */
export function Home() {
  const [pins, setPins] = useState<FeedPin[] | null>(null);
  const [waiting, setWaiting] = useState<number[]>([]);
  const [focusRequest, setFocusRequest] = useState<{ id: number; nonce: number } | null>(null);
  const actions = usePinActions();

  const load = async (): Promise<FeedPin[]> => (await api.get<{ pins: FeedPin[] }>("/api/feed")).pins;
  useEffect(() => {
    void api.get<{ pins: FeedPin[] }>("/api/feed").then((loaded) => setPins(loaded.pins));
  }, []);
  useEffect(() => watch({ feed: true }), []);

  useLive((message) => {
    if (message.type !== "feed" || !pins) return;
    const fresh = message.pin_ids.filter((id) => !waiting.includes(id) && !pins.some((pin) => pin.id === id));
    if (fresh.length === 0) return;
    const next = [...waiting, ...fresh];
    setWaiting(next);
    announce(counted(next.length, "new pin", "new pins"));
  });

  const show = async (): Promise<void> => {
    const known = new Set((pins ?? []).map((pin) => pin.id));
    try {
      const next = await load();
      setPins(next);
      setWaiting([]);
      const first = next.find((pin) => !known.has(pin.id));
      if (first) setFocusRequest({ id: first.id, nonce: performance.now() });
    } catch {
      showAlert(GENERIC_ERROR);
    }
  };

  if (pins === null) return <div className="page" aria-busy="true" />;
  return (
    <div className="page">
      <h1 className="visually-hidden">Home</h1>
      {waiting.length > 0 ? (
        <div className="new-pins">
          <Button onClick={() => void show()}>{`Show ${counted(waiting.length, "new pin", "new pins")}`}</Button>
        </div>
      ) : null}
      {pins.length === 0 ? (
        <EmptyState sentence="Follow people or boards to fill your feed." seed="feed" />
      ) : (
        <Grid name="Pins" pins={pins} showGroups onOpen={actions.open} onSave={actions.save} focusRequest={focusRequest} />
      )}
      {actions.dialog}
    </div>
  );
}
