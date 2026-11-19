import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Alert, LiveStatus } from "../components/ui";
import { api, RequestError } from "../lib/api";
import { BAD_PAGE_LINK_COPY } from "../lib/copy";
import { useRefusalAlert } from "./Shell";

interface Table {
  name: string;
  row_count: number;
}

interface Destination {
  id: string;
  name: string;
}

export function Destinations(): JSX.Element {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [tables, setTables] = useState<Record<string, Table[]>>({});

  useEffect(() => {
    void api<{ destinations: Destination[] }>("GET", "/api/destinations")
      .then(async (answer) => {
        setDestinations(answer.destinations);
        const pairs = await Promise.all(
          answer.destinations.map(async (destination) => {
            const list = await api<{ tables: Table[] }>(
              "GET",
              `/api/destinations/${destination.id}/tables`,
            );
            return [destination.id, list.tables] as const;
          }),
        );
        setTables(Object.fromEntries(pairs));
      })
      .catch(() => undefined);
  }, []);

  return (
    <>
      <h1>Destinations</h1>
      {destinations.map((destination) => (
        <div className="panel" key={destination.id}>
          <h2>{destination.name}</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Records</th>
              </tr>
            </thead>
            <tbody>
              {(tables[destination.id] ?? []).map((table) => (
                <tr key={table.name}>
                  <th scope="row">
                    <Link to={`/app/destinations/${destination.id}/tables/${table.name}`}>{table.name}</Link>
                  </th>
                  <td className="numeric">{table.row_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(tables[destination.id] ?? []).length === 0 ? <p>No tables yet. Run a sync to create them.</p> : null}
        </div>
      ))}
    </>
  );
}

interface RecordsPage {
  records: Record<string, unknown>[];
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more: boolean;
  total_count: number;
}

const METADATA_COLUMNS = ["_wayline_job_id", "_wayline_extracted_at"];

export function TablePage(): JSX.Element {
  const { destinationId = "", table = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const cursor = new URLSearchParams(location.search).get("cursor");
  const [page, setPage] = useState<RecordsPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [badLink, setBadLink] = useState(false);
  const [message, setMessage] = useState("");
  const alertFor = useRefusalAlert();

  const load = useCallback(async () => {
    setMessage("Loading records…");
    setBadLink(false);
    try {
      const address = `/api/destinations/${destinationId}/tables/${table}/records?limit=50${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const answer = await api<RecordsPage>("GET", address);
      setPage(answer);
      setMessage("Page loaded");
    } catch (error) {
      const refusal = error as RequestError;
      if (refusal.code === "invalid_cursor") {
        setPage({ records: [], next_cursor: null, prev_cursor: null, has_more: false, total_count: 0 });
        setBadLink(true);
        setMessage("");
      } else if (refusal.status === 404) {
        setMissing(true);
      } else {
        setMessage(alertFor(refusal) ?? "");
      }
    }
  }, [destinationId, table, cursor, alertFor]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <>
        <h1>Table not found</h1>
        <Link to="/app/destinations">Back to destinations</Link>
      </>
    );
  }

  const columns = page?.records.length
    ? [
        ...Object.keys(page.records[0]).filter((key) => !METADATA_COLUMNS.includes(key)),
        ...METADATA_COLUMNS,
      ]
    : [];

  return (
    <>
      <h1>{table}</h1>
      {badLink ? (
        <Alert>
          {BAD_PAGE_LINK_COPY}{" "}
          <Link to={`/app/destinations/${destinationId}/tables/${table}`}>First page</Link>
        </Alert>
      ) : null}
      <p>{page ? `${page.total_count} records` : "0 records"}</p>
      <div
        className="records-frame"
        role="region"
        aria-label={`Scroll ${table} records`}
        tabIndex={0}
        onKeyDown={(event) => {
          const frame = event.currentTarget;
          if (event.key === "ArrowRight") frame.scrollLeft += 80;
          if (event.key === "ArrowLeft") frame.scrollLeft -= 80;
        }}
      >
        <table className="data-table" aria-label={`${table} records`}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(page?.records ?? []).map((record, index) => (
              <tr key={`${String(record.id)}-${index}`}>
                {columns.map((column, columnIndex) =>
                  columnIndex === 0 ? (
                    <th scope="row" key={column}>
                      {String(record[column])}
                    </th>
                  ) : (
                    <td key={column} className="numeric">
                      {String(record[column] ?? "")}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="button-row" style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className="button outline"
          disabled={!page?.prev_cursor}
          onClick={() =>
            navigate(
              `/app/destinations/${destinationId}/tables/${table}?cursor=${encodeURIComponent(
                page?.prev_cursor ?? "",
              )}`,
            )
          }
        >
          Previous page
        </button>
        <button
          type="button"
          className="button outline"
          disabled={!page?.has_more}
          onClick={() =>
            navigate(
              `/app/destinations/${destinationId}/tables/${table}?cursor=${encodeURIComponent(
                page?.next_cursor ?? "",
              )}`,
            )
          }
        >
          Next page
        </button>
      </div>
      <LiveStatus name="Records status" message={message} />
    </>
  );
}
