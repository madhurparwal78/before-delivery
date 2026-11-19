export interface SearchHit {
  title: string;
  path: string;
  excerpt: string;
}

interface Page {
  title: string;
  path: string;
  headings: string[];
  paras: string[];
}

/** The public pages' own text is the search corpus, decided on the server. */
export const PUBLIC_PAGES: Page[] = [
  {
    path: "/",
    title: "Coaches and minibuses with a driver",
    headings: ["Arranged for you from Coventry", "One desk, one person, every detail checked", "Start your quote"],
    paras: [
      "Coaches and minibuses with a driver, arranged for you from Coventry by Merrowfield Coach Hire.",
      "We ask partner operators for their prices so you do not have to chase several companies yourself.",
      "Partner operators asked for you. Papers checked for your last day. Drivers' hours checked before you travel. One private page for your quote.",
      "School trips, weddings, company travel, festivals and sport: choose your occasion and the quote form opens with it already chosen.",
      "Start your quote and we will collect prices from operators who are clear to run your hire on its last day.",
    ],
  },
  {
    path: "/occasions/school",
    title: "School trips",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "School trips by coach and minibus, from a morning at a museum to a week away.",
      "Every operator we ask holds an operator licence and public liability cover, and for a school hire we also check the driver's DBS date covers your last day.",
      "Tell us the pick-up and destination, the dates, the party size and any wheelchair users, and we will collect prices.",
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "How early should we ask? The earlier the better, and we can often help at short notice.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side.",
    ],
  },
  {
    path: "/occasions/weddings",
    title: "Weddings",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "Weddings and the guests around them: one minibus for the close family or coaches for the whole day.",
      "We check every operator's papers so the vehicles are properly covered on your last day.",
      "Tell us the pick-up, the ceremony and the reception, the times and the party size.",
      "A deposit holds the seats and the balance is due in the week before the day.",
      "How early should we ask? Popular Saturdays go early, so ask as soon as the venue is fixed.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side.",
    ],
  },
  {
    path: "/occasions/company",
    title: "Company travel",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "Company travel: shuttles between sites, a day at a conference, or the Christmas party run.",
      "One desk collects the prices and one invoice follows, with a credit note if a run changes.",
      "Tell us the route, the dates and the numbers, and we will collect prices from clear operators.",
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "How early should we ask? Ask as soon as the dates are fixed and we will do the rest.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side.",
    ],
  },
  {
    path: "/occasions/festivals",
    title: "Festivals and sport",
    headings: ["What we arrange", "What to tell us", "How payment works", "Questions"],
    paras: [
      "Festivals and sport: the coach that waits, or the minibuses that shuttle all weekend.",
      "Waiting time and comfort stops are worked out per stop and shown before you accept them.",
      "Tell us the pick-up, the ground, the times and the party size.",
      "A deposit holds the seats and the balance is due in the week before you travel.",
      "How early should we ask? Festival weekends fill early, so ask as soon as you know the date.",
      "Who checks the driver? We do, against the operator's papers and the drivers' hours rules.",
      "What happens if plans change? We reprice and show you the change side by side.",
    ],
  },
  {
    path: "/fleet",
    title: "Our fleet",
    headings: ["Our fleet"],
    paras: [
      "Our fleet of seven sizes, from an 8-seat minibus to a 70-seat coach.",
      "The 8-seat minibus takes 8 people and 16 bag units. The 12-seat minibus takes 12 people and 24 bag units. The 16-seat minibus takes 16 people and 32 bag units.",
      "The 31-seat coach takes 31 people and 62 bag units. The 49-seat coach takes 49 people and 98 bag units. The 56-seat coach takes 56 people and 112 bag units. The 70-seat coach takes 70 people and 140 bag units.",
      "The 16-seat and 49-seat vehicles carry a lift, each taking two wheelchair users.",
    ],
  },
  {
    path: "/terms",
    title: "Terms",
    headings: ["Terms"],
    paras: [
      "Terms of hire. These terms set out what Merrowfield Coach Hire arranges and what you agree to.",
      "We arrange coaches and minibuses operated by partner operators. We are not the operator and we own no vehicles.",
      "A quote is valid for five days from the day it is sent. A deposit holds the seats. The balance is due seven days before departure.",
      "A cancellation by you is charged by the calendar days between your written notice and the departure: thirty days or more takes the deposit only, fifteen to twenty-nine days takes a quarter, eight to fourteen days takes half, and seven days or fewer takes the whole amount.",
      "Complaints are answered within three working days in England and Wales. Found property is held for one calendar month.",
    ],
  },
];

export function searchPublicPages(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase();
  if (needle === "") return [];
  const hits: SearchHit[] = [];
  for (const p of PUBLIC_PAGES) {
    const blocks = [p.title, ...p.headings, ...p.paras];
    let found = false;
    let excerpt = "";
    for (const b of blocks) {
      const low = b.toLowerCase();
      const idx = low.indexOf(needle);
      if (idx !== -1) {
        found = true;
        excerpt = b;
        break;
      }
    }
    if (found) {
      hits.push({ title: p.title, path: p.path, excerpt });
      continue;
    }
    // word-prefix match
    const words = needle.split(/\s+/).filter(Boolean);
    if (words.length && blocks.some((b) => words.every((w) => b.toLowerCase().includes(w)))) {
      hits.push({ title: p.title, path: p.path, excerpt: p.paras[0] });
    }
  }
  return hits;
}
