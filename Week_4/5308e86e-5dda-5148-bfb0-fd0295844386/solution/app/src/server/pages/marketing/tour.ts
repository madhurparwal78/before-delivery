/** The product tour's three captions: served as WebVTT at /media/tour.vtt and shown as the page transcript. */

interface TourCue {
  start: string;
  end: string;
  text: string;
}

export const TOUR_CUES: TourCue[] = [
  { start: "00:00:00.000", end: "00:00:04.000", text: "Watch every account in one calm view." },
  { start: "00:00:04.000", end: "00:00:09.000", text: "Send a payment and see the balance move at once." },
  { start: "00:00:09.000", end: "00:00:13.000", text: "Large payments wait for a second approver." },
];

export const tourCaptions: string = `WEBVTT\n\n${TOUR_CUES.map(
  (cue, index) => `${index + 1}\n${cue.start} --> ${cue.end}\n${cue.text}`,
).join("\n\n")}\n`;
