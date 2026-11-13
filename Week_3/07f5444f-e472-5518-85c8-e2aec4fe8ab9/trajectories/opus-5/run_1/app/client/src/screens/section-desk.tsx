import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import type { Part, ProgrammeSummary, Scan, WorkDetail } from '../../../shared/api.js';
import { EN_DASH, MIDDLE_DOT } from '../../../shared/format.js';
import { ApiFailure, api, newIdempotencyKey } from '../api.js';
import { STORE_OFFLINE_BANNER, useApp } from '../app.js';
import { uploadFailureReason } from '../upload-reason.js';
import { STORE_OFFLINE_DESCRIPTION_ID } from './parts-table.js';

interface Card {
  programme: ProgrammeSummary;
  work: WorkDetail;
  part: Part;
  bowingMasters: Scan[];
}

type FilingStatus = { state: 'uploading' | 'filed' | 'not-filed'; reason?: string };

interface ProgrammeGroup {
  programme: ProgrammeSummary;
  label: string;
  cards: Card[];
}

function programmeGroups(cards: Card[]): ProgrammeGroup[] {
  const groups: ProgrammeGroup[] = [];
  for (const card of cards) {
    const existing = groups.find((group) => group.programme.id === card.programme.id);
    if (existing) {
      existing.cards.push(card);
      continue;
    }
    groups.push({
      programme: card.programme,
      label: `Programme ${card.programme.number} ${MIDDLE_DOT} ${card.programme.title}`,
      cards: [card],
    });
  }
  return groups;
}

