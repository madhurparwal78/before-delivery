/** Every published message, heading and banner, character for character. */

import { formatSize } from "./sizes.js";
import { reasonText } from "./reasons.js";
import type { RejectionReason } from "./model.js";

export const EM_DASH = "\u2014";

function count(value: number, singular: string, plural: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

export const uploadCopy = {
  pending: (filename: string): string => `Uploading ${filename}...`,
  stored: (filename: string): string =>
    `${filename} stored, checksum verified. Parsing...`,
  storedQueueDown: (filename: string): string =>
    `${filename} stored, checksum verified. Queued for parsing...`,
  parsed: (filename: string, samples: number, lines: number): string =>
    `${filename} parsed: ${count(samples, "sample", "samples")}, ${count(
      lines,
      "transcript line",
      "transcript lines",
    )}.`,
  rejectedAtLine: (filename: string, line: number, reason: RejectionReason): string =>
    `${filename} rejected at line ${line}: ${reasonText(reason)}.`,
  rejected: (filename: string, reason: RejectionReason): string =>
    `${filename} rejected: ${reasonText(reason)}.`,
  duplicate: (filename: string): string => `${filename} is already on this mission.`,
  quota: (filename: string, usedBytes: number, quotaBytes: number): string =>
    `${filename} is over your Archive quota (${formatSize(usedBytes)} of ${formatSize(
      quotaBytes,
    )}).`,
  tooLarge: (filename: string): string =>
    `${filename} is over the 5,000,000-byte limit.`,
  refused: (filename: string, message: string): string =>
    `${filename} was not uploaded: ${message}`,
  storageOffline: (filename: string): string =>
    `${filename} was not stored. Capture storage is offline.`,
};

export const searchCopy = {
  pending: "Searching...",
  results: (resultCount: number, query: string): string =>
    resultCount === 0
      ? `No results for "${query}"`
      : `${count(resultCount, "result", "results")} for "${query}"`,
  offline: "Search is offline.",
};

export const consoleCopy = {
  pinning: "Pinning event...",
  pinned: (metLabel: string): string => `Event pinned at ${metLabel}.`,
  landmarkAdded: (name: string): string => `Landmark ${name} added.`,
  landmarkRemoved: (name: string): string => `Landmark ${name} removed.`,
  referenceFetching: (target: string): string => `Fetching reference ${target}...`,
  referenceReady: (target: string, vectors: number): string =>
    `Reference ${target} ready: ${count(vectors, "vector", "vectors")}.`,
  referenceUnchanged: (target: string): string => `Reference ${target} unchanged.`,
  referenceUnavailable: (target: string): string =>
    `Reference ${target} is unavailable. \u0394R shows ${EM_DASH} until a refresh succeeds.`,
  referenceCleared: "Reference cleared.",
  unitsSaved: (distanceLabel: string, speedLabel: string): string =>
    `Units saved: ${distanceLabel} and ${speedLabel}.`,
  unitsRefused:
    "Units could not be saved. The share page still opens in the previous units.",
  shareCreated: (expiresGmt: string): string =>
    `Share link ready. It expires ${expiresGmt}.`,
  shareReplaced: (expiresGmt: string): string =>
    `New share link ready. The previous link no longer works. It expires ${expiresGmt}.`,
  shareRevoked: "Share link revoked. It no longer works.",
  subscriberAdded: (url: string): string => `Subscriber ${url} added.`,
  subscriberRemoved: (url: string): string => `Subscriber ${url} removed.`,
  subscribersOffline: "Subscribers could not be changed. Webhooks are offline.",
  deleting: (filename: string): string => `Deleting ${filename}...`,
  deleted: (filename: string): string => `${filename} deleted.`,
  deleteNotSettled: (filename: string): string => `${filename} is still being processed.`,
  deleteStorageOffline: (filename: string): string =>
    `${filename} was not deleted. Capture storage is offline.`,
  deleteSearchOffline: (filename: string): string =>
    `${filename} was not deleted. Transcript search is offline.`,
};

export const planCopy = {
  pending: "Changing plan...",
  changed: (label: string): string => `Plan changed to ${label}.`,
  tooSmall: (label: string, quotaBytes: number, usedBytes: number): string =>
    `${label} holds ${formatSize(quotaBytes)}, and ${formatSize(usedBytes)} is stored.`,
  offline: "The plan was not changed. Billing did not confirm it.",
};

export const downloadCopy = {
  gone: (filename: string): string => `${filename} is no longer available.`,
  rateLimited: (retrySeconds: number): string =>
    `Too many requests for this replay link. Try again in ${retrySeconds} seconds.`,
  captureStorageOffline: (filename: string): string =>
    `${filename} was not downloaded. Capture storage is offline.`,
  dossierOffline: "The dossier was not created. The PDF renderer is offline.",
};

export const fieldErrors = {
  dayOfYear: "Use GMT day-of-year: YYYY-DDD/HH:MM:SS.",
  met: "Use a MET like +000:01:00:00 or T-000:00:05:00.",
  latitude: "Use a latitude like 12.5\u00b0 S or \u221212.5.",
  longitude: "Use a longitude like 45.25\u00b0 W or \u221245.25.",
};

export const banners = {
  storage:
    "Capture storage is offline. Uploads, deletions and capture downloads are paused; the replay still plays.",
  search: "Transcript search is offline. The track, loupe and transcript still work.",
  queue: "The parsing queue is offline. Uploads are stored and will be parsed when it returns.",
  webhooks: "Webhooks are offline. Changes are kept and sent to subscribers when it returns.",
  billing: "Billing is offline. Uploads keep your current quota; plan changes are paused.",
};

export const pages = {
  emptyAuthor: {
    heading: "No passes on this mission yet",
    line: "Upload a capture to draw the first ground track.",
  },
  emptyShare: { heading: "This replay has no passes yet", line: "" },
  revoked: {
    heading: "This replay link has been withdrawn",
    line: "The author turned this link off. Ask them for a new one.",
  },
  expired: {
    heading: "This replay link has expired",
    line: "Ask the author for a new link.",
  },
  rateLimited: {
    heading: "Too many requests for this replay link",
    line: "Wait a minute, then reload.",
  },
  unknownLink: { heading: "No replay at this link", line: "" },
  unknownMission: { heading: "Mission not found", line: "" },
  notFound: { heading: "Page not found", line: "" },
};

export const passStateText = {
  uploading: "Uploading",
  stored: "Stored",
  parsed: (samples: number): string => `Parsed: ${samples} samples`,
  rejectedAtLine: (line: number, reason: RejectionReason): string =>
    `Rejected at line ${line}: ${reasonText(reason)}`,
  rejected: (reason: RejectionReason): string => `Rejected: ${reasonText(reason)}`,
};

/** `<reference line>`. */
export function referenceLine(
  reference: { target: string; state: string; vector_count: number } | null,
): string {
  if (!reference) {
    return "No reference target";
  }
  if (reference.state === "ready") {
    return `Reference ${reference.target}: ready, ${reference.vector_count} vectors`;
  }
  return `Reference ${reference.target}: ${reference.state}`;
}
