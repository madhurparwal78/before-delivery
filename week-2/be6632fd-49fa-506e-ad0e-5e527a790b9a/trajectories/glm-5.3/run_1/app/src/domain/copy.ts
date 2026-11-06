// The exact copy of every feedback state, in one place.
export interface Copy {
  unreachable: string;
  crossOrigin: string;
  sessionEnded: string;
  accessRemoved: string;
  unauthenticated: string;
  draftRestored: string;
  forbidden: string;
  validationOne: string;
  validationMany: (n: number) => string;
  staleStart: (name: string, time: string) => string;
}

export const MESSAGES = {
  unreachable: "Hourline can't be reached. Nothing was saved. Check your connection and try again.",
  crossOrigin: 'This request came from another site and was refused.',
  sessionEnded: 'Your session ended. Sign in again to continue — your draft is kept.',
  accessRemoved: 'Your access to this workspace was removed.',
  unauthenticated: 'Sign in to continue.',
  draftRestored: 'Your draft is restored.',
  forbidden: "Your role can't do this.",
  validationOne: 'There is 1 problem. Fix it and try again.',
  validationMany: (n: number) => `There are ${n} problems. Fix them and try again.`,
  staleStart: (name: string, time: string) => `Not saved: ${name} saved a newer version at ${time}.`,
  // field messages
  required: 'This field is required.',
  email: 'Enter an email address like name@example.com.',
  tooLong: (n: number) => `Use at most ${n} characters.`,
  wholeRange: (min: number, max: number) => `Enter a whole number from ${min} to ${max}.`,
  date: 'Enter a date as YYYY-MM-DD.',
  time: 'Enter a time as HH:MM.',
  instant: 'Enter an instant like 2027-03-18T09:00:00Z.',
  notLaterThanNow: 'Choose a time later than now.',
  gap: (date: string) => `Copenhagen skips from 02:00 to 03:00 on ${date}. Choose another time.`,
  consent: 'Tick the box to agree to drop emails.',
  password: 'Use 12 to 128 characters.',
  imageType: 'Use a JPEG, PNG or WebP photo.',
  imagePixels: 'Use a photo at most 12,000 pixels on each side and 40,000,000 pixels in all.',
  priceDatePast: 'Choose today or a later date.',
  unknownStyle: (styleNumber: string) => `No style ${styleNumber} on this drop.`,
  unknownMarket: 'Choose one of the six markets.',
  unknownStockist: 'Choose a stockist.',
  contactErased: 'Contact erased'
} as const;

export const STATUS_MARKS: Record<string, { word: string; mark: 'ring' | 'dot' | 'slash' | 'cross' }> = {
  upcoming: { word: 'Upcoming', mark: 'ring' },
  live: { word: 'Live', mark: 'dot' },
  sold_out: { word: 'Sold out', mark: 'slash' },
  withdrawn: { word: 'Withdrawn', mark: 'cross' }
};

export function calendarResults(n: number): string {
  return n === 1 ? '1 drop' : `${n} drops`;
}

export const NO_DROPS_MATCH = 'No drops match these filters.';
export const NOTHING_HERE = 'Nothing here yet.';
