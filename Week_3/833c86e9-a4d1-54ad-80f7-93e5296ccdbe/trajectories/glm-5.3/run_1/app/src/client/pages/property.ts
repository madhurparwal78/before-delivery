import { state, t, fmt, moneyEl, moneyText } from "../i18n.js";
import { ui } from "../boot.js";
import { api, idempotencyKey } from "../api.js";
import { status, toast, openDialog, animateId } from "../ui.js";
import { onEvent } from "../events.js";
import { openDatePicker } from "../widgets/search.js";
import { renderNightStrip } from "../nightstrip.js";
import { onCleanup } from "../router.js";
import type { Page } from "../router.js";

type RoomType = { code: string; name: string; max_adults: number; max_guests: number; left: number };
type Rec = { rooms: { room_type: string; adults: number; ages: number[] }[]; total_minor: number; total_eur_minor: number };
type PropertyData = {
  code: string; name: string; zone: string; stars: number; amenities: string[]; score: number;
  distance_km: number; pictures: string[]; policy: { days_before: number; hour: number; refund_pct: number }[];
  room_types: RoomType[]; recommendation: Rec | null;
};

const page: Page = {
  async render(main: HTMLElement, params: URLSearchParams, path: string): Promise<void> {
    main.replaceChildren();
    const code = params.get("seg0") ?? path.split("/")[2];
    const query = new URLSearchParams(location.search);
    const cur = state.cur;
    const res = await api<PropertyData>(`/api/properties/${code}?${query.toString()}`);
    if (!res.ok) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const word = document.createElement("p");
      word.className = "huge";
      word.textContent = t("empty.results.word", { fmt: fmt() });
      empty.appendChild(word);
      main.appendChild(empty);
      return;
    }
    const data = res.data;
    const inDate = query.get("in");
    const outDate = query.get("out");

    const layout = document.createElement("div");
    layout.className = "property-page";
    const details = document.createElement("div");
    const reserveCol = document.createElement("aside");
    reserveCol.className = "price-reserve";
    reserveCol.setAttribute("role", "region");
    reserveCol.setAttribute("aria-label", ui("property.price_reserve"));
    layout.append(details, reserveCol);
    main.appendChild(layout);

    // details: name, stars, score, distance, dates button
    const h1 = document.createElement("h1");
    h1.textContent = data.name;
    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = `${data.stars} stars · ${fmt().num(data.score)} · ${fmt().num(data.distance_km)} km`;
    const datesBtn = document.createElement("button");
    datesBtn.dataset.focusKey = "dates";
    const datesLabel = (): string => inDate && outDate
      ? `${ui("search.dates")}, ${fmt().dayMonth(inDate, data.zone)} to ${fmt().dayMonth(outDate, data.zone)}`
      : ui("search.dates");
    datesBtn.setAttribute("aria-label", datesLabel());
    datesBtn.textContent = inDate && outDate ? `${fmt().dayMonth(inDate, data.zone)} – ${fmt().dayMonth(outDate, data.zone)}` : ui("search.dates");
    datesBtn.addEventListener("click", () => {
      openDatePicker({
        opener: datesBtn,
        property: code,
        zone: data.zone,
        cur,
        arrival: inDate,
        departure: outDate,
        onPicked: (a, b) => {
          if (a && b) {
            const url = new URLSearchParams(location.search);
            url.set("in", a);
            url.set("out", b);
            history.pushState({}, "", `/properties/${code}?${url.toString()}`);
            import("../router.js").then(({ renderRoute }) => { void renderRoute(location.pathname + location.search); });
          }
        }
      });
    });
    details.append(h1, meta, datesBtn);

    if (!data.recommendation || !inDate || !outDate) {
      const sold = document.createElement("div");
      sold.className = "empty-state";
      const word = document.createElement("p");
      word.className = "huge";
      word.textContent = t("empty.sold.word", { fmt: fmt() });
      const help = document.createElement("p");
      help.textContent = t("empty.sold", { fmt: fmt() });
      sold.append(word, help);
      main.appendChild(sold);
      return;
    }

    const rooms = document.createElement("section");
    rooms.setAttribute("role", "group");
    rooms.setAttribute("aria-label", ui("property.rooms"));
    const roomsH2 = document.createElement("h2");
    roomsH2.textContent = ui("property.rooms");
    rooms.appendChild(roomsH2);
    const advice = document.createElement("div");
    advice.className = "status-line";
    advice.setAttribute("role", "status");
    advice.dataset.status = "room-advice";
    rooms.appendChild(advice);

    let counts: Record<string, number> = {};
    let plans: Record<string, "refundable" | "nonrefundable"> = {};
    let breakfasts: Record<string, boolean> = {};
    for (const room of data.recommendation.rooms) {
      counts[room.room_type] = (counts[room.room_type] ?? 0) + 1;
      plans[room.room_type] ??= "refundable";
      breakfasts[room.room_type] ??= false;
    }

    const renderRoomControls = () => {
      rooms.querySelectorAll(".room-row").forEach((el) => el.remove());
      let n = 0;
      for (const rt of data.room_types) {
        const count = counts[rt.code] ?? 0;
        n += count;
        const row = document.createElement("div");
        row.className = "room-row";
        const spin = document.createElement("input");
        spin.type = "number";
        spin.min = "0";
        spin.max = "4";
        spin.value = String(count);
        spin.setAttribute("role", "spinbutton");
        spin.setAttribute("aria-label", `${rt.name} rooms`);
        spin.dataset.focusKey = "room-" + rt.code;
        spin.addEventListener("change", () => overrideRooms(rt.code, Number(spin.value)));
        const label = document.createElement("span");
        label.textContent = `${rt.name}`;
        const left = document.createElement("span");
        left.className = "meta";
        left.textContent = `${rt.left} left`;
        row.append(spin, label, left);
        if ((counts[rt.code] ?? 0) > 0) {
          const tag = document.createElement("span");
          tag.className = "tag accent";
          tag.textContent = ui("property.recommended");
          row.appendChild(tag);
        }
        rooms.appendChild(row);
      }
    };
    renderRoomControls();

    const useRecommended = document.createElement("button");
    useRecommended.dataset.focusKey = "use-recommended";
    useRecommended.textContent = ui("property.use_recommended");
    useRecommended.addEventListener("click", () => {
      counts = {};
      for (const room of data.recommendation!.rooms) counts[room.room_type] = (counts[room.room_type] ?? 0) + 1;
      renderRoomControls();
      void refreshQuote();
    });
    rooms.appendChild(useRecommended);

    // rate plan and breakfast per selected room
    const planSection = document.createElement("section");
    main.appendChild(planSection);
    const renderPlans = () => {
      planSection.replaceChildren();
      let roomNo = 0;
      for (const [rtCode, count] of Object.entries(counts)) {
        for (let i = 0; i < count; i++) {
          roomNo++;
          const group = document.createElement("fieldset");
          group.setAttribute("role", "radiogroup");
          group.setAttribute("aria-label", `${ui("property.rate")} ${roomNo}`);
          const legend = document.createElement("legend");
          legend.textContent = `${ui("property.rate")} ${roomNo}`;
          group.appendChild(legend);
          const flex = document.createElement("label");
          const flexRadio = document.createElement("input");
          flexRadio.type = "radio";
          flexRadio.name = `plan-${roomNo}`;
          flexRadio.checked = plans[rtCode] !== "nonrefundable";
          flexRadio.addEventListener("change", () => { plans[rtCode] = "refundable"; void refreshQuote(); });
          flex.append(flexRadio, document.createTextNode(ui("property.flexible")));
          const nonref = document.createElement("label");
          const nonrefRadio = document.createElement("input");
          nonrefRadio.type = "radio";
          nonrefRadio.name = `plan-${roomNo}`;
          nonrefRadio.checked = plans[rtCode] === "nonrefundable";
          nonrefRadio.addEventListener("change", () => { plans[rtCode] = "nonrefundable"; void refreshQuote(); });
          nonref.append(nonrefRadio, document.createTextNode(ui("property.nonrefundable")));
          group.append(flex, nonref);
          const bfLabel = document.createElement("label");
          const bf = document.createElement("input");
          bf.type = "checkbox";
          bf.checked = breakfasts[rtCode] === true;
          bf.addEventListener("change", () => { breakfasts[rtCode] = bf.checked; void refreshQuote(); });
          bfLabel.append(bf, document.createTextNode(`${ui("property.breakfast")} ${roomNo}`));
          planSection.append(group, bfLabel);
        }
      }
    };
    renderPlans();

    // Night Strip
    const stripHost = document.createElement("section");
    main.appendChild(stripHost);

    // pictures
    const picturesBtn = document.createElement("button");
    picturesBtn.dataset.focusKey = "pictures";
    picturesBtn.textContent = ui("property.pictures");
    picturesBtn.addEventListener("click", () => openGallery(picturesBtn, data));
    main.appendChild(picturesBtn);

    // reserve column
    const totalEl = document.createElement("div");
    totalEl.className = "total";
    const reserveBtn = document.createElement("button");
    reserveBtn.className = "reserve-btn";
    reserveBtn.dataset.focusKey = "reserve";
    reserveBtn.textContent = ui("property.reserve");
    reserveCol.append(totalEl, reserveBtn);

    type Quote = {
      id: string; property: string; in: string; out: string; nights_count: number; currency: string;
      tier: string; rooms: { room_type: string; plan: string; breakfast: boolean; adults: number; ages: number[]; nights: { date: string; lines: { key: string; minor: number }[]; total_minor: number }[] }[];
      nights: { date: string; total_minor: number; converted_minor: number; state: string }[];
      total_minor: number; converted_total_minor: number; expires_at: string;
    };
    let quote: Quote | null = null;

    async function refreshQuote(): Promise<void> {
      const roomsPayload = buildRoomsPayload(data, counts, plans, breakfasts);
      if (roomsPayload.length === 0) return;
      const res2 = await api<Quote>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          property: code,
          in: inDate,
          out: outDate,
          currency: cur,
          adults: Number(query.get("adults") ?? 2),
          ages: (query.get("ages") ?? "").split(",").filter(Boolean).map(Number),
          rooms: roomsPayload
        })
      });
      if (!res2.ok) {
        if (res2.data.error === "restricted") {
          const reason = res2.data.reason as { code: string; date?: string; n?: number };
          status("room-advice", reason.code);
        }
        return;
      }
      quote = res2.data;
      renderPlans();
      renderNightStrip(stripHost, quote, data.zone);
      totalEl.replaceChildren(moneyEl(quote.converted_total_minor, quote.currency as "EUR"));
    }

    async function overrideRooms(rtCode: string, count: number): Promise<void> {
      const nextCounts = { ...counts, [rtCode]: count };
      const res2 = await api<{ rooms: Rec["rooms"]; total_minor: number }>("/api/allocations", {
        method: "POST",
        body: JSON.stringify({
          property: code, in: inDate, out: outDate,
          adults: Number(query.get("adults") ?? 2),
          ages: (query.get("ages") ?? "").split(",").filter(Boolean).map(Number),
          counts: nextCounts
        })
      });
      if (!res2.ok) {
        if (res2.data.error === "room_advice") {
          const adviceData = res2.data.advice as { code: string; n?: number; m?: number; room_type?: string };
          status("room-advice", adviceText(adviceData, data));
        }
        // keep the previous prices
        return;
      }
      counts = nextCounts;
      for (const room of res2.data.rooms) {
        plans[room.room_type] ??= "refundable";
        breakfasts[room.room_type] ??= false;
      }
      renderRoomControls();
      renderPlans();
      await refreshQuote();
    }

    reserveBtn.addEventListener("click", async () => {
      if (!quote) return;
      const roomsPayload = buildRoomsPayload(data, counts, plans, breakfasts);
      const res2 = await api<Quote>("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          property: code, in: inDate, out: outDate, currency: cur,
          adults: Number(query.get("adults") ?? 2),
          ages: (query.get("ages") ?? "").split(",").filter(Boolean).map(Number),
          rooms: roomsPayload
        })
      });
      if (!res2.ok) return;
      location.href = `/checkout/${res2.data.id}`;
    });

    await refreshQuote();

    const off = onEvent(() => { void refreshQuote(); }, "availability");
    onCleanup(() => { off(); });


  }
};

