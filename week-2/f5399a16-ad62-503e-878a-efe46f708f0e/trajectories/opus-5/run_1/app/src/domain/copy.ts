/** Every published sentence of the desk's own screens, in one place. */

export const COPY = {
  sessionEnded: 'Your session ended. Sign in again to keep going — what you typed is still here.',
  refreshFailed: "Couldn't refresh. Trying again.",
  wrongSignIn: "That email and password don't match.",
  typeName: 'Type a name.',
  typeEmail: 'Type a mail address such as name@example.test.',
  typePassword: 'A password has at least 10 characters.',
  typeDate: 'Type a date such as 2027-03-15.',
  typeTime: 'Type a time such as 09:00.',
  typeTitle: 'Type a title.',

  passwordChanged: 'Password changed.',
  wrongCurrentPassword: "That current password doesn't match.",

  clientAdded: 'Client added.',
  clientSaved: 'Client saved.',
  clientDeleted: 'Client deleted.',
  clientHasJobs: 'A client with jobs has to be closed instead.',
  producerAdded: 'Producer added.',
  producerSaved: 'Producer saved.',
  clientClosing: "This client is closing and can't change.",
  bringBackPassed: 'The time to bring this client back has passed.',
  clientNotClosing: 'This client is not closing.',

  jobAdded: 'Job added.',
  jobSaved: 'Job saved.',
  jobDuplicated: 'Job duplicated.',
  adIdEnding: 'That Ad-ID should end in H or D.',
  adIdShape: 'An Ad-ID has four letters, then seven letters or digits, then H or D.',
  jobArchived: 'This job is archived.',

  scriptHeader: 'This file needs the header row shot,visual,audio,seconds.',
  scriptNotText: 'This file is not UTF-8 text.',

  uploadNotImage: 'This file is not a PNG or JPEG.',
  uploadTooBig: 'This file is over 8,000,000 bytes.',
  storeUnavailable: 'The file store is unavailable right now. Nothing was saved.',

  undoPassed: 'The time to undo has passed.',

  lineSaved: 'Line saved.',
  lineRemoved: 'Line removed.',
  lineText: "Type the line's text.",
  linePastLast: 'This line runs past the last frame.',

  musicUnavailable: 'The music library is unavailable right now. Your cue stays.',
  licenceBackwards: 'The licence ends before it starts.',

  filmAsked: 'Film asked for.',
  filmStored: 'The stored film is shown.',
  renderIncomplete: 'The render came back incomplete. Nothing was saved.',
  renderUnavailable: 'The render service is unavailable right now. Nothing changed.',
  renderFailed: 'The render service could not finish this film. Nothing was saved.',

  cutSignedOff: "A signed-off cut can't change.",
  cutsSame: 'These two cuts are the same.',
  pageEnded: 'Page ended.',
  dueDatePassed: "This job's due date has passed.",

  noteDone: 'Note marked done.',
  noteWontDo: "Note marked won't do.",
  noteReopened: 'Note reopened.',

  callBooked: 'Call booked.',
  callMoved: 'Call moved.',
  callCancelled: 'Call cancelled.',
  callPassed: 'That time has passed.',

  packageReady: 'Package ready.',
  pdfUnavailable: 'The PDF service is unavailable right now. Nothing was saved.',
  packageNotSignedOff: 'Only a signed-off cut can be delivered.',

  letterSaved: 'Letter saved.',
  letterAmount: 'Type an amount such as 1835.50.',
  letterAccepted: "This letter is accepted and can't change.",

  copyAddress: 'Address copied.',
  copyAddressRefused: 'Press Ctrl+C to copy the address.',
  enquiryThanks: 'Thanks. I answer within two working days.',
  enquiryMessage: 'Type your message.',
} as const;

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

export const frameWord = (count: number): string =>
  `${count} ${plural(count, 'frame', 'frames')}`;

