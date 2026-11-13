const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres, the same formula the server uses. */
function haversine(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const half = (rad(b.lat) - rad(a.lat)) / 2;
  const halfLon = rad(b.lon - a.lon) / 2;
  const h = Math.sin(half) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(halfLon) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** The distance in whole metres a GPX document will be stored with, or null when it has no usable track. */
export function previewDistance(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) return null;
  const points = [];
  for (const node of doc.getElementsByTagNameNS("*", "trkpt")) {
    const stamp = node.getElementsByTagNameNS("*", "time")[0];
    const lat = Number(node.getAttribute("lat")), lon = Number(node.getAttribute("lon"));
    if (stamp && Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat, lon });
  }
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i++) total += haversine(points[i - 1], points[i]);
  return Math.floor(total + 0.5);
}
