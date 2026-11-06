var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/shared/rat.ts
var Rat = class _Rat {
  static {
    __name(this, "Rat");
  }
  n;
  d;
  constructor(n, d = 1n) {
    const nn = typeof n === "bigint" ? n : BigInt(n);
    let dd = typeof d === "bigint" ? d : BigInt(d);
    if (dd === 0n) throw new Error("zero denominator");
    const neg = dd < 0n;
    this.n = neg ? -nn : nn;
    this.d = neg ? -dd : dd;
  }
  static of(n, d = 1n) {
    return new _Rat(n, d);
  }
  add(o) {
    return new _Rat(this.n * o.d + o.n * this.d, this.d * o.d).norm();
  }
  sub(o) {
    return new _Rat(this.n * o.d - o.n * this.d, this.d * o.d).norm();
  }
  mul(o) {
    return new _Rat(this.n * o.n, this.d * o.d).norm();
  }
  div(o) {
    return new _Rat(this.n * o.d, this.d * o.n).norm();
  }
  cmp(o) {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  isZero() {
    return this.n === 0n;
  }
  sign() {
    return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
  }
  norm() {
    if (this.n === 0n) return new _Rat(0n, 1n);
    let a = this.n < 0n ? -this.n : this.n;
    let b = this.d;
    while (b !== 0n) {
      const t = a % b;
      a = b;
      b = t;
    }
    const g = a;
    return new _Rat(this.n / g, this.d / g);
  }
  // Half-up to a whole number: 37.5 -> 38, ties away from zero.
  roundHalfUp() {
    const neg = this.n < 0n;
    const absN = neg ? -this.n : this.n;
    let q = absN / this.d;
    const r = absN % this.d;
    if (r * 2n >= this.d) q += 1n;
    return neg ? -q : q;
  }
  // Half-up to the given decimal places, returned as an exact scaled integer:
  // 5.005 at 2 places is 501, never 500.
  scaledHalfUp(places) {
    const pow = 10n ** BigInt(places);
    return new _Rat(this.n * pow, this.d).roundHalfUp();
  }
};
function divHalfUp(a, b) {
  return new Rat(a, b).roundHalfUp();
}
__name(divHalfUp, "divHalfUp");
function maxBig(a, b) {
  return a > b ? a : b;
}
__name(maxBig, "maxBig");
function minBig(a, b) {
  return a < b ? a : b;
}
__name(minBig, "minBig");

// src/shared/framerate.ts
var FRAME_RATES = ["25", "23.976", "29.97"];
function isFrameRate(v) {
  return FRAME_RATES.includes(v);
}
__name(isFrameRate, "isFrameRate");
var RATE_RAT = {
  "25": Rat.of(25n, 1n),
  "23.976": Rat.of(24000n, 1001n),
  "29.97": Rat.of(30000n, 1001n)
};
var NOMINAL_RATE = {
  "25": 25n,
  "23.976": 24n,
  "29.97": 30n
};
function realSeconds(frames, rate) {
  const f = BigInt(frames);
  switch (rate) {
    case "25":
      return Rat.of(f, 25n);
    case "23.976":
      return Rat.of(f * 1001n, 24000n).norm();
    case "29.97":
      return Rat.of(f * 1001n, 30000n).norm();
  }
}
__name(realSeconds, "realSeconds");
function realSecondsText(frames, rate) {
  const centis = realSeconds(frames, rate).scaledHalfUp(2);
  const negative = centis < 0n;
  const abs = negative ? -centis : centis;
  const units = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? "-" : ""}${units}.${cents.toString().padStart(2, "0")} s`;
}
__name(realSecondsText, "realSecondsText");
function targetFrames(targetSeconds, rate) {
  return Number(BigInt(targetSeconds) * NOMINAL_RATE[rate]);
}
__name(targetFrames, "targetFrames");
function secondsToFrames(seconds, rate) {
  const r = parseDecimalExact(seconds);
  if (r === null) return 0;
  return Number(r.mul(RATE_RAT[rate]).roundHalfUp());
}
__name(secondsToFrames, "secondsToFrames");
function nominalFrames(rate) {
  return Number(NOMINAL_RATE[rate]);
}
__name(nominalFrames, "nominalFrames");
function convertFrames(frames, from, to) {
  if (from === to) return frames;
  const exact = Rat.of(BigInt(frames) * RATE_RAT[from].d, RATE_RAT[from].n).mul(Rat.of(RATE_RAT[to].n, RATE_RAT[to].d));
  const converted = Number(exact.roundHalfUp());
  return converted < 1 ? 1 : converted;
}
__name(convertFrames, "convertFrames");
function parseDecimalExact(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const fracText = m[2] ?? "";
  const frac = fracText.length === 0 ? 0n : BigInt(fracText);
  const pow = 10n ** BigInt(fracText.length);
  return Rat.of(whole * pow + frac, pow);
}
__name(parseDecimalExact, "parseDecimalExact");
function parsePositiveDecimal(text, maxPlaces) {
  const r = parseDecimalExact(text);
  if (!r) return null;
  if (r.sign() <= 0) return null;
  if (maxPlaces !== null) {
    const pow = 10n ** BigInt(maxPlaces);
    if (r.n * pow % r.d !== 0n) return null;
  }
  return r;
}
__name(parsePositiveDecimal, "parsePositiveDecimal");

// src/shared/timecode.ts
function pad2(n) {
  return n.toString().padStart(2, "0");
}
__name(pad2, "pad2");
function ndf(frames, base) {
  const f = BigInt(frames);
  const frame = f % base;
  const totalSecs = f / base;
  const secs = totalSecs % 60n;
  const totalMins = totalSecs / 60n;
  const mins = totalMins % 60n;
  const hours = totalMins / 60n;
  return `${pad2(Number(hours))}:${pad2(Number(mins))}:${pad2(Number(secs))}:${pad2(Number(frame))}`;
}
__name(ndf, "ndf");
function dropFrameTimecode(frames) {
  const group = Math.floor(frames / 17982);
  const within = frames - group * 17982;
  const extra = within >= 2 ? 2 * Math.floor((within - 2) / 1798) : 0;
  const adjusted = frames + group * 18 + extra;
  const frame = adjusted % 30;
  const totalSecs = Math.floor(adjusted / 30);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);
  return `${pad2(hours)}:${pad2(mins)}:${pad2(secs)};${pad2(frame)}`;
}
__name(dropFrameTimecode, "dropFrameTimecode");
function dropFrameIndex(mi, s, fr) {
  let start = 0;
  for (let k = 0; k < mi; k++) start += k % 10 === 0 ? 1800 : 1798;
  const frameInMinute = mi % 10 === 0 ? fr : fr - 2;
  return start + s * 30 + frameInMinute;
}
__name(dropFrameIndex, "dropFrameIndex");
function timecode(frames, rate) {
  switch (rate) {
    case "25":
      return ndf(frames, NOMINAL_RATE["25"]);
    case "23.976":
      return ndf(frames, NOMINAL_RATE["23.976"]);
    case "29.97":
      return dropFrameTimecode(frames);
  }
}
__name(timecode, "timecode");
function framesOfTimecode(text, rate) {
  const sep = rate === "29.97" ? ";" : ":";
  const re = new RegExp(`^(\\d{2}):(\\d{2}):(\\d{2})${sep}(\\d{2})$`);
  const m = re.exec(text);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]), s = Number(m[3]), fr = Number(m[4]);
  const base = Number(NOMINAL_RATE[rate]);
  if (s >= 60 || mi >= 60 || h >= 24) return null;
  if (rate === "29.97") {
    if (fr >= 30) return null;
    return dropFrameIndex(mi, s, fr);
  }
  if (fr >= base) return null;
  return (h * 3600 + mi * 60 + s) * base + fr;
}
__name(framesOfTimecode, "framesOfTimecode");

// src/shared/folding.ts
var SMALL_FOLDS = {
  "\xE0": "a",
  "\xE1": "a",
  "\xE2": "a",
  "\xE3": "a",
  "\xE4": "a",
  "\xE5": "a",
  "\xE6": "ae",
  "\xE7": "c",
  "\xE8": "e",
  "\xE9": "e",
  "\xEA": "e",
  "\xEB": "e",
  "\xEC": "i",
  "\xED": "i",
  "\xEE": "i",
  "\xEF": "i",
  "\u0131": "i",
  "\xF1": "n",
  "\xF2": "o",
  "\xF3": "o",
  "\xF4": "o",
  "\xF5": "o",
  "\xF6": "o",
  "\xF8": "o",
  "\u0153": "oe",
  "\xF9": "u",
  "\xFA": "u",
  "\xFB": "u",
  "\xFC": "u",
  "\xFD": "y",
  "\xFF": "y",
  "\xDF": "ss",
  "\u1E9E": "ss"
};
var CAPITAL_FOLDS = {
  "\xC0": "A",
  "\xC1": "A",
  "\xC2": "A",
  "\xC3": "A",
  "\xC4": "A",
  "\xC5": "A",
  "\xC6": "AE",
  "\xC7": "C",
  "\xC8": "E",
  "\xC9": "E",
  "\xCA": "E",
  "\xCB": "E",
  "\xCC": "I",
  "\xCD": "I",
  "\xCE": "I",
  "\xCF": "I",
  "\u0130": "I",
  "\xD1": "N",
  "\xD2": "O",
  "\xD3": "O",
  "\xD4": "O",
  "\xD5": "O",
  "\xD6": "O",
  "\xD8": "O",
  "\u0152": "OE",
  "\xD9": "U",
  "\xDA": "U",
  "\xDB": "U",
  "\xDC": "U",
  "\xDD": "Y"
};
function foldForCompare(text) {
  return Array.from(text).map((ch) => {
    const small = SMALL_FOLDS[ch];
    if (small !== void 0) return small;
    const capital = CAPITAL_FOLDS[ch];
    if (capital !== void 0) return capital.toLowerCase();
    return ch.toLowerCase();
  }).join("");
}
__name(foldForCompare, "foldForCompare");
function foldAscii(text) {
  return Array.from(text).map((ch) => {
    const capital = CAPITAL_FOLDS[ch];
    if (capital !== void 0) return asciiOrUnderscore(capital);
    const small = SMALL_FOLDS[ch];
    if (small !== void 0) return asciiOrUnderscore(small);
    return asciiOrUnderscore(ch);
  }).join("");
}
__name(foldAscii, "foldAscii");
function asciiOrUnderscore(text) {
  const printable = Array.from(text).every((c) => {
    const code = c.codePointAt(0);
    return code >= 32 && code <= 126;
  });
  return printable ? text : "_";
}
__name(asciiOrUnderscore, "asciiOrUnderscore");
function titleSortKey(text) {
  return foldForCompare(text);
}
__name(titleSortKey, "titleSortKey");

// src/shared/money.ts
var CURRENCIES = ["EUR", "CAD", "USD"];
function isCurrency(v) {
  return CURRENCIES.includes(v);
}
__name(isCurrency, "isCurrency");
function taxPercentOfPlace(place) {
  switch (place) {
    case "netherlands":
      return 21n;
    case "ontario":
      return 13n;
    case "newYork":
    case "dubai":
      return null;
    default:
      return null;
  }
}
__name(taxPercentOfPlace, "taxPercentOfPlace");
function taxOfMilestone(amountMinor, percent) {
  if (percent === null) return 0n;
  const scaled = amountMinor * percent * 2n;
  const q = scaled / 200n;
  const r = scaled % 200n;
  if (r >= 100n) {
    return q + 1n;
  }
  return q;
}
__name(taxOfMilestone, "taxOfMilestone");
function splitMilestones(feeMinor) {
  const third = feeMinor / 3n;
  const rem = feeMinor - third * 3n;
  if (rem === 0n) return [third, third, third];
  if (rem === 1n) return [third + 1n, third, third];
  return [third + 1n, third + 1n, third];
}
__name(splitMilestones, "splitMilestones");
function grouped(amountMinor, decimal, mark) {
  const neg = amountMinor < 0n;
  const abs = neg ? -amountMinor : amountMinor;
  const units = abs / decimal;
  const cents = abs % decimal;
  const digits = decimal === 100n ? 2 : 0;
  const unitText = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsText = cents.toString().padStart(digits, "0");
  const body = digits > 0 ? `${unitText}.${centsText}` : unitText;
  return `${neg ? "-" : ""}${mark}${body}`;
}
__name(grouped, "grouped");
function amountText(currency, amountMinor) {
  switch (currency) {
    case "EUR":
      return grouped(amountMinor, 100n, "\u20AC");
    case "CAD":
      return grouped(amountMinor, 100n, "CA$");
    case "USD":
      return grouped(amountMinor, 100n, "US$");
  }
}
__name(amountText, "amountText");
function totalTaxOf(milestones, percent) {
  return milestones.reduce((sum, m) => sum + taxOfMilestone(m, percent), 0n);
}
__name(totalTaxOf, "totalTaxOf");

// src/shared/copy.ts
var APP_NAME = "Clapstick";
var ARTIST_NAME = "Noor Bakker Boards";
var MAIL_ADDRESS = "desk@noorbakkerboards.example";
var LANGUAGES = ["en", "nl", "fr", "ar"];
var RTL_LANGUAGES = ["ar"];
function isLanguage(v) {
  return LANGUAGES.includes(v);
}
__name(isLanguage, "isLanguage");
var PLACES = ["netherlands", "ontario", "newYork", "dubai"];
var PLACE_LABEL = {
  netherlands: "Netherlands",
  ontario: "Ontario",
  newYork: "New York",
  dubai: "Dubai"
};
var PLACE_TAX_PERCENT = {
  netherlands: 21n,
  ontario: 13n,
  newYork: null,
  dubai: null
};
var TOWNS = ["amsterdam", "newYork", "toronto", "dubai"];
var TOWN_LABEL = {
  amsterdam: "Amsterdam",
  newYork: "New York",
  toronto: "Toronto",
  dubai: "Dubai"
};
var ASPECTS = ["16:9", "1:1", "9:16"];
function isAspect(v) {
  return ASPECTS.includes(v);
}
__name(isAspect, "isAspect");
var ASPECT_RATIO = {
  "16:9": [16, 9],
  "1:1": [1, 1],
  "9:16": [9, 16]
};
var TARGET_SECONDS = [6, 15, 30, 60];
function isTargetSeconds(v) {
  return TARGET_SECONDS.includes(v);
}
__name(isTargetSeconds, "isTargetSeconds");
function targetLabel(seconds) {
  return `:${seconds.toString().padStart(2, "0")}`;
}
__name(targetLabel, "targetLabel");
var JOB_STATES = ["draft", "inReview", "signedOff", "delivered", "archived"];
var JOB_STATE_LABEL = {
  draft: "Draft",
  inReview: "In review",
  signedOff: "Signed off",
  delivered: "Delivered",
  archived: "Archived"
};
var NOTE_STATES = ["open", "done", "wontDo"];
var NOTE_STATE_LABEL = {
  open: "Open",
  done: "Done",
  wontDo: "Won't do"
};
var CLIENT_STATE_LABEL = {
  active: "Active",
  closing: "Closing",
  erasing: "Erasing",
  erased: "Erased"
};
var RENDER_STATE_LABEL = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  ready: "Ready",
  outdated: "Outdated"
};
var LICENCE_MARKETS = ["NL", "US", "CA", "AE"];
function isLicenceMarket(v) {
  return LICENCE_MARKETS.includes(v);
}
__name(isLicenceMarket, "isLicenceMarket");
var MARKET_TOWN = {
  NL: "amsterdam",
  US: "newYork",
  CA: "toronto",
  AE: "dubai"
};
var MINUTES_CHOICES = [30, 60];
var COPY = {
  sessionEnded: "Your session ended. Sign in again to keep going \u2014 what you typed is still here.",
  refreshFailed: "Couldn't refresh. Trying again.",
  wrongSignIn: "That email and password don't match.",
  typeAName: "Type a name.",
  typeAnEmail: "Type a mail address such as name@example.test.",
  passwordRule: "A password has at least 10 characters.",
  typeADate: "Type a date such as 2027-03-15.",
  typeATime: "Type a time such as 09:00.",
  typeATitle: "Type a title.",
  working: "Working\u2026"
};
var ARTIST_COPY = {
  passwordChanged: "Password changed.",
  currentPasswordWrong: "That current password doesn't match.",
  clientAdded: "Client added.",
  clientSaved: "Client saved.",
  clientDeleted: "Client deleted.",
  clientHasJobs: "A client with jobs has to be closed instead.",
  producerAdded: "Producer added.",
  producerSaved: "Producer saved.",
  closing: /* @__PURE__ */ __name((name, date) => `Closing ${name}. You can bring it back until ${date}.`, "closing"),
  backAgain: /* @__PURE__ */ __name((name) => `${name} is back.`, "backAgain"),
  closingNoChange: "This client is closing and can't change.",
  waitPassed: "The time to bring this client back has passed.",
  notClosing: "This client is not closing.",
  jobAdded: "Job added.",
  jobSaved: "Job saved.",
  jobDuplicated: "Job duplicated.",
  jobArchived: /* @__PURE__ */ __name((title) => `${title} archived.`, "jobArchived"),
  adIdEnd: "That Ad-ID should end in H or D.",
  adIdShape: "An Ad-ID has four letters, then seven letters or digits, then H or D.",
  jobArchivedRefusal: "This job is archived.",
  searchResults: /* @__PURE__ */ __name((count) => count === 1 ? "1 result." : `${count} results.`, "searchResults"),
  searchNone: "No results.",
  scriptHeader: "This file needs the header row shot,visual,audio,seconds.",
  scriptNotUtf8: "This file is not UTF-8 text.",
  scriptRowSeconds: /* @__PURE__ */ __name((row) => `Row ${row}: seconds should be a number such as 1.5.`, "scriptRowSeconds"),
  scriptRowShot: /* @__PURE__ */ __name((row) => `Row ${row}: shot is empty.`, "scriptRowShot"),
  scriptRowDuplicate: /* @__PURE__ */ __name((row, shot, other) => `Row ${row}: shot ${shot} is already in row ${other}.`, "scriptRowDuplicate"),
  scriptSaved: /* @__PURE__ */ __name((created, changed) => `Script saved: ${created} new, ${changed} changed.`, "scriptSaved"),
  scriptPreview: /* @__PURE__ */ __name((newCount, matched, refused) => `Preview ready: ${newCount} new, ${matched} matched, ${refused} refused.`, "scriptPreview"),
  uploadStored: /* @__PURE__ */ __name((name) => `${name}: Stored.`, "uploadStored"),
  uploadNotImage: "This file is not a PNG or JPEG.",
  uploadTooBig: "This file is over 8,000,000 bytes.",
  uploadAspect: /* @__PURE__ */ __name((w, h, aspect) => `This frame is ${w} x ${h}. This job is ${aspect}.`, "uploadAspect"),
  uploadDuplicate: /* @__PURE__ */ __name((number) => `Already on this board as frame ${number}.`, "uploadDuplicate"),
  storeUnavailable: "The file store is unavailable right now. Nothing was saved.",
  frameMoved: /* @__PURE__ */ __name((number, position, count) => `Frame ${number} moved to position ${position} of ${count}.`, "frameMoved"),
  frameDuplicated: /* @__PURE__ */ __name((number, newNumber) => `Frame ${number} duplicated as frame ${newNumber}.`, "frameDuplicated"),
  frameInserted: /* @__PURE__ */ __name((number, afterNumber) => `Frame ${number} inserted after frame ${afterNumber}.`, "frameInserted"),
  frameRemoved: /* @__PURE__ */ __name((number) => `Frame ${number} removed.`, "frameRemoved"),
  frameBack: /* @__PURE__ */ __name((number) => `Frame ${number} is back.`, "frameBack"),
  undoPassed: "The time to undo has passed.",
  frameSaved: /* @__PURE__ */ __name((number) => `Frame ${number} saved.`, "frameSaved"),
  frameNow: /* @__PURE__ */ __name((number, count) => `Frame ${number} is now ${count === 1 ? "1 frame" : `${count} frames`}.`, "frameNow"),
  staleBoard: /* @__PURE__ */ __name((time) => `This board was changed at ${time} Amsterdam time in another window. Your changes are still here.`, "staleBoard"),
  frameRateNow: /* @__PURE__ */ __name((rate) => `Frame rate is now ${rate}.`, "frameRateNow"),
  lineSaved: "Line saved.",
  lineRemoved: "Line removed.",
  lineOutside: /* @__PURE__ */ __name((percent) => `This line runs outside the safe area by ${percent}%.`, "lineOutside"),
  lineReading: /* @__PURE__ */ __name((need, has) => `This line needs ${need === 1 ? "1 frame" : `${need} frames`} on screen. It has ${has === 1 ? "1 frame" : `${has} frames`}.`, "lineReading"),
  lineEmpty: "Type the line's text.",
  linePastLast: "This line runs past the last frame.",
  cueAdded: /* @__PURE__ */ __name((title) => `Cue added: ${title}.`, "cueAdded"),
  cueRemoved: /* @__PURE__ */ __name((title) => `Cue removed: ${title}.`, "cueRemoved"),
  libraryUnavailable: "The music library is unavailable right now. Your cue stays.",
  licenceOrder: "The licence ends before it starts.",
  licenceDays: /* @__PURE__ */ __name((count) => count === 1 ? "Licence ends in 1 day" : `Licence ends in ${count} days`, "licenceDays"),
  licenceToday: "Licence ends today",
  licenceEnded: /* @__PURE__ */ __name((date) => `Licence ended on ${date}.`, "licenceEnded"),
  filmAsked: "Film asked for.",
  filmStored: "The stored film is shown.",
  filmReady: /* @__PURE__ */ __name((number) => `The film for Cut ${number} is ready.`, "filmReady"),
  renderBusy: /* @__PURE__ */ __name((time) => `The render service is busy. You can try again at ${time} Amsterdam time.`, "renderBusy"),
  renderIncomplete: "The render came back incomplete. Nothing was saved.",
  renderUnavailable: "The render service is unavailable right now. Nothing changed.",
  renderFailed: "The render service could not finish this film. Nothing was saved.",
  reviewReady: /* @__PURE__ */ __name((name) => `Review page ready. The mail to ${name} is on its way.`, "reviewReady"),
  pageEnded: "Page ended.",
  duePassed: "This job's due date has passed.",
  noteDone: "Note marked done.",
  noteWontDo: "Note marked won't do.",
  noteReopened: "Note reopened.",
  notesDone: /* @__PURE__ */ __name((count) => `${count} note${count === 1 ? "" : "s"} marked done.`, "notesDone"),
  noteArrived: /* @__PURE__ */ __name((name, number, time, town) => `${name} left a note on frame ${number} at ${time} ${town} time.`, "noteArrived"),
  notePosition: /* @__PURE__ */ __name((position) => `Position ${position}`, "notePosition"),
  frameGone: /* @__PURE__ */ __name((number) => `Frame gone in Cut ${number}.`, "frameGone"),
  signOffReady: /* @__PURE__ */ __name((name) => `Sign-off page ready. The mail to ${name} is on its way.`, "signOffReady"),
  signedOffArrived: /* @__PURE__ */ __name((number, name, time, town) => `Cut ${number} signed off by ${name} at ${time} ${town} time.`, "signedOffArrived"),
  callBooked: "Call booked.",
  callMoved: "Call moved.",
  callCancelled: "Call cancelled.",
  callTaken: /* @__PURE__ */ __name((time) => `That time was just taken at ${time} Amsterdam time. Pick another.`, "callTaken"),
  callMissing: /* @__PURE__ */ __name((time, town, date) => `${time} does not exist in ${town} on ${date}.`, "callMissing"),
  callPast: "That time has passed.",
  packageReady: "Package ready.",
  pdfUnavailable: "The PDF service is unavailable right now. Nothing was saved.",
  licenceEndedPackage: /* @__PURE__ */ __name((title, date) => `The licence for ${title} ended on ${date}.`, "licenceEndedPackage"),
  onlySignedOff: "Only a signed-off cut can be delivered.",
  noDrawing: /* @__PURE__ */ __name((number) => `Frame ${number} has no drawing yet.`, "noDrawing"),
  tooManyDownloads: /* @__PURE__ */ __name((time) => `Too many downloads for now. You can download again at ${time} Amsterdam time.`, "tooManyDownloads"),
  letterSaved: "Letter saved.",
  feePageReady: /* @__PURE__ */ __name((name) => `Fee page ready. The mail to ${name} is on its way.`, "feePageReady"),
  letterAcceptedArrived: /* @__PURE__ */ __name((name) => `Letter accepted by ${name}.`, "letterAcceptedArrived"),
  amountShape: "Type an amount such as 1835.50.",
  letterAcceptedLock: "This letter is accepted and can't change.",
  letterStale: /* @__PURE__ */ __name((time, town) => `This letter was changed at ${time} ${town} time. Read it again.`, "letterStale"),
  cutMade: /* @__PURE__ */ __name((number) => `Cut ${number} made.`, "cutMade"),
  cutBroughtBack: /* @__PURE__ */ __name((number) => `Cut ${number} is the board again.`, "cutBroughtBack"),
  cutDeleted: /* @__PURE__ */ __name((number) => `Cut ${number} deleted.`, "cutDeleted"),
  cutSaved: /* @__PURE__ */ __name((number) => `Cut ${number} saved.`, "cutSaved"),
  cutSignedNoChange: "A signed-off cut can't change.",
  differencesNone: "These two cuts are the same."
};
var VISITOR_COPY = {
  addressCopied: "Address copied.",
  copyRefused: "Press Ctrl+C to copy the address.",
  enquiryThanks: "Thanks. I answer within two working days.",
  enquiryLimit: /* @__PURE__ */ __name((time) => `Too many enquiries from this address for now. You can send again at ${time} Amsterdam time.`, "enquiryLimit"),
  enquiryMessage: "Type your message."
};
var PRIVATE_COPY = {
  en: {
    reviewHeading: "Review of <title>",
    stepsGroup: "Steps",
    stepFrames: "Frames",
    stepNotes: "Notes",
    stepSend: "Send",
    next: "Next",
    back: "Back",
    openSheet: "Open notes",
    close: "Close",
    filmStrip: "Film strip",
    clip: "Frame <number>",
    earlier: "Earlier",
    later: "Later",
    play: "Play",
    pause: "Pause",
    placePin: "Place a pin",
    noteField: "Your note",
    lengthField: "Suggested length in seconds",
    lengthInFrames: "<count> frames",
    attachment: "Attach a drawing",
    addNote: "Add note",
    nameField: "Your full name",
    sendNotes: "Send notes",
    notesSent: "Your notes were sent.",
    draftRefused: "This draft is not kept on this device.",
    numberCopy: "Type a length such as 1.5.",
    emptyNote: "Type your note.",
    emptyName: "Type your full name.",
    badAttachment: "This file is not a PNG or JPEG.",
    bigAttachment: "This file is over 5,000,000 bytes.",
    problems: "Problems",
    working: "Working\u2026",
    refreshLine: "Couldn't refresh. Trying again.",
    ended: "This page has ended.",
    askLink: "Ask for a new link",
    mailField: "Mail address",
    linkAnswer: "If that address belongs to this page, a new link is on its way.",
    linkLimit: "Too many requests for now. Try again later.",
    signOffHeading: "Sign-off for <title>",
    signOffButton: "Sign off",
    signed: "Signed off at <when>.",
    alreadySigned: "Already signed off at <when>.",
    newerCut: "A newer cut was made at <when>. Read it first.",
    wrongName: "That name doesn't match. Type your full name as it was given.",
    mailReviewSubject: "Your review page for <title>",
    mailReminderSubject: "Reminder: your review page for <title>",
    mailNewLinkSubject: "Your new link",
    mailDueLine: "Due <date>",
    mailCallSubject: "Call on <date>",
    mailCancelledCallSubject: "Call cancelled: <date>"
  },
  nl: {
    reviewHeading: "Beoordeling van <title>",
    stepsGroup: "Stappen",
    stepFrames: "Beelden",
    stepNotes: "Notities",
    stepSend: "Versturen",
    next: "Volgende",
    back: "Terug",
    openSheet: "Notities openen",
    close: "Sluiten",
    filmStrip: "Filmstrook",
    clip: "Beeld <number>",
    earlier: "Eerder",
    later: "Later",
    play: "Afspelen",
    pause: "Pauzeren",
    placePin: "Speld plaatsen",
    noteField: "Je notitie",
    lengthField: "Voorgestelde lengte in seconden",
    lengthInFrames: "<count> beelden",
    attachment: "Tekening toevoegen",
    addNote: "Notitie toevoegen",
    nameField: "Je volledige naam",
    sendNotes: "Notities versturen",
    notesSent: "Je notities zijn verstuurd.",
    draftRefused: "Dit concept wordt niet op dit apparaat bewaard.",
    numberCopy: "Typ een lengte zoals 1,5.",
    emptyNote: "Typ je notitie.",
    emptyName: "Typ je volledige naam.",
    badAttachment: "Dit bestand is geen PNG of JPEG.",
    bigAttachment: "Dit bestand is groter dan 5.000.000 bytes.",
    problems: "Problemen",
    working: "Bezig\u2026",
    refreshLine: "Vernieuwen is niet gelukt. We proberen het opnieuw.",
    ended: "Deze pagina is verlopen.",
    askLink: "Vraag een nieuwe link aan",
    mailField: "E-mailadres",
    linkAnswer: "Als dit adres bij deze pagina hoort, is er een nieuwe link onderweg.",
    linkLimit: "Te veel verzoeken. Probeer het later opnieuw.",
    signOffHeading: "Akkoord voor <title>",
    signOffButton: "Akkoord geven",
    signed: "Akkoord gegeven om <when>.",
    alreadySigned: "Al akkoord gegeven om <when>.",
    newerCut: "Er is om <when> een nieuwere versie gemaakt. Lees die eerst.",
    wrongName: "Die naam komt niet overeen. Typ je volledige naam zoals die is doorgegeven.",
    mailReviewSubject: "Je beoordelingspagina voor <title>",
    mailReminderSubject: "Herinnering: je beoordelingspagina voor <title>",
    mailNewLinkSubject: "Je nieuwe link",
    mailDueLine: "Uiterlijk <date>",
    mailCallSubject: "Gesprek op <date>",
    mailCancelledCallSubject: "Gesprek geannuleerd: <date>"
  },
  fr: {
    reviewHeading: "Relecture de <title>",
    stepsGroup: "\xC9tapes",
    stepFrames: "Images",
    stepNotes: "Notes",
    stepSend: "Envoyer",
    next: "Volgende",
    back: "Retour",
    openSheet: "Ouvrir les notes",
    close: "Fermer",
    filmStrip: "Bande de film",
    clip: "Image <number>",
    earlier: "Plus t\xF4t",
    later: "Plus tard",
    play: "Lire",
    pause: "Pause",
    placePin: "Placer une \xE9pingle",
    noteField: "Votre note",
    lengthField: "Dur\xE9e sugg\xE9r\xE9e en secondes",
    lengthInFrames: "<count> images",
    attachment: "Joindre un dessin",
    addNote: "Ajouter la note",
    nameField: "Votre nom complet",
    sendNotes: "Envoyer les notes",
    notesSent: "Vos notes ont \xE9t\xE9 envoy\xE9es.",
    draftRefused: "Ce brouillon n'est pas conserv\xE9 sur cet appareil.",
    numberCopy: "Saisissez une dur\xE9e comme 1,5.",
    emptyNote: "Saisissez votre note.",
    emptyName: "Saisissez votre nom complet.",
    badAttachment: "Ce fichier n'est ni un PNG ni un JPEG.",
    bigAttachment: "Ce fichier d\xE9passe 5 000 000 octets.",
    problems: "Probl\xE8mes",
    working: "En cours\u2026",
    refreshLine: "Actualisation impossible. Nouvel essai en cours.",
    ended: "Cette page est termin\xE9e.",
    askLink: "Demander un nouveau lien",
    mailField: "Adresse e-mail",
    linkAnswer: "Si cette adresse correspond \xE0 cette page, un nouveau lien est en route.",
    linkLimit: "Trop de demandes pour le moment. R\xE9essayez plus tard.",
    signOffHeading: "Validation de <title>",
    signOffButton: "Valider",
    signed: "Valid\xE9 \xE0 <when>.",
    alreadySigned: "D\xE9j\xE0 valid\xE9 \xE0 <when>.",
    newerCut: "Une version plus r\xE9cente a \xE9t\xE9 faite \xE0 <when>. Lisez-la d'abord.",
    wrongName: "Ce nom ne correspond pas. Saisissez votre nom complet tel qu'il a \xE9t\xE9 donn\xE9.",
    mailReviewSubject: "Votre page de relecture pour <title>",
    mailReminderSubject: "Rappel : votre page de relecture pour <title>",
    mailNewLinkSubject: "Votre nouveau lien",
    mailDueLine: "\xC0 rendre le <date>",
    mailCallSubject: "Appel le <date>",
    mailCancelledCallSubject: "Appel annul\xE9 : <date>"
  },
  ar: {
    reviewHeading: "\u0645\u0631\u0627\u062C\u0639\u0629 <title>",
    stepsGroup: "\u0627\u0644\u062E\u0637\u0648\u0627\u062A",
    stepFrames: "\u0627\u0644\u0625\u0637\u0627\u0631\u0627\u062A",
    stepNotes: "\u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    stepSend: "\u0625\u0631\u0633\u0627\u0644",
    next: "\u0627\u0644\u062A\u0627\u0644\u064A",
    back: "\u0627\u0644\u0633\u0627\u0628\u0642",
    openSheet: "\u0641\u062A\u062D \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    close: "\u0625\u063A\u0644\u0627\u0642",
    filmStrip: "\u0634\u0631\u064A\u0637 \u0627\u0644\u0641\u064A\u0644\u0645",
    clip: "\u0627\u0644\u0625\u0637\u0627\u0631 <number>",
    earlier: "\u0623\u0628\u0643\u0631",
    later: "\u0644\u0627\u062D\u0642\u064B\u0627",
    play: "\u062A\u0634\u063A\u064A\u0644",
    pause: "\u0625\u064A\u0642\u0627\u0641 \u0645\u0624\u0642\u062A",
    placePin: "\u0648\u0636\u0639 \u062F\u0628\u0648\u0633",
    noteField: "\u0645\u0644\u0627\u062D\u0638\u062A\u0643",
    lengthField: "\u0627\u0644\u0645\u062F\u0629 \u0627\u0644\u0645\u0642\u062A\u0631\u062D\u0629 \u0628\u0627\u0644\u062B\u0648\u0627\u0646\u064A",
    lengthInFrames: "<count> \u0625\u0637\u0627\u0631\u064B\u0627",
    attachment: "\u0625\u0631\u0641\u0627\u0642 \u0631\u0633\u0645",
    addNote: "\u0625\u0636\u0627\u0641\u0629 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0629",
    nameField: "\u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644",
    sendNotes: "\u0625\u0631\u0633\u0627\u0644 \u0627\u0644\u0645\u0644\u0627\u062D\u0638\u0627\u062A",
    notesSent: "\u062A\u0645 \u0625\u0631\u0633\u0627\u0644 \u0645\u0644\u0627\u062D\u0638\u0627\u062A\u0643.",
    draftRefused: "\u0644\u0627 \u064A\u062A\u0645 \u062D\u0641\u0638 \u0647\u0630\u0647 \u0627\u0644\u0645\u0633\u0648\u062F\u0629 \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u062C\u0647\u0627\u0632.",
    numberCopy: "\u0627\u0643\u062A\u0628 \u0645\u062F\u0629 \u0645\u062B\u0644 \u0661\u066B\u0665.",
    emptyNote: "\u0627\u0643\u062A\u0628 \u0645\u0644\u0627\u062D\u0638\u062A\u0643.",
    emptyName: "\u0627\u0643\u062A\u0628 \u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644.",
    badAttachment: "\u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u0644\u064A\u0633 PNG \u0623\u0648 JPEG.",
    bigAttachment: "\u062D\u062C\u0645 \u0647\u0630\u0627 \u0627\u0644\u0645\u0644\u0641 \u064A\u062A\u062C\u0627\u0648\u0632 5,000,000 \u0628\u0627\u064A\u062A.",
    problems: "\u0627\u0644\u0645\u0634\u0643\u0644\u0627\u062A",
    working: "\u062C\u0627\u0631\u064D \u0627\u0644\u0639\u0645\u0644\u2026",
    refreshLine: "\u062A\u0639\u0630\u0631 \u0627\u0644\u062A\u062D\u062F\u064A\u062B. \u062C\u0627\u0631\u064D \u0625\u0639\u0627\u062F\u0629 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629.",
    ended: "\u0627\u0646\u062A\u0647\u062A \u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629.",
    askLink: "\u0637\u0644\u0628 \u0631\u0627\u0628\u0637 \u062C\u062F\u064A\u062F",
    mailField: "\u0639\u0646\u0648\u0627\u0646 \u0627\u0644\u0628\u0631\u064A\u062F \u0627\u0644\u0625\u0644\u0643\u062A\u0631\u0648\u0646\u064A",
    linkAnswer: "\u0625\u0630\u0627 \u0643\u0627\u0646 \u0647\u0630\u0627 \u0627\u0644\u0639\u0646\u0648\u0627\u0646 \u0645\u0631\u062A\u0628\u0637\u064B\u0627 \u0628\u0647\u0630\u0647 \u0627\u0644\u0635\u0641\u062D\u0629\u060C \u0641\u0633\u064A\u0635\u0644\u0643 \u0631\u0627\u0628\u0637 \u062C\u062F\u064A\u062F \u0642\u0631\u064A\u0628\u064B\u0627.",
    linkLimit: "\u0637\u0644\u0628\u0627\u062A \u0643\u062B\u064A\u0631\u0629 \u062C\u062F\u064B\u0627 \u0627\u0644\u0622\u0646. \u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0644\u0627\u062D\u0642\u064B\u0627.",
    signOffHeading: "\u0627\u0639\u062A\u0645\u0627\u062F <title>",
    signOffButton: "\u0627\u0639\u062A\u0645\u0627\u062F",
    signed: "\u062A\u0645 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0641\u064A <when>.",
    alreadySigned: "\u062A\u0645 \u0627\u0644\u0627\u0639\u062A\u0645\u0627\u062F \u0628\u0627\u0644\u0641\u0639\u0644 \u0641\u064A <when>.",
    newerCut: "\u062A\u0645 \u0625\u0639\u062F\u0627\u062F \u0646\u0633\u062E\u0629 \u0623\u062D\u062F\u062B \u0641\u064A <when>. \u0627\u0642\u0631\u0623\u0647\u0627 \u0623\u0648\u0644\u0627\u064B.",
    wrongName: "\u0647\u0630\u0627 \u0627\u0644\u0627\u0633\u0645 \u063A\u064A\u0631 \u0645\u0637\u0627\u0628\u0642. \u0627\u0643\u062A\u0628 \u0627\u0633\u0645\u0643 \u0627\u0644\u0643\u0627\u0645\u0644 \u0643\u0645\u0627 \u0647\u0648 \u0645\u0633\u062C\u0644.",
    mailReviewSubject: "\u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0643 \u0644\u0640 <title>",
    mailReminderSubject: "\u062A\u0630\u0643\u064A\u0631: \u0635\u0641\u062D\u0629 \u0627\u0644\u0645\u0631\u0627\u062C\u0639\u0629 \u0627\u0644\u062E\u0627\u0635\u0629 \u0628\u0643 \u0644\u0640 <title>",
    mailNewLinkSubject: "\u0631\u0627\u0628\u0637\u0643 \u0627\u0644\u062C\u062F\u064A\u062F",
    mailDueLine: "\u0627\u0644\u0645\u0648\u0639\u062F \u0627\u0644\u0646\u0647\u0627\u0626\u064A <date>",
    mailCallSubject: "\u0645\u0643\u0627\u0644\u0645\u0629 \u0641\u064A <date>",
    mailCancelledCallSubject: "\u062A\u0645 \u0625\u0644\u063A\u0627\u0621 \u0627\u0644\u0645\u0643\u0627\u0644\u0645\u0629: <date>"
  }
};
var FEE_COPY = {
  heading: /* @__PURE__ */ __name((title) => `Fee letter for ${title}`, "heading"),
  acceptLetter: "Accept letter",
  openTheLetter: "Open the letter",
  yourFullName: "Your full name",
  acceptedLine: "Letter accepted.",
  mailSubject: /* @__PURE__ */ __name((title) => `Your fee letter for ${title}`, "mailSubject")
};
var TOWN_TIME_PHRASE = {
  newYork: { en: "New York time", nl: "tijd in New York", fr: "heure de New York", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u0646\u064A\u0648\u064A\u0648\u0631\u0643" },
  toronto: { en: "Toronto time", nl: "tijd in Toronto", fr: "heure de Toronto", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u062A\u0648\u0631\u0646\u062A\u0648" },
  amsterdam: { en: "Amsterdam time", nl: "tijd in Amsterdam", fr: "heure d'Amsterdam", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u0623\u0645\u0633\u062A\u0631\u062F\u0627\u0645" },
  dubai: { en: "Dubai time", nl: "tijd in Dubai", fr: "heure de Duba\xEF", ar: "\u0628\u062A\u0648\u0642\u064A\u062A \u062F\u0628\u064A" }
};

// src/shared/tz.ts
function townOffsetMinutes(town, at) {
  switch (town) {
    case "dubai":
      return 240;
    case "amsterdam":
      return inSummer(at, euStart, euEnd) ? 120 : 60;
    case "newYork":
    case "toronto":
      return inSummer(at, naStart, naEnd) ? -240 : -300;
  }
}
__name(townOffsetMinutes, "townOffsetMinutes");
function euStart(year) {
  return lastSundayUtc(year, 2, 1);
}
__name(euStart, "euStart");
function euEnd(year) {
  return lastSundayUtc(year, 9, 1);
}
__name(euEnd, "euEnd");
function naStart(year) {
  return nthSundayUtc(year, 2, 2, 7);
}
__name(naStart, "naStart");
function naEnd(year) {
  return nthSundayUtc(year, 10, 1, 6);
}
__name(naEnd, "naEnd");
function lastSundayUtc(year, monthIndex0, hourUtc) {
  const d = new Date(Date.UTC(year, monthIndex0 + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hourUtc) / 1e3);
}
__name(lastSundayUtc, "lastSundayUtc");
function nthSundayUtc(year, monthIndex0, n, hourUtc) {
  const d = new Date(Date.UTC(year, monthIndex0, 1));
  const firstSunday = 1 + (7 - d.getUTCDay()) % 7;
  return Math.floor(Date.UTC(year, monthIndex0, firstSunday + (n - 1) * 7, hourUtc) / 1e3);
}
__name(nthSundayUtc, "nthSundayUtc");
function inSummer(at, startOf, endOf) {
  const year = new Date(at * 1e3).getUTCFullYear();
  for (const y of [year - 1, year, year + 1]) {
    const start = startOf(y);
    const end = endOf(y);
    if (at >= start && at < end) return true;
  }
  return false;
}
__name(inSummer, "inSummer");
function pad(n) {
  return n.toString().padStart(2, "0");
}
__name(pad, "pad");
function sameWall(town, at, date, h, m) {
  const local = at + townOffsetMinutes(town, at) * 60;
  const d = new Date(local * 1e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` === date && d.getUTCHours() === h && d.getUTCMinutes() === m;
}
__name(sameWall, "sameWall");
function instantOfWall(town, date, time) {
  const h = Number(time.slice(0, 2));
  const m = Number(time.slice(3, 5));
  const naive = Math.floor(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      h,
      m
    ) / 1e3
  );
  const matches = [];
  for (const minutes of [240, 180, 120, 60, 0, -60, -120, -180, -240, -300, -360]) {
    const at = naive - minutes * 60;
    if (sameWall(town, at, date, h, m)) matches.push(at);
  }
  if (matches.length === 0) return null;
  return Math.min(...matches);
}
__name(instantOfWall, "instantOfWall");
function wallTime(town, at) {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1e3);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
__name(wallTime, "wallTime");
function wallDate(town, at) {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
__name(wallDate, "wallDate");
var WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function longDate(town, at) {
  const d = new Date((at + townOffsetMinutes(town, at) * 60) * 1e3);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
__name(longDate, "longDate");
function dateTimeTown(town, at, townText) {
  return `${longDate(town, at)}, ${wallTime(town, at)} ${townText} time`;
}
__name(dateTimeTown, "dateTimeTown");
function instantText(at) {
  const d = new Date(at * 1e3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}
__name(instantText, "instantText");
function dateOnly(date) {
  return Math.floor(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1e3
  );
}
__name(dateOnly, "dateOnly");
function weekStartOfAmsterdam(at) {
  const d = new Date((at + townOffsetMinutes("amsterdam", at) * 60) * 1e3);
  const back = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}
__name(weekStartOfAmsterdam, "weekStartOfAmsterdam");
function addDays(date, days) {
  const d = new Date(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
  );
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
__name(addDays, "addDays");

// src/shared/ics.ts
function escapeText(text) {
  return text.replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
}
__name(escapeText, "escapeText");
function fold(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    let limit = start + (first ? 75 : 74);
    if (limit >= bytes.length) {
      parts.push(bytes.subarray(start).toString("utf8"));
      break;
    }
    while (limit > start && (bytes[limit] & 192) === 128) limit--;
    parts.push(bytes.subarray(start, limit).toString("utf8"));
    start = limit;
    first = false;
  }
  return parts.join("\r\n ");
}
__name(fold, "fold");
function utcStamp(at) {
  const t = instantText(at);
  return `${t.slice(0, 4)}${t.slice(5, 7)}${t.slice(8, 10)}T${t.slice(11, 13)}${t.slice(14, 16)}${t.slice(17, 19)}Z`;
}
__name(utcStamp, "utcStamp");
function calendarFile(call, method) {
  const start = instantOfWall(call.town, call.date, call.time);
  if (start === null) throw new Error("wall time does not exist");
  const end = start + call.minutes * 60;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Noor Bakker Boards//Clapstick//EN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${call.uid}`,
    `SEQUENCE:${call.sequence}`,
    `DTSTAMP:${utcStamp(start)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    fold(`SUMMARY:${escapeText(`Call with ${call.producerName}`)}`),
    fold(`DESCRIPTION:${escapeText(call.note)}`),
    `ORGANIZER:mailto:${call.artistEmail}`,
    fold(`ATTENDEE:mailto:${call.producerEmail}`),
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
__name(calendarFile, "calendarFile");
var CALENDAR_FILE_NAME = "call.ics";
var CALENDAR_MIME = "text/calendar";

// src/shared/edl.ts
function pad3(n, width) {
  return n.toString().padStart(width, "0");
}
__name(pad3, "pad");
function recordStart(rate) {
  switch (rate) {
    case "29.97":
      return 107892;
    case "25":
      return 25 * 3600;
    case "23.976":
      return 24 * 3600;
  }
}
__name(recordStart, "recordStart");
function clipName(clip) {
  return clip.fileName ?? `frame-${clip.frame}.svg`;
}
__name(clipName, "clipName");
function editDecisionList(title, rate, clips) {
  const lines = [];
  const foldedTitle = foldAscii(title).slice(0, 70);
  lines.push(`TITLE: ${foldedTitle}`);
  lines.push(rate === "29.97" ? "FCM: DROP FRAME" : "FCM: NON-DROP FRAME");
  lines.push("");
  let record = recordStart(rate);
  let event = 1;
  for (const clip of clips) {
    const sourceIn = timecode(0, rate);
    const sourceOut = timecode(clip.durationFrames, rate);
    const recordIn = timecode(record, rate);
    const recordOut = timecode(record + clip.durationFrames, rate);
    lines.push(
      `${pad3(event, 3)}  AX       V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`
    );
    lines.push(`* FROM CLIP NAME: ${foldAscii(clipName(clip))}`);
    record += clip.durationFrames;
    event++;
  }
  return lines.join("\r\n") + "\r\n";
}
__name(editDecisionList, "editDecisionList");

// src/shared/shotlist.ts
function shotListRow(position, frame, startFrame, durationFrames, rate, shot, visual, audio, actionNote) {
  return {
    position,
    frame,
    timecodeIn: timecode(startFrame, rate),
    seconds: realSecondsText(durationFrames, rate).replace(" s", ""),
    shot,
    visual,
    audio,
    actionNote
  };
}
__name(shotListRow, "shotListRow");
function cell(text) {
  let value = text ?? "";
  if (/^[=+\-@\t\r]/.test(value)) {
    value = `'${value}`;
  }
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
__name(cell, "cell");
function shotList(rows) {
  const header = ["position", "frame", "timecodeIn", "seconds", "shot", "visual", "audio", "actionNote"];
  const lines = [header.map(cell).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.position.toString(),
        row.frame.toString(),
        row.timecodeIn,
        row.seconds,
        row.shot,
        row.visual,
        row.audio,
        row.actionNote
      ].map(cell).join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
__name(shotList, "shotList");

// src/shared/svg.ts
var WIDTH = 1280;
var HEIGHT = 720;
function seedOf(text) {
  let h = 2166136261;
  for (const byte of Buffer.from(text, "utf8")) {
    h ^= byte;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
__name(seedOf, "seedOf");
function rand(seed) {
  let s = seed;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
__name(rand, "rand");
function frameDrawingSvg(frameNumber, actionNote) {
  const seed = seedOf(`${frameNumber}:${actionNote}`);
  const next = rand(seed);
  const lines = [];
  lines.push(`<rect x="24" y="24" width="${WIDTH - 48}" height="${HEIGHT - 48}" fill="none" stroke="#1a1a1a" stroke-width="3"/>`);
  const horizon = 300 + Math.floor(next() * 220);
  lines.push(`<line x1="48" y1="${horizon}" x2="${WIDTH - 48}" y2="${horizon - Math.floor(next() * 60)}" stroke="#1a1a1a" stroke-width="2"/>`);
  const shapes = 3 + Math.floor(next() * 3);
  for (let i = 0; i < shapes; i++) {
    const x = 80 + Math.floor(next() * (WIDTH - 200));
    const y = horizon - Math.floor(next() * 180);
    const w = 60 + Math.floor(next() * 260);
    const h = 40 + Math.floor(next() * 200);
    if (next() > 0.5) {
      lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`);
    } else {
      lines.push(`<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 2}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`);
    }
  }
  const ax = 160 + Math.floor(next() * 500);
  const ay = horizon + 60 + Math.floor(next() * 160);
  lines.push(`<path d="M ${ax} ${ay} C ${ax + 140} ${ay - 70}, ${ax + 260} ${ay + 40}, ${ax + 380} ${ay - 30}" fill="none" stroke="#b3261e" stroke-width="6" stroke-linecap="round"/>`);
  lines.push(`<path d="M ${ax + 380} ${ay - 30} l -34 -6 l 14 30 z" fill="#b3261e"/>`);
  lines.push(`<line x1="48" y1="${HEIGHT - 60}" x2="${WIDTH - 200}" y2="${HEIGHT - 60}" stroke="#1a1a1a" stroke-width="2"/>`);
  const body = lines.join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
  ${body}
</svg>
`;
}
__name(frameDrawingSvg, "frameDrawingSvg");
var DRAWING_WIDTH = WIDTH;
var DRAWING_HEIGHT = HEIGHT;
var DRAWING_MIME = "image/svg+xml";
function seededDrawingName(frameNumber) {
  return `frame-${frameNumber}.svg`;
}
__name(seededDrawingName, "seededDrawingName");
export {
  APP_NAME,
  ARTIST_COPY,
  ARTIST_NAME,
  ASPECTS,
  ASPECT_RATIO,
  CALENDAR_FILE_NAME,
  CALENDAR_MIME,
  CLIENT_STATE_LABEL,
  COPY,
  CURRENCIES,
  DRAWING_HEIGHT,
  DRAWING_MIME,
  DRAWING_WIDTH,
  FEE_COPY,
  FRAME_RATES,
  JOB_STATES,
  JOB_STATE_LABEL,
  LANGUAGES,
  LICENCE_MARKETS,
  MAIL_ADDRESS,
  MARKET_TOWN,
  MINUTES_CHOICES,
  NOMINAL_RATE,
  NOTE_STATES,
  NOTE_STATE_LABEL,
  PLACES,
  PLACE_LABEL,
  PLACE_TAX_PERCENT,
  PRIVATE_COPY,
  RATE_RAT,
  RENDER_STATE_LABEL,
  RTL_LANGUAGES,
  Rat,
  TARGET_SECONDS,
  TOWNS,
  TOWN_LABEL,
  TOWN_TIME_PHRASE,
  VISITOR_COPY,
  addDays,
  amountText,
  calendarFile,
  convertFrames,
  dateOnly,
  dateTimeTown,
  divHalfUp,
  editDecisionList,
  foldAscii,
  foldForCompare,
  frameDrawingSvg,
  framesOfTimecode,
  instantOfWall,
  instantText,
  isAspect,
  isCurrency,
  isFrameRate,
  isLanguage,
  isLicenceMarket,
  isTargetSeconds,
  longDate,
  maxBig,
  minBig,
  nominalFrames,
  parseDecimalExact,
  parsePositiveDecimal,
  realSeconds,
  realSecondsText,
  secondsToFrames,
  seededDrawingName,
  shotList,
  shotListRow,
  splitMilestones,
  targetFrames,
  targetLabel,
  taxOfMilestone,
  taxPercentOfPlace,
  timecode,
  titleSortKey,
  totalTaxOf,
  townOffsetMinutes,
  wallDate,
  wallTime,
  weekStartOfAmsterdam
};
