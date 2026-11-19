import { useEffect, useRef, useState } from 'react';
import type {
  DisplayUnits,
  StandardsProfileWithRevision,
  TimetableEntry,
} from '../../shared/protocol.js';
import {
  elevationStepFromInput,
  elevationStepToInput,
  lengthFromInput,
  lengthToInput,
} from '../../shared/units.js';
import { copy } from '../lib/copy.js';
import { writeView, type SheetName } from '../lib/viewState.js';
import { useStore } from '../store.js';
import { EmptyArt } from './Art.js';
import { SessionControls } from './SessionBar.js';
import { sessionPath } from '../lib/api.js';

const TITLES: Record<string, string> = {
  layouts: 'Layouts',
  versions: 'Versions',
  timetable: 'Timetable',
  'crew-packets': 'Crew packets',
  members: 'Members',
  standards: 'Standards',
  history: 'History',
  trash: 'Trash',
  sessions: 'Sessions',
};

function Empty({ children }: { children?: React.ReactNode }): JSX.Element {
  return (
    <div className="empty-state">
      <EmptyArt />
      <p>{copy.emptyList}</p>
      {children}
    </div>
  );
}

export function Sheet({ name }: { name: SheetName }): JSX.Element | null {
  const title = TITLES[name];
  const closer = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') writeView({ sheet: null });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!title) return null;
  return (
    <div className="sheet-backdrop">
      <div
        role="dialog"
        aria-label={title}
        data-testid={`sheet-${name}`}
        className="sheet"
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          <button ref={closer} className="mini" onClick={() => writeView({ sheet: null })}>
            Close
          </button>
        </div>
        <div className="sheet-body">
          {name === 'layouts' ? <LayoutsSheet /> : null}
          {name === 'versions' ? <VersionsSheet /> : null}
          {name === 'timetable' ? <TimetableSheet /> : null}
          {name === 'crew-packets' ? <PacketsSheet /> : null}
          {name === 'members' ? <MembersSheet /> : null}
          {name === 'standards' ? <StandardsSheet /> : null}
          {name === 'history' ? <HistorySheet /> : null}
          {name === 'trash' ? <TrashSheet /> : null}
          {name === 'sessions' ? <SessionsSheet /> : null}
        </div>
      </div>
    </div>
  );
}

