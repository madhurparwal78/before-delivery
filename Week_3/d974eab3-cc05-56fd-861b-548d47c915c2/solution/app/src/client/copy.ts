import { BRAND, COMPANY } from "../shared/titles.js";

/** The fixed site copy: the same in every edition. The product, interviews and scenarios come from the site's API. */

export const HERO = "Energy you make, at your own pace.";
export const HERO_LINE = `${BRAND} is a daily drink stick from ${COMPANY}, made with red beet root.`;

export const ABOUT_TITLE = "Inner Pace";
export const ABOUT_LEAD =
  `Inner Pace is how ${COMPANY} thinks about energy: something your body already makes, spends in effort and rebuilds in recovery.`;
export const PANELS = [
  { title: "Effort", text: "Every climb, deadline and load of laundry spends energy your body makes from breath and food." },
  { title: "Recovery", text: "Pauses, meals and sleep are when the body rebuilds what effort used." },
  { title: "One pace", text: "Effort and recovery are not opposites. Kept in rhythm they are one pace: your Inner Pace." },
] as const;

export const OXYGEN_TITLE = "From breath to energy";
export const STAGES = [
  { name: "Breath", title: "Air reaches the lungs", text: "With each breath, air travels down to hundreds of millions of tiny air sacs in the lungs, where oxygen passes into the blood." },
  { name: "Blood", title: "Red blood cells carry it", text: "Haemoglobin inside red blood cells picks up oxygen in the lungs and carries it through the arteries to every tissue." },
  { name: "Cell", title: "Oxygen enters the cell", text: "In the smallest blood vessels, oxygen leaves the blood and moves into the cells that use it." },
  { name: "Mitochondria", title: "Mitochondria use it", text: "Inside each cell, mitochondria use oxygen to release the energy stored in food, giving off water and carbon dioxide." },
  { name: "ATP", title: "Energy you can spend", text: "That energy is held in a molecule called ATP, which muscles and nerves spend as you move, think and rest." },
] as const;

export const SCIENCE_TITLE = "A root that keeps nitrate";
export const SCIENCE_LEAD = `${BRAND} is made with red beet root. Here is what that plant is, what it holds and how it becomes a powder.`;
export const DISCLOSURES = [
  { name: "Where it grows", text: "Red beet (Beta vulgaris) is a root vegetable grown in cool climates. Its deep red colour comes from pigments called betalains." },
  { name: "What it holds", text: "Beet roots store nitrate taken up from the soil, along with natural sugars and fibre." },
  { name: "How it becomes powder", text: "Washed roots are sliced, juiced, gently dried and milled into a fine powder." },
] as const;
export const AMOUNTS_LINK = "See the amounts per stick";
export const NITRATE_STEPS = [
  { name: "Nitrate", text: "Beet roots store nitrate taken up from the soil." },
  { name: "Nitrite", text: "Bacteria in the mouth turn part of swallowed nitrate into nitrite." },
  { name: "Nitric oxide", text: "In the body, part of that nitrite becomes nitric oxide, a molecule involved in widening blood vessels." },
] as const;

export const INTERVIEWS_TITLE = "Voices on pace";
export const PROFILE_NOTE = `Everyone in these interviews is fictional. They talk about their own routines, not about results from ${BRAND}.`;

export const LIFESTYLE_TITLE = "ON and OFF, one pace";
export const LIFESTYLE_LEAD = "Some moments call for effort, others for recovery. Choose a mode, then a moment.";

export const FOOTER_LINES = [COMPANY, "A fictional company created for this site.", `© 2026 ${COMPANY}`] as const;
export const ONLINE_STORE = "Online store";

export const CONTACT = {
  title: "Contact",
  lines: ["Alder Quay Customer Care", "Phone 0120-555-014, weekdays 9:00 to 17:00"],
  email: "care@alderquay.example",
} as const;
export const PRIVACY = {
  title: "Privacy",
  text: "This site sets no cookies and keeps no record of who you are. Server logs keep the address and time of each request for 14 days.",
} as const;
export const LEGAL = {
  title: "Legal",
  text: `${COMPANY}, ${BRAND} and every person on this site are fictional. All text and pictures were made for this site.`,
} as const;

export const NOT_FOUND_TITLE = "This page does not exist.";
export const CONTENT_ALERT = "The story cannot be loaded right now. Please reload the page.";
export const SCENARIO_ALERT = "This moment cannot be shown right now. Please choose it again.";
