// The public check: search by statement code, then the statement, its signature result and the PDF.
import { h, pct, commas } from "../dom.js";
import { get, ApiError } from "../api.js";
import { problems } from "../problems.js";
import { announce } from "../announce.js";
import { meter, pylon } from "../art.js";

export const search = {
  mount({ container, navigate }) {
    const code = h("input", { id: "code", type: "text", autocomplete: "off", spellcheck: "false" });
    const list = problems();
    const form = h("form", { class: "stack", novalidate: "" },
      h("label", { for: "code", text: "Statement code" }), code, list.el,
      h("button", { type: "submit", text: "Check statement" }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = code.value.trim();
      if (value) navigate(`/check/${encodeURIComponent(value)}`);
    });
    container.replaceChildren(h("section", { class: "page field-cyan" },
      pylon("cutout cutout-pylon"), h("h1", { text: "CHECK A STATEMENT." }), form));
    return { unmount() {} };
  },
};

function fact(label, value) {
  return h("div", { class: "fact" }, h("dt", { text: label }), h("dd", { text: value }));
}

export const statement = {
  mount({ container, params }) {
    const [code] = params;
    const seal = h("div", { role: "status", "aria-label": "Seal status", "aria-live": "polite", class: "sr-only" });
    const body = h("div", { class: "statement-body" });
    container.replaceChildren(h("section", { class: "page field-cyan" },
      meter("cutout cutout-meter"), pylon("cutout cutout-pylon"), seal, body));
    let timer = null;
    let stopped = false;
    let announced = false;
    let last = "";

    const show = (sealedStatement) => {
      const serial = JSON.stringify(sealedStatement);
      if (serial === last) return;
      last = serial;
      const holds = sealedStatement.signature_valid;
      body.replaceChildren(h("section", { role: "region", "aria-label": "Statement result", class: "statement field-cyan" },
        h("div", { class: "statement-facts" },
          h("h1", { text: "HERE IS THE RECORD." }),
          h("p", { class: "verdict", text: holds ? "SIGNATURE HOLDS." : "SIGNATURE DOES NOT HOLD." }),
          h("dl", {}, fact("Code", sealedStatement.code), fact("Site", sealedStatement.site_name), fact("Month", sealedStatement.month),
            fact("Opinion", sealedStatement.opinion), fact("Verifier firm", sealedStatement.firm_name), fact("State", sealedStatement.state)),
          sealedStatement.state === "Restated"
            ? h("p", { class: "stamp" }, "RESTATED. SEE THE SUCCESSOR WINDOW. ", h("span", { text: sealedStatement.successor_window_id }))
            : null,
          h("div", { class: "row" },
            h("a", { class: "button", href: sealedStatement.pdf_url, text: "Download attestation PDF" }),
            sealedStatement.successor_statement_code
              ? h("a", { class: "button", href: `/check/${sealedStatement.successor_statement_code}`, text: "Open the successor statement" })
              : null)),
        h("div", { class: "statement-scores" },
          ...[["Month", sealedStatement.scores.month_bp], ["Week", sealedStatement.scores.week_bp], ["Day", sealedStatement.scores.day_bp], ["Hour", sealedStatement.scores.hour_bp]]
            .map(([name, bp]) => h("div", { class: "score" }, h("span", { class: "score-name", text: `${name} score` }),
              h("span", { class: "figure", text: `${pct(bp)}%` }))),
          h("p", { text: `Consumed ${commas(sealedStatement.consumed_wh)} Wh. Hour matched ${commas(sealedStatement.hour_matched_wh)} Wh.` }))));
      if (!announced && sessionStorage.getItem("sealed") === code) {
        announced = true;
        sessionStorage.removeItem("sealed");
        announce(seal, `Sealed. Statement ${code} is live.`);
      }
    };
    const problem = (text) => body.replaceChildren(h("section", { class: "panel field-orange" }, h("p", { class: "figure", text })));
    const load = async () => {
      try {
        show(await get(`/api/public/statements/${encodeURIComponent(code)}`));
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        problem(error.status === 404 ? "NO STATEMENT HAS THAT CODE." : error.message);
        last = "";
        if (error.status === 404) return;
      }
      if (!stopped) timer = setTimeout(load, 5000);
    };
    load();
    return { unmount() { stopped = true; clearTimeout(timer); } };
  },
};
