import { MemberRole, SeasonState } from './workbook';

export type EndpointAction =
  | 'readWorkbooks'
  | 'readStation'
  | 'ownConflicts'
  | 'createWorkbooks'
  | 'seasonManage'
  | 'archive'
  | 'versions'
  | 'restoreVersion'
  | 'exports'
  | 'shareLinks'
  | 'stationManage';

const ENDPOINT_ROLES: Record<EndpointAction, MemberRole[]> = {
  readWorkbooks: ['viewer', 'technician', 'lead', 'data_manager'],
  readStation: ['viewer', 'technician', 'lead', 'data_manager'],
  ownConflicts: ['viewer', 'technician', 'lead', 'data_manager'],
  createWorkbooks: ['lead', 'data_manager'],
  seasonManage: ['lead', 'data_manager'],
  archive: ['data_manager'],
  versions: ['lead', 'data_manager'],
  restoreVersion: ['data_manager'],
  exports: ['lead', 'data_manager'],
  shareLinks: ['data_manager'],
  stationManage: ['data_manager'],
};

export function roleCan(role: MemberRole, action: EndpointAction): boolean {
  return ENDPOINT_ROLES[action].includes(role);
}

/** `setCell` and `setFormat`, per the role table's season states. */
export function canEditCells(role: MemberRole, state: SeasonState): boolean {
  switch (role) {
    case 'viewer':
      return false;
    case 'technician':
      return state === 'in_season';
    case 'lead':
    case 'data_manager':
      return state === 'draft' || state === 'in_season';
  }
}

/** `addSheet`, `renameSheet`, `addChart` and `removeChart`. */
export function canEditStructure(role: MemberRole, state: SeasonState): boolean {
  if (role !== 'lead' && role !== 'data_manager') return false;
  return state === 'draft' || state === 'in_season';
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  viewer: 'Viewer',
  technician: 'Technician',
  lead: 'Trial lead',
  data_manager: 'Data manager',
};
