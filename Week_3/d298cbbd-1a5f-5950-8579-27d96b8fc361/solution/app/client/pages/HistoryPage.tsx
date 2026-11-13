import type { JSX } from "preact";
import { useLayoutEffect, useState } from "preact/hooks";
import type { HistoryRow } from "../../shared/protocol";
import { twoDecimals, utcMinute } from "../../shared/format";
import { api } from "../api";
import { Link, navigate, useLocation } from "../router";
import { useStore } from "../store";
import { viewer } from "../viewer";

const LENGTHS: Readonly<Record<string, readonly string[]>> = {
  time: ["15", "30", "60", "120"],
  words: ["10", "25", "50", "100"],
  quote: ["short", "medium", "long", "all"],
};

const figure = (value: number | null, suffix = ""): string => (value === null ? "-" : `${twoDecimals(value)}${suffix}`);

/** Word counts of the typist's custom runs, since a custom test has no fixed length. */
async function customLengths(): Promise<string[]> {
  const found = new Set<number>();
  for (let page = 1; ; page++) {
    const answer = await api<{ runs: HistoryRow[]; more: boolean }>("GET", `/api/history?mode=custom&page=${page}`);
    for (const run of answer.runs) if (typeof run.length === "number") found.add(run.length);
    if (!answer.more) return [...found].sort((a, b) => a - b).map(String);
  }
}

function RunFields({ run }: { run: HistoryRow }): JSX.Element {
  return (
    <>
      <span data-label="Date">{utcMinute(run.finishedAt)}</span>
      <span data-label="Mode">{run.mode}</span>
      <span data-label="Length">{run.length ?? "-"}</span>
      <span data-label="Speed">{figure(run.speed)}</span>
      <span data-label="Raw">{figure(run.raw)}</span>
      <span data-label="Accuracy">{figure(run.accuracy, "%")}</span>
      <span data-label="Consistency">{figure(run.consistency, "%")}</span>
      <span data-label="Verdict">{run.verdict === "counted" ? "Counted" : "Not counted"}</span>
    </>
  );
}

export function HistoryPage(): JSX.Element {
  const { me } = useStore(viewer.state);
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const mode = params.get("mode") ?? "";
  const length = params.get("length") ?? "";
  const verdict = params.get("verdict") ?? "";
  const [runs, setRuns] = useState<HistoryRow[]>([]);
  const [more, setMore] = useState(false);
  const [pending, setPending] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [customs, setCustoms] = useState<string[]>([]);
  const [phone, setPhone] = useState(() => window.matchMedia("(max-width: 767px)").matches);

  useLayoutEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const listen = (): void => setPhone(query.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);

  const filter = (page: number): string => `/api/history?page=${page}${mode ? `&mode=${mode}` : ""}${length ? `&length=${length}` : ""}${verdict ? `&verdict=${verdict}` : ""}`;

  useLayoutEffect(() => {
    if (!me) return;
    let current = true;
    setPending(true);
    api<{ runs: HistoryRow[]; more: boolean }>("GET", filter(1)).then((answer) => {
      if (!current) return;
      setRuns(answer.runs);
      setMore(answer.more);
      setPending(false);
      setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [me?.id, mode, length, verdict]);

  useLayoutEffect(() => {
    if (me && mode === "custom") void customLengths().then(setCustoms);
  }, [me?.id, mode]);

  async function older(): Promise<void> {
    setPending(true);
    const answer = await api<{ runs: HistoryRow[]; more: boolean }>("GET", filter(Math.floor(runs.length / 20) + 1));
    setRuns((before) => [...before, ...answer.runs]);
    setMore(answer.more);
    setPending(false);
  }

  function update(change: Record<string, string>): void {
    const next = new URLSearchParams({ mode, length, verdict, ...change });
    for (const [key, value] of [...next]) if (value === "") next.delete(key);
    navigate(`/history${next.size ? `?${next}` : ""}`, true);
  }

  if (!me) {
    return (
      <section class="paper narrow">
        <h1 class="page-title">History</h1>
        <p>Sign in to see the runs filed to your account.</p>
        <Link href="/signin" class="button">Sign in</Link>
      </section>
    );
  }
  const lengths = mode === "custom" ? customs : LENGTHS[mode] ?? [];
  return (
    <section class="paper ledger">
      <h1 class="page-title">History</h1>
      <div class="filters">
        <label>Mode
          <select value={mode} onChange={(event) => update({ mode: event.currentTarget.value, length: "" })}>
            <option value="">All</option>
            {["time", "words", "quote", "custom"].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Length
          <select value={length} onChange={(event) => update({ length: event.currentTarget.value })}>
            <option value="">All</option>
            {lengths.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Verdict
          <select value={verdict} onChange={(event) => update({ verdict: event.currentTarget.value })}>
            <option value="">All</option>
            <option value="counted">Counted</option>
            <option value="not_counted">Not counted</option>
          </select>
        </label>
      </div>
      {loaded && runs.length === 0 && !pending ? (
        <p class="empty-sheet">Nothing filed yet. Your first counted run will be filed here.</p>
      ) : phone ? (
        <ul class="cards" aria-label="History" aria-busy={pending ? "true" : "false"}>
          {runs.map((run) => (
            <li class="card-row" key={run.runId}>
              <RunFields run={run} />
              <Link href={`/runs/${run.runId}`} class="button small">Open run</Link>
            </li>
          ))}
        </ul>
      ) : (
        <div class="table-wrap">
          <table class="data-table wide" aria-label="History" aria-busy={pending ? "true" : "false"}>
            <thead>
              <tr>
                {["Date", "Mode", "Length", "Speed", "Raw", "Accuracy", "Consistency", "Verdict"].map((name) => <th scope="col" key={name}>{name}</th>)}
                <th scope="col"><span class="sr-only">Run</span></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td>{utcMinute(run.finishedAt)}</td>
                  <td>{run.mode}</td>
                  <td>{run.length ?? "-"}</td>
                  <td>{figure(run.speed)}</td>
                  <td>{figure(run.raw)}</td>
                  <td>{figure(run.accuracy, "%")}</td>
                  <td>{figure(run.consistency, "%")}</td>
                  <td>{run.verdict === "counted" ? "Counted" : "Not counted"}</td>
                  <td><Link href={`/runs/${run.runId}`} class="button small">Open run</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <button type="button" class="button" onClick={() => void older()}>Older runs</button>}
    </section>
  );
}
