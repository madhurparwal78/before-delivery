// The signing page: public, keyboard-only, expires in place (DP-06, DP-08, DP-62).
import { api, ApiError, serverClock } from "../api.js";
import { h } from "../ui/dom.js";
import { formatMoney, formatTaxPercent, formatDateTime } from "../format.js";

interface SigningAgreement {
  server_now: string;
  agreement: {
    contract_id: string;
    student_name: string;
    school_name: string;
    instrument_label: string;
    serial: string;
    waiver: boolean;
    terms: {
      price_list_id: string;
      base_rent_cents: number;
      waiver_cents: number;
      purchase_price_cents: number;
      tax_rate_bp: number;
      term_months: number;
      tiers: { label: string }[];
    };
    link_expires_at: string;
    status: string;
  };
}

export async function renderSigningPage(root: HTMLElement, token: string): Promise<void> {
  while (root.firstChild) root.removeChild(root.firstChild);
  const wrap = h("div", { class: "signin-wrap" });
  const card = h("div", { class: "signin-card signing-card" });
  card.appendChild(h("h1", { text: "Rental agreement" }));
  const status = h("div", {
    class: "status-text",
    role: "status",
    "aria-live": "polite",
    "data-status-name": "Signing status",
    tabindex: "-1",
  });
  let linkExpiresAt: string | null = null;
  let formArea: HTMLElement | null = null;

  function showExpired(copy: string): void {
    status.textContent = copy;
    if (formArea) {
      formArea.remove();
      formArea = null;
    }
    status.focus({ preventScroll: true });
  }

  async function load(): Promise<void> {
    status.textContent = "Loading agreement…";
    try {
      const data = await api<SigningAgreement>("GET", `/api/signing/${encodeURIComponent(token)}`);
      serverClock.syncFrom(data.server_now);
      linkExpiresAt = data.agreement.link_expires_at;
      render(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === "link_not_found") {
        status.textContent = "This signing link is not valid.";
      } else if (err instanceof ApiError && err.code === "link_expired") {
        status.textContent = "This signing link has expired. Ask Keel & Bell for a new one.";
      } else if (err instanceof ApiError && err.code === "link_used") {
        status.textContent = "This agreement has already been signed.";
      } else {
        status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
      }
    }
  }

  function render(data: SigningAgreement): void {
    if (formArea) formArea.remove();
    const a = data.agreement;
    status.textContent = "";
    card.appendChild(
      h("p", {},
        `This rental agreement covers a ${a.instrument_label} (serial ${a.serial}) for ${a.student_name} at ${a.school_name}.`)
    );
    const terms = h("div", { class: "agreement-terms" });
    terms.append(
      h("p", {}, `Monthly base rent: ${formatMoney(a.terms.base_rent_cents)}`),
      a.waiver ? h("p", {}, `Maintenance and damage waiver: ${formatMoney(a.terms.waiver_cents)}`) : h("p", {}, "Maintenance and damage waiver: declined"),
      h("p", {}, `Purchase price: ${formatMoney(a.terms.purchase_price_cents)}`),
      h("p", {}, `Sales tax at ${formatTaxPercent(a.terms.tax_rate_bp)} (the rate in force when billed applies).`),
      h("p", {}, `Term: ${a.terms.term_months} months`)
    );
    for (const tier of a.terms.tiers) {
      terms.appendChild(h("p", { class: "muted", text: tier.label }));
    }
    const region = h("div", {
      class: "agreement-text",
      tabindex: "0",
      role: "region",
      "aria-label": "Agreement text",
    },
      h("p", {}, "Each month's base rent adds equity toward the purchase price. An early buyout takes a stepped discount off the remaining balance, and the discount shrinks as the contract ages. By signing, the renter agrees to these terms and to return the instrument in good condition at the end of the rental, or to complete a buyout as described.")
    );
    const expiryLine = h("p", { class: "muted", text: `This link works until ${formatDateTime(a.link_expires_at)}.` });

    const name = h("input", {
      class: "input",
      "aria-label": "Full legal name",
      autocomplete: "name",
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void form.requestSubmit();
        }
      },
    });
    const nameField = h("label", { class: "field" }, h("span", { class: "field-label", text: "Full legal name" }), name);
    const agree = h("input", { type: "checkbox", id: "agree-input" });
    const agreeField = h("label", { class: "check-label", for: "agree-input" }, agree, " I have read and agree to this rental agreement");
    const signButton = h("button", { class: "btn btn-primary", type: "submit", text: "Sign agreement" });
    const form = h("form", {
      onsubmit: async (event: Event) => {
        event.preventDefault();
        signButton.disabled = true;
        status.textContent = "Signing…";
        try {
          await api("POST", `/api/signing/${encodeURIComponent(token)}`, {
            full_name: name.value,
            agree: agree.checked,
          });
          status.textContent = "Agreement signed. Keel & Bell will confirm delivery.";
          form.remove();
          status.focus({ preventScroll: true });
        } catch (err) {
          signButton.disabled = false;
          if (err instanceof ApiError && err.status === 422 && err.fields) {
            if (err.fields.full_name) {
              status.textContent = "Type your full legal name.";
            } else {
              status.textContent = "Tick the box to agree.";
            }
          } else if (err instanceof ApiError && err.code === "storage_unavailable") {
            status.textContent = "We couldn't save your signed agreement. Nothing was signed; try again in a moment.";
          } else if (err instanceof ApiError && err.code === "link_not_found") {
            status.textContent = "This signing link is not valid.";
          } else if (err instanceof ApiError && err.code === "link_expired") {
            showExpired("This signing link has expired. Ask Keel & Bell for a new one.");
            return;
          } else if (err instanceof ApiError && err.code === "link_used") {
            status.textContent = "This agreement has already been signed.";
          } else {
            status.textContent = "Couldn't reach Bellroll. Nothing was changed; check your connection and try again.";
          }
          status.focus({ preventScroll: true });
        }
      },
    });
    form.append(nameField, agreeField, signButton);
    formArea = h("div", {});
    formArea.append(terms, region, expiryLine, form);
    card.appendChild(formArea);
  }

  card.appendChild(status);
  wrap.appendChild(card);
  root.appendChild(wrap);
  await load();

  // Expiry in place: the signing form is removed within 2 seconds after the
  // link expires on the server clock, whatever the device clock says.
  const expiryTimer = window.setInterval(() => {
    if (!linkExpiresAt || !formArea) return;
    const now = serverClock.now();
    if (now && now.getTime() >= Date.parse(linkExpiresAt)) {
      showExpired("This signing link has expired. Ask Keel & Bell for a new one.");
    }
  }, 500);
  const resyncTimer = window.setInterval(() => {
    if (serverClock.needsResync()) {
      void load().catch(() => undefined);
    }
  }, 10_000);
  const cleanup = (): void => {
    window.clearInterval(expiryTimer);
    window.clearInterval(resyncTimer);
    document.removeEventListener("bellroll:navigate", cleanup);
  };
  document.addEventListener("bellroll:navigate", cleanup);
}
