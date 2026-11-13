// The section desk: the section's part in each active programme, its cuts to confirm and its
// bowing masters, from one screen.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Upload } from "lucide-react";
import type { Part, ProgrammeDetail, ProgrammeSummary, Scan, User, WorkDetail } from "../../shared/api";
import { dateTimeLabel } from "../../shared/london";
import { call, get, uploadReason, uploadScan } from "../api";
import { STORE_OUTAGE_ID, useStatus } from "../status";

const ACTIVE = new Set(["in_preparation", "published", "in_performance"]);

interface Card {
  programme: ProgrammeSummary;
  work: WorkDetail;
  part: Part;
  bowingMasters: Scan[];
}

type BowingState = { text: "Uploading" } | { text: "Filed" } | { text: "Not filed"; reason: string };

function SectionCard({
  card,
  storeDown,
  onConfirm,
  onFiled,
}: {
  card: Card;
  storeDown: boolean;
  onConfirm: (card: Card, cutId: string) => void;
  onFiled: () => Promise<void>;
}) {
  const { work, part } = card;
  const input = useRef<HTMLInputElement>(null);
  const [bowing, setBowing] = useState<BowingState | null>(null);
  const toConfirm = work.cuts.filter((cut) => part.cuts_to_mark.includes(cut.id));
  const lines = [
    ...part.marks.map((mark) => ({ from: mark.from_bar, key: mark.cut_id, mark, cut: null })),
    ...toConfirm.map((cut) => ({ from: cut.from_bar, key: cut.id, mark: null, cut })),
  ].sort((a, b) => a.from - b.from);

  const file = async (chosen: File): Promise<void> => {
    setBowing({ text: "Uploading" });
    const answer = await uploadScan(part.id, "bowing_master", chosen, () => undefined);
    if (answer.ok) {
      setBowing({ text: "Filed" });
      await onFiled();
    } else {
      const reason = uploadReason(answer.status, chosen.size);
      setBowing({ text: "Not filed", reason: `${reason[0]?.toUpperCase() ?? ""}${reason.slice(1)}.` });
    }
  };

  return (
    <article className="section-card">
      <h2 className="section-card__title">{work.title}</h2>
      <p className="section-card__meta">
        {work.composer} · {part.name} · bars{" "}
        <span className="mono">
          {part.bars_from}–{part.bars_to}
        </span>
      </p>
      <div className="section-card__cuts">
        <h3 className="section-card__subhead">Cuts</h3>
        {lines.length === 0 && <p className="quiet">No cuts in this part.</p>}
        <ul className="plain-list">
          {lines.map(({ key, mark, cut }) => (
            <li key={key} className="section-card__cut">
              {mark && (
                <span className="confirmed">
                  <Check aria-hidden="true" />
                  <span>{`Confirmed ${mark.from_bar}–${mark.to_bar} by ${mark.marked_by.name}`}</span>
                </span>
              )}
              {cut && (
                <button type="button" className="button button--small" onClick={() => onConfirm(card, cut.id)}>
                  Confirm cut {cut.from_bar}–{cut.to_bar}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div className="section-card__bowing">
        <h3 className="section-card__subhead">Bowing master</h3>
        <button
          type="button"
          className="button button--small"
          aria-label={`Upload bowing master ${work.title}`}
          aria-disabled={storeDown ? "true" : undefined}
          aria-describedby={storeDown ? STORE_OUTAGE_ID : undefined}
          onClick={() => {
            if (!storeDown) input.current?.click();
          }}
        >
          <Upload aria-hidden="true" />
          Upload bowing master
        </button>
        <input
          ref={input}
          type="file"
          hidden
          accept="application/pdf,image/png,image/jpeg"
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            event.target.value = "";
            if (chosen) void file(chosen);
          }}
        />
        <p className="bowing-status" role="status" aria-label={`Bowing master status: ${work.title}`}>
          {bowing && <span className="bowing-status__word">{bowing.text}</span>}
          {bowing?.text === "Not filed" && <span className="bowing-status__reason">{bowing.reason}</span>}
        </p>
        <ul className="plain-list filed" aria-label={`Filed bowing masters: ${work.title}`}>
          {card.bowingMasters.map((scan) => (
            <li key={scan.id}>
              <a className="download" href={`/api/scans/${scan.id}/file`} download aria-label={`Download ${scan.file_name}`}>
                <Download aria-hidden="true" />
                <span className="download__name">{scan.file_name}</span>
              </a>
              <span className="quiet mono">{dateTimeLabel(scan.filed_at)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

export function SectionDesk({ user }: { user: User }) {
  const { status, refresh } = useStatus();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [sectionStatus, setSectionStatus] = useState("");
  const chairKey = user.chair?.key;

  const reload = useCallback(async (): Promise<void> => {
    const list = await get<{ programmes: ProgrammeSummary[] }>("/api/programmes");
    if (!list.ok) return;
    const active = list.data.programmes.filter((p) => ACTIVE.has(p.status));
    const details = await Promise.all(active.map((p) => get<ProgrammeDetail>(`/api/programmes/${p.id}`)));
    const works = await Promise.all(
      details.flatMap((answer) => (answer.ok ? answer.data.works.map((w) => get<WorkDetail>(`/api/works/${w.id}`)) : [])),
    );
    const found = await Promise.all(
      works.flatMap((answer) => {
        if (!answer.ok) return [];
        const part = answer.data.parts.find((p) => p.chair_key === chairKey);
        const programme = active.find((p) => p.id === answer.data.programme_id);
        if (!part || !programme) return [];
        return [
          get<{ scans: Scan[] }>(`/api/parts/${part.id}/scans`).then((scans) => ({
            programme,
            work: answer.data,
            part,
            bowingMasters: scans.ok ? scans.data.scans.filter((s) => s.kind === "bowing_master") : [],
          })),
        ];
      }),
    );
    setCards(found);
  }, [chairKey]);

  useEffect(() => {
    void reload();
  }, [reload, refresh]);

  const confirmCut = async (card: Card, cutId: string): Promise<void> => {
    const cut = card.work.cuts.find((c) => c.id === cutId);
    const span = cut ? `${cut.from_bar}–${cut.to_bar}` : "";
    const label = `${card.work.title} — ${card.part.name}`;
    setSectionStatus("Recording");
    const answer = await call<{ part: Part }>("POST", `/api/parts/${card.part.id}/marks`, { cut_id: cutId });
    if (answer.ok) {
      setSectionStatus(`${label} carries cut ${span}.`);
      setCards((list) => list?.map((c) => (c.part.id === card.part.id ? { ...c, part: answer.data.part } : c)) ?? null);
    } else if (answer.status === 404) {
      setSectionStatus("That cut was restored before the mark was recorded.");
      await reload();
    } else if (answer.status === 422) {
      setSectionStatus(`${label} doesn't play in bars ${span}.`);
    } else {
      setSectionStatus(answer.error?.message ?? "The cut was not confirmed.");
    }
  };

  const groups = new Map<string, Card[]>();
  for (const card of cards ?? []) groups.set(card.programme.id, [...(groups.get(card.programme.id) ?? []), card]);

  return (
    <main className="page section-desk">
      <div className="page__head">
        <h1 className="page__title">Section desk</h1>
        <p className="page__lede">{user.chair ? `${user.chair.section} · ${user.name}` : user.name}</p>
      </div>
      <p className="page__status" role="status" aria-label="Section status">
        {sectionStatus}
      </p>
      {cards === null && <div className="placeholder" aria-hidden="true"><span /><span /></div>}
      {cards?.length === 0 && <p className="empty-line">No programme in preparation, published or in performance yet.</p>}
      {[...groups.values()].map((group) => {
        const programme = group[0]?.programme;
        if (!programme) return null;
        return (
          <section key={programme.id} className="section-group" aria-label={`Programme ${programme.number} · ${programme.title}`}>
            <p className="section-group__title">
              <span className="section-group__numeral">{programme.number}</span>
              <span>{programme.title}</span>
            </p>
            <div className="section-group__cards">
              {group.map((card) => (
                <SectionCard key={card.work.id} card={card} storeDown={status?.storage === "down"} onConfirm={(c, id) => void confirmCut(c, id)} onFiled={reload} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