export const say = {
  closing: (name: string, date: string): string =>
    `Closing ${name}. You can bring it back until ${date}.`,
  broughtBack: (name: string): string => `${name} is back.`,
  archived: (title: string): string => `${title} archived.`,
  searchResults: (count: number): string =>
    count === 0 ? 'No results.' : `${count} ${plural(count, 'result', 'results')}.`,
  previewReady: (newRows: number, matched: number, refused: number): string =>
    `Preview ready: ${newRows} new, ${matched} matched, ${refused} refused.`,
  rowSeconds: (row: number): string =>
    `Row ${row}: seconds should be a number such as 1.5.`,
  rowShotEmpty: (row: number): string => `Row ${row}: shot is empty.`,
  rowShotRepeated: (row: number, shot: string, firstRow: number): string =>
    `Row ${row}: shot ${shot} is already in row ${firstRow}.`,
  scriptSaved: (created: number, updated: number): string =>
    `Script saved: ${created} new, ${updated} changed.`,
  fileStored: (fileName: string): string => `${fileName}: Stored.`,
  fileRefused: (fileName: string, reason: string): string => `${fileName}: ${reason}`,
  wrongAspect: (width: number, height: number, aspect: string): string =>
    `This frame is ${width} x ${height}. This job is ${aspect}.`,
  alreadyOnBoard: (frame: number): string => `Already on this board as frame ${frame}.`,
  frameMoved: (frame: number, position: number, count: number): string =>
    `Frame ${frame} moved to position ${position} of ${count}.`,
  frameDuplicated: (frame: number, made: number): string =>
    `Frame ${frame} duplicated as frame ${made}.`,
  frameInserted: (made: number, after: number): string =>
    `Frame ${made} inserted after frame ${after}.`,
  frameRemoved: (frame: number): string => `Frame ${frame} removed.`,
  frameBack: (frame: number): string => `Frame ${frame} is back.`,
  frameSaved: (frame: number): string => `Frame ${frame} saved.`,
  frameNowFrames: (frame: number, count: number): string =>
    `Frame ${frame} is now ${frameWord(count)}.`,
  staleBoard: (time: string): string =>
    `This board was changed at ${time} Amsterdam time in another window. Your changes are still here.`,
  frameRateNow: (rate: string): string => `Frame rate is now ${rate}.`,
  lineOutside: (percent: string): string =>
    `This line runs outside the safe area by ${percent}%.`,
  lineReading: (needs: number, has: number): string =>
    `This line needs ${needs} frames on screen. It has ${has}.`,
  cueAdded: (title: string): string => `Cue added: ${title}.`,
  cueRemoved: (title: string): string => `Cue removed: ${title}.`,
  licenceEndsInDays: (days: number): string =>
    `Licence ends in ${days} ${plural(days, 'day', 'days')}`,
  licenceEndsToday: (): string => 'Licence ends today',
  licenceEnded: (date: string): string => `Licence ended on ${date}.`,
  renderBusy: (time: string): string =>
    `The render service is busy. You can try again at ${time} Amsterdam time.`,
  filmReady: (cut: number): string => `The film for Cut ${cut} is ready.`,
  cutMade: (cut: number): string => `Cut ${cut} made.`,
  cutBroughtBack: (cut: number): string => `Cut ${cut} is the board again.`,
  cutDeleted: (cut: number): string => `Cut ${cut} deleted.`,
  cutSaved: (cut: number): string => `Cut ${cut} saved.`,
  reviewReady: (name: string): string => `Review page ready. The mail to ${name} is on its way.`,
  signOffReady: (name: string): string => `Sign-off page ready. The mail to ${name} is on its way.`,
  notesMarkedDone: (count: number): string =>
    `${count} ${plural(count, 'note', 'notes')} marked done.`,
  noteArrived: (name: string, frame: number, time: string, town: string): string =>
    `${name} left a note on frame ${frame} at ${time} ${town} time.`,
  notePosition: (position: number): string => `Position ${position}`,
  frameGone: (cut: number): string => `Frame gone in Cut ${cut}.`,
  signedOffArrived: (cut: number, name: string, time: string, town: string): string =>
    `Cut ${cut} signed off by ${name} at ${time} ${town} time.`,
  slotTaken: (time: string): string =>
    `That time was just taken at ${time} Amsterdam time. Pick another.`,
  timeMissing: (time: string, town: string, date: string): string =>
    `${time} does not exist in ${town} on ${date}.`,
  callLine: (date: string, time: string, town: string, amsterdam: string): string =>
    `${date}, ${time} ${town} time · ${amsterdam} Amsterdam time`,
  licenceEndedForPackage: (title: string, date: string): string =>
    `The licence for ${title} ended on ${date}.`,
  frameNoDrawing: (frame: number): string => `Frame ${frame} has no drawing yet.`,
  tooManyDownloads: (time: string): string =>
    `Too many downloads for now. You can download again at ${time} Amsterdam time.`,
  feePageReady: (name: string): string => `Fee page ready. The mail to ${name} is on its way.`,
  letterAcceptedBy: (name: string): string => `Letter accepted by ${name}.`,
  letterStale: (time: string, town: string): string =>
    `This letter was changed at ${time} ${town} time. Read it again.`,
  enquiryLimit: (time: string): string =>
    `Too many enquiries from this address for now. You can send again at ${time} Amsterdam time.`,
  markNotesDone: (count: number): string =>
    `Mark ${count} ${plural(count, 'note', 'notes')} done`,
  clipTip: (frame: number, inPoint: string, outPoint: string): string =>
    `Frame ${frame} · in ${inPoint} · out ${outPoint}`,
  movedFrom: (frame: number, from: number, to: number): string =>
    `Frame ${frame} moved from position ${from} to position ${to}.`,
  shorter: (frame: number, count: number): string =>
    `Frame ${frame} is ${frameWord(count)} shorter.`,
  longer: (frame: number, count: number): string =>
    `Frame ${frame} is ${frameWord(count)} longer.`,
  isNew: (frame: number): string => `Frame ${frame} is new.`,
  newDrawing: (frame: number): string => `Frame ${frame} has a new drawing.`,
  isGone: (frame: number): string => `Frame ${frame} is gone.`,
  enquirySubject: (name: string): string => `Enquiry from ${name}`,
} as const;

