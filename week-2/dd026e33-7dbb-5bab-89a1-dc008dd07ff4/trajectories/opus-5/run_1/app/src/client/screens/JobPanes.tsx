import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CoatStack as CoatStackData } from '../../shared/coatstack';
import { DEFAULT_PANEL, isPanelId, panelName, type PanelId } from '../../shared/panels';
import { filmReading } from '../../shared/units';
import { stageAnnouncement, timestampDateLabel } from '../copy';
import { api } from '../lib/api';
import { useReducedMotion, useStatus } from '../lib/hooks';
import { replaceAddress, useLocation } from '../lib/router';
import { useSession } from '../lib/session';
import { Dialog } from '../components/Dialog';
import {
  CrossSection,
  PanelMap,
  PanelReadingsTable,
  StageScrubber,
} from '../components/CoatStack';
import { StatusRegion } from '../components/Status';

/** The stage and the panel live in the address, by replacing the current entry. */
export function useCoatStackAddress(
  basePath: string,
  data: CoatStackData | null,
): {
  stageIndex: number;
  panelId: PanelId;
  setStage(index: number): void;
  setPanel(panel: PanelId): void;
} {
  const location = useLocation();
  const parameters = new URLSearchParams(location.search);
  const count = data?.stages.length ?? 0;
  const latest = Math.max(0, count - 1);
  const rawStage = parameters.get('stage');
  // A missing or invalid value falls back to the latest logged stage.
  const stageIndex =
    rawStage !== null && /^\d+$/.test(rawStage) && Number(rawStage) < count
      ? Number(rawStage)
      : latest;
  const rawPanel = parameters.get('panel') ?? '';
  const panelId: PanelId = isPanelId(rawPanel) ? rawPanel : DEFAULT_PANEL;

  const write = (stage: number, panel: PanelId): void => {
    const next = new URLSearchParams();
    next.set('stage', String(stage));
    next.set('panel', panel);
    replaceAddress(`${basePath}?${next.toString()}`);
  };

  // The resolved stage and panel live in the address, so a shared link opens the same view.
  useEffect(() => {
    if (data === null) return;
    if (parameters.get('stage') === String(stageIndex) && parameters.get('panel') === panelId) {
      return;
    }
    write(stageIndex, panelId);
  });

  return {
    stageIndex,
    panelId,
    setStage: (index) => write(index, panelId),
    setPanel: (panel) => write(stageIndex, panel),
  };
}

export function CoatStackPanes({
  jobId,
  data,
  stageIndex,
  panelId,
  setStage,
  setPanel,
  canOpenHistory,
}: {
  jobId: string;
  data: CoatStackData;
  stageIndex: number;
  panelId: PanelId;
  setStage(index: number): void;
  setPanel(panel: PanelId): void;
  canOpenHistory: boolean;
}): ReactNode {
  const { units } = useSession();
  const reducedMotion = useReducedMotion();
  const announcer = useStatus();
  const [historyOpen, setHistoryOpen] = useState(false);
  const first = useRef(true);

  const slice = data.stages[stageIndex];
  const panel = slice?.panels.find((entry) => entry.panel === panelId);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    announcer.success(
      stageAnnouncement({
        stageName: slice?.name ?? 'No stage',
        position: stageIndex + 1,
        count: data.stages.length,
        panelName: panelName(panelId),
        reading:
          panel?.film_um === null || panel?.film_um === undefined
            ? null
            : filmReading(panel.film_um, units.film),
        band: panel?.band ?? null,
      }),
    );
    // Announcements follow each step and each panel change.
  }, [stageIndex, panelId, units.film]);

  return (
    <>
      <section className="pane" aria-label="Car plan">
        <h2 className="pane-heading">Car plan</h2>
        <PanelMap
          data={data}
          stageIndex={stageIndex}
          panelId={panelId}
          unit={units.film}
          reducedMotion={reducedMotion}
          onSelectPanel={setPanel}
          onOpenHistory={() => setHistoryOpen(true)}
        />
        <StageScrubber data={data} stageIndex={stageIndex} onSelectStage={setStage} />
        {canOpenHistory ? (
          <button type="button" onClick={() => setHistoryOpen(true)}>
            Reading history
          </button>
        ) : null}
      </section>
      <section className="pane" aria-label="Cross-section">
        <h2 className="pane-heading">Cross-section</h2>
        <CrossSection
          data={data}
          stageIndex={stageIndex}
          panelId={panelId}
          unit={units.film}
          reducedMotion={reducedMotion}
        />
        <PanelReadingsTable data={data} stageIndex={stageIndex} unit={units.film} />
      </section>
      {historyOpen ? (
        <ReadingHistoryDialog
          jobId={jobId}
          panelId={panelId}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
      <StatusRegion name="Stage announcer" status={announcer} />
    </>
  );
}

interface PanelReading {
  id: string;
  stage: string;
  film_um: number;
  logged_at: string;
  logged_by: { id: string; name: string };
}

function ReadingHistoryDialog({
  jobId,
  panelId,
  onClose,
}: {
  jobId: string;
  panelId: PanelId;
  onClose: () => void;
}): ReactNode {
  const { units } = useSession();
  const [readings, setReadings] = useState<PanelReading[]>([]);

  useEffect(() => {
    void api<{ readings: PanelReading[] }>(`/api/jobs/${jobId}/panels/${panelId}/readings`).then(
      (outcome) => {
        if (outcome.kind === 'ok') setReadings(outcome.body.readings);
      },
    );
  }, [jobId, panelId]);

  return (
    <Dialog name={`Reading history: ${panelName(panelId)}`} onClose={onClose}>
      <table className="data-table">
        <caption className="visually-hidden">{`Readings for ${panelName(panelId)}`}</caption>
        <thead>
          <tr>
            <th scope="col">Stage</th>
            <th scope="col">Reading</th>
            <th scope="col">Logged</th>
            <th scope="col">By</th>
          </tr>
        </thead>
        <tbody>
          {readings.map((reading) => (
            <tr key={reading.id}>
              <th scope="row">{reading.stage}</th>
              <td className="mono">{filmReading(reading.film_um, units.film)}</td>
              <td className="mono">{timestampDateLabel(reading.logged_at)}</td>
              <td>{reading.logged_by.name}</td>
            </tr>
          ))}
          {readings.length === 0 ? (
            <tr>
              <td colSpan={4}>No readings for this panel yet.</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <button type="button" onClick={onClose}>
        Cancel
      </button>
    </Dialog>
  );
}
