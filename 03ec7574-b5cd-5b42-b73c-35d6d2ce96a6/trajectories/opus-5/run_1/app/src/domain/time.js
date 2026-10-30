export function formatTimestamp(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function unixSeconds(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Math.floor(date.getTime() / 1000);
}
