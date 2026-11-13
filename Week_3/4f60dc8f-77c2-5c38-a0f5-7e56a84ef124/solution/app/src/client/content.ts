// The studio's published content, read once per visit and kept for in-place navigation.
import { api, type ApiFailure, type Content } from "./api";

/** The server inlines the published content into home and case study pages, so their first render is complete. */
function inlined(): Content | null {
  const element = document.getElementById("studio-content");
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as Content;
  } catch {
    return null;
  }
}

let cached: Content | null = inlined();
let pending: Promise<Content | ApiFailure> | null = null;

export function cachedContent(): Content | null {
  return cached;
}

export function loadContent(): Promise<Content | ApiFailure> {
  if (cached) return Promise.resolve(cached);
  pending ??= api<Content>("GET", "/api/content").then((reply) => {
    pending = null;
    if (!reply.ok) return reply.failure;
    cached = reply.data;
    return reply.data;
  });
  return pending;
}
