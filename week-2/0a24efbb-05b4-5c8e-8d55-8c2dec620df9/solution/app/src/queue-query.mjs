// The canonical queue query, shared by the server, the server-drawn pages and the browser island.

export const QUEUE_PARAMS = ["state", "type", "person", "month", "q", "sort", "page"];

/** The first value of each queue parameter, an empty value counting as absent. */
export function queueValues(search) {
  const params = new URLSearchParams(search);
  const values = {};
  for (const name of QUEUE_PARAMS) {
    const value = params.get(name);
    if (value) values[name] = value;
  }
  return values;
}

/** Only parameters that differ from their defaults, in the published order; `page=1` is never written. */
export function canonicalQuery(values) {
  const out = new URLSearchParams();
  for (const name of QUEUE_PARAMS) {
    const value = name === "q" ? String(values.q ?? "").trim() : String(values[name] ?? "");
    if (value && !(name === "page" && value === "1")) out.append(name, value);
  }
  return out.toString();
}

/** A queue path with its canonical query. */
export function queueHref(path, values) {
  const query = canonicalQuery(values);
  return query ? `${path}?${query}` : path;
}
