import { useEffect, useRef, useState } from 'react';
import { api } from '../app/api';
import { Link, useAnnounce, useFieldErrors, useLive } from '../app/shell';
import { Overlay } from '../components/overlays';
import { BottomBar, Card, TextField } from '../components/pieces';
import { MarkerBand } from '../components/markerBand';
import {
  MarkerResultsView,
  MemberView,
  ResultDrawView,
  copy,
  displayTimeOfInstant,
  PRACTICE_ZONE,
} from '../app/types';

export function StaffMemberResultsScreen({ memberId }: { memberId: string }): JSX.Element {
  const { announce } = useAnnounce();
  const errors = useFieldErrors();
  const [correcting, setCorrecting] = useState<{ marker: MarkerResultsView; draw: ResultDrawView } | null>(
    null,
  );
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef<Map<string, string>>(new Map());

  const { data: member } = useLive<MemberView>(async () => {
    const result = await api<{ member: MemberView }>(`/api/members/${memberId}`);
    return result.data?.member ?? null;
  }, [memberId]);
  const { data: markers, reload } = useLive<MarkerResultsView[]>(async () => {
    const result = await api<{ markers: MarkerResultsView[] }>(
      `/api/members/${memberId}/results`,
    );
    return result.data?.markers ?? null;
  }, [memberId]);

  useEffect(() => {
    if (!markers) return;
    const lines: Record<string, string> = {};
    for (const marker of markers) {
      for (const draw of marker.draws) {
        const key = `${marker.marker}:${draw.drawId}`;
        const stamp = `${draw.value}|${draw.correctedAt ?? ''}`;
        const before = previous.current.get(key);
        if (before && before !== stamp && draw.correctedBy && draw.correctedAt) {
          lines[marker.marker] = copy.correctionArrived(
            draw.correctedBy,
            marker.name,
            displayTimeOfInstant(draw.correctedAt, PRACTICE_ZONE),
            PRACTICE_ZONE,
          );
        }
        previous.current.set(key, stamp);
      }
    }
    if (Object.keys(lines).length > 0) {
      setCorrections((current) => ({ ...current, ...lines }));
      const first = Object.values(lines)[0];
      if (first) announce(first);
    }
  }, [markers, announce]);

  const saveCorrection = async (): Promise<void> => {
    if (!correcting) return;
    setBusy(true);
    announce(copy.working);
    const result = await api(`/api/results/${correcting.draw.resultId}`, {
      method: 'PATCH',
      json: { value, note: note === '' ? null : note },
    });
    setBusy(false);
    if (result.error) {
      errors.show(result.error);
      announce(result.error.message);
      return;
    }
    errors.clear();
    announce(copy.correctionSaved(correcting.marker.name));
    setCorrecting(null);
    reload();
  };

  return (
    <>
      <h1 tabIndex={-1}>Results for {member?.name ?? ''}</h1>
      {(markers ?? []).map((marker) => (
        <MarkerBand
          key={marker.marker}
          marker={marker}
          zone={PRACTICE_ZONE}
          correctionLine={corrections[marker.marker] ?? null}
          onCorrect={(draw) => {
            setCorrecting({ marker, draw });
            setValue(draw.value);
            setNote(draw.note ?? '');
          }}
        />
      ))}
      {markers && markers.length === 0 ? (
        <Card>
          <p className="muted">No results yet.</p>
        </Card>
      ) : null}
      <Overlay
        name="Correct value"
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        opener={opener}
      >
        <h2>Correct value</h2>
        <TextField
          label="Value"
          name="value"
          value={value}
          error={errors.fields.value}
          onChange={setValue}
        />
        <TextField label="Note" name="note" value={note} onChange={setNote} />
        <button type="button" disabled={busy} onClick={() => void saveCorrection()}>
          Save correction
        </button>
      </Overlay>
      <BottomBar>
        <Link to={`/staff/members/${memberId}`} className="button">
          Back to member
        </Link>
      </BottomBar>
    </>
  );
}
