/**
 * Every published string, character for character. Server and browser both read
 * them from here so that one string has one source.
 */

export const COPY = {
  signInPending: 'Signing in',
  signInWrong: 'Handle or passcode is wrong.',

  joinPending: 'Joining server',
  joinUsed: 'This invite link has already been used.',
  joinExpired: 'This invite link has expired. Ask for a new invite.',
  joinSuperseded: 'This invite link was replaced by a newer invite. Use the latest email.',
  joinEmailInUse: 'An account already uses this email. Ask the owner to add you by handle.',

  checkoutPending: 'Renting server',
  checkoutOutage:
    'The billing provider is unreachable, so no server was created. Try again in a minute.',

  billingWaitingConfirm: 'Waiting for the billing provider to confirm payment.',
  billingConfirmed: 'Payment confirmed by the billing provider.',
  billingNotConfirmedYet:
    'The billing provider has not confirmed the payment yet. This page checks again every 10 seconds.',
  billingSuspended: 'Suspended until the billing provider confirms payment.',
  billingPaymentSent: 'Payment sent to the billing provider. Waiting for confirmation.',
  billingAsking: 'Asking the billing provider to take the payment.',
  billingNothingDue: 'There is nothing to pay.',
  billingPaymentPending: 'A payment is already waiting for the billing provider.',
  billingSamePlan: 'The server is already on that plan.',
  billingPlanChangePending: 'A plan change is already waiting for payment.',
  billingServerNotActive: 'Plans can change only while the server is active.',
  billingStatementOutage:
    'The billing provider is unreachable, so no statement was made. Try again in a minute.',
  billingOutage:
    'The billing provider is unreachable. Nothing was charged or changed. Showing the last confirmed status.',

  refusalSuspended:
    'This server is suspended. Play and saves resume once the billing provider confirms payment.',
  refusalInactive: 'This server is waiting for its first payment to be confirmed.',
  tableSuspended: 'This server is suspended. Play is paused until the invoice is paid.',

  membersUnknownHandle: 'No player has that handle.',

  staleVersion: 'This changed since you opened it. The latest version is now shown.',

  rosterFull: 'You already have the most characters allowed on this server.',
  appearanceSaved: 'Appearance saved',

  tableInUse: 'Settings can change only while no one is seated.',
  timeZoneSaved: 'Time zone saved',

  saving: 'Saving world',
  saved: 'World saved',
  saveNotWritten:
    'Save not written. Storage is unreachable, so nothing was saved and your world is unchanged. Try again in a minute.',
  restoreFailed: 'Restore failed. Storage is unreachable, so the world is unchanged.',
  exportReady: 'Export ready',
  exportNotWritten: 'Export not written. Storage is unreachable. Try again in a minute.',

  blocked: "You can't walk there.",
  tooFar: 'Too far away. Stand next to that tile first.',
  notBuildable: 'You can only build on grass or sand.',
  tileTaken: 'That tile is taken.',
  noBlock: 'There is no block there.',
  inventoryFull: 'Inventory full. Make room first.',

  parkingCancelled: 'Parking cancelled',
  notARoad: 'Not a road',
  notARunway: 'Not a runway',
  carWrongSurface: 'Cars park only on road tiles.',
  planeWrongSurface: 'Planes park only on runway tiles.',
  noRoute: 'No road leads there.',
  weatherGrounded: 'Planes are grounded during the storm.',

  tableFull: 'This table is full. You can watch from the spectator ring.',
  standUpInPlay: "You can't stand up during a game. Forfeit first.",
  standUpNotSettled: 'You can stand up once the coins have settled.',
  fullScreenUnavailable: 'Full screen is not available here.',

  staleTurn: 'That move came too late; the board has changed.',
  turnExpired: 'Time ran out before your move arrived.',
  resultNotStored: 'Result not stored yet. Coins will settle once storage is back.',
  rematchStarted: 'Rematch started',

  inviteHeld: 'Invite held: mail is down',

  receiptHeld: 'Receipt held: mail is down',
  coinsSpent: "Some of these coins are spent, so this purchase can't be refunded.",
  alreadyRefunded: 'This purchase is already refunded.',
  dailyLimitReached: "You've made 5 purchases today. Try again after midnight server time.",
  coinsOutage: 'The billing provider is unreachable, so nothing was charged. Try again in a minute.',

  offerUpdated: 'Offer updated',
  tradeChanged: 'Trade changed. Both players must accept again.',
  acceptExpired: 'Accept expired. Press Accept again.',
  tradeComplete: 'Trade complete',
  tradeCancelled: 'Trade cancelled',
  tradeInventoryFull:
    'Trade could not complete: an inventory is full. Both players must accept again.',

  moveCancelled: 'Move cancelled',

  emptyLeaderboard: 'No wins yet this season.',

  weatherClear: 'Weather: clear',
  weatherRain: 'Weather: rain',
  weatherStorm: 'Weather: storm. Planes are grounded.',

  notFound: "We couldn't find that page.",
} as const;

