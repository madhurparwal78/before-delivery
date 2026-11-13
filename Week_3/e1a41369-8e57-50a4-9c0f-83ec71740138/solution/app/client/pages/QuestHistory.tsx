import { useEffect, useState } from "react";
import type { Quest } from "../../shared/api";
import { api } from "../api";
import { Link } from "../router";
import { useStore } from "../store";

const localDate = (instant: string, zone: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(instant));

export function QuestHistory() {
  const zone = useStore((state) => state.me!.timeZone);
  const [quests, setQuests] = useState<Quest[] | null>(null);
  useEffect(() => {
    void api<{ quests: Quest[] }>("GET", "/api/history").then((body) => setQuests(body.quests));
  }, []);
  return (
    <main className="page">
      <section className="page-head"><h1 className="page-title">Quest history</h1></section>
      <div className="page-body">
      {quests && quests.length === 0 && <p>No finished quests yet.</p>}
      {quests && quests.length > 0 && (
        <ul className="ledger" role="list" aria-label="Quest history">
          {quests.map((quest) => (
            <li key={quest.id}>
              <Link className="ledger-name" href={`/quests/${quest.id}`}>{quest.name}</Link>
              <span className="ledger-result">{`${quest.boss}, ${quest.state}, ended ${localDate(quest.endedAt!, zone)}`}</span>
            </li>
          ))}
        </ul>
      )}
      </div>
    </main>
  );
}