function LayoutsSheet(): JSX.Element {
  const { layouts, actions } = useStore();
  const [name, setName] = useState('');
  return (
    <>
      <label className="field">
        <span>Layout name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <button
        className="lipped"
        onClick={() => {
          void actions.createLayout(name);
          setName('');
        }}
      >
        Create layout
      </button>
      {layouts.length === 0 ? <Empty /> : null}
      {layouts.map((layout) => (
        <div key={layout.id} className="sheet-row" data-testid={`layout-row-${layout.id}`}>
          <div className="sheet-row-head">
            <h3>{layout.name}</h3>
          </div>
          <p className="figure">
            {layout.counts.modules} modules · {layout.counts.pieces} pieces ·{' '}
            {layout.counts.blocks} blocks · {layout.counts.trash} in trash
          </p>
          <div className="row-actions">
            <button className="mini strong" onClick={() => void actions.openLayout(layout.id)}>
              Open
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function VersionsSheet(): JSX.Element {
  const { versions, actions, findings } = useStore();
  const [label, setLabel] = useState('');
  return (
    <>
      <label className="field">
        <span>Version label</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <button className="lipped" onClick={() => void actions.saveVersion(label)}>
        Save version
      </button>
      {findings.length > 0 ? (
        <div className="sheet-row">
          <h3>Findings</h3>
          {findings.map((finding, index) => (
            <p key={`${finding.rule}-${index}`}>{finding.message}</p>
          ))}
        </div>
      ) : null}
      {versions.length === 0 ? <Empty /> : null}
      {[...versions].reverse().map((version) => (
        <div key={version.id} className="sheet-row" data-testid={`version-row-${version.number}`}>
          <div className="sheet-row-head">
            <h3>Version {version.number}</h3>
            <strong>{version.state}</strong>
            <span>{version.label}</span>
          </div>
          <span className="hash">{version.canonical_hash}</span>
          <div className="row-actions">
            <button
              className="mini"
              onClick={() =>
                void actions.validateVersion(version.id, version.number, version.revision)
              }
            >
              Validate
            </button>
            <button
              className="mini"
              onClick={() =>
                void actions.publishVersion(version.id, version.number, version.revision)
              }
            >
              Publish
            </button>
            <button
              className="mini"
              onClick={() => void actions.restoreVersion(version.id, version.number)}
            >
              Restore
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function TimetableSheet(): JSX.Element {
  const { layout, actions } = useStore();
  const [draft, setDraft] = useState<TimetableEntry[]>(() => layout?.content.timetable.entries ?? []);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    setDraft(layout?.content.timetable.entries ?? []);
  }, [layout?.content.timetable.version, layout?.revision]);

  const stations = layout?.content.stations ?? [];
  const trains = layout?.content.trains ?? [];

  return (
    <>
      <p className="figure">Timetable version {layout?.content.timetable.version ?? 0}</p>
      {draft.length === 0 ? <Empty /> : null}
      {draft.map((entry) => (
        <div key={entry.id} className="sheet-row" data-testid={`timetable-row-${entry.id}`}>
          <div className="sheet-row-head">
            <h3>
              Train {trains.find((train) => train.id === entry.train_id)?.number ?? entry.train_id}
            </h3>
            <span>{stations.find((station) => station.id === entry.station_id)?.name ?? ''}</span>
          </div>
          <label className="field">
            <span>Depart</span>
            <input
              type="number"
              min={0}
              max={86399}
              step={1}
              value={entry.depart_fast_seconds}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((row) =>
                    row.id === entry.id
                      ? {
                          ...row,
                          depart_fast_seconds: Number.parseInt(event.target.value, 10) || 0,
                        }
                      : row,
                  ),
                )
              }
            />
          </label>
        </div>
      ))}
      <button className="lipped" onClick={() => void actions.saveTimetable(draft)}>
        Save timetable
      </button>
      <h3>Stations</h3>
      {stations.map((station) => (
        <div key={station.id} className="sheet-row">
          <div className="sheet-row-head">
            <h3>{station.name}</h3>
          </div>
          <div className="row-actions">
            <button
              className="mini"
              onClick={() => setRenaming({ id: station.id, name: station.name })}
            >
              Rename
            </button>
          </div>
        </div>
      ))}
      {renaming ? (
        <div
          className="modal-centre"
          onKeyDown={(event) => event.key === 'Escape' && setRenaming(null)}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label="Rename"
            className="modal-card"
            onSubmit={(event) => {
              event.preventDefault();
              void actions.renameStation(renaming.id, renaming.name).then(() => setRenaming(null));
            }}
          >
            <h2>Rename</h2>
            <label className="field">
              <span>New name</span>
              <input
                value={renaming.name}
                onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
              />
            </label>
            <button className="lipped" type="submit">
              Save name
            </button>
            <button className="mini" type="button" onClick={() => setRenaming(null)}>
              Close
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}

function PacketsSheet(): JSX.Element {
  const { packets, packetPreview, actions, session, view, service } = useStore();
  return (
    <>
      {service.gotenberg === 'down' ? <p role="status">{copy.gotenbergDown}</p> : null}
      <button className="lipped" disabled={!session} onClick={() => void actions.issuePacket()}>
        Issue packet
      </button>
      {packetPreview ? (
        <div className="sheet-row" data-testid="next-packet-preview">
          <div className="sheet-row-head">
            <h3>Next packet</h3>
            <span>Session version {packetPreview.session_version}</span>
          </div>
          <span className="hash">{packetPreview.content_hash}</span>
          {packetPreview.content.train_orders.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
      {packets.length === 0 ? <Empty /> : null}
      {packets.map((packet) => (
        <div key={packet.id} className="sheet-row" data-testid={`packet-row-${packet.id}`}>
          <div className="sheet-row-head">
            <h3>{packet.state}</h3>
            <span>Session version {packet.session_version}</span>
          </div>
          <span className="hash">{packet.content_hash ?? ''}</span>
          <p>Issued by {packet.issued_by}</p>
          {packet.byte_length ? (
            <a
              className="mini"
              href={`${sessionPath(view.workspace ?? '', view.session ?? '')}/packets/${packet.id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Download PDF
            </a>
          ) : null}
        </div>
      ))}
    </>
  );
}

function MembersSheet(): JSX.Element {
  const { members, actions } = useStore();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');
  return (
    <>
      <button className="lipped" onClick={() => setOpen(true)}>
        Add member
      </button>
      {open ? (
        <form
          className="sheet-row"
          onSubmit={(event) => {
            event.preventDefault();
            void actions
              .addMember(
                displayName,
                email,
                password,
                role as 'manager' | 'member' | 'operator',
              )
              .then(() => setOpen(false));
          }}
        >
          <label className="field">
            <span>Display name</span>
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="manager">Manager</option>
              <option value="member">Member</option>
              <option value="operator">Operator</option>
            </select>
          </label>
          <button className="lipped" type="submit">
            Save member
          </button>
        </form>
      ) : null}
      {members.length === 0 ? <Empty /> : null}
      {members.map((member) => (
        <div key={member.user_id} className="sheet-row" data-testid={`member-row-${member.user_id}`}>
          <div className="sheet-row-head">
            <h3>{member.display_name}</h3>
            <span>{member.role}</span>
          </div>
          <p>{member.email}</p>
        </div>
      ))}
    </>
  );
}

const LENGTH_FIELDS: { key: keyof StandardsProfileWithRevision; label: string }[] = [
  { key: 'endplate_single_mm', label: 'Single endplate' },
  { key: 'endplate_double_mm', label: 'Double endplate' },
  { key: 'double_track_offset_mm', label: 'Double track offset' },
  { key: 'end_straight_mm', label: 'End straight' },
  { key: 'min_radius_mm', label: 'Minimum radius' },
  { key: 'reverse_curve_straight_mm', label: 'Reverse curve straight' },
];

function StandardsSheet(): JSX.Element {
  const { standards, actions } = useStore();
  const [units, setUnits] = useState<DisplayUnits>(standards?.display_units ?? 'in');
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!standards) return;
    setUnits(standards.display_units);
    const next: Record<string, string> = {};
    for (const field of LENGTH_FIELDS) {
      next[field.key] = lengthToInput(standards[field.key] as number, standards.display_units);
    }
    next['elevation_step_hundredths_mm'] = elevationStepToInput(
      standards.elevation_step_hundredths_mm,
      standards.display_units,
    );
    next['max_grade_tenths_percent'] = (standards.max_grade_tenths_percent / 10).toFixed(1);
    next['min_frog_number'] = String(standards.min_frog_number);
    setValues(next);
  }, [standards]);

  const retune = (nextUnits: DisplayUnits): void => {
    if (!standards) return;
    const next: Record<string, string> = { ...values };
    for (const field of LENGTH_FIELDS) {
      const stored = lengthFromInput(Number(values[field.key] ?? '0'), units);
      next[field.key] = lengthToInput(stored, nextUnits);
    }
    const storedStep = elevationStepFromInput(
      Number(values['elevation_step_hundredths_mm'] ?? '0'),
      units,
    );
    next['elevation_step_hundredths_mm'] = elevationStepToInput(storedStep, nextUnits);
    setUnits(nextUnits);
    setValues(next);
  };

  if (!standards) return <Empty />;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const profile: StandardsProfileWithRevision = {
          ...standards,
          display_units: units,
          max_grade_tenths_percent: Math.round(
            Number(values['max_grade_tenths_percent'] ?? '0') * 10,
          ),
          min_frog_number: Math.round(Number(values['min_frog_number'] ?? '6')),
          elevation_step_hundredths_mm: elevationStepFromInput(
            Number(values['elevation_step_hundredths_mm'] ?? '0'),
            units,
          ),
          endplate_single_mm: lengthFromInput(Number(values['endplate_single_mm'] ?? '0'), units),
          endplate_double_mm: lengthFromInput(Number(values['endplate_double_mm'] ?? '0'), units),
          double_track_offset_mm: lengthFromInput(
            Number(values['double_track_offset_mm'] ?? '0'),
            units,
          ),
          end_straight_mm: lengthFromInput(Number(values['end_straight_mm'] ?? '0'), units),
          min_radius_mm: lengthFromInput(Number(values['min_radius_mm'] ?? '0'), units),
          reverse_curve_straight_mm: lengthFromInput(
            Number(values['reverse_curve_straight_mm'] ?? '0'),
            units,
          ),
        };
        void actions.saveStandards(profile);
      }}
    >
      <fieldset style={{ border: 'none', padding: 0, display: 'flex', gap: 14 }}>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name="display-units"
            checked={units === 'in'}
            onChange={() => retune('in')}
            style={{ width: 22, minHeight: 22 }}
          />
          <span>Inches</span>
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input
            type="radio"
            name="display-units"
            checked={units === 'mm'}
            onChange={() => retune('mm')}
            style={{ width: 22, minHeight: 22 }}
          />
          <span>Millimetres</span>
        </label>
      </fieldset>
      {LENGTH_FIELDS.map((field) => (
        <label key={field.key} className="field">
          <span>{field.label}</span>
          <input
            type="number"
            step={units === 'in' ? 0.001 : 1}
            value={values[field.key] ?? ''}
            onChange={(event) =>
              setValues((current) => ({ ...current, [field.key]: event.target.value }))
            }
          />
        </label>
      ))}
      <label className="field">
        <span>Elevation step</span>
        <input
          type="number"
          step={units === 'in' ? 0.001 : 0.01}
          value={values['elevation_step_hundredths_mm'] ?? ''}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              elevation_step_hundredths_mm: event.target.value,
            }))
          }
        />
      </label>
      <label className="field">
        <span>Maximum grade</span>
        <input
          type="number"
          step={0.1}
          value={values['max_grade_tenths_percent'] ?? ''}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              max_grade_tenths_percent: event.target.value,
            }))
          }
        />
      </label>
      <label className="field">
        <span>Minimum turnout</span>
        <input
          type="number"
          step={1}
          value={values['min_frog_number'] ?? ''}
          onChange={(event) =>
            setValues((current) => ({ ...current, min_frog_number: event.target.value }))
          }
        />
      </label>
      <button className="lipped" type="submit">
        Save standards
      </button>
    </form>
  );
}

function HistorySheet(): JSX.Element {
  const { history } = useStore();
  if (history.length === 0) return <Empty />;
  return (
    <>
      {history.map((row) => (
        <div key={row.id} className="sheet-row">
          <div className="sheet-row-head">
            <h3>{row.action === 'purged' ? 'Purged module' : row.action}</h3>
            <span>{row.actor}</span>
          </div>
          <p>
            {row.from ?? '—'} → {row.to ?? '—'}
          </p>
          <span className="hash">{row.at}</span>
        </div>
      ))}
    </>
  );
}

function TrashSheet(): JSX.Element {
  const { trash, actions } = useStore();
  if (trash.length === 0) return <Empty />;
  return (
    <>
      {trash.map((row) => (
        <div key={row.id} className="sheet-row" data-testid={`trash-row-${row.id}`}>
          <div className="sheet-row-head">
            <h3>{row.name}</h3>
            <span>{row.trashed_by}</span>
          </div>
          <div className="row-actions">
            <button className="mini" onClick={() => void actions.undoTrash(row.id)}>
              Undo
            </button>
            <button className="mini" onClick={() => void actions.purgeTrash(row.id)}>
              Purge
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function SessionsSheet(): JSX.Element {
  const { sessions, versions, actions, session, view } = useStore();
  const [open, setOpen] = useState(false);
  const published = versions.filter((version) => version.state === 'Published');
  const [name, setName] = useState('');
  const [versionId, setVersionId] = useState(published[published.length - 1]?.id ?? '');
  const [ratio, setRatio] = useState(6);

  return (
    <>
      <button className="lipped" onClick={() => setOpen(true)}>
        New session
      </button>
      {open ? (
        <div className="modal-centre" onKeyDown={(event) => event.key === 'Escape' && setOpen(false)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-label="New session"
            className="modal-card"
            onSubmit={(event) => {
              event.preventDefault();
              void actions.createSession(name, versionId, ratio).then(() => setOpen(false));
            }}
          >
            <h2>New session</h2>
            <label className="field">
              <span>Session name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="field">
              <span>Published version</span>
              <select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
                {published.map((version) => (
                  <option key={version.id} value={version.id}>
                    Version {version.number} {version.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Clock ratio</span>
              <input
                type="number"
                min={1}
                max={12}
                step={1}
                value={ratio}
                onChange={(event) => setRatio(Number.parseInt(event.target.value, 10) || 6)}
              />
            </label>
            <button className="lipped" type="submit">
              Create session
            </button>
            <button className="mini" type="button" onClick={() => setOpen(false)}>
              Close
            </button>
          </form>
        </div>
      ) : null}
      {sessions.length === 0 ? <Empty /> : null}
      {sessions.map((row) => (
        <div key={row.id} className="sheet-row">
          <div className="sheet-row-head">
            <h3>{row.name}</h3>
            <strong>{row.status}</strong>
            <span className="figure">tick {row.tick}</span>
          </div>
          <p>Layout version {row.layout_version_number}</p>
          <div className="row-actions">
            <button className="mini strong" onClick={() => void actions.openSession(row.id)}>
              Open
            </button>
          </div>
          {session && view.session === row.id ? <SessionControls /> : null}
        </div>
      ))}
    </>
  );
}
