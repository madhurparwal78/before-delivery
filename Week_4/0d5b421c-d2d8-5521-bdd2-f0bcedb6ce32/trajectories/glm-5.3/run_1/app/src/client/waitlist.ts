import { apiJson, ApiFailure, escapeHtml, lisbonToday, renderBanners, watchStatus } from "./shared.js";

const params = new URLSearchParams(location.search);
/** The slot times from the published rules: 18:00 to 22:00, 17 slots. */
const SLOT_TIMES = Array.from({ length: 17 }, (_, i) => {
  const total = 18 * 60 + i * 15;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

async function main(): Promise<void> {
  const partyRow = document.getElementById("party-row") as HTMLElement;
  const dateInput = document.getElementById("date-input") as HTMLInputElement;
  const earliest = document.getElementById("earliest") as HTMLSelectElement;
  const latest = document.getElementById("latest") as HTMLSelectElement;
  const name = document.getElementById("name") as HTMLInputElement;
  const email = document.getElementById("email") as HTMLInputElement;
  const joinBtn = document.getElementById("join-btn") as HTMLButtonElement;
  const resultLine = document.getElementById("result-line") as HTMLElement;
  const statusRegion = document.getElementById("status-region") as HTMLElement;
  const bannerSlot = document.getElementById("banner-slot") as HTMLElement;

  const rules = await apiJson<{ booking_horizon_days: number }>("/api/rules");
  const today = lisbonToday();
  dateInput.min = today;
  const max = new Date(`${today}T12:00:00Z`);
  max.setUTCDate(max.getUTCDate() + rules.booking_horizon_days);
  dateInput.max = max.toISOString().slice(0, 10);

  const date = params.get("date") ?? today;
  dateInput.value = date;
  const party = Number(params.get("party"));
  const initialParty = Number.isInteger(party) && party >= 1 && party <= 8 ? party : 2;
  const initialEarliest = params.get("earliest") ?? "18:00";
  const initialLatest = params.get("latest") ?? "22:00";

  partyRow.innerHTML = Array.from({ length: 8 }, (_, i) => i + 1).map((n) => `
    <label><input type="radio" name="party" value="${n}" ${n === initialParty ? "checked" : ""}>
    <span>${n === 1 ? "1 guest" : `${n} guests`}</span></label>`).join("");

  earliest.innerHTML = SLOT_TIMES.map((t) => `<option value="${t}" ${t === initialEarliest ? "selected" : ""}>${t}</option>`).join("");
  latest.innerHTML = SLOT_TIMES.map((t) => `<option value="${t}" ${t === initialLatest ? "selected" : ""}>${t}</option>`).join("");

  const form = document.getElementById("waitlist-form") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const partyValue = Number((partyRow.querySelector("input[type=radio]:checked") as HTMLInputElement)?.value ?? 2);
    const body = {
      date: dateInput.value,
      party_size: partyValue,
      earliest: earliest.value,
      latest: latest.value,
      name: name.value.trim(),
      email: email.value.trim(),
    };
    joinBtn.disabled = true;
    try {
      const resp = await apiJson<{ entry_id: string; status: string; position: number }>("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const line = `You're on the waitlist at position ${resp.position}. We'll email you if a table frees up.`;
      resultLine.textContent = line;
      statusRegion.textContent = line;
    } catch (err) {
      if (err instanceof ApiFailure) {
        if (err.status === 422) {
          const first = Object.values(err.fields)[0] ?? "Some details need fixing.";
          resultLine.textContent = first;
          statusRegion.textContent = first;
        } else {
          resultLine.textContent = "We couldn't add you to the waitlist. Please try again.";
          statusRegion.textContent = resultLine.textContent;
        }
      }
    } finally {
      joinBtn.disabled = false;
    }
  });

  watchStatus((s) => renderBanners(bannerSlot, s, false));
  void escapeHtml;
}

void main();
