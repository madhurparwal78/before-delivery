import { moneyLabel, Pennies } from '../domain/money.js';
import { formatUkDate } from '../domain/time.js';

/** Every published line of copy, in one place. */
export const copy = {
  sessionEnded: 'Your session ended. Sign in again to keep going — what you typed is still here.',
  refreshFailed: "Couldn't refresh. Trying again.",
  customerSaved: 'Customer saved.',
  customerRenamed: 'Customer renamed.',
  customerRemoved: 'Customer removed.',
  customerHasHire: "This customer has a hire, so it can't be removed.",
  passwordChanged: 'Password changed.',
  wrongSignIn: 'That email and password do not match.',
  searchTooLong: 'Search text can be up to 200 characters.',
  nothingFound: 'Nothing found for that search.',
  chooseOccasion: 'Choose an occasion.',
  enterPickUp: 'Enter the pick-up address.',
  enterDestination: 'Enter the destination.',
  enterDate: 'Enter a date as DD/MM/YYYY.',
  chooseHourAndMinutes: 'Choose an hour and minutes.',
  enterPeople: 'Enter between 1 and 400 people.',
  enterBags: 'Enter between 0 and 40 bags.',
  enterWheelchairs: 'Enter between 0 and 10 wheelchair users.',
  describeStops: 'Describe the stops in up to 2,000 characters.',
  enterName: 'Enter your name.',
  enterEmail: 'Enter a real email address.',
  enterTelephone: 'Enter a UK telephone number.',
  datePassed: 'That date has passed. Choose today or a later date.',
  noHoursLeft: 'No more pick-ups today.',
  shortNotice: "We need at least 30 minutes' notice for a pick-up.",
  returnTooEarly: 'The return has to be after the pick-up.',
  addressFailed: 'We could not check this address. You can carry on and type it in full.',
  enquiryAdded: 'Enquiry added.',
  enquiriesMerged: 'Enquiries merged.',
  stateSaved: 'State saved.',
  stateRefused: 'That did not save. Try again.',
  noEnquiriesMatch: 'No enquiries match these filters.',
  noOperators: 'No operators yet. Press Refresh directory.',
  noBids: 'No bids yet.',
  noPayments: 'No payments yet.',
  nothingThisWeek: 'Nothing in this week.',
  noPassengers: 'No passengers yet.',
  noDocuments: 'No documents yet.',
  noComplaints: 'No complaints logged.',
  noFoundItems: 'No found items logged.',
  noCustomers: 'No customers yet.',
  routeUpdated: 'Route updated.',
  routeFailed: 'Route not updated. Showing the last good route.',
  planOutOfDate: 'Plan is out of date',
  planSaved: 'Plan saved.',
  largerThanNeeded: 'Larger than needed',
  sizeNotOffered: 'Choose sizes from 8, 12, 16, 31, 49, 56 and 70.',
  directoryRefreshed: 'Directory refreshed.',
  directoryFailed: 'The directory could not be read. Your list has not changed.',
  noLongerListed: 'No longer listed',
  paperStored: 'Paper stored.',
  paperWrongType: 'This file is not a PDF, JPEG or PNG.',
  fileStoreDown: 'The file store is unavailable right now. Nothing was saved.',
  pdfServiceDown: 'The PDF service is unavailable right now. Nothing was saved.',
  dbsMissing: 'Driver DBS check is missing.',
  dbsTooOld: "Driver DBS check is older than three years on this hire's last day.",
  operatorsAsked: 'Operators asked.',
  savePlanFirst: 'Save a plan before asking operators.',
  priceSent: 'Price sent.',
  priceChanged: 'Price changed.',
  bidWithdrawn: 'Bid withdrawn.',
  priceGrammar: 'Enter the price in pounds and pence.',
  quoteSent: 'Quote sent.',
  quoteLocked: 'This quote is accepted. Use Changes instead.',
  marginRange: 'Margin is 0 to 60 in steps of 0.5.',
  rateTableAdded: 'Rate table added.',
  rateTableBeforeToday: "A rate table can't start before today.",
  enterAmount: 'Enter the amount in pounds and pence.',
  statementHeader: 'The first line has to read Date,Description,Amount,Balance.',
  statementTooManyRows: 'This file has more than 2,000 rows.',
  bookingChanged: 'Booking changed.',
  bookingCancelled: 'Booking cancelled.',
  departureGone: 'This departure has already gone.',
  breakMoved: 'Break moved.',
  secondDriverAdded: 'Second driver added.',
  runConfirmed: 'Run confirmed.',
  overTheLimit: 'This run is over the limit. Move a break or add a second driver.',
  driverPhoneFailed: "We couldn't reach the driver's phone. Nothing was marked as told.",
  nameAdded: 'Name added.',
  listedTwice: 'Listed twice',
  wheelchairSeats: 'Wheelchair users sit only in 2A and 2B.',
  passengerFileTooManyRows: 'This file has more than 500 rows.',
  noAcceptedQuote: 'This hire has no accepted quote yet.',
  complaintLogged: 'Complaint logged.',
  holidaysUnavailable: 'Bank holidays unavailable. Weekends only.',
  itemLogged: 'Item logged.',
  itemReturned: 'Item returned.',
  recordOwnerFirst: "Record the owner's details before returning this.",
  pastHoldingDate: 'Past holding date',
  customerClosed: 'Customer closed.',
  customerBroughtBack: 'Customer brought back.',
  bringBackOver: "The wait is over. This customer can't be brought back.",
  sheetBroughtIn: 'Sheet brought in.',
  matchesTwoCustomers: 'Matches two customers',
  erasedCustomer: 'Erased customer',
  notFound: "We can't find that.",
  seatPlanStored: 'Seat plan stored.',
} as const;

