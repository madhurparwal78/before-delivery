import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { announce } from './Announcements.tsx';
import type { DriveFile, LedgerEntry, Folder, PathSegment } from '../lib/types.js';
import { formatSize, formatPhoenixTime } from '../lib/format.js';
import { Icon } from './Icon.tsx';
import { useStore } from '../lib/store.js';
import type { Person, Role } from '../lib/types.js';

interface Props {
  file: DriveFile | null;
  folder: Folder | null;
  path: PathSegment[];
  onClose?: () => void;
  onOfferHandover?: (folder: Folder) => void;
  onShare?: (item: Folder | DriveFile) => void;
}

export function DetailsPanel({ file, folder, path, onClose, onOfferHandover, onShare }: Props): preact.JSX.Element {
  const person = useStore(s => s.person)!;
  const services = useStore(s => s.services);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNote, setPreviewNote] = useState<string | null>(null);
  const [activity, setActivity] = useState<LedgerEntry[]>([]);
  const [grants, setGrants] = useState<Array<{ id: string; name: string; role: Role; endDate: string }>>([]);

  const itemName = file?.name ?? folder?.name ?? '';

  useEffect(() => {
    void (async () => {
      setPreviewUrl(null);
      setPreviewNote(null);
      if (file) {
        try {
          const entries = await api.fileActivity(file.id);
          setActivity(entries.entries);
        } catch { setActivity([]); }
        try {
          if (file.previewable) {
            const link = await api.fileLink(file.id, 'preview');
            setPreviewUrl(link.url);
          } else {
            setPreviewNote('No preview for this file type.');
          }
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code === 'storage_unavailable') setPreviewNote('Preview unavailable while file storage is unreachable.');
          else if (code === 'validation') setPreviewNote('No preview for this file type.');
          else setPreviewNote('No preview for this file type.');
        }
      } else if (folder) {
        try {
          const entries = await api.folderActivity(folder.id ?? '');
          setActivity(entries.entries);
        } catch { setActivity([]); }
      }
      if (person.kind === 'staff' && (file || folder) && (file?.access === 'editor' || person.staffRole === 'controller' || person.staffRole === 'admin')) {
        try {
          const itemType = file ? 'file' : 'folder';
          const itemId = file ? file.id : folder!.id;
          if (itemId) {
            const res = await api.grants(itemType, itemId);
            setGrants(res.grants.map(g => ({ id: g.id, name: g.person.name, role: g.role, endDate: g.endDate })));
          }
        } catch { setGrants([]); }
      }
    })();
  }, [file?.id, folder?.id]);

  return (
    <section class="details" aria-label="Details" role="complementary" id="details-panel">
      {onClose && <div style="display:flex;justify-content:flex-end;"><button type="button" class="btn-secondary" onClick={onClose} aria-label="Close details"><Icon name="x" size={14} /></button></div>}
      <h2>{itemName || 'Details'}</h2>
      <dl class="facts">
        <dt>Kind</dt><dd>{file ? 'File' : 'Folder'}</dd>
        {file && <><dt>Size</dt><dd class="mono">{formatSize(file.size)}</dd></>}
        {file && <><dt>Modified</dt><dd class="mono">{formatPhoenixTime(file.modifiedAt)}</dd></>}
        <dt>Location</dt>
        <dd>{path.length > 0 ? path.map(p => p.name).join(' / ') : file?.folderName ?? ''}</dd>
        {folder && <><dt>Owner</dt><dd>{folder.owner.name}</dd></>}
        {file && <><dt>Owner</dt><dd>{path[0]?.name ?? ''}</dd></>}
        {file && <><dt>Lock state</dt><dd>{file.locked ? 'Locked' : 'Unlocked'}</dd></>}
        {file && file.accessEnds && <><dt>Access ends</dt><dd class="mono">{file.accessEnds}</dd></>}
        {(file || folder) && person.kind === 'partner' && <><dt>Access</dt><dd>{(file ?? folder)!.access === 'editor' ? 'Editor' : 'Viewer'}</dd></>}
      </dl>
      <div class="preview-box" role="region" aria-label="Preview">
        {services.storage === 'down' && (file || folder) && (
          <p class="preview-note">Preview unavailable while file storage is unreachable.</p>
        )}
        {services.storage === 'up' && file && previewUrl && file.previewable && file.contentType === 'application/pdf' && (
          <iframe src={previewUrl} title={`${file.name} preview`} />
        )}
        {services.storage === 'up' && file && previewUrl && file.previewable && file.contentType !== 'application/pdf' && (
          <img src={previewUrl} alt={`${file.name} preview`} />
        )}
        {services.storage === 'up' && previewNote && <p class="preview-note">{previewNote}</p>}
        {!file && !folder && <p class="preview-note">Select a file to see its preview.</p>}
      </div>
      {person.kind === 'staff' && grants.length > 0 && (
        <div>
          <h3 style="font-size:12px;margin:0 0 6px;">People with access</h3>
          <ul class="access-list" style="margin-bottom:12px;">
            {grants.map(g => (
              <li key={g.id} class="access-row">
                <span class="who">{g.name}<br /><span class="firm mono">Ends {g.endDate}</span></span>
                <span class="badge role">{g.role === 'editor' ? 'Editor' : 'Viewer'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <h3 style="font-size:12px;margin:0 0 6px;">Activity</h3>
      <ul class="activity" aria-label="Activity">
        {activity.map(entry => (
          <li key={entry.id} class="activity-entry">
            <span class="at">{formatPhoenixTime(entry.at)}</span>
            <span class="sentence">{ledgerSentence(entry, person)}</span>
          </li>
        ))}
        {activity.length === 0 && <li class="preview-note">Nothing yet.</li>}
      </ul>
      <p class="footnote">All dates and times are Phoenix time.</p>
      {folder && person.kind === 'staff' && onOfferHandover && (
        <div style="margin-top:12px;">
          <button type="button" class="btn-secondary" onClick={() => onOfferHandover(folder)}>Hand over</button>
        </div>
      )}
      {(file || folder) && person.kind === 'staff' && onShare && (
        <div style="margin-top:12px;">
          <button type="button" class="btn-secondary" onClick={() => onShare(file ?? folder!)}>Share</button>
        </div>
      )}
    </section>
  );
}

function ledgerSentence(entry: LedgerEntry, viewer: Person): string {
  const actor = entry.actor?.name ?? 'Lintel Drive';
  const detail = entry.detail as Record<string, unknown>;
  const fileName = typeof detail['fileName'] === 'string' ? detail['fileName'] : '';
  const toFolder = typeof detail['toFolder'] === 'string' ? detail['toFolder'] : '';
  const folderName = typeof detail['folderName'] === 'string' ? detail['folderName'] : '';
  const personName = typeof detail['personName'] === 'string' ? detail['personName'] : typeof detail['toName'] === 'string' ? detail['toName'] : '';
  switch (entry.action) {
    case 'uploaded': return `${actor} uploaded ${fileName}.`;
    case 'renamed': return `${actor} renamed a file to ${fileName}.`;
    case 'moved': return `${actor} moved ${fileName} to ${toFolder}.`;
    case 'locked': return `${actor} locked ${fileName}.`;
    case 'unlocked': return `${actor} unlocked ${fileName}.`;
    case 'binned': return `${actor} moved ${fileName} to the bin.`;
    case 'restored': return `${actor} restored ${fileName} to ${toFolder}.`;
    case 'purged': return `${actor === 'Lintel Drive' ? 'Lintel Drive purged' : actor + ' purged'} ${fileName} from the bin.`;
    case 'folder_created': return `${actor} created the folder ${folderName}.`;
    case 'shared': return `${actor} shared this with ${personName}.`;
    case 'access_changed': return `${actor} changed access for ${personName}.`;
    case 'access_removed': return `${actor} removed access for ${personName}.`;
    case 'access_ended': return `Access ended for ${personName}.`;
    case 'handover_offered': return `${actor} offered this folder to ${personName}.`;
    case 'handover_accepted': return `${actor} accepted the handover.`;
    case 'handover_declined': return `${actor} declined the handover.`;
    case 'handover_lapsed': return `The handover offer lapsed.`;
    case 'policy_scheduled': return `${actor} scheduled a policy change.`;
    case 'policy_withdrawn': return `${actor} withdrew a scheduled change.`;
    default: return `${actor} did something.`;
  }
}