/** The visible label of every published option value. */
export const LABELS = {
  jobState: {
    draft: 'Draft',
    inReview: 'In review',
    signedOff: 'Signed off',
    delivered: 'Delivered',
    archived: 'Archived',
  },
  noteState: { open: 'Open', done: 'Done', wontDo: "Won't do" },
  clientState: { active: 'Active', closing: 'Closing', erasing: 'Erasing', erased: 'Erased' },
  sort: { title: 'Title', dueDate: 'Due date' },
  targetSeconds: { 6: ':06', 15: ':15', 30: ':30', 60: ':60' },
  frameRate: { '25': '25', '23.976': '23.976', '29.97': '29.97' },
  aspect: { '16:9': '16:9', '1:1': '1:1', '9:16': '9:16' },
  place: {
    netherlands: 'Netherlands',
    ontario: 'Ontario',
    newYork: 'New York',
    dubai: 'Dubai',
  },
  town: { amsterdam: 'Amsterdam', newYork: 'New York', toronto: 'Toronto', dubai: 'Dubai' },
  language: { en: 'English', nl: 'Dutch', fr: 'French', ar: 'Arabic' },
  licenceMarket: { NL: 'NL', US: 'US', CA: 'CA', AE: 'AE' },
  minutes: { 30: '30', 60: '60' },
  currency: { EUR: 'EUR', CAD: 'CAD', USD: 'USD' },
  renderState: {
    queued: 'Queued',
    running: 'Running',
    done: 'Queued',
    failed: 'Failed',
    ready: 'Ready',
    outdated: 'Outdated',
  },
} as const;