export const FIELD_COPY = {
  handleRequired: 'Enter a handle.',
  handleTooLong: 'Use at most 24 characters.',
  handleFormat: 'Use 3 to 24 lower-case letters, digits or hyphens.',
  handleTaken: 'That handle is taken.',

  passcodeRequired: 'Enter your passcode.',
  passcodeTooLong: 'Use at most 64 characters.',
  passcodeTooShort: 'Use at least 8 characters.',

  displayNameRequired: 'Enter a display name.',
  displayNameTooLong: 'Use at most 40 characters.',

  emailRequired: 'Enter an email address.',
  emailTooLong: 'Use at most 254 characters, with at most 64 before the @.',
  emailFormat: 'Enter an email address like name@example.com.',

  serverNameRequired: 'Enter a server name.',
  serverNameTooLong: 'Use at most 40 characters.',
  serverNameFormat: 'Use 3 to 40 letters, digits, spaces or hyphens.',
  serverNameTaken: 'That server name is taken.',

  planRequired: 'Choose a plan.',

  characterNameRequired: 'Enter a name.',
  characterNameTooLong: 'Use at most 20 characters.',
  characterNameFormat: 'Use 2 to 20 letters, digits, spaces or hyphens.',
  characterNameTaken: 'That character name is taken on this server.',

  appearanceRequired: 'Choose an appearance.',
  loadoutTooMany: 'Choose at most 3 items.',

  worldNameRequired: 'Enter a world name.',
  worldNameTooLong: 'Use at most 40 characters.',

  partyNameRequired: 'Enter a party name.',
  partyNameTooLong: 'Use at most 30 characters.',

  messageRequired: 'Write a message.',
  messageTooLong: 'Use at most 280 characters.',

  stake: 'Use a whole number of coins from 0 to 100.',
  turnSeconds: 'Use 5 to 120 seconds.',
  timeZone: 'Choose a time zone from the list.',

  coinPackRequired: 'Choose a coin pack.',
  coinCharacterRequired: 'Choose a character.',
  partnerRequired: 'Choose a player to trade with.',

  unknownField: 'Unknown field.',
} as const;

/* Parameterised published copy. */

export const already_member = (handle: string): string => `${handle} is already a member.`;
export const memberLimit = (limit: number): string =>
  `This server's plan allows ${limit} members.`;
export const characterLimit = (limit: number): string =>
  `This server's plan allows ${limit} characters.`;
export const memberAdded = (handle: string): string => `${handle} added to the server`;
export const characterCreated = (name: string): string => `Character created: ${name}`;
export const settingsSaved = (table: string): string => `Settings saved for ${table}`;
export const worldRenamed = (name: string): string => `World renamed to ${name}`;
export const worldRestored = (n: number): string => `World restored from save ${n}`;
export const movedTo = (x: number, y: number): string => `Moved to ${x}, ${y}`;
export const placedBlock = (material: string, x: number, y: number): string =>
  `Placed ${material} block at ${x}, ${y}`;
export const brokeBlock = (material: string, x: number, y: number): string =>
  `Broke ${material} block at ${x}, ${y}`;
