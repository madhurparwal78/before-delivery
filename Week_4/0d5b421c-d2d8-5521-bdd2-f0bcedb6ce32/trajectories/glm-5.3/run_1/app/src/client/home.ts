import { apiJson, escapeHtml, openEvents, lisbonToday } from "./shared.js";

interface TonightResponse {
  date: string;
  server_now: string;
  next_slot: string | null;
  rooms: {
    room_id: string;
    name: string;
    seats: number;
    covers_free_at_next_slot: number | null;
    next_table_for_two: string | null;
  }[];
}

interface RoomPortrait { room_id: string; name: string; seats: number; }

/** The six room portraits in published order, each as a flat elevation. */
function roomPortraitSvg(name: string): string {
  // A drawn elevation in black and dark wine on a pink ground.
  const motifs: Record<string, string> = {
    "window-row": `<rect x="30" y="60" width="140" height="180" fill="#4b1626"/><rect x="40" y="70" width="120" height="160" fill="#ffd6e8"/><rect x="46" y="76" width="52" height="148" fill="#14090f"/><rect x="106" y="76" width="52" height="148" fill="#14090f"/><rect x="46" y="150" width="112" height="4" fill="#4b1626"/>`,
    "hearth": `<rect x="60" y="130" width="80" height="110" fill="#14090f"/><rect x="70" y="140" width="60" height="100" fill="#4b1626"/><polygon points="100,150 82,190 118,190" fill="#ffd6e8"/><rect x="60" y="120" width="80" height="10" fill="#14090f"/><rect x="40" y="230" width="120" height="10" fill="#14090f"/>`,
    "slate-room": `<rect x="40" y="90" width="120" height="130" fill="#14090f"/><rect x="55" y="105" width="90" height="100" fill="#4b1626"/><rect x="60" y="115" width="80" height="8" fill="#ffd6e8"/><rect x="60" y="135" width="80" height="8" fill="#ffd6e8"/><rect x="60" y="155" width="80" height="8" fill="#ffd6e8"/><rect x="60" y="175" width="80" height="8" fill="#ffd6e8"/>`,
    "bar-rail": `<rect x="30" y="150" width="140" height="12" fill="#14090f"/><rect x="40" y="162" width="8" height="90" fill="#4b1626"/><rect x="160" y="162" width="8" height="90" fill="#4b1626"/><circle cx="55" cy="138" r="10" fill="#4b1626"/><circle cx="85" cy="138" r="10" fill="#4b1626"/><circle cx="115" cy="138" r="10" fill="#4b1626"/><circle cx="145" cy="138" r="10" fill="#4b1626"/>`,
    "courtyard": `<rect x="35" y="70" width="130" height="140" fill="#4b1626"/><rect x="50" y="85" width="100" height="110" fill="#ffd6e8"/><circle cx="75" cy="120" r="16" fill="#14090f"/><circle cx="115" cy="150" r="22" fill="#14090f"/><rect x="50" y="200" width="100" height="10" fill="#14090f"/><rect x="70" y="210" width="8" height="40" fill="#14090f"/><rect x="120" y="210" width="8" height="40" fill="#14090f"/>`,
    "chefs-counter": `<rect x="30" y="140" width="140" height="14" fill="#14090f"/><rect x="30" y="154" width="140" height="6" fill="#4b1626"/><rect x="44" y="100" width="16" height="40" fill="#4b1626"/><rect x="76" y="100" width="16" height="40" fill="#4b1626"/><rect x="108" y="100" width="16" height="40" fill="#4b1626"/><rect x="140" y="100" width="16" height="40" fill="#4b1626"/><rect x="30" y="160" width="10" height="80" fill="#14090f"/><rect x="160" y="160" width="10" height="80" fill="#14090f"/>`,
  };
  const id = name.toLowerCase().replace(/\s+/g, "-").replace(/'/g, "");
  return `<svg class="home-portrait" viewBox="0 0 200 300" role="img" aria-label="${escapeHtml(name)} elevation">
  <rect x="0" y="0" width="200" height="300" fill="#fff5fa"/>
  ${motifs[id] ?? ""}
</svg>`;
}

function captionText(room: TonightResponse["rooms"][number], t: TonightResponse): string {
  if (t.next_slot === null || room.covers_free_at_next_slot === null) {
    return `${room.name} · ${room.seats} seats · Online booking for tonight has closed`;
  }
  const next = room.next_table_for_two === null ? "none" : room.next_table_for_two;
  return `${room.name} · ${room.seats} seats · ${room.covers_free_at_next_slot} covers free at ${t.next_slot} · Next table for two tonight: ${next}`;
}

async function loadTonight(): Promise<TonightResponse> {
  return apiJson<TonightResponse>("/api/tonight");
}

async function main(): Promise<void> {
  const roomsHost = document.getElementById("rooms") as HTMLElement;

  const floor = await apiJson<{
    rooms: { room_id: string; name: string; seats: number; tables: unknown[] }[];
  }>("/api/floor");

  const portraits: RoomPortrait[] = floor.rooms.map((r) => ({ room_id: r.room_id, name: r.name, seats: r.seats }));

  // Render the six figures once; captions update in place without motion.
  roomsHost.innerHTML = portraits.map((r) => `
    <figure aria-label="${escapeHtml(r.name)}" data-room="${r.room_id}">
      ${roomPortraitSvg(r.name)}
      <figcaption class="home-caption" id="caption-${r.room_id}">Loading...</figcaption>
    </figure>`).join("");

  const renderCaptions = (t: TonightResponse): void => {
    for (const room of t.rooms) {
      const el = document.getElementById(`caption-${room.room_id}`);
      if (el) el.textContent = captionText(room, t);
    }
  };

  const refresh = async (): Promise<void> => {
    try {
      const t = await loadTonight();
      renderCaptions(t);
    } catch { /* keep captions */ }
  };

  await refresh();

  // Live captions: update within two seconds of any change tonight.
  openEvents(`/api/floor/events?date=${lisbonToday()}`, (data) => {
    if (data.type) void refresh();
  });

  // Poll as a fallback while the stream is down.
  setInterval(() => void refresh(), 30_000);
}

void main();
