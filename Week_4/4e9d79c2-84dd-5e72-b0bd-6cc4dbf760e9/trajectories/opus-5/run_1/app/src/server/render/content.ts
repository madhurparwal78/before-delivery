export type Occasion = 'school' | 'weddings' | 'company' | 'festivals';

export type OccasionPage = {
  occasion: Occasion;
  path: string;
  heading: string;
  title: string;
  cardHeading: [string, string];
  checklist: string[];
  panel: string;
  sections: { heading: string; id: string; paragraphs: string[] }[];
};

export const QUESTIONS = [
  {
    id: 'how-early',
    question: 'How early should we ask?',
    answer:
      'Ask as soon as you have a date. Partner operators hold their vehicles for the hires they already know about, so a request three months ahead reaches more of them than one three days ahead. A late request is still worth sending; it reaches fewer operators and the price is usually higher.',
  },
  {
    id: 'who-checks',
    question: 'Who checks the driver?',
    answer:
      "Every operator asked for your hire has its operator licence and public liability cover checked against your hire\'s last day, not merely against today. On a school hire the driver DBS check is read too, and an operator whose check is older than three years on that day is not asked.",
  },
  {
    id: 'plans-change',
    question: 'What happens if plans change?',
    answer:
      'Tell us and we price the change beside the old booking, so you see both. If the price moves you get a fresh quote page by email and the old address stops working. Written notice of a cancellation is counted in UK calendar days against your departure date.',
  },
] as const;

export const OCCASION_PAGES: OccasionPage[] = [
  {
    occasion: 'school',
    path: '/occasions/school',
    heading: 'School trips',
    title: 'School trips | Merrowfield Coach Hire',
    cardHeading: ['School trips', 'with the papers checked'],
    checklist: ['Driver DBS check read for your last day', 'Adults counted per 15 pupils', 'Seat plan and list to print'],
    panel: 'Museums, swimming, residentials and sports fixtures, with one person answering about all of them.',
    sections: [
      {
        heading: 'What we arrange',
        id: 'what-we-arrange',
        paragraphs: [
          'A coach or minibus with a driver from a small partner operator near Coventry, priced for your party and your route.',
          'A printed passenger list and seat plan, with wheelchair users beside the lift on a 16 or a 49.',
        ],
      },
      {
        heading: 'What to tell us',
        id: 'what-to-tell-us',
        paragraphs: [
          'Pick-up, destination, the date and time out, the time back, how many are travelling and how many bags.',
          'Tell us about wheelchair users so we only ask operators with a lift.',
        ],
      },
      {
        heading: 'How payment works',
        id: 'how-payment-works',
        paragraphs: [
          'A deposit holds the hire and the balance is due seven days before departure. Pay by bank transfer quoting the reference on your quote page.',
          'Nothing is taken on this site; no card is ever asked for.',
        ],
      },
      { heading: 'Questions', id: 'questions', paragraphs: [] },
    ],
  },
  {
    occasion: 'weddings',
    path: '/occasions/weddings',
    heading: 'Weddings',
    title: 'Weddings | Merrowfield Coach Hire',
    cardHeading: ['Weddings', 'and the guests on time'],
    checklist: ['Church, venue and hotel runs', 'Late returns allowed for', 'One private page for the couple'],
    panel: 'Guests gathered from hotels, taken to the church and home again, on a timetable that holds.',
    sections: [
      {
        heading: 'What we arrange',
        id: 'what-we-arrange',
        paragraphs: [
          'One vehicle or several, with waiting time between the church and the venue priced before you agree to it.',
          'A quote page in English, Polish or Urdu for whoever is paying.',
        ],
      },
      {
        heading: 'What to tell us',
        id: 'what-to-tell-us',
        paragraphs: [
          'Where guests gather, the ceremony time, the venue and the latest you want the last coach to leave.',
          'Tell us the number travelling each way; they are often different.',
        ],
      },
      {
        heading: 'How payment works',
        id: 'how-payment-works',
        paragraphs: [
          'A deposit per vehicle holds the date, with the balance due seven days before.',
          'Waiting beyond fifteen free minutes at a stop is charged at the hour rate, pro rata by the minute.',
        ],
      },
      { heading: 'Questions', id: 'questions', paragraphs: [] },
    ],
  },
  {
    occasion: 'company',
    path: '/occasions/company',
    heading: 'Company travel',
    title: 'Company travel | Merrowfield Coach Hire',
    cardHeading: ['Company travel', 'and airport runs'],
    checklist: ['Airport pick-ups read from the flight', 'Invoices with no gaps', "Drivers' hours checked first"],
    panel: 'Staff to a conference, a shift to a plant, a team from the airport, with one invoice afterwards.',
    sections: [
      {
        heading: 'What we arrange',
        id: 'what-we-arrange',
        paragraphs: [
          "Door-to-door work for teams of eight to four hundred, with the drivers' hours checked before the day.",
          'An airport pick-up counts its free hour from the real landing, not from the booked time.',
        ],
      },
      {
        heading: 'What to tell us',
        id: 'what-to-tell-us',
        paragraphs: [
          'The flight number for an airport run, the number travelling and whether you need a return.',
          'Tell us if anything about the route is fixed by a site rule.',
        ],
      },
      {
        heading: 'How payment works',
        id: 'how-payment-works',
        paragraphs: [
          'A deposit holds the vehicle and an invoice follows, numbered without gaps.',
          'A second driver, where the hours need one, is charged once and shown on the quote.',
        ],
      },
      { heading: 'Questions', id: 'questions', paragraphs: [] },
    ],
  },
  {
    occasion: 'festivals',
    path: '/occasions/festivals',
    heading: 'Festivals and sport',
    title: 'Festivals and sport | Merrowfield Coach Hire',
    cardHeading: ['Festivals', 'and away fixtures'],
    checklist: ['Comfort stops priced plainly', 'Late-night returns', 'Club bags counted in units'],
    panel: 'Away fixtures, festival weekends and club outings, with the bags counted before you travel.',
    sections: [
      {
        heading: 'What we arrange',
        id: 'what-we-arrange',
        paragraphs: [
          'Coaches for clubs and crowds, with bag space worked out in units so nothing is left on the pavement.',
          'Comfort stops over fifteen minutes are charged for the excess only.',
        ],
      },
      {
        heading: 'What to tell us',
        id: 'what-to-tell-us',
        paragraphs: [
          'The number travelling, the bags by size, and the latest return time you can accept.',
          'Tell us about kit and instruments; they take bag units too.',
        ],
      },
      {
        heading: 'How payment works',
        id: 'how-payment-works',
        paragraphs: [
          'A deposit per vehicle, the balance seven days before departure, and waiting charged only where it happened.',
          'A cancellation is charged by UK calendar days from your written notice.',
        ],
      },
      { heading: 'Questions', id: 'questions', paragraphs: [] },
    ],
  },
];

