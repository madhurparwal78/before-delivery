import type { EventStatus, StandingsView } from '../shared/api';

export const STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Draft',
  registration_open: 'Registration open',
  registration_closed: 'Registration closed',
  running: 'Running',
  provisional: 'Provisional',
  final: 'Final',
  published: 'Published',
};

export const VIEW_LABELS: Record<StandingsView, string> = {
  indexed: 'Indexed',
  class: 'Class',
  raw: 'Raw',
};

export const copy = {
  signIn: {
    pending: 'Signing in',
    invalid: 'Email or password is incorrect.',
  },
  join: {
    pending: 'Creating account',
    emailTaken: 'That email already has an account.',
  },
  event: {
    savePending: 'Saving event',
    saved: 'Event saved as draft.',
    stale: 'Someone else changed this event. Reload to see the latest.',
    lifecyclePending: 'Updating event',
    lifecycleDone: (status: EventStatus): string => `Event is now ${STATUS_LABELS[status]}.`,
    illegal: (status: EventStatus): string =>
      `That step is not available from ${STATUS_LABELS[status]}.`,
    windowOpen: 'The protest window is still open.',
    protestsPending: 'Decide every protest before setting results final.',
  },
  register: {
    pending: 'Registering',
    success: (carNumber: number, classCode: string, heat: number): string =>
      `Registered: car ${carNumber} ${classCode}, run heat ${heat}.`,
    emailDelayed: "Your confirmation email is delayed. We'll keep trying.",
    closed: 'Registration for this event is closed.',
    already: 'You are already registered for this event.',
    numberTaken: (carNumber: number, classCode: string): string =>
      `Car ${carNumber} is already taken in ${classCode}.`,
  },
  withdraw: {
    pending: 'Withdrawing',
    success: (eventName: string): string => `You have withdrawn from ${eventName}.`,
    closed: 'Withdrawal closed once the event starts.',
  },
  checkIn: {
    pending: 'Signing your waiver',
    success: 'Checked in. Your signed waiver is saved.',
    mismatch: 'Type your name exactly as registered.',
    renderer: 'Waiver signing is unavailable right now. Check in at the registration table.',
    storage: 'We could not save your signed waiver. You are not checked in yet; try again shortly.',
  },
  rota: {
    claimPending: 'Claiming',
    claimed: (station: string, heat: number): string =>
      `You are working ${station} in heat ${heat}.`,
    emailDelayed: "Your assignment email is delayed. We'll keep trying.",
    assignPending: 'Assigning',
    assigned: (driverName: string, station: string, heat: number): string =>
      `${driverName} is working ${station} in heat ${heat}.`,
    releasePending: 'Releasing',
    released: (station: string, heat: number): string =>
      `${station} in heat ${heat} is open again.`,
    taken: 'That station was just taken. Pick another.',
    ownHeat: (heat: number): string =>
      `You drive in heat ${heat}. Pick a station in another heat.`,
    already: 'You already have a work station for this event.',
  },
  timing: {
    committedTime: (
      carNumber: number,
      classCode: string,
      indexed: string,
      classPosition: number,
      overallPosition: number,
    ): string =>
      `Car ${carNumber} ${classCode}: indexed ${indexed}, P${classPosition} in ${classCode}, P${overallPosition} overall`,
    committedDnfRanked: (
      carNumber: number,
      classCode: string,
      classPosition: number,
      overallPosition: number,
    ): string =>
      `Car ${carNumber} ${classCode}: DNF, P${classPosition} in ${classCode}, P${overallPosition} overall`,
    committedDnfNoTime: (carNumber: number, classCode: string): string =>
      `Car ${carNumber} ${classCode}: DNF, no time yet`,
    rerunGranted: (carNumber: number, classCode: string, runNumber: number): string =>
      `Car ${carNumber} ${classCode}: rerun granted for run ${runNumber}`,
    empty: 'Type a time, D for DNF or R for rerun.',
    format: 'Run time must look like 45.123.',
    heatNotRunning: (carNumber: number, heat: number): string =>
      `Car ${carNumber} runs in heat ${heat}, which is not running.`,
    notCheckedIn: (carNumber: number): string => `Car ${carNumber} is not checked in.`,
    alreadyRecorded: (runNumber: number, carNumber: number): string =>
      `Run ${runNumber} for car ${carNumber} is already recorded. Press Enter to correct it.`,
    correctionPending: 'Saving correction',
    corrected: (
      carNumber: number,
      classCode: string,
      runNumber: number,
      indexed: string | null,
      classPosition: number,
      overallPosition: number,
    ): string =>
      `Car ${carNumber} ${classCode} run ${runNumber} corrected: ${
        indexed === null ? 'DNF' : `indexed ${indexed}`
      }, P${classPosition} in ${classCode}, P${overallPosition} overall`,
    reason: 'Give a reason of at least 5 characters.',
    noChange: 'The correction must change the time, cones or outcome.',
    locked: 'Results are final. Times can no longer change.',
  },
  standings: {
    update: (carNumber: number, classCode: string, badge: string): string =>
      `Car ${carNumber} ${classCode}: ${badge}`,
  },
  protest: {
    filePending: 'Filing protest',
    filed: (carNumber: number, classCode: string): string =>
      `Protest filed against car ${carNumber} ${classCode}.`,
    closed: 'The protest window has closed.',
    decidePending: 'Saving decision',
    upheld: 'Protest upheld.',
    denied: 'Protest denied.',
  },
  publish: {
    pending: 'Publishing final results',
    success: 'Final results published.',
    renderer: 'Results PDF renderer is offline. Publishing is paused and drivers have not been emailed.',
    storage: 'Results storage is offline. Nothing was published and drivers have not been emailed.',
    mail: 'The mail server did not accept the results emails. Results are not published yet.',
  },
  indexTable: {
    pending: 'Loading table',
    loaded: (effectiveDate: string): string => `Index table effective ${effectiveDate} loaded.`,
    runsExist: (effectiveDate: string): string =>
      `An event on or after ${effectiveDate} already has timed runs.`,
    classesMissing: (codes: string[]): string =>
      `Missing classes used by later events: ${codes.join(', ')}.`,
    dateTaken: (effectiveDate: string): string => `A table already starts on ${effectiveDate}.`,
  },
  season: {
    pending: 'Preparing CSV',
    downloaded: 'Standings CSV downloaded.',
  },
  operator: {
    pending: 'Creating workspace',
    created: (clubName: string, chairName: string): string =>
      `Club ${clubName} is ready. ${chairName} can sign in now.`,
    slugTaken: 'That club slug is taken.',
    emailTaken: 'That email already has an account.',
  },
  registrationLine: (date: string, time: string): string =>
    `Registration closes ${date} at ${time}`,
  registrationClosed: 'Registration closed',
  protestWindowLine: (time: string): string => `Protest window open until ${time}`,
  protestWindowClosed: 'Protest window closed',
  stationsOpen: (count: number): string =>
    count === 1 ? '1 station open' : `${count} stations open`,
  heatHeading: (heat: number, count: number): string =>
    `Heat ${heat}: ${copy.stationsOpen(count)}`,
  coneCount: (count: number): string => (count === 1 ? '1 cone' : `${count} cones`),
};
