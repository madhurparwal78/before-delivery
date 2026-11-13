import { orderStatusLabel, type OrderStatus } from '../domain/orders.ts';

/** Every published line of copy, rendered character for character. */

export const copy = {
  signInHeading: 'Sign in to Ditchbook',
  signingIn: 'Signing in.',
  badCredentials: 'That email and password do not match.',

  allocation: (remaining: string, allocation: string): string => `${remaining} ML of ${allocation} ML left`,

  placingOrder: 'Placing your order.',
  orderScheduled: (orderNumber: string): string => `Order ${orderNumber} scheduled.`,
  capacityTakenHeading: 'Capacity taken',
  capacityTakenBody: "Another order took the last of this window's capacity. Nothing was debited from your allocation.",
  backToTheOrder: 'Back to the order',
  windowClosed: 'This window has closed.',
  tooEarly: 'Orders open 10 days before a window opens.',
  turnoutBusy: 'This turnout already has an order scheduled or running.',
  allocationError: (remaining: string): string => `More than your remaining allocation of ${remaining} ML.`,
  turnoutLimit: (turnoutCode: string, maxVolume: string): string =>
    `More than ${turnoutCode} can pass in this window: ${maxVolume} ML.`,
  turnoutOffChannel: "Choose one of your turnouts on this window's channel.",
  draftRestored: 'Your session ended. Your order is as you left it. Check it and place it again.',
  restrictedStatusSuffix: (cap: string, remaining: string): string =>
    ` Restricted to ${cap} ML/day, ${remaining} ML left.`,

  orderNowStatus: (orderNumber: string, status: OrderStatus): string =>
    `Order ${orderNumber} is now ${orderStatusLabel(status)}.`,
  orderLapsed: (orderNumber: string): string => `Order ${orderNumber} lapsed when the window closed.`,
  conflictRestriction: 'Moved back by a restriction.',
  conflictLapsed: 'Lapsed when the window closed.',
  rationedFrom: (requested: string): string => `Rationed from ${requested} ML.`,
  askedVolume: (requested: string): string => `Asked ${requested} ML`,

  cancelling: 'Cancelling.',
  orderNowClosed: (orderNumber: string): string => `Order ${orderNumber} is now Closed.`,
  illegalTransition: 'That change is not allowed for this order now.',

  strokeSent: 'Stroke sent. Waiting for the store.',
  waitingForTheStore: 'Waiting for the store',
  strokeStored: (turnoutCode: string, channelFlow: string): string =>
    `Stroke stored for ${turnoutCode}. Flow now ${channelFlow} ML/day.`,
  releasedEarly: 'Released early. Stroke not sent.',
  storeNotAnswering: 'The evidence store is not answering. The stroke will count once it is stored.',
  notHolder: 'This gate card has moved to another operator.',
  windowNotOpen: 'This window is not open yet.',
  cardNowYours: (turnoutCode: string): string => `Gate card for ${turnoutCode} is now yours.`,

  publishingRestriction: 'Publishing restriction.',
  restrictionPublished: (channelName: string, windowLabel: string, movedCount: number): string =>
    `Restriction published for ${channelName}, ${windowLabel}. ${movedCount} orders moved to requested.`,
  restrictionExists: 'This window already has a restriction.',

  rationing: 'Rationing.',
  windowRationed: (scheduledCount: number, leftCount: number): string =>
    `Window rationed. ${scheduledCount} orders scheduled, ${leftCount} left requested.`,
  nothingToRation: 'No requested orders to ration.',
  rationDialogBody: (remaining: string, requestedCount: number): string =>
    `Share ${remaining} ML among ${requestedCount} requested orders in proportion to what each asked for.`,

  updatingOrder: (orderNumber: string): string => `Updating order ${orderNumber}.`,
  windowFullBoard: 'Not enough capacity left in this window.',
  allocationExceeded: 'This grower does not have enough allocation left.',
  notReopenable: 'This order cannot be reopened.',

  handingOver: 'Handing over.',
  cardHandedTo: (turnoutCode: string, operatorCode: string): string =>
    `Gate card for ${turnoutCode} handed to ${operatorCode}.`,
  noSuccessor: 'No standby or rostered operator can take this card.',
  cardNotOpen: 'This gate card is no longer open.',

  saving: 'Saving.',
  revisionSaved: (revision: number): string => `Revision ${revision} saved.`,
  revisionConflict: 'Another dispatcher saved first. Each cap settled to the lower value.',
  savedCapNow: (cap: string): string => `Saved cap now ${cap} ML/day`,
  youTyped: (cap: string): string => `You typed ${cap}`,
  restoring: 'Restoring.',
  revisionRestored: (oldRevision: number, newRevision: number): string =>
    `Revision ${oldRevision} restored as revision ${newRevision}.`,
  restoreBelowCommitted: (oldRevision: number): string =>
    `Restoring revision ${oldRevision} would cut below what is already committed.`,

  storingAndMailing: 'Storing and mailing the pack.',
  packStoredAndMailed: (packNumber: string): string => `Pack ${packNumber} stored and mailed to the regulator.`,
  packStale: 'The records changed since your preview. Preview again before signing.',
  packStalledOnStore: 'The evidence store is not answering. The pack will be stored and mailed when it returns.',
  packStalledOnMail: 'The mail service is not answering. The pack is stored and will be mailed when it returns.',
  withdrawing: 'Withdrawing.',
  packWithdrawn: (packNumber: string): string => `Pack ${packNumber} withdrawn. Nothing was mailed.`,
  packMailed: 'This pack has already been mailed.',
  packDigest: (digest: string): string => `SHA-256 ${digest}`,

  erasing: 'Erasing.',
  contractorErased: (operatorCode: string): string =>
    `Contractor ${operatorCode} erased. Their deliveries now show only the operator code.`,
  alreadyErased: 'This contractor has already been erased.',
  erasedName: (operatorCode: string): string => `Operator ${operatorCode}`,

  packReceived: (packNumber: string): string => `Pack ${packNumber} received from the district.`,

  selectAWindow: 'Select a window',
  pageNotFound: 'Page not found',
} as const;