export function resultsFound(count: number): string {
  return `${count} results found.`;
}

export function suggestionsCount(count: number): string {
  return `${count} suggestions.`;
}

export function requestSent(reference: string): string {
  return `Request sent. Your reference is ${reference}.`;
}

export function chooseWhichTime(time: string): string {
  return `Choose which ${time} you mean.`;
}

export function missingHour(time: string, date: string): string {
  return `${time} does not exist on ${formatUkDate(date)}, when the clocks go forward. Choose another time.`;
}

export function requestLimit(time: string): string {
  return `You have sent several requests. Try again after ${time}.`;
}

export function downloadLimit(time: string): string {
  return `You have downloaded several files. Try again after ${time}.`;
}

export function stopMoved(index: number, total: number, address: string): string {
  return `Stop ${index} of ${total}: ${address}`;
}

export function paperEndsBefore(paper: string, date: string): string {
  return `${paper} ends ${formatUkDate(date)}, before this hire's last day.`;
}

export function paperMissing(paper: string): string {
  return `${paper} is missing.`;
}

export function awardedTo(operator: string): string {
  return `Awarded to ${operator}.`;
}

export function alreadyAwarded(operator: string, time: string): string {
  return `Already awarded to ${operator} at ${time}.`;
}

export function noPriceOnHire(operator: string): string {
  return `${operator} has no price on this hire.`;
}

export function bidsClosedAt(time: string): string {
  return `Bids closed at ${time}. Your price was not sent.`;
}

export function totalsUpdated(total: Pennies): string {
  return `Totals updated: ${moneyLabel(total)}.`;
}

export function staleQuote(time: string): string {
  return `Someone changed this quote at ${time}. Your edit is still here. Reload to see theirs.`;
}

export function rateTableExists(date: string): string {
  return `A rate table already starts on ${formatUkDate(date)}.`;
}

export function readRows(count: number): string {
  return `Read ${count} rows.`;
}

export function broughtInRows(count: number): string {
  return `Brought in ${count} rows.`;
}

export function creditLabel(amount: Pennies): string {
  return `Credit ${moneyLabel(amount)}`;
}

export function runMoved(number: number, date: string): string {
  return `Run ${number} moved to ${formatUkDate(date)}.`;
}

export function driverClash(number: number, time: string): string {
  return `That driver is already on Run ${number} at ${time}.`;
}

export function driverTold(time: string): string {
  return `Driver told at ${time}`;
}

export function overLimitFrom(time: string): string {
  return `Over the limit from ${time}`;
}

export function namesBroughtIn(count: number): string {
  return `${count} names brought in.`;
}

export function adultsShortLine(count: number): string {
  return count === 1 ? '1 more adult is needed' : `${count} more adults are needed`;
}

export function chargesAccepted(amount: Pennies): string {
  return `Charges accepted: ${moneyLabel(amount)}.`;
}

export function documentStored(kind: string): string {
  return `${kind} stored.`;
}

export function seatMoved(name: string, seat: string, otherName?: string, otherSeat?: string): string {
  if (otherName && otherSeat) {
    return `${name} is now in ${seat}. ${otherName} is now in ${otherSeat}.`;
  }
  return `${name} is now in ${seat}.`;
}
