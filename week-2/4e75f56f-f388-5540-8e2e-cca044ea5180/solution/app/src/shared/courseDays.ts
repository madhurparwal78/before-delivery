// Which course day a venue-local date is, decided once for check-in and the check-in screen heading.

const COURSE_DAYS: Record<1 | 2, string> = { 1: "2027-04-16", 2: "2027-04-17" };

export function openCourseDay(venueDate: string): 1 | 2 | null {
  if (venueDate === COURSE_DAYS[1]) return 1;
  if (venueDate === COURSE_DAYS[2]) return 2;
  return null;
}