function adviceText(advice: { code: string; n?: number; m?: number; room_type?: string }, data: PropertyData): string {
  const f = fmt();
  if (advice.code === "capacity") return t("advice.capacity", { n: advice.n ?? 0, m: advice.m ?? 0, fmt: f });
  if (advice.code === "adult") return t("advice.adult", { fmt: f });
  const name = data.room_types.find((r) => r.name === advice.room_type)?.name ?? advice.room_type ?? "";
  return t("advice.left", { n: advice.n ?? 0, name, fmt: f });
}

function buildRoomsPayload(data: PropertyData, counts: Record<string, number>, plans: Record<string, string>, breakfasts: Record<string, boolean>): unknown[] {
  const out: unknown[] = [];
  const byRt = new Map<string, { adults: number; ages: number[] }[]>();
  const recRooms = data.recommendation?.rooms ?? [];
  for (const room of recRooms) {
    const list = byRt.get(room.room_type) ?? [];
    list.push({ adults: room.adults, ages: room.ages });
    byRt.set(room.room_type, list);
  }
  for (const [rtCode, count] of Object.entries(counts)) {
    const list = byRt.get(rtCode) ?? [];
    for (let i = 0; i < count; i++) {
      const place = list[i] ?? list[list.length - 1] ?? { adults: 1, ages: [] };
      out.push({
        room_type: rtCode,
        plan: plans[rtCode] === "nonrefundable" ? "nonrefundable" : "refundable",
        breakfast: breakfasts[rtCode] === true,
        adults: place.adults,
        ages: place.ages
      });
    }
  }
  return out;
}

