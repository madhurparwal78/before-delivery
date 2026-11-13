export const fieldCopy = {
  thousands: 'Write the number without thousands separators, for example 1200,5.',
  badNumber: 'Enter a number such as 1,8.',
  badUnit: 'Choose one of the listed units.',
  siteName: 'Give the site a name of 1 to 80 characters without hidden or line-break characters.',
  wallSize: 'The wall must be from 1 to 100 metres wide and from 1 to 40 metres high.',
  showTime: 'Enter a date and time as YYYY-MM-DDTHH:mm.',
  readingTime: 'Give the capture time as an instant with its offset.',
  cell: "That cell isn't on this wall.",
  belowZero: "A reading can't be below zero.",
  reflectance: 'Reflectance runs above 0 and up to 1.',
  recess: 'Recess runs from 0 to 2 metres.',
  firstDay: "The first day can't be before today in Brussels.",
  days: 'A hire runs for 1 to 7 days.',
  hours: 'Show hours must be above 0 and up to 1000.',
  limit: 'Ask for 1 to 200 at a time.',
  pixel: 'That point is outside the photo.',
  pointCount: 'Set exactly four points and one check point.',
  live: 'Say true or false.',
  operations: 'Send 1 to 500 readings at a time.',
  required: 'This is required.',
} as const;

export function zoomCopy(min: string, max: string): string {
  return `This lens zooms from ${min} to ${max} to 1.`;
}

export function shiftCopy(max: string): string {
  return `This lens shifts up to ${max}% that way.`;
}

export function obliquityCopy(angle: string): string {
  return `That throw hits the wall at ${angle} degrees; the limit is 25.`;
}

export const aimGridCopy = 'Aim on a half-metre step.';
export const overlapCopy = 'No cell can sit under more than two bodies.';

export function lensCopy(serial: string): string {
  return `${serial} isn't on the shelf or at this site.`;
}
