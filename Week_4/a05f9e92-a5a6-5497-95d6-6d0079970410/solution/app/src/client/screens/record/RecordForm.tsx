import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure, get } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { useSession } from "../../lib/session.js";
import { loadingScreen, type Loaded } from "../../lib/ui.js";
import type { Detail } from "./model.js";
import { RecordView } from "./RecordView.js";

/** Loads one record, and loads it again without a loading state when the live channel or an access change says so. */
function useRecord(number: string, accessVersion: number): { state: Loaded<Detail>; reload: () => void; retry: () => void; replace: (record: Detail) => void } {
  const [state, setState] = useState<Loaded<Detail>>({ status: "loading" });
  const generation = useRef(0);
  const seen = useRef(accessVersion);

  const load = useCallback(
    (silent: boolean): void => {
      const mine = ++generation.current;
      if (!silent) setState({ status: "loading" });
      get<{ record: Detail }>(`/api/records/${number}`).then(
        (response) => mine === generation.current && setState({ status: "ready", data: response.record }),
        (error: unknown) => {
          if (mine !== generation.current) return;
          if (silent && !(error instanceof ApiFailure && error.status === 404)) return;
          setState({ status: "error", error });
        },
      );
    },
    [number],
  );

  useEffect(() => {
    load(false);
    return () => {
      generation.current++;
    };
  }, [load]);

  useEffect(() => {
    if (seen.current === accessVersion) return;
    seen.current = accessVersion;
    load(true);
  }, [accessVersion, load]);

  const reload = useCallback(() => load(true), [load]);
  const retry = useCallback(() => load(false), [load]);
  const replace = useCallback((record: Detail) => {
    generation.current++;
    setState({ status: "ready", data: record });
  }, []);
  return { state, reload, retry, replace };
}

/**
 * The record form: fields, SLA, transitions, approvals, activity, attachments and links of one record.
 * With `focusHeading` the form focuses its record heading as soon as it is shown; `onBack` adds a back button.
 */
export function RecordForm({ number, onBack, focusHeading = false, onHeadingFocused }: { number: string; onBack?: () => void; focusHeading?: boolean; onHeadingFocused?: () => void }): JSX.Element {
  const session = useSession();
  const { state, reload, retry, replace } = useRecord(number, session.accessVersion);
  useTopics([`record:${number}`], reload);
  if (state.status !== "ready") return <div className="record-state">{loadingScreen(state, number, retry)}</div>;
  return <RecordView key={number} detail={state.data} onRecord={replace} reload={reload} onBack={onBack} focusHeading={focusHeading} onHeadingFocused={onHeadingFocused} />;
}
