// Reserve an instrument: live sizes, the delivery line by the store cutoff,
// and the unavailable answer with alternatives (DP-04, DP-60, DP-61).
import { api, ApiError, serverClock } from "../api.js";
import { h, statusRegion, clearChildren, focusStatus } from "../ui/dom.js";
import { formatMoney, formatDateTime, formatDateShort } from "../format.js";
import type { RenderContext } from "../router.js";
import { INSTRUMENT_NAMES, SIZES_BY_TYPE, visibleSize, type InstrumentType, type Size } from "../../shared/domain.js";

interface AvailabilityItem {
  instrument_type: string;
  size: string;
  available: number;
}

interface SchoolResponse {
  server_now: string;
  schools: {
    id: string;
    name: string;
    next_delivery_date: string;
    cutoff_at: string;
    upcoming_delivery_days: { date: string; cutoff_at: string }[];
  }[];
}

interface FamilyResponse {
  students: {
    id: string;
    name: string;
    school: { id: string; name: string };
    contracts: { id: string; status: string }[];
  }[];
}

interface CurrentPriceList {
  price_list: {
    id: string;
    tax_rate_bp: number;
    items: { instrument_type: string; base_rent_cents: number; waiver_cents: number; purchase_price_cents: number }[];
  };
}

export async function renderReserve(ctx: RenderContext): Promise<void> {
  ctx.root.appendChild(h("h1", { text: "Reserve an instrument" }));
  const status = statusRegion("Reservation status");
  const form = h("form", { class: "reserve-form" });

  const family = await api<FamilyResponse>("GET", "/api/family");
  const priceList = await api<CurrentPriceList>("GET", "/api/price-lists/current");
  let schoolsData: SchoolResponse | null = null;

  let availability: AvailabilityItem[] = [];

  const studentGroup = h("fieldset", { class: "radio-group", role: "radiogroup", "aria-label": "Student" });
  studentGroup.appendChild(h("legend", { class: "field-label", text: "Student" }));
  const instrumentGroup = h("fieldset", { class: "radio-group", role: "radiogroup", "aria-label": "Instrument" });
  instrumentGroup.appendChild(h("legend", { class: "field-label", text: "Instrument" }));
  const sizeGroup = h("fieldset", { class: "radio-group", role: "radiogroup", "aria-label": "Size" });
  sizeGroup.appendChild(h("legend", { class: "field-label", text: "Size" }));

  const waiver = h("input", { type: "checkbox", id: "waiver-input" });
  const waiverLabel = h("label", { class: "check-label", for: "waiver-input" }, waiver, " Add maintenance and damage waiver");

  const deliveryLine = h("p", { class: "delivery-line" });
  const termsLine = h("p", { class: "terms-line muted" });
  const alternatives = h("div", { class: "alternatives" });
  const submit = h("button", { class: "btn btn-primary", type: "submit", text: "Reserve instrument" });

  let selectedStudent = family.students.find(
    (s) => s.id === ctx.query.get("student") && !s.contracts.some((c) => ["reserved", "agreement_sent", "signed", "active"].includes(c.status))
  ) ?? family.students.find((s) => !s.contracts.some((c) => ["reserved", "agreement_sent", "signed", "active"].includes(c.status)));
  let selectedInstrument: InstrumentType = "cello";
  let selectedSize: Size | null = null;
  let waiverChosen = false;

  function buildStudentGroup(): void {
    clearChildren(studentGroup);
    studentGroup.appendChild(h("legend", { class: "field-label", text: "Student" }));
    for (const student of family.students) {
      const open = student.contracts.some((c) => ["reserved", "agreement_sent", "signed", "active"].includes(c.status));
      const id = `student-${student.id}`;
      const radio = h("input", {
        type: "radio",
        name: "student",
        id,
        value: student.id,
        ...(selectedStudent?.id === student.id ? { checked: true } : {}),
        ...(open ? { disabled: true } : {}),
        onchange: () => {
          selectedStudent = student;
          refreshDeliveryLine();
        },
      });
      studentGroup.appendChild(h("label", { class: open ? "radio-label radio-disabled" : "radio-label", for: id }, radio,
        h("span", { text: open ? `${student.name} (has an instrument)` : student.name })));
    }
  }

  function buildInstrumentGroup(): void {
    clearChildren(instrumentGroup);
    instrumentGroup.appendChild(h("legend", { class: "field-label", text: "Instrument" }));
    for (const type of Object.keys(INSTRUMENT_NAMES) as InstrumentType[]) {
      const id = `instrument-${type}`;
      const radio = h("input", {
        type: "radio",
        name: "instrument",
        id,
        value: type,
        ...(selectedInstrument === type ? { checked: true } : {}),
        onchange: () => {
          selectedInstrument = type;
          // Choosing an instrument rebuilds the Size group and selects the
          // first available size.
          selectedSize = null;
          buildSizeGroup();
          refreshTermsLine();
        },
      });
      instrumentGroup.appendChild(h("label", { class: "radio-label", for: id }, radio, h("span", { text: INSTRUMENT_NAMES[type] })));
    }
  }

  function availableFor(type: string, size: string): number {
    return availability.find((a) => a.instrument_type === type && a.size === size)?.available ?? 0;
  }

  function buildSizeGroup(): void {
    const focusWasInSize = sizeGroup.contains(document.activeElement);
    clearChildren(sizeGroup);
    sizeGroup.appendChild(h("legend", { class: "field-label", text: "Size" }));
    const sizes = SIZES_BY_TYPE[selectedInstrument];
    const previouslySelected = selectedSize;
    let firstAvailable: Size | null = null;
    for (const size of sizes) {
      const count = availableFor(selectedInstrument, size);
      const id = `size-${selectedInstrument}-${size.replace("/", "-")}`;
      const disabled = count === 0;
      const radio = h("input", {
        type: "radio",
        name: "size",
        id,
        value: size,
        ...(selectedSize === size ? { checked: true } : {}),
        ...(disabled ? { disabled: true } : {}),
        onchange: () => {
          selectedSize = size;
        },
      });
      const label = h("label", { class: disabled ? "radio-label radio-disabled" : "radio-label", for: id }, radio,
        h("span", { text: `${visibleSize(selectedInstrument, size)}, ${count} available` }));
      if (count > 0 && !firstAvailable) firstAvailable = size;
      sizeGroup.appendChild(label);
    }
    const previousStillAvailable =
      previouslySelected !== null && availableFor(selectedInstrument, previouslySelected as Size) > 0;
    if (previousStillAvailable) {
      selectedSize = previouslySelected as Size;
    } else {
      // Nothing is selected yet, or the selected size ran out: the first
      // available size of that instrument, in size order, is selected.
      selectedSize = firstAvailable;
      if (previouslySelected && firstAvailable) {
        status.textContent =
          `The last ${visibleSize(selectedInstrument, previouslySelected as Size)} ${INSTRUMENT_NAMES[selectedInstrument]} was just reserved. ` +
          `${firstAvailable} ${INSTRUMENT_NAMES[selectedInstrument]} is selected instead.`;
      } else if (!firstAvailable) {
        selectedSize = null;
        status.textContent = `No ${INSTRUMENT_NAMES[selectedInstrument]} is available right now.`;
      }
    }
    if (selectedSize) {
      const id = `size-${selectedInstrument}-${selectedSize.replace("/", "-")}`;
      const radio = sizeGroup.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
      radio?.setAttribute("checked", "true");
      if (focusWasInSize && previouslySelected && !previousStillAvailable) {
        radio?.focus();
      }
    }
    const anyAvailable = firstAvailable !== null;
    submit.disabled = !anyAvailable || selectedSize === null;
  }

  async function refreshAvailability(): Promise<void> {
    const data = await api<{ items: AvailabilityItem[] }>("GET", "/api/availability");
    availability = data.items;
    buildSizeGroup();
  }

  async function refreshSchools(): Promise<void> {
    schoolsData = await api<SchoolResponse>("GET", "/api/schools");
    serverClock.syncFrom(schoolsData.server_now);
    refreshDeliveryLine();
  }

  function refreshDeliveryLine(): void {
    if (!selectedStudent || !schoolsData) {
      deliveryLine.textContent = "";
      return;
    }
    const school = schoolsData.schools.find((s) => s.id === selectedStudent!.school.id);
    if (!school) {
      deliveryLine.textContent = "";
      return;
    }
    // The server's clock decides, never the device's: the first upcoming day
    // whose cutoff is still later than the estimated server clock.
    const now = serverClock.now();
    const day = school.upcoming_delivery_days.find((d) => !now || Date.parse(d.cutoff_at) > now.getTime());
    if (day) {
      deliveryLine.textContent = `Reserve before ${formatDateTime(day.cutoff_at)} for delivery day ${formatDateShort(day.date)}.`;
    }
  }

  function refreshTermsLine(): void {
    const item = priceList.price_list.items.find((i) => i.instrument_type === selectedInstrument);
    if (item) {
      termsLine.textContent =
        `Terms today (${priceList.price_list.id}): rent ${formatMoney(item.base_rent_cents)} monthly, ` +
        `waiver ${formatMoney(item.waiver_cents)}, purchase price ${formatMoney(item.purchase_price_cents)}.`;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedStudent || !selectedSize) {
      status.textContent = "Choose a student, instrument and size.";
      return;
    }
    submit.disabled = true;
    status.textContent = "Reserving…";
    clearChildren(alternatives);
    try {
      const result = await api<{ contract: {
        id: string;
        instrument: { serial: string; label: string };
        hold_expires_at: string;
        delivery_date: string;
        student: { name: string };
      } }>("POST", "/api/reservations", {
        student_id: selectedStudent.id,
        instrument_type: selectedInstrument,
        size: selectedSize,
        waiver: waiverChosen,
      });
      status.textContent =
        `Reserved ${result.contract.instrument.label} ${result.contract.instrument.serial} for ${result.contract.student.name}. ` +
        `Hold until ${formatDateTime(result.contract.hold_expires_at)}. Delivery day ${formatDateShort(result.contract.delivery_date)}.`;
    } catch (err) {
      submit.disabled = false;
      if (err instanceof ApiError && err.code === "unavailable") {
        // The Size group refreshes and the Available instead list appears.
        await refreshAvailability();
        status.textContent = `That ${visibleSize(selectedInstrument, selectedSize!)} ${INSTRUMENT_NAMES[selectedInstrument]} is no longer available.`;
        const alts = err.body.error.alternatives ?? [];
        if (alts.length === 0) {
          status.textContent = `That ${visibleSize(selectedInstrument, selectedSize!)} ${INSTRUMENT_NAMES[selectedInstrument]} is no longer available. Nothing else is available in that instrument right now.`;
        } else {
          const list = h("ul", { class: "alternatives-list", "aria-label": "Available instead" });
          for (const alt of alts) {
            const button = h("button", {
              class: "btn btn-secondary",
              text: `Reserve ${visibleSize(alt.instrument_type as InstrumentType, alt.size as Size)} ${INSTRUMENT_NAMES[alt.instrument_type as InstrumentType]}`,
              onclick: () => {
                selectedInstrument = alt.instrument_type as InstrumentType;
                selectedSize = alt.size as Size;
                buildInstrumentGroup();
                buildSizeGroup();
                refreshTermsLine();
                void form.requestSubmit();
              },
            });
            list.appendChild(h("li", {}, button));
          }
          clearChildren(alternatives);
          alternatives.appendChild(list);
          const first = list.querySelector<HTMLElement>("button");
          first?.focus();
        }
      } else if (err instanceof ApiError && err.code === "student_has_instrument") {
        status.textContent = `${selectedStudent.name} already has an instrument on contract.`;
        focusStatus("Reservation status");
      } else if (err instanceof ApiError && err.status === 422) {
        status.textContent = "Choose a student, instrument and size.";
        focusStatus("Reservation status");
      } else {
        status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
        focusStatus("Reservation status");
      }
    } finally {
      submit.disabled = !selectedSize || !SIZES_BY_TYPE[selectedInstrument].some((s) => availableFor(selectedInstrument, s) > 0);
    }
  });

  waiver.addEventListener("change", () => {
    waiverChosen = waiver.checked;
  });

  buildStudentGroup();
  buildInstrumentGroup();
  await refreshAvailability();
  await refreshSchools();
  refreshTermsLine();
  refreshDeliveryLine();

  form.append(studentGroup, instrumentGroup, sizeGroup, waiverLabel, termsLine, deliveryLine, submit, alternatives);
  ctx.root.append(form, status);

  // Live sizes: ask for availability every 5 seconds and whenever the window
  // regains focus, without losing the parent's choices or focus.
  const poll = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void refreshAvailability().catch(() => undefined);
    }
  }, 5000);
  const onVisible = (): void => {
    if (document.visibilityState === "visible") void refreshAvailability().catch(() => undefined);
  };
  document.addEventListener("visibilitychange", onVisible);

  // The delivery line follows the server's cutoff: it switches within 2
  // seconds, whatever the device clock says. The server is asked again at
  // least every 60 seconds.
  const linePoll = window.setInterval(() => {
    refreshDeliveryLine();
  }, 500);
  const clockPoll = window.setInterval(() => {
    if (serverClock.needsResync()) {
      void refreshSchools().catch(() => undefined);
    }
  }, 10_000);
  const cleanup = (): void => {
    window.clearInterval(poll);
    window.clearInterval(clockPoll);
    window.clearInterval(linePoll);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("bellroll:navigate", cleanup);
  };
  document.addEventListener("bellroll:navigate", cleanup);
}
