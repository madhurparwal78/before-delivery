// Event facts shown on the public site (the server decides every rule).

export const EVENT = {
  institute: "Opaline Institute",
  name: "Opaline Bench Days",
  course: "Layered Composite Masterclass",
  dates: "Friday 16 and Saturday 17 April 2027",
  city: "Chicago",
  venue: "The Opaline Lab",
  street: "1460 West Kinzie Street",
  locality: "Chicago, Illinois",
  director: "Dr. Celeste Marrow-Ibarra",
  provider: "Opaline Institute",
  providerId: "OI-PACE-219874",
  credits: "16",
  format: "Lecture and participation (hands-on)",
  subject: "250 Operative (restorative) dentistry",
};

export const SEATS_TOTAL = 24;
export const ROWS = ["A", "B", "C", "D"] as const;

export const CHAPTERS = [
  { id: "overture", number: "01", title: "Overture" },
  { id: "method", number: "02", title: "Method" },
  { id: "two-days", number: "03", title: "Two days" },
  { id: "lab", number: "04", title: "The lab" },
  { id: "evenings", number: "05", title: "Evenings" },
  { id: "venue", number: "06", title: "Venue" },
  { id: "reserve", number: "07", title: "Reserve" },
] as const;
