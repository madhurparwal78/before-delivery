import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  COPY,
  memberAdded,
  memberLimit,
  settingsSaved,
  worldRenamed,
  worldRestored,
} from '../../shared/copy.js';
import { TIME_ZONES } from '../../shared/domain.js';
import type { MailRow, SaveRow, ServerObject, TableObject, WorldObject } from '../../shared/types.js';
import { ApiFailure, get, getWithEtag, patch, post } from '../api.js';
import { Link } from '../router.js';
import { Dialog, FieldError, Status } from '../ui.js';

interface Friend {
  handle: string;
  display_name: string;
  online: boolean;
}

interface WorldBlock {
  readonly world: { slug: string; name: string };
  readonly saves: SaveRow[];
}

export function AdminPage({
  slug,
  server,
}: {
  slug: string;
  server: ServerObject | null;
}): ReactNode {
  const [status, setStatus] = useState('');
  const [handle, setHandle] = useState('');
  const [handleError, setHandleError] = useState('');
  const [members, setMembers] = useState<Friend[]>([]);
  const [tables, setTables] = useState<TableObject[]>([]);
  const [worlds, setWorlds] = useState<WorldBlock[]>([]);
  const [mail, setMail] = useState<MailRow[]>([]);
  const [purchases, setPurchases] = useState<
    { id: string; character: string; pack: string }[]
  >([]);
  const [timeZone, setTimeZone] = useState('UTC');
  const [exportId, setExportId] = useState<string | null>(null);
  const [settingsFor, setSettingsFor] = useState<TableObject | null>(null);

  const [loaded, setLoaded] = useState(false);

  // Every section's records are read together and applied in one render, so the page never
  // shifts under a control after it first appears.
  const reload = useCallback(async () => {
    const [friends, outgoing, serverRecord, bought] = await Promise.all([
      get<{ friends: Friend[] }>(`/api/servers/${slug}/friends`),
      get<{ mail: MailRow[] }>(`/api/servers/${slug}/mail`),
      get<ServerObject>(`/api/servers/${slug}`),
      get<{ purchases: { id: string; character_id: string; pack: string }[] }>(
        `/api/servers/${slug}/coin-purchases`,
      ),
    ]);
    const perWorld = await Promise.all(
      serverRecord.worlds.map(async (world) => {
        const [record, saves] = await Promise.all([
          get<WorldObject>(`/api/servers/${slug}/worlds/${world.slug}`),
          get<{ saves: SaveRow[] }>(`/api/servers/${slug}/worlds/${world.slug}/saves`),
        ]);
        const worldTables = await Promise.all(
          record.tables.map((table) => get<TableObject>(`/api/tables/${table.id}`)),
        );
        return { block: { world: { slug: world.slug, name: record.name }, saves: saves.saves }, worldTables };
      }),
    );
    const named = await Promise.all(
      bought.purchases.map(async (purchase) => {
        const character = await get<{ name: string }>(`/api/characters/${purchase.character_id}`);
        return { id: purchase.id, character: character.name, pack: purchase.pack };
      }),
    );
    setMembers(friends.friends);
    setMail(outgoing.mail);
    setTimeZone(serverRecord.time_zone);
    setWorlds(perWorld.map((entry) => entry.block));
    setTables(perWorld.flatMap((entry) => entry.worldTables));
    setPurchases(named);
    setLoaded(true);
  }, [slug]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const membersSection = (
    <section className="card">
      <h2>Members</h2>
      <div>
        <label htmlFor="member-handle">Member handle</label>
        <input
          id="member-handle"
          type="text"
          aria-label="Member handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
        />
        <FieldError id="member-handle-error" message={handleError} />
      </div>
      <button
        type="button"
        className="primary"
        onClick={() => {
          setHandleError('');
          void post(`/api/servers/${slug}/members`, { handle })
            .then(async () => {
              setStatus(memberAdded(handle));
              setHandle('');
              await reload();
            })
            .catch((error: unknown) => {
              if (!(error instanceof ApiFailure)) return;
              if (error.code === 'validation') {
                setHandleError(error.fields.handle ?? error.message);
                setStatus(error.fields.handle ?? error.message);
              } else if (error.code === 'unknown_handle') {
                setStatus(COPY.membersUnknownHandle);
              } else if (error.code === 'member_limit_reached') {
                setStatus(
                  server === null ? error.message : memberLimit(limitFor(server)),
                );
              } else {
                setStatus(error.message);
              }
            });
        }}
      >
        Add member
      </button>
      <ul aria-label="Members">
        {members.map((member) => (
          <li key={member.handle}>
            {`${member.display_name} (${member.handle}): `}
            <span className="status-word">{member.online ? 'ONLINE' : 'OFFLINE'}</span>
          </li>
        ))}
      </ul>
    </section>
  );

  const tablesSection = (
    <section className="card">
      <h2>Tables</h2>
      <ul>
        {tables.map((table) => (
          <li key={table.id}>
            <span>{table.name}</span>{' '}
            <span className="mono">{`stake ${table.stake}, clock ${table.turn_seconds}s`}</span>{' '}
            <button type="button" onClick={() => setSettingsFor(table)}>
              {`Settings for ${table.name}`}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  const exportSection = (
    <section className="card">
      <h2>Export</h2>
      <button
        type="button"
        onClick={() => {
          void post<{ export: { id: string } }>(`/api/servers/${slug}/exports`, {})
            .then((answer) => {
              setExportId(answer.export.id);
              setStatus(COPY.exportReady);
            })
            .catch((error: unknown) => {
              if (error instanceof ApiFailure) {
                setStatus(
                  error.code === 'storage_unavailable' ? COPY.exportNotWritten : error.message,
                );
              }
            });
        }}
      >
        Export worlds
      </button>
      {exportId !== null ? (
        <p>
          <a href={`/api/servers/${slug}/exports/${exportId}`} download>
            Download export
          </a>
        </p>
      ) : null}
    </section>
  );

  const settingsSection = (
    <section className="card">
      <h2>Server settings</h2>
      <label htmlFor="time-zone">Time zone</label>
      <select
        id="time-zone"
        aria-label="Time zone"
        value={timeZone}
        onChange={(event) => setTimeZone(event.target.value)}
      >
        {TIME_ZONES.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          void getWithEtag<ServerObject>(`/api/servers/${slug}`)
            .then((read) => patch(`/api/servers/${slug}`, { time_zone: timeZone }, read.etag))
            .then(() => setStatus(COPY.timeZoneSaved))
            .catch((error: unknown) => {
              if (error instanceof ApiFailure) {
                setStatus(error.code === 'precondition_failed' ? COPY.staleVersion : error.message);
              }
            });
        }}
      >
        Save time zone
      </button>
    </section>
  );

  const worldsSection = (
    <section className="card">
      <h2>Worlds</h2>
      {worlds.map((block) => (
        <WorldAdminBlock
          key={block.world.slug}
          slug={slug}
          block={block}
          onStatus={setStatus}
          onReload={reload}
        />
      ))}
    </section>
  );

  const purchasesSection = (
    <section className="card">
      <h2>Coin purchases</h2>
      <ul aria-label="Coin purchases">
        {purchases.map((purchase) => (
          <li key={purchase.id}>
            <Link to={`/s/${slug}/coins/${purchase.id}`}>
              {`${purchase.character}: ${packName(purchase.pack)}`}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

  const mailSection = (
    <section className="card">
      <h2>Outgoing mail</h2>
      <ul aria-label="Outgoing mail">
        {mail.map((row) => (
          <li key={row.id}>
            {`${row.subject} to ${row.to_handle}: `}
            <span className="status-word">{row.state === 'sent' ? 'SENT' : 'HELD'}</span>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="page">
      <h1>Server admin</h1>
      {loaded ? (
      <div className="admin-grid">
        <div className="stack">
          {membersSection}
          {tablesSection}
          {exportSection}
          {settingsSection}
        </div>
        <div className="stack">
          {worldsSection}
          {purchasesSection}
          {mailSection}
        </div>
      </div>
      ) : (
        <p className="loading">Loading server admin</p>
      )}
      <Status name="Admin status" text={status} />
      {settingsFor !== null ? (
        <TableSettingsDialog
          table={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={async (name) => {
            setStatus(settingsSaved(name));
            setSettingsFor(null);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}

const limitFor = (server: ServerObject): number => (server.plan === 'borough' ? 20 : 6);

const PACK_NAMES: Readonly<Record<string, string>> = {
  pouch: 'Pouch',
  satchel: 'Satchel',
  chest: 'Chest',
};
const packName = (pack: string): string => PACK_NAMES[pack] ?? pack;

function WorldAdminBlock({
  slug,
  block,
  onStatus,
  onReload,
}: {
  slug: string;
  block: WorldBlock;
  onStatus: (text: string) => void;
  onReload: () => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(block.world.name);

  return (
    <div role="region" aria-label={block.world.name}>
      <h3>{block.world.name}</h3>
      <label htmlFor={`world-name-${block.world.slug}`}>World name</label>
      <input
        id={`world-name-${block.world.slug}`}
        type="text"
        aria-label="World name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <div className="row">
        <button
          type="button"
          onClick={() => {
            void getWithEtag<WorldObject>(`/api/servers/${slug}/worlds/${block.world.slug}`)
              .then((read) =>
                patch(`/api/servers/${slug}/worlds/${block.world.slug}`, { name }, read.etag),
              )
              .then(async () => {
                onStatus(worldRenamed(name));
                await onReload();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  onStatus(
                    error.code === 'precondition_failed' ? COPY.staleVersion : error.message,
                  );
                }
              });
          }}
        >
          Rename world
        </button>
        <button
          type="button"
          onClick={() => {
            onStatus(COPY.saving);
            void post(`/api/servers/${slug}/worlds/${block.world.slug}/saves`, {})
              .then(async () => {
                onStatus(COPY.saved);
                await onReload();
              })
              .catch((error: unknown) => {
                if (error instanceof ApiFailure) {
                  onStatus(
                    error.code === 'storage_unavailable' ? COPY.saveNotWritten : error.message,
                  );
                }
              });
          }}
        >
          Save world
        </button>
      </div>
      <ul aria-label="Saves">
        {block.saves.map((save) => (
          <li key={save.id}>
            <span className="mono">{`Save ${save.number}`}</span>{' '}
            <button
              type="button"
              onClick={() => {
                void post(`/api/servers/${slug}/worlds/${block.world.slug}/restore`, {
                  save_id: save.id,
                })
                  .then(async () => {
                    onStatus(worldRestored(save.number));
                    await onReload();
                  })
                  .catch((error: unknown) => {
                    if (error instanceof ApiFailure) {
                      onStatus(
                        error.code === 'storage_unavailable'
                          ? COPY.restoreFailed
                          : error.message,
                      );
                    }
                  });
              }}
            >
              {`Restore save ${save.number}`}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SETTINGS_STEPS = ['Stake', 'Turn clock'] as const;

function TableSettingsDialog({
  table,
  onClose,
  onSaved,
}: {
  table: TableObject;
  onClose: () => void;
  onSaved: (name: string) => Promise<void>;
}): ReactNode {
  const [step, setStep] = useState(1);
  const [stake, setStake] = useState(table.stake);
  const [turnSeconds, setTurnSeconds] = useState(table.turn_seconds);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  /* Save settings sends the change with the If-Match read when it opened. */
  const etag = useRef<string | null>(null);

  useEffect(() => {
    void getWithEtag<TableObject>(`/api/tables/${table.id}`).then((read) => {
      etag.current = read.etag;
    });
  }, [table.id]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  return (
    <Dialog label="Table settings" onClose={onClose}>
      <h2 tabIndex={-1} ref={heading}>
        {`Step ${step} of 2: ${SETTINGS_STEPS[step - 1]}`}
      </h2>
      {step === 1 ? (
        <div>
          <label htmlFor="stake">Stake</label>
          <input
            id="stake"
            type="number"
            aria-label="Stake"
            value={stake}
            onChange={(event) => setStake(Number(event.target.value))}
          />
        </div>
      ) : (
        <div>
          <label htmlFor="turn-clock">Turn clock seconds</label>
          <input
            id="turn-clock"
            type="number"
            aria-label="Turn clock seconds"
            value={turnSeconds}
            onChange={(event) => setTurnSeconds(Number(event.target.value))}
          />
        </div>
      )}
      <FieldError id="table-settings-error" message={error} />
      <div className="steps">
        {step > 1 ? (
          <button type="button" onClick={() => setStep(step - 1)}>
            Back
          </button>
        ) : null}
        {step < 2 ? (
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (!Number.isInteger(stake) || stake < 0 || stake > 100) {
                setError('Use a whole number of coins from 0 to 100.');
                return;
              }
              setError('');
              setStep(2);
            }}
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (!Number.isInteger(turnSeconds) || turnSeconds < 5 || turnSeconds > 120) {
                setError('Use 5 to 120 seconds.');
                return;
              }
              setError('');
              void patch(
                `/api/tables/${table.id}`,
                { stake, turn_seconds: turnSeconds },
                etag.current,
              )
                .then(() => onSaved(table.name))
                .catch((error_: unknown) => {
                  if (error_ instanceof ApiFailure) {
                    setError(
                      error_.code === 'table_in_use'
                        ? COPY.tableInUse
                        : error_.code === 'precondition_failed'
                          ? COPY.staleVersion
                          : Object.values(error_.fields).join(' ') || error_.message,
                    );
                  }
                });
            }}
          >
            Save settings
          </button>
        )}
      </div>
    </Dialog>
  );
}
