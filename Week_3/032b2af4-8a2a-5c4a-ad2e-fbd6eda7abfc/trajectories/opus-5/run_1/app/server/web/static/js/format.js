export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function kilometres(metres) {
  return (metres / 1000).toFixed(2);
}

export function duration(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function paceText(secondsPerKm) {
  const whole = Math.round(secondsPerKm);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")} /km`;
}

export function speedText(kmh) {
  return `${Number(kmh).toFixed(1)} km/h`;
}

export function effortText(activity) {
  if (activity.sport_type === "ride") return speedText(activity.avg_speed_kmh);
  return paceText(activity.avg_pace_s_per_km || 0);
}

export function startedAt(iso) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export function thousands(value, decimals = 0) {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function projector(points, width, height, padding) {
  const lats = points.map((point) => point[0]);
  const lons = points.map((point) => point[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const byWidth = (width - 2 * padding) / (maxLon - minLon);
  const byHeight = (height - 2 * padding) / (maxLat - minLat);
  const scale = Math.min(byWidth, byHeight);
  const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const centreLon = (minLon + maxLon) / 2;
  const centreLat = (minLat + maxLat) / 2;
  return (lat, lon) => [width / 2 + (lon - centreLon) * zoom, height / 2 - (lat - centreLat) * zoom];
}

export function pathFrom(points, place) {
  return points
    .map((point, index) => {
      const [x, y] = place(point[0], point[1]);
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function element(tag, properties = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(properties).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("data-") || key.startsWith("aria-") || key === "role" || key === "hidden")
      node.setAttribute(key, value);
    else node[key] = value;
  });
  children.filter(Boolean).forEach((child) => node.append(child));
  return node;
}