export const FLEET_SIZES = [
  { seats: 8, name: 'Eight-seat minibus', bags: 16 },
  { seats: 12, name: 'Twelve-seat minibus', bags: 24 },
  { seats: 16, name: 'Sixteen-seat minibus with a lift', bags: 32 },
  { seats: 31, name: 'Thirty-one-seat coach', bags: 62 },
  { seats: 49, name: 'Forty-nine-seat coach with a lift', bags: 98 },
  { seats: 56, name: 'Fifty-six-seat coach', bags: 112 },
  { seats: 70, name: 'Seventy-seat coach', bags: 140 },
];

export const TERMS_PARAGRAPHS = [
  'Merrowfield Coach Hire arranges coaches and minibuses with drivers from partner operators. We own no vehicles. The operator named on your confirmation carries you, under its own operator licence and insurance.',
  'A quote is valid until the end of the fifth calendar day after it is sent, in UK time. Accepting a quote makes a booking. A deposit per vehicle holds it and the balance is due seven days before departure.',
  'Waiting time beyond fifteen free minutes at a stop is charged at the hour rate, pro rata by the minute. An airport pick-up has sixty free minutes from the flight\'s real landing. A comfort stop over fifteen minutes is charged for the excess.',
  'Cancellation charges are counted in UK calendar days between your written notice and the departure date: thirty days or more, the deposit only; fifteen to twenty-nine days, a quarter of the vehicle total; eight to fourteen days, half; seven days or fewer, all of it. A charge is never below the deposit and never above the vehicle total.',
  'We cancel only where we must, and then we return exactly what was paid.',
  'Lost property is held for one calendar month and returned for five pounds once the owner\'s details are recorded. Complaints are answered within three working days in England and Wales.',
  'Merrowfield Coach Hire, Coventry. Telephone 01632 960140.',
];

export const HOME_PROMISES = [
  'Partner operators asked for you',
  'Papers checked for your last day',
  "Drivers' hours checked before you travel",
  'One private page for your quote',
];
