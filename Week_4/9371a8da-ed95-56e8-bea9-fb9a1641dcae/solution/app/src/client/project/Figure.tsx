import type { JSX } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { storageOrder } from "../latest.ts";
import { formatBytes } from "../text.ts";

/** A read still unanswered this long is abandoned, and the next refresh sends a new one. */
const ABANDON_MS = 10_000;

interface FigureProps {
  /** The figure's raw-bytes address. */
  url: string;
  path: string;
  size: number;
  contentType: string;
  /** Changes on every refresh of the project view. */
  refreshes: number;
  /** A storage action's outcome: true when the object loaded, false when storage refused it. */
  onStorage: (loaded: boolean) => void;
}

/**
 * The figure preview. Its raw read is a storage action: at most one is in flight, a fallback retries on each
 * refresh, and an answer older than the latest answered storage action changes nothing.
 */
export function FigurePreview(props: FigureProps): JSX.Element {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef<{ stamp: number; at: number } | null>(null);
  const alive = useRef(true);
  const objectUrl = useRef<string | null>(null);
  const report = useRef(props.onStorage);
  report.current = props.onStorage;

  const read = () => {
    const stamp = storageOrder.stamp();
    inFlight.current = { stamp, at: Date.now() };
    const settle = (blob: Blob | null) => {
      if (inFlight.current?.stamp === stamp) inFlight.current = null;
      if (!alive.current || !storageOrder.applies(stamp)) return;
      if (blob) {
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = URL.createObjectURL(blob);
        setSource(objectUrl.current);
        setFailed(false);
      } else setFailed(true);
      report.current(blob !== null);
    };
    fetch(props.url, { credentials: "same-origin" })
      .then(async (response) => settle(response.ok ? await response.blob() : null))
      .catch(() => settle(null));
  };

  useLayoutEffect(() => {
    alive.current = true;
    read();
    return () => {
      alive.current = false;
      inFlight.current = null;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
  }, [props.url]);

  // Each refresh retries a fallback (or a read whose answer was outdated), and replaces a read abandoned after 10 seconds; never a second read in flight.
  useLayoutEffect(() => {
    const pending = inFlight.current;
    if (pending ? Date.now() - pending.at < ABANDON_MS : !failed && source !== null) return;
    read();
  }, [props.refreshes]);

  return (
    <div class="figure-preview">
      <figure>
        {failed ? (
          <p class="figure-missing">Figure unavailable</p>
        ) : source ? (
          <img src={source} alt={props.path} />
        ) : (
          <p class="muted">Loading figure…</p>
        )}
        <figcaption>
          <span class="mono">{props.path}</span> · {formatBytes(props.size)} · {props.contentType}
        </figcaption>
      </figure>
    </div>
  );
}
