import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { announce, api, clubTime, errorText, get, goSignIn, statusWords, useInterval } from "./lib";
import { usePagedList } from "./paged";
import { Alert, Empty } from "./ui";

type DeskRow = {
  id: string;
  kind: string;
  court: number;
  start: string;
  start_utc: string;
  minutes: number;
  status: string;
  organiser_name: string;
  players: number;
};

type Notice = { id: string; event: string; channel: string; recipient: string };

const deskOrder = (a: DeskRow, b: DeskRow) =>
  a.start_utc !== b.start_utc
    ? a.start_utc < b.start_utc
      ? -1
      : 1
    : a.court !== b.court
      ? a.court - b.court
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;

export function DeskPage() {
  const [date, setDate] = useState("");
  const seenMatches = useRef<Set<string> | null>(null);
  const onPage = useCallback((p: { date: string; items: DeskRow[] }, more: boolean) => {
    setDate(p.date);
    const fresh = p.items.filter((r) => r.kind === "match");
    if (seenMatches.current === null || more) {
      seenMatches.current ??= new Set();
      fresh.forEach((r) => seenMatches.current!.add(r.id));
      return;
    }
    for (const r of fresh) {
      if (!seenMatches.current.has(r.id)) {
        seenMatches.current.add(r.id);
        announce("Match is full.");
      }
    }
  }, []);
  const list = usePagedList<DeskRow>("/api/desk/bookings", deskOrder, onPage);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Notice[] | null>(null);
  const loadFailed = useCallback(async () => {
    const a = await get<{ items: Notice[] }>("/api/desk/notices?status=failed&limit=50");
    if (a.status === 200) setFailed(a.data.items);
  }, []);
  useEffect(() => {
    list.refresh();
    loadFailed();
  }, []);
  useInterval(loadFailed, 10000);

  const act = async (r: DeskRow, action: "check-in" | "no-show") => {
    if (list.pending[r.id]) return;
    list.setRowPending(r.id, action);
    setErrors((e) => ({ ...e, [r.id]: "" }));
    const a = await api<DeskRow>("POST", `/api/desk/bookings/${r.id}/${action}`, {});
    list.setRowPending(r.id, null);
    if (a.status === 401) return goSignIn();
    if (a.status === 200) list.setRow(r.id, { status: a.data.status });
    else setErrors((e) => ({ ...e, [r.id]: errorText(a) }));
  };

  return (
    <div class="column page" ref={(el) => {
        list.container.current = el;
      }}>
      <h1>{date ? `Today, ${date}` : "Today"}</h1>
      {list.rows === null ? (
        <p class="loading">Loading today's bookings…</p>
      ) : list.rows.length === 0 ? (
        <Empty>No bookings today.</Empty>
      ) : (
        <table class="data-table stacked desk-table" aria-label="Today's bookings" tabIndex={-1}>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Court</th>
              <th scope="col">Organiser</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
              <th scope="col"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => {
              const time = clubTime(r.start);
              const name = `${r.organiser_name}, Court ${r.court} at ${time}`;
              const p = list.pending[r.id];
              return (
                <tr data-row={r.id} key={r.id}>
                  <td data-label="Time">{time}</td>
                  <td data-label="Court">Court {r.court}</td>
                  <td data-label="Organiser">{r.organiser_name}</td>
                  <td data-label="Kind">{r.kind === "match" ? "Match" : "Booking"}</td>
                  <td data-label="Status">{statusWords[r.status] ?? r.status}</td>
                  <td class="row-actions">
                    <Alert text={errors[r.id] ?? ""} />
                    <button
                      type="button"
                      class="pill pill-cobalt"
                      data-control="check-in"
                      aria-label={`Check in ${name}`}
                      aria-disabled={p ? "true" : undefined}
                      onClick={() => act(r, "check-in")}
                    >
                      {p === "check-in" ? "Checking in..." : "Check in"}
                    </button>
                    <button
                      type="button"
                      class="pill pill-outline"
                      data-control="no-show"
                      aria-label={`Mark no-show ${name}`}
                      aria-disabled={p ? "true" : undefined}
                      onClick={() => act(r, "no-show")}
                    >
                      {p === "no-show" ? "Marking..." : "Mark no-show"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {list.next && (
        <button type="button" class="pill pill-outline more" data-control="more" onClick={list.loadMore}>
          Load more bookings
        </button>
      )}
      <section class="card failed" role="region" aria-labelledby="failed-heading">
        <h2 id="failed-heading">Failed notices</h2>
        {failed === null ? null : failed.length === 0 ? (
          <Empty>No failed notices.</Empty>
        ) : (
          <ul class="notice-list">
            {failed.map((n) => (
              <li>
                {n.event} {n.channel} to {n.recipient}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
