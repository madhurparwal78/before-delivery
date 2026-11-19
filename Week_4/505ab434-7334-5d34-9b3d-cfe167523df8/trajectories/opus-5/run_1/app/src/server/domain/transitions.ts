import { GRANT_STATUS_LABELS, REQUEST_STATE_LABELS, VERSION_STATE_WORDS } from '../../shared/labels.js';
import { errors } from '../errors.js';
import type { AssetState, GrantStatus, RequestState, VersionState } from '../../shared/types.js';

export const OPEN_REQUEST_STATES: RequestState[] = ['draft', 'routed', 'under_review', 'changes_requested'];

export function wrongRequestState(requestId: string, state: RequestState): never {
  throw errors.wrongState(`${requestId} is already ${REQUEST_STATE_LABELS[state]}.`);
}

export function wrongGrantState(grantId: string, status: GrantStatus): never {
  throw errors.wrongState(`${grantId} is ${GRANT_STATUS_LABELS[status]}.`);
}

export function wrongAssetState(assetName: string, state: AssetState): never {
  throw errors.wrongState(`${assetName} is ${state}.`);
}

export function wrongVersionState(versionNumber: number, state: VersionState): never {
  throw errors.wrongState(`Version ${versionNumber} is ${VERSION_STATE_WORDS[state]}.`);
}

export const requestTransitions = {
  canSubmit: (state: RequestState): boolean => state === 'draft' || state === 'changes_requested',
  canWithdraw: (state: RequestState): boolean => OPEN_REQUEST_STATES.includes(state),
  canDecide: (state: RequestState): boolean => state === 'under_review',
  canResubmit: (state: RequestState): boolean => state === 'changes_requested',
};

export const assetTransitions = {
  canRelease: (state: AssetState): boolean => state === 'draft' || state === 'restricted',
  canRestrict: (state: AssetState): boolean => state === 'released',
  canRetire: (state: AssetState): boolean => state === 'released' || state === 'restricted',
};

export const versionTransitions = {
  canEdit: (state: VersionState): boolean => state === 'draft',
  canSubmit: (state: VersionState): boolean => state === 'draft',
  canApprove: (state: VersionState): boolean => state === 'in_review',
  canRequestChanges: (state: VersionState): boolean => state === 'in_review',
  canPublish: (state: VersionState): boolean => state === 'approved',
};

export const OPEN_VERSION_STATES: VersionState[] = ['draft', 'in_review', 'approved'];