function openGallery(opener: HTMLElement, data: PropertyData): void {
  let index = 0;
  openDialog((body) => {
    body.dataset.role = "gallery";
    const img = document.createElement("img");
    img.alt = "";
    const counter = document.createElement("p");
    const prev = document.createElement("button");
    prev.textContent = "‹";
    prev.setAttribute("aria-label", ui("gallery.prev"));
    const next = document.createElement("button");
    next.textContent = "›";
    next.setAttribute("aria-label", ui("gallery.next"));
    const show = (i: number) => {
      index = (i + data.pictures.length) % data.pictures.length;
      img.src = data.pictures[index];
      img.alt = `Picture ${index + 1} of ${data.pictures.length}`;
      counter.textContent = `${index + 1} / ${data.pictures.length}`;
      body.closest("dialog")?.setAttribute("data-index", String(index + 1));
    };
    prev.addEventListener("click", () => { show(index - 1); animateId(img, "gallery-slide", [{ transform: "translateX(30px)", opacity: "0.4" }, { transform: "translateX(0)", opacity: "1" }], { duration: 240 }); });
    next.addEventListener("click", () => { show(index + 1); animateId(img, "gallery-slide", [{ transform: "translateX(-30px)", opacity: "0.4" }, { transform: "translateX(0)", opacity: "1" }], { duration: 240 }); });
    body.addEventListener("keydown", (e) => {
      const rtl = document.documentElement.lang === "ar";
      if (e.key === "ArrowRight") { e.preventDefault(); next.click(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev.click(); }
    });
    body.append(prev, img, next, counter);
    show(0);
  }, { opener, label: ui("gallery.title") });
}

export default page;
