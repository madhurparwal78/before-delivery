import { useEffect, useState } from 'react';
import type { FileItem, Folder, Grant, LedgerEntry, Person } from '../../shared/types.js';
import { api } from '../lib/api.js';
import {
  PHOENIX_FOOTNOTE,
  PREVIEW_OUTAGE,
  PREVIEW_UNSUPPORTED,
  daysLeftText,
} from '../../shared/copy.js';
import { formatDateTime, formatSize } from '../lib/format.js';
import { ledgerSentence } from '../lib/sentences.js';
import { useGlobal } from '../lib/store.js';

export type DetailsItem =
  | { kind: 'file'; file: FileItem }
  | { kind: 'folder'; folder: Folder };

interface DetailsProps {
  person: Person;
  item: DetailsItem | null;
  ownerName: string;
  onHandover: (folder: Folder) => void;
  refreshToken: number;
}

const Preview = ({ file }: { file: FileItem }): JSX.Element => {
  const storage = useGlobal((state) => state.status.storage);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setUrl(null);
    setFailed(false);
    if (storage === 'down' || !file.previewable) return;
    let live = true;
    void api
      .link(file.id, 'preview')
      .then((link) => {
        if (live) setUrl(link.url);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [file.id, file.previewable, storage]);

  const body = (): JSX.Element | string => {
    if (storage === 'down') return PREVIEW_OUTAGE;
    if (!file.previewable) return PREVIEW_UNSUPPORTED;
    if (failed) return PREVIEW_OUTAGE;
    if (url === null) return '';
    if (file.contentType === 'application/pdf') {
      return (
        <object type="application/pdf" data={url} aria-label={`Preview of ${file.name}`}>
          <p>{file.name}</p>
        </object>
      );
    }
    return <img src={url} alt={`Preview of ${file.name}`} />;
  };

  return (
    <section aria-label="Preview" className="preview">
      {body()}
    </section>
  );
};

export const DetailsBody = ({
  person,
  item,
  ownerName,
  onHandover,
  refreshToken,
}: DetailsProps): JSX.Element => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);

  useEffect(() => {
    if (item === null) {
      setEntries([]);
      setGrants([]);
      return;
    }
    let live = true;
    const load = async (): Promise<void> => {
      const activity =
        item.kind === 'file'
          ? await api.fileActivity(item.file.id)
          : await api.folderActivity(item.folder.id);
      if (live) setEntries(activity.entries);
      if (person.kind === 'staff') {
        const found = await api.grants(
          item.kind === 'file' ? 'file' : 'folder',
          item.kind === 'file' ? item.file.id : item.folder.id,
        );
        if (live) setGrants(found.grants);
      }
    };
    void load().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [item, person.kind, refreshToken]);

  if (item === null) {
    return (
      <>
        <h2>Details</h2>
        <p>Select an item to see its details.</p>
      </>
    );
  }

  const isProject =
    item.kind === 'folder' && item.folder.parentId === null && item.folder.projectId === item.folder.id;

  return (
    <>
      <h2>{item.kind === 'file' ? item.file.name : item.folder.name}</h2>
      <dl className="facts">
        <div>
          <dt>Kind</dt>
          <dd>{item.kind === 'file' ? item.file.contentType : 'Folder'}</dd>
        </div>
        {item.kind === 'file' ? (
          <>
            <div>
              <dt>Size</dt>
              <dd className="num">{formatSize(item.file.size)}</dd>
            </div>
            <div>
              <dt>Modified</dt>
              <dd className="num">{formatDateTime(item.file.modifiedAt)}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>{item.file.folderName}</dd>
            </div>
            <div>
              <dt>Lock state</dt>
              <dd>{item.file.locked ? 'Locked' : 'Unlocked'}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Files</dt>
            <dd className="num">{item.folder.fileCount}</dd>
          </div>
        )}
        <div>
          <dt>Owner</dt>
          <dd>{item.kind === 'file' ? ownerName : item.folder.owner.name}</dd>
        </div>
        {person.kind === 'partner' && item.kind === 'file' && item.file.accessEnds !== null ? (
          <div>
            <dt>Access ends</dt>
            <dd className="num">{item.file.accessEnds}</dd>
          </div>
        ) : null}
      </dl>
      {isProject && person.kind === 'staff' ? (
        <button type="button" onClick={() => onHandover(item.folder)}>
          Hand over
        </button>
      ) : null}
      {item.kind === 'file' ? <Preview file={item.file} /> : null}
      {person.kind === 'staff' ? (
        <section>
          <h3>People with access</h3>
          <ul className="access-list">
            {grants.map((grant) => (
              <li key={grant.id}>
                <span>
                  {grant.person.name} — {grant.person.firm}
                </span>
                <span className="num">
                  {grant.role} · Ends {grant.endDate} · {daysLeftText(grant.daysLeft)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h3>Activity</h3>
        <ul className="activity" aria-label="Activity">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="num">{formatDateTime(entry.at)}</span>
              <span>{entry.actor === null ? 'Lintel Drive' : entry.actor.name}</span>
              <span>{ledgerSentence(entry)}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="num" style={{ color: 'var(--muted)' }}>
        {PHOENIX_FOOTNOTE}
      </p>
    </>
  );
};
