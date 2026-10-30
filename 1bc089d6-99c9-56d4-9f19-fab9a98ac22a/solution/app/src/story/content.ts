/** Story time: the top of the page is 21:00 and the very bottom is 22:00. */
export const STORY_START_MINUTES = 21 * 60;
export const STORY_LENGTH_MINUTES = 60;

export const preloader = {
  label: "Gathering the evening",
  enter: "Begin the hour",
  silent: "Begin in silence",
};

export const hero = {
  eyebrow: "21:00 · the hour before sleep",
  title: "Give your last hour a shape.",
  titleLines: ["Give your last hour", "a shape."],
  lead: "A slow walk through one evening, and a plan you can keep every night.",
  scrollHint: "Scroll to dim the day",
};

export const nobodyPlans = {
  index: "01",
  eyebrow: "Chapter one",
  title: "The hour nobody plans.",
  body: "Mornings get alarms and workdays get calendars. The hour before bed gets whatever is left: one more episode, one more message, the kitchen light still on. Stillhour gives that hour a beginning, a middle and an end, so the night starts on purpose.",
};

export const numbers = {
  items: [
    { value: "60", unit: "minutes", note: "One hour, set aside on purpose" },
    { value: "06", unit: "rituals", note: "Small things, done in order" },
    { value: "01", unit: "bedtime", note: "The same time, most nights" },
  ],
  region: "Tonight in numbers",
  liveMany: (count: string) => `${count} people are keeping a Stillhour tonight`,
  liveOne: "1 person is keeping a Stillhour tonight",
  liveResting: "Tonight, people everywhere are keeping a Stillhour.",
};

export const city = {
  region: "The city at night",
  captions: ["The offices close.", "The kitchens go quiet.", "One window left."],
  windows: 4096,
};

export const screen = {
  index: "02",
  eyebrow: "Chapter two",
  title: "Put the screen to bed.",
  body: "Phones are bright, close and endlessly interesting. Turn the brightness down early, move the charger out of reach, and let the last thing you look at be the room you are in.",
  dialLabel: "Screen brightness",
  dialFrom: 100,
  dialTo: 5,
};

export const water = {
  caption: "The water goes still.",
  sub: "Every ripple you scroll past grows a little calmer.",
};

export const breathe = {
  index: "03",
  eyebrow: "Chapter three",
  title: "Breathe in for four, hold for seven, out for eight.",
  body: "Three slow rounds take under a minute and tell your body the day is done. Follow the circle; the count keeps time for you.",
  start: "Breathe with me",
  stop: "Stop",
  phases: [
    { name: "Breathe in", seconds: 4 },
    { name: "Hold", seconds: 7 },
    { name: "Breathe out", seconds: 8 },
  ],
  rounds: 3,
  idle: "Ready when you are.",
  done: "Three rounds done. Notice how you feel.",
  stopped: "Breathing stopped.",
};

export const flowers = {
  caption: "Close what you opened today.",
  sub: "Tabs, tasks, conversations. Fold them shut, one by one.",
};

export const settle = {
  line: "Let the day settle.",
};

export const track = {
  index: "04",
  eyebrow: "Chapter four",
  title: "Build your hour.",
  body: "Pick the rituals that fit your evening. Together they make an hour, and you can change them any night.",
  add: (title: string) => `Add ${title} to my hour`,
  remove: (title: string) => `Remove ${title} from my hour`,
  minutes: (minutes: number) => `${minutes} min`,
  updates: "Ritual updates",
  addedCopy: (title: string, total: number) => `${title} added. ${total} of 60 minutes planned.`,
  removed: (title: string, total: number) => `${title} removed. ${total} of 60 minutes planned.`,
  noRoom: (title: string, total: number) => `There is no room for ${title}. Your hour already has ${total} of 60 minutes.`,
};

export const film = {
  index: "05",
  eyebrow: "Chapter five",
  title: "One still hour.",
  body: "A forty-second film of the evening you just scrolled through.",
  open: "Play the film",
  dialog: "One still hour",
  copy: {
    playing: "Playing",
    paused: "Paused",
    captionsOn: "Captions on",
    captionsOff: "Captions off",
    muted: "Muted",
    soundOn: "Sound on",
  },
  src: { webm: "/video/one-still-hour.webm", mp4: "/video/one-still-hour.mp4" },
  captions: "/video/one-still-hour.en.vtt",
  poster: "/images/film-poster.webp",
};

export const planner = {
  index: "06",
  eyebrow: "Chapter six",
  title: "Plan your Stillhour.",
  body: "Choose a bedtime and the rituals that lead up to it. We will send one email when your hour starts, every night, in your own time zone.",
};

export const lightsOut = {
  title: "Goodnight.",
  sub: "Lights out at 22:00.",
  links: [
    { label: "Manage my hour", href: "/manage" },
    { label: "Privacy", href: "/privacy" },
  ],
};
