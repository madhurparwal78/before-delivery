import { get } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { useSession } from "../../lib/session.js";
import { shownOf, useSlaFeed, type SlaView } from "../../lib/sla.js";
import { SlaInline } from "../../components/Sla.js";
import { Page, Rest, StatusBlock, useLoad } from "../../lib/ui.js";
import { gate, PortalActions } from "./common.js";
import type { ShownItem } from "./ItemForm.js";

interface RequestItem {
  number: string;
  item: string;
  state: string;
  state_label: string;
  tasks: Array<{ number: string; state: string; state_label: string }>;
  slas: SlaView[];
}

interface RequestJson {
  number: string;
  state: "open" | "closed";
  items: RequestItem[];
}

function ItemRow({ entry, name }: { entry: RequestItem; name: string }): JSX.Element {
  const slas = useSlaFeed(entry.number, entry.slas, false);
  return (
    <li className="status-item" aria-label={`${entry.number} ${name}: ${entry.state_label}`}>
      <div className="status-line">
        <span className="status-name">
          {entry.number} {name}:
        </span>{" "}
        <StatusBlock>{entry.state_label}</StatusBlock>
        <SlaInline entry={shownOf(slas)} />
      </div>
      {entry.tasks.length > 0 ? (
        <ul className="status-tasks">
          {entry.tasks.map((task) => (
            <li key={task.number} aria-label={`${task.number}: ${task.state_label}`}>
              <span>{task.number}:</span> <StatusBlock outlined>{task.state_label}</StatusBlock>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function RequestPage({ number }: { number: string }): JSX.Element {
  const session = useSession();
  const { state, reload } = useLoad(async () => {
    const [{ request }, { items }] = await Promise.all([get<{ request: RequestJson }>(`/api/requests/${encodeURIComponent(number)}`), get<{ items: ShownItem[] }>("/api/catalog/items")]);
    return { request, names: new Map(items.map((item) => [item.id, item.name])) };
  }, [number, session.accessVersion]);
  const request = state.status === "ready" ? state.data.request : null;
  const watched = request ? request.items.flatMap((item) => [item.number, ...item.tasks.map((task) => task.number)]) : [];
  useTopics(watched.map((n) => `record:${n}`), reload);
  if (state.status !== "ready") return gate(state, number, reload);
  const { request: shown, names } = state.data;
  return (
    <Page subject={shown.number}>
      <PortalActions />
      <Rest narrow label="Request status" className="portal-column">
        <div className="status-head">
          <h2>Request status</h2>
          <StatusBlock outlined={shown.state === "closed"}>{shown.state === "open" ? "Open" : "Closed"}</StatusBlock>
        </div>
        <ul className="status-items">
          {shown.items.map((entry) => (
            <ItemRow key={entry.number} entry={entry} name={names.get(entry.item) ?? entry.item} />
          ))}
        </ul>
      </Rest>
    </Page>
  );
}
