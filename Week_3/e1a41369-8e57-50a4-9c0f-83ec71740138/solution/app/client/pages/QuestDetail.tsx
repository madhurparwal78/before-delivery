import { useEffect, useState } from "react";
import type { Quest } from "../../shared/api";
import { ApiError, api } from "../api";
import { StrikeList } from "../components/PartyPanel";
import { tenths } from "../format";

export function QuestDetail({ questId }: { questId: string }) {
  const [quest, setQuest] = useState<Quest | "missing" | null>(null);
  useEffect(() => {
    api<Quest>("GET", `/api/quests/${questId}`).then(setQuest, (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) setQuest("missing");
    });
  }, [questId]);

  if (quest === null) return null;
  if (quest === "missing") {
    return (
      <main className="page">
        <section className="page-head"><h1 className="page-title">Quest not found</h1></section>
        <p className="page-body">This quest does not exist or is not yours to see.</p>
      </main>
    );
  }
  return (
    <main className="page">
      <section className="page-head">
        <h1 className="page-title">{quest.name}</h1>
        <p>{`State: ${quest.state}`}</p>
      </section>
      <div className="page-body">
      <h2 className="page-sub">Damage</h2>
      <ul className="ledger" role="list" aria-label="Member damage">
        {quest.members.map((member) => (
          <li key={member.username}>
            <span className="ledger-name">{member.username}</span> <span className="ledger-result">{tenths(member.damage)}</span>
          </li>
        ))}
      </ul>
      <h2 className="page-sub">Strikes</h2>
      <StrikeList quest={quest} />
      </div>
    </main>
  );
}
