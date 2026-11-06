/** Every published focus target, decided in this one place. */
export const focusIds = {
  handle: (placementId: string): string => `handle-${placementId}`,
  cardTitle: (objectId: string): string => `card-title-${objectId}`,
  cardAction: (objectId: string, action: string): string => `action-${action}-${objectId}`,
  photoInput: (objectId: string): string => `photo-input-${objectId}`,
  wallLuxSave: (wallId: string): string => `save-lux-${wallId}`,
  errorSummary: (form: string): string => `error-summary-${form}`,
  undoButton: 'undo-button',
  sceneLedgerHeading: 'scene-ledger-heading',
  previewHeading: 'lender-preview-heading',
  previewDate: 'preview-date',
  mainHeading: 'main-heading',
  databaseRetry: 'database-retry',
};

export type FocusAction =
  | { after: 'place-saved'; placementId: string }
  | { after: 'form-rejected'; form: string }
  | { after: 'details-closed'; placementId: string }
  | { after: 'removed' }
  | { after: 'undo-accepted'; placementId: string }
  | { after: 'undo-refused' }
  | { after: 'toast-closed' }
  | { after: 'claim-won'; objectId: string }
  | { after: 'claim-lost'; objectId: string }
  | { after: 'released'; objectId: string }
  | { after: 'card-settled'; objectId: string }
  | { after: 'object-saved' }
  | { after: 'preview-settled' }
  | { after: 'preview-date-rejected' }
  | { after: 'database-recovered' };

export function focusTargetFor(action: FocusAction): string {
  switch (action.after) {
    case 'place-saved':
      return focusIds.handle(action.placementId);
    case 'form-rejected':
      return focusIds.errorSummary(action.form);
    case 'details-closed':
      return focusIds.handle(action.placementId);
    case 'removed':
      return focusIds.undoButton;
    case 'undo-accepted':
      return focusIds.handle(action.placementId);
    case 'undo-refused':
    case 'toast-closed':
      return focusIds.sceneLedgerHeading;
    case 'claim-won':
      return focusIds.cardAction(action.objectId, 'hang');
    case 'claim-lost':
    case 'card-settled':
      return focusIds.cardTitle(action.objectId);
    case 'released':
      return focusIds.cardAction(action.objectId, 'claim');
    case 'object-saved':
    case 'database-recovered':
      return focusIds.mainHeading;
    case 'preview-settled':
      return focusIds.previewHeading;
    case 'preview-date-rejected':
      return focusIds.previewDate;
  }
}