export function SectionDesk(): JSX.Element {
  const { user, status, statusTick, visibilityTick } = useApp();
  const [cards, setCards] = useState<Card[] | null>(null);
  const [sectionStatus, setSectionStatus] = useState<string[]>([]);
  const [filing, setFiling] = useState<Record<string, FilingStatus>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const chairKey = user.chair?.key ?? '';

  const load = useCallback(async () => {
    try {
      const listed = await api.programmes();
      const active = listed.programmes.filter(
        (entry) =>
          entry.status === 'in_preparation' || entry.status === 'published' || entry.status === 'in_performance',
      );
      const next: Card[] = [];
      for (const summary of active) {
        const detail = await api.programme(summary.id);
        for (const workSummary of detail.works) {
          const work = await api.work(workSummary.id);
          const part = work.parts.find((entry) => entry.chair_key === chairKey);
          if (!part) continue;
          const scans = await api.scans(part.id);
          next.push({
            programme: summary,
            work,
            part,
            bowingMasters: scans.scans.filter((scan) => scan.kind === 'bowing_master'),
          });
        }
      }
      setCards(next);
    } catch {
      /* a failed read leaves the screen as it is */
    }
  }, [chairKey]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (statusTick > 0) void load();
  }, [statusTick, load]);
  useEffect(() => {
    if (visibilityTick > 0) void load();
  }, [visibilityTick, load]);

  async function confirmCut(card: Card, cutId: string, fromBar: number, toBar: number): Promise<void> {
    setSectionStatus(['Recording']);
    try {
      await api.recordMark(card.part.id, cutId);
      setSectionStatus([
        `${card.work.title} \u2014 ${card.part.name} carries cut ${fromBar}${EN_DASH}${toBar}.`,
      ]);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setSectionStatus([failure.fieldError('cut_id') ?? failure.body.message]);
      } else {
        setSectionStatus(['That cut was not recorded.']);
      }
    }
    await load();
  }

  async function uploadBowingMaster(card: Card, file: File): Promise<void> {
    setFiling((current) => ({ ...current, [card.work.id]: { state: 'uploading' } }));
    try {
      await api.uploadScan(card.part.id, 'bowing_master', file, { idempotencyKey: newIdempotencyKey() });
      setFiling((current) => ({ ...current, [card.work.id]: { state: 'filed' } }));
      await load();
    } catch (failure) {
      const reason = uploadFailureReason(failure);
      setFiling((current) => ({
        ...current,
        [card.work.id]: {
          state: 'not-filed',
          reason: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`,
        },
      }));
    }
  }

  const storageDown = status.storage === 'down';

  return (
    <main className="section-desk">
      {storageDown ? (
        <span className="visually-hidden" id={STORE_OFFLINE_DESCRIPTION_ID}>
          {STORE_OFFLINE_BANNER}
        </span>
      ) : null}
      <h1>Section desk {EN_DASH} {user.chair?.section ?? ''}</h1>

      {cards === null ? <p className="loading">Opening the section desk</p> : null}

      {programmeGroups(cards ?? []).map((group) => (
        <section className="programme-group" key={group.programme.id} aria-label={group.label}>
          <p className="card-programme mono">{group.label}</p>
          {group.cards.map((card) => {
            const filingStatus = filing[card.work.id];
            return (
              <section className="card section-card" key={`${card.programme.id}-${card.work.id}`}>
                <h2>{card.work.title}</h2>
                <p>
                  {card.part.name} · bars {card.part.bars_from}
                  {EN_DASH}
                  {card.part.bars_to}
                </p>

                <ul className="section-cuts">
                  {card.work.cuts.map((cut) => {
                    const mark = card.part.marks.find((entry) => entry.cut_id === cut.id);
                    const plays = card.part.bars_from <= cut.to_bar && card.part.bars_to >= cut.from_bar;
                    if (!plays) return null;
                    return (
                      <li key={cut.id}>
                        {mark ? (
                          <span>
                            Confirmed {cut.from_bar}
                            {EN_DASH}
                            {cut.to_bar} by {mark.marked_by.name}
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void confirmCut(card, cut.id, cut.from_bar, cut.to_bar)}
                          >
                            Confirm cut {cut.from_bar}
                            {EN_DASH}
                            {cut.to_bar}
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {card.work.cuts.length === 0 ? <li>No cuts are marked on this work.</li> : null}
                </ul>

                <button
                  type="button"
                  aria-disabled={storageDown ? true : undefined}
                  aria-describedby={storageDown ? STORE_OFFLINE_DESCRIPTION_ID : undefined}
                  className={storageDown ? 'unavailable' : undefined}
                  onClick={() => {
                    if (storageDown) return;
                    fileInputs.current[card.work.id]?.click();
                  }}
                >
                  <Upload className="icon" aria-hidden="true" focusable="false" />
                  Upload bowing master {card.work.title}
                </button>
                <input
                  type="file"
                  className="file-input"
                  tabIndex={-1}
                  aria-hidden="true"
                  accept="application/pdf,image/png,image/jpeg"
                  ref={(element) => {
                    fileInputs.current[card.work.id] = element;
                  }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void uploadBowingMaster(card, file);
                  }}
                />

                <p role="status" aria-label={`Bowing master status: ${card.work.title}`} className="filing-status">
                  {filingStatus === undefined
                    ? ''
                    : filingStatus.state === 'uploading'
                      ? 'Uploading'
                      : filingStatus.state === 'filed'
                        ? 'Filed'
                        : 'Not filed'}
                  {filingStatus?.state === 'not-filed' && filingStatus.reason !== undefined ? (
                    <span className="status-line">{filingStatus.reason}</span>
                  ) : null}
                </p>

                <ul aria-label={`Filed bowing masters: ${card.work.title}`} className="filed-list">
                  {card.bowingMasters.map((scan) => (
                    <li key={scan.id}>
                      <a href={`/api/scans/${scan.id}/file`} download>
                        <Download className="icon" aria-hidden="true" focusable="false" />
                        Download {scan.file_name}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </section>
      ))}

      <p className="section-status" role="status" aria-label="Section status">
        {sectionStatus.map((line, index) => (
          <span key={`${index}-${line}`} className="status-line">
            {line}
          </span>
        ))}
      </p>
    </main>
  );
}
