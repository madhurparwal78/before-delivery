import type { LedgerEntry } from '../../shared/types.js';

const kindName = (kind: string | undefined): string =>
  kind === 'bin_retention_days' ? 'bin retention' : 'grant length';

/** One sentence naming the action and the folders or people involved. */
export const ledgerSentence = (entry: LedgerEntry): string => {
  const detail = entry.detail;
  const file = detail.fileName ?? '';
  const folder = detail.folderName ?? '';
  switch (entry.action) {
    case 'uploaded':
      return `Uploaded ${file} to ${folder}`;
    case 'renamed':
      return `Renamed ${detail.previousName ?? ''} to ${file}`;
    case 'moved':
      return `Moved ${file} from ${detail.fromFolderName ?? ''} to ${detail.toFolderName ?? ''}`;
    case 'locked':
      return `Locked ${file}`;
    case 'unlocked':
      return `Unlocked ${file}`;
    case 'binned':
      return `Moved ${file} to the bin`;
    case 'restored':
      return `Restored ${file} to ${folder}`;
    case 'purged':
      return `Deleted ${file} forever`;
    case 'folder_created':
      return `Created ${folder}`;
    case 'shared':
      return `Shared ${folder} with ${detail.personName ?? ''} as ${detail.role ?? ''} until ${detail.endDate ?? ''}`;
    case 'access_changed':
      return `Changed ${detail.personName ?? ''} to ${detail.role ?? ''} on ${folder} until ${detail.endDate ?? ''}`;
    case 'access_removed':
      return `Removed ${detail.personName ?? ''} from ${folder}`;
    case 'access_ended':
      return `${detail.personName ?? ''}'s ${detail.role ?? ''} access to ${folder} ended on ${detail.endDate ?? ''}`;
    case 'handover_offered':
      return `Offered ${folder} to ${detail.personName ?? ''} until ${detail.endDate ?? ''}`;
    case 'handover_accepted':
      return `${detail.personName ?? ''} accepted ${folder}`;
    case 'handover_declined':
      return `${detail.personName ?? ''} declined ${folder}`;
    case 'handover_lapsed':
      return `The handover of ${folder} lapsed at the end of ${detail.endDate ?? ''}`;
    case 'policy_scheduled':
      return `Scheduled ${kindName(detail.kind)} of ${detail.days ?? 0} days from ${detail.effectiveFrom ?? ''}`;
    case 'policy_withdrawn':
      return `Withdrew the ${kindName(detail.kind)} change from ${detail.effectiveFrom ?? ''}`;
  }
};