export const noBlockInInventory = (material: string): string =>
  `You have no ${material} block in your inventory.`;
export const parkingPrompt = (vehicle: string, surface: 'road' | 'runway'): string =>
  `Parking ${vehicle}. Choose a ${surface} tile.`;
export const parked = (vehicle: string, surface: 'road' | 'runway', x: number, y: number): string =>
  `${vehicle} parked on ${surface} at ${x}, ${y}`;
export const newLeader = (name: string): string => `${name} now leads the party.`;
export const checkpointReached = (name: string): string => `Checkpoint reached: ${name}`;
export const checkpointWaiting = (name: string): string =>
  `Checkpoint reached: ${name}. Not saved yet; it will be saved when storage is back.`;
export const chapterComplete = (title: string): string => `Chapter complete: ${title}`;
export const seated = (table: string, seatLabel: string): string =>
  `You sit at ${table}, seat ${seatLabel}.`;
export const watching = (table: string): string => `You are watching ${table}.`;
export const stoodUp = (table: string): string => `You stood up from ${table}.`;
export const coinsSettled = (signed: string): string => `Coins settled: ${signed} for you`;
export const rematchOffered = (name: string): string => `${name} offers a rematch`;
export const yourTurnClock = (seconds: number): string => `Your turn: ${seconds} s`;
export const theirTurnClock = (name: string, seconds: number): string =>
  `${name}'s turn: ${seconds} s`;
export const replayStep = (n: number, total: number, moveCopy: string): string =>
  `Move ${n} of ${total}: ${moveCopy}`;
export const gamesFound = (n: number): string =>
  n === 0 ? 'No games found' : n === 1 ? '1 game found' : `${n} games found`;
export const inviteSent = (email: string): string => `Invite sent to ${email}`;
export const inviteAlreadyMember = (email: string): string =>
  `${email} already belongs to a member.`;
export const coinsAdded = (coins: number, character: string): string =>
  `${coins} coins added to ${character}.`;
export const coinsRefunded = (coins: number, character: string): string =>
  `Refunded. ${coins} coins were removed from ${character}.`;
export const tradeOffered = (name: string): string => `${name} offers a trade.`;
export const tradeOpened = (name: string): string => `Trade opened with ${name}`;
export const youAccepted = (name: string): string => `You accepted. Waiting for ${name}.`;
export const partnerAccepted = (name: string): string => `${name} accepted.`;
export const tradeTooFar = (name: string): string => `Stand next to ${name} to trade.`;
export const tradeAlreadyOpen = (name: string): string => `${name} is already trading.`;
export const pickedUp = (item: string, cell: string): string => `Picked up ${item} from ${cell}`;
export const movedItem = (item: string, cell: string): string => `Moved ${item} to ${cell}`;
export const crafted = (item: string): string => `Crafted ${item}`;
export const missingIngredients = (recipe: string): string => `Missing ingredients for ${recipe}.`;
export const achievementUnlocked = (name: string): string => `Achievement unlocked: ${name}`;
export const seasonStarted = (n: number): string => `Season ${n} started`;
export const coinsToOfferRange = (available: number): string =>
  `Use a whole number from 0 to ${available}.`;
export const pastDueBanner = (suspendsAt: string): string =>
  `An invoice is overdue. This server will be suspended at ${suspendsAt} unless the payment is approved.`;
export const SUSPENDED_BANNER =
  'This server is suspended because an invoice is unpaid. Play and saves are paused until the billing provider confirms payment. Your worlds can still be exported.';
export const pastDueBillingStatus = (suspendsAt: string): string =>
  `Invoice overdue. Approve payment before ${suspendsAt} to keep this server running.`;
export const planChangePendingStatus = (planName: string): string =>
  `Plan change to ${planName} is waiting for the billing provider to confirm payment.`;
export const planChanged = (planName: string): string => `Plan changed to ${planName}.`;
export const unknownFieldMessage = (name: string): string => `Unknown field: ${name}`;
export const moveCounter = (n: number, total: number): string => `Move ${n} of ${total}`;
