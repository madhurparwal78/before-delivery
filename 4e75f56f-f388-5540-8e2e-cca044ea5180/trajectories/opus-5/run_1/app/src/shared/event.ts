export const EVENT = {
  brand: 'Opaline Institute',
  site: 'Opaline Bench Days',
  courseTitle: 'Layered Composite Masterclass',
  dates: 'Friday 16 and Saturday 17 April 2027',
  day1Label: 'Friday 16 April 2027',
  day2Label: 'Saturday 17 April 2027',
  city: 'Chicago, Illinois',
  venueName: 'The Opaline Lab',
  venueAddress: '1460 West Kinzie Street, Chicago, Illinois',
  instructor: 'Dr. Celeste Marrow-Ibarra',
  provider: 'Opaline Institute',
  providerId: 'OI-PACE-219874',
  credits: 16,
  educationalFormat: 'Lecture and participation (hands-on)',
  subjectCode: '250 Operative (restorative) dentistry',
} as const;

export const CE_STATEMENT =
  `${EVENT.provider} (provider ID ${EVENT.providerId}) awards ${EVENT.credits} credits for this course. ` +
  `Educational format: ${EVENT.educationalFormat}. Subject code ${EVENT.subjectCode}.`;
