#!/usr/bin/env node
// Tiny JSON HTTP + WebSocket helpers for the smoke-test scripts.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
let cookieValue = '';

export async function call(method, path, body, opts = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(cookieValue ? { cookie: cookieValue } : {}),
      ...(opts.headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && !opts.keepCookie) cookieValue = setCookie.split(';')[0];
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers, text };
}

export function setCookie(v) { cookieValue = v; }
export function getCookie() { return cookieValue; }
export function freshCookie() { cookieValue = ''; }
export const BASE = base;
