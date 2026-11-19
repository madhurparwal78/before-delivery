export const copy = {
  signInPending: 'Signing in.',
  signInDone: 'Signed in.',
  signInFailed: 'That email and password do not match.',

  addPiecePending: 'Adding piece.',
  addPieceDone: 'Piece added.',
  removePiecePending: 'Removing piece.',
  removePieceDone: 'Piece removed.',
  applyPiecePending: 'Saving piece.',
  applyPieceDone: 'Piece saved.',

  checkPending: 'Checking layout.',
  checkPassed: 'Layout passes every rule.',
  checkFailed: (count: number): string => `Layout has ${count} findings.`,

  saveVersionPending: 'Saving version.',
  saveVersionDone: (version: number): string => `Version ${version} saved.`,
  validatePending: (version: number): string => `Validating version ${version}.`,
  validateDone: (version: number): string => `Version ${version} validated.`,
  validateFailed: (version: number, count: number): string =>
    `Version ${version} has ${count} findings.`,
  publishPending: (version: number): string => `Publishing version ${version}.`,
  publishDone: (version: number): string => `Version ${version} published.`,
  restorePending: (version: number): string => `Restoring version ${version}.`,
  restoreDone: (version: number): string => `Restored as version ${version}.`,

  renamePending: 'Saving name.',
  renameDone: (name: string): string => `Renamed to ${name}.`,

  trashPending: 'Moving to trash.',
  trashDone: 'Moved to trash.',
  undoPending: 'Undoing.',
  undoDone: 'Module restored.',
  purgePending: 'Purging.',
  purgeDone: 'Purged.',

  timetablePending: 'Saving timetable.',
  timetableDone: 'Timetable saved.',
  standardsPending: 'Saving standards.',
  standardsDone: 'Standards saved.',
  memberPending: 'Adding member.',
  memberDone: 'Member added.',
  createSessionPending: 'Creating session.',
  createSessionDone: 'Session created.',

  startPending: 'Starting session.',
  startDone: 'Session running.',
  holdPending: 'Holding session.',
  holdDone: (tick: number): string => `Session held at tick ${tick}.`,
  resumePending: 'Resuming session.',
  resumeDone: (tick: number): string => `Session resumed at tick ${tick}.`,
  endPending: 'Ending session.',
  endDone: 'Session ended.',

  highballPending: (train: string): string => `Requesting the road for Train ${train}.`,
  highballDone: (train: string, block: string, blocks: number): string =>
    `Train ${train} has the road to ${block}, ${blocks} blocks.`,

  cancelPending: 'Cancelling authority.',
  cancelDone: 'Authority released.',
  backToLoopPending: (train: string): string => `Sending Train ${train} back to loop.`,
  backToLoopDone: (train: string, block: string): string => `Train ${train} is in ${block}.`,
  recallPending: (train: string): string => `Recalling Train ${train}.`,
  recallDone: (train: string, block: string): string => `Train ${train} recalled to ${block}.`,

  notePending: 'Saving note.',
  noteDone: 'Note saved.',
  withdrawPending: 'Withdrawing request.',
  withdrawDone: 'Request withdrawn.',

  servicePending: 'Changing block.',
  serviceOut: (block: string): string => `Block ${block} out of service.`,
  serviceIn: (block: string): string => `Block ${block} back in service.`,

  addTrainPending: 'Adding train.',
  addTrainDone: (train: string, version: number): string =>
    `Train ${train} added. Session version ${version}.`,

  issuePacketPending: 'Issuing crew packet.',
  packetReady: 'Crew packet ready.',

  deadlock: (numbers: string[]): string =>
    `Deadlock: Trains ${numbers.join(', ')} are waiting on each other.`,
  authorityExpired: (train: string): string => `Authority for Train ${train} expired.`,

  valkeyDown: 'Live updates are paused. Sessions are held at their last committed tick.',
  valkeyBack: 'Live updates are back.',
  savedWhileValkeyDown: 'Saved. Other members will see this when live updates return.',
  packetFailedGotenberg: 'Crew packet failed: the PDF service did not answer. Nothing was issued.',
  packetFailedValkey: 'Crew packet failed: live updates are paused. Nothing was issued.',
  gotenbergDown: 'The PDF service is not answering. New packets will fail until it returns.',

  emptyList: 'Nothing here yet.',
  webglLost: 'The 3D view is paused. Your session is still running.',
} as const;

export const WALKTHROUGH_STEPS = [
  {
    title: 'Pick an open end',
    line: 'Select the end of a module where track should continue.',
  },
  { title: 'Add track', line: 'Press a tile to add a piece to that end.' },
  {
    title: 'Check the standard',
    line: 'Check layout shows every rule your layout breaks.',
  },
  {
    title: 'Switch to Operate',
    line: 'Use the switch to open a session and watch the blocks.',
  },
  {
    title: 'Give the road',
    line: 'Select a train, choose a destination and press Highball.',
  },
] as const;
