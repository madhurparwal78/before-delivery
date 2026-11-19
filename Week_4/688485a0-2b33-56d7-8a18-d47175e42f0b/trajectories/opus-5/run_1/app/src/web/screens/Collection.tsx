import { useEffect, useState } from 'react';
import {
  ApiFailure,
  IndexAnswer,
  QueryAnswer,
  SavedQueryAnswer,
  SchemaAnswer,
  SessionUser,
  apiGet,
  apiSend,
  collectionPath,
} from '../api';
import {
  READ_ONLY_NOTE,
  indexCreatedText,
  indexErrorText,
  lastRunText,
  queryStatusResult,
  schemaPresenceText,
  schemaTypeText,
} from '../copy';
import { ConfirmDialog } from '../components/Dialog';
import { JsonBlock } from '../components/JsonBlock';
import { PipelinePanel } from '../components/PipelinePanel';
import { DocumentsScreen } from './Documents';
import { NotFoundScreen, ProjectShell, Skeleton } from '../components/Shell';
import { compactJson } from '../../shared/json';
import { DocObject, fromJson } from '../../shared/values';
import { useCollection, useViewport } from '../hooks';
import { useStorageHealth } from '../components/Shell';

interface ScreenProps {
  user: SessionUser | null;
  pid: string;
  cid: string;
}

function Frame({
  user,
  pid,
  cid,
  section,
  children,
}: {
  user: SessionUser | null;
  pid: string;
  cid: string;
  section: 'queries' | 'pipeline' | 'indexes' | 'schema' | 'rules';
  children: (state: ReturnType<typeof useCollection>) => JSX.Element;
}): JSX.Element {
  const collection = useCollection(pid, cid);
  const storage = useStorageHealth(true);
  if (collection.missing) return <NotFoundScreen user={user} />;
  return (
    <ProjectShell
      user={user}
      pid={pid}
      cid={cid}
      section={section}
      projectName={collection.projectName}
      storageDown={storage.storageDown}
    >
      {collection.role === 'reader' ? <p>{READ_ONLY_NOTE}</p> : null}
      {collection.loading ? (
        <div aria-busy="true">
          <Skeleton lines={4} />
        </div>
      ) : (
        children(collection)
      )}
    </ProjectShell>
  );
}

export function PipelineScreen({ user, pid, cid }: ScreenProps): JSX.Element {
  const viewport = useViewport();
  if (viewport === 'phone') {
    return <DocumentsScreen user={user} pid={pid} cid={cid} did={null} section="pipeline" initialTab="Pipeline" />;
  }
  return (
    <Frame user={user} pid={pid} cid={cid} section="pipeline">
      {(collection) => (
        <>
          <h2>Pipeline</h2>
          <PipelinePanel pid={pid} cid={cid} collectionCount={collection.count} />
        </>
      )}
    </Frame>
  );
}

export function IndexesScreen({ user, pid, cid }: ScreenProps): JSX.Element {
  const [indexes, setIndexes] = useState<IndexAnswer[] | null>(null);
  const [keys, setKeys] = useState('');
  const [unique, setUnique] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    void apiGet<{ indexes: IndexAnswer[] }>(`${collectionPath(pid, cid)}/indexes`)
      .then((answer) => setIndexes(answer.indexes))
      .catch(() => setIndexes([]));
  }, [pid, cid, nonce]);

  return (
    <Frame user={user} pid={pid} cid={cid} section="indexes">
      {(collection) => (
        <>
          <h2>Indexes</h2>
          <ul className="row-list" aria-label="Indexes" aria-busy={indexes === null ? 'true' : undefined}>
            {(indexes ?? []).map((index) => (
              <li key={index.name}>
                <span className="count">
                  {index.name} {compactJson(fromJson(index.keys) as DocObject)} {index.unique ? 'unique' : ''}
                </span>{' '}
                {index.name === '_id_' || collection.role !== 'owner' ? null : (
                  <button
                    type="button"
                    aria-label={`Drop ${index.name}`}
                    onClick={async () => {
                      await apiSend('DELETE', `${collectionPath(pid, cid)}/indexes/${index.name}`);
                      setNonce(nonce + 1);
                    }}
                  >
                    Drop
                  </button>
                )}
              </li>
            ))}
          </ul>
          {collection.role === 'owner' ? (
            <>
              <h3>Create an index</h3>
              <div className="field">
                <label htmlFor="index-keys">Index keys</label>
                <input id="index-keys" type="text" value={keys} onChange={(event) => setKeys(event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="index-unique">
                  <input
                    id="index-unique"
                    type="checkbox"
                    checked={unique}
                    onChange={(event) => setUnique(event.target.checked)}
                  />{' '}
                  Unique
                </label>
              </div>
              <div className="field">
                <label htmlFor="index-name">Index name</label>
                <input id="index-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  setStatus('Creating index');
                  let parsed: unknown;
                  try {
                    parsed = JSON.parse(keys.trim().length === 0 ? '{}' : keys) as unknown;
                  } catch {
                    setStatus('Index keys are not valid');
                    return;
                  }
                  try {
                    const answer = await apiSend<{ index: IndexAnswer }>(
                      'POST',
                      `${collectionPath(pid, cid)}/indexes`,
                      { keys: parsed, unique, ...(name.length > 0 ? { name } : {}) },
                    );
                    setStatus(indexCreatedText(answer.index.name));
                    setNonce(nonce + 1);
                  } catch (failure) {
                    if (failure instanceof ApiFailure) setStatus(indexErrorText(failure, collection.validator));
                  }
                }}
              >
                Create index
              </button>
            </>
          ) : null}
          <p role="status" aria-label="Index status">
            {status}
          </p>
        </>
      )}
    </Frame>
  );
}

export function SchemaScreen({ user, pid, cid }: ScreenProps): JSX.Element {
  const [schema, setSchema] = useState<SchemaAnswer | null>(null);

  useEffect(() => {
    void apiGet<SchemaAnswer>(`${collectionPath(pid, cid)}/schema`)
      .then(setSchema)
      .catch(() => setSchema({ sampled: 0, fields: [] }));
  }, [pid, cid]);

  return (
    <Frame user={user} pid={pid} cid={cid} section="schema">
      {() => (
        <>
          <h2>Schema</h2>
          <ul className="row-list" aria-label="Schema fields" aria-busy={schema === null ? 'true' : undefined}>
            {(schema?.fields ?? []).map((field) => (
              <li key={field.path} className="schema-row" data-field-path={field.path} data-present={field.present}>
                <strong>{field.path}</strong>
                <div>{schemaPresenceText(field.present)}</div>
                <div className="schema-bar">
                  {field.types.map((type, position) => (
                    <span
                      key={type.type}
                      className={position % 2 === 0 ? 'schema-seg odd' : 'schema-seg even'}
                      data-type={type.type}
                      data-share={type.share}
                      style={{ width: `${type.share}%` }}
                    >
                      {schemaTypeText(type.type, type.share)}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Frame>
  );
}

export function RulesScreen({ user, pid, cid }: ScreenProps): JSX.Element {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void apiGet<{ validator: unknown }>(`${collectionPath(pid, cid)}/validator`)
      .then((answer) => {
        setText(answer.validator === null ? '' : JSON.stringify(answer.validator, null, 2));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [pid, cid]);

  return (
    <Frame user={user} pid={pid} cid={cid} section="rules">
      {(collection) => (
        <>
          <h2>Rules</h2>
          <label htmlFor="validator-json">Validator JSON</label>
          <textarea
            id="validator-json"
            className="code"
            aria-label="Validator JSON"
            readOnly={collection.role !== 'owner'}
            spellCheck={false}
            rows={12}
            value={text}
            aria-busy={loaded ? undefined : 'true'}
            onChange={(event) => setText(event.target.value)}
          />
          {collection.role === 'owner' ? (
            <button
              type="button"
              className="primary"
              onClick={async () => {
                let parsed: unknown = null;
                if (text.trim().length > 0) {
                  try {
                    parsed = JSON.parse(text) as unknown;
                  } catch {
                    setStatus('Rules are not valid');
                    return;
                  }
                }
                try {
                  await apiSend('PUT', `${collectionPath(pid, cid)}/validator`, { validator: parsed });
                  setStatus('Rules saved');
                  collection.reload();
                } catch {
                  setStatus('Rules are not valid');
                }
              }}
            >
              Save rules
            </button>
          ) : null}
          <p role="status" aria-label="Rules status">
            {status}
          </p>
        </>
      )}
    </Frame>
  );
}

export function SavedQueriesScreen({ user, pid, cid }: ScreenProps): JSX.Element {
  const [queries, setQueries] = useState<SavedQueryAnswer[] | null>(null);
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState<SavedQueryAnswer | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    void apiGet<{ saved_queries: SavedQueryAnswer[] }>(`${collectionPath(pid, cid)}/saved-queries`)
      .then((answer) => setQueries(answer.saved_queries))
      .catch(() => setQueries([]));
  }, [pid, cid, nonce]);

  return (
    <Frame user={user} pid={pid} cid={cid} section="queries">
      {(collection) => (
        <>
          <h2>Saved queries</h2>
          <ul className="row-list" aria-label="Saved queries" aria-busy={queries === null ? 'true' : undefined}>
            {(queries ?? []).map((saved) => (
              <li key={saved.id}>
                <strong>{saved.name}</strong>
                <JsonBlock text={compactJson(fromJson(saved.filter) as DocObject)} />
                <div className="count">{lastRunText(saved.last_run_at, saved.last_count)}</div>
                <div className="inline">
                  <button
                    type="button"
                    aria-label={`Run ${saved.name}`}
                    onClick={async () => {
                      const answer = await apiSend<QueryAnswer>(
                        'POST',
                        `${collectionPath(pid, cid)}/saved-queries/${saved.id}/run`,
                        { page: 1 },
                      );
                      setStatus(queryStatusResult(answer.matched, answer.documents.length));
                      setNonce(nonce + 1);
                    }}
                  >
                    Run
                  </button>
                  {collection.role === 'reader' ? null : (
                    <button type="button" aria-label={`Delete ${saved.name}`} onClick={() => setConfirming(saved)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div role="status" aria-label="Query status">
            {status}
          </div>
          {confirming ? (
            <ConfirmDialog
              label={`Delete ${confirming.name}?`}
              confirmLabel="Delete"
              onCancel={() => setConfirming(null)}
              onConfirm={async () => {
                await apiSend('DELETE', `${collectionPath(pid, cid)}/saved-queries/${confirming.id}`);
                setConfirming(null);
                setNonce(nonce + 1);
              }}
            />
          ) : null}
        </>
      )}
    </Frame>
  );
}
