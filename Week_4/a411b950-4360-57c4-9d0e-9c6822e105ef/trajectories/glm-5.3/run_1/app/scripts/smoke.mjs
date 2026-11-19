#!/usr/bin/env node
/**
 * End-to-end smoke test: brief → triage → qualify → proposal → accept →
 * deposit → production → milestone invoices, with email and Kill Bill checks.
 */
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4173";
const MAILPIT = process.env.SMOKE_MAILPIT || "http://mailpit:8025";

let failures = 0;
function check(name, condition, detail = "") {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(method, path, { body, headers, cookie, form } = {}) {
  const options = { method, headers: { ...(headers || {}) } };
  if (cookie) options.headers.Cookie = cookie;
  if (form) {
    const boundary = "----smoke" + Math.random().toString(36).slice(2);
    const parts = [];
    for (const [name, value] of Object.entries(form)) {
      if (value === undefined || value === null) continue;
      parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
    }
    parts.push(`--${boundary}--\r\n`);
    options.body = parts.join("");
    options.headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
  } else if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${BASE}${path}`, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

function cookieFrom(response) {
  const set = response.headers.get("set-cookie") || "";
  return set.split(";")[0];
}

async function mailpitCount() {
  const response = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
  const data = await response.json();
  // Mailpit reports camel-cased keys; normalise to lower case for checks.
  return {
    messages: (data.messages || []).map((m) => ({
      subject: m.Subject,
      fromName: m.From && m.From.Name,
      fromAddress: m.From && m.From.Address,
      to: (m.To || []).map((entry) => ({ name: entry.Name, address: entry.Address })),
      replyTo: (m.ReplyTo || []).map((entry) => ({ name: entry.Name, address: entry.Address })),
    })),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // Health.
  const health = await api("GET", "/api/health");
  check("health answers 200 ok", health.status === 200 && health.json.status === "ok");

  // Journey and stems.
  const journey = await api("GET", "/api/journey");
  const stations = journey.json.stations;
  check("journey lists seeded public stations", stations.length === 3, `got ${stations.length}`);
  check(
    "stations are playable with four stems",
    stations.every((s) => s.playable && s.stems.length === 4),
  );
  const stemResponse = await fetch(`${BASE}${stations[0].stems[0].url}`);
  const stemBytes = Buffer.from(await stemResponse.arrayBuffer());
  check("stem serves WAV bytes", stemResponse.status === 200 && stemBytes.length > 44 && stemBytes.toString("ascii", 0, 4) === "RIFF");
  const withdrawnStem = await fetch(`${BASE}/api/stems/00000000-0000-0000-0000-000000000000`);
  check("unknown stem answers 404", withdrawnStem.status === 404);

  // Search.
  const search = await api("GET", "/api/search?q=lantern");
  check("search finds by title", search.json.results.some((r) => r.slug === "lantern-moth"));
  const searchNda = await api("GET", "/api/search?q=glasshouse");
  check("NDA project not in search", searchNda.json.results.length === 0);
  const searchTag = await api("GET", "/api/search?q=redesign");
  check("search matches tags and credit lines", searchTag.json.results.length >= 1);
  const badSearch = await api("GET", "/api/search?q=" + "x".repeat(101));
  check("long search query answers 422", badSearch.status === 422);

  // Months.
  const months = await api("GET", "/api/months");
  check("public months lists open months", months.json.months.length >= 1);

  // Private listening.
  const listen = await api("GET", "/api/listen/glasshouse-seed-preview");
  check("seed private link answers 200", listen.status === 200, `status ${listen.status}`);
  check(
    "private station is the NDA project",
    listen.json.station.slug === "glasshouse" && listen.json.nda === true,
  );
  check("private responses are not cached", listen.headers.get("cache-control") === "no-store");
  const privateStem = await fetch(`${BASE}${listen.json.station.stems[0].url}`);
  check("private stem serves audio", privateStem.status === 200);
  const listenPost = await api("POST", "/api/listen/glasshouse-seed-preview");
  check("private link is read-only", listenPost.status === 405 && listenPost.json.error === "read_only");
  check("read-only response allows GET", (listenPost.headers.get("allow") || "") === "GET");
  const listenUnknown = await api("GET", "/api/listen/not-a-real-token");
  check("unknown link answers 404", listenUnknown.status === 404);

  // Briefs: name with quotes, studio with non-English letters.
  const briefFields = {
    name: 'Hale, Imogen "Imo"',
    email: "imogen.hale@brackwater.example",
    studio: "Ålborg Lydværk",
    brief: "We need an adaptive combat score for a roguelite with four intensity tiers and layering.",
  };
  const brief = await api("POST", "/api/enquiries", {
    form: { ...briefFields, preferred_month: months.json.months[0].month, project_slug: stations[0].slug },
    headers: { "Idempotency-Key": "smoke-brief-1" },
  });
  check("brief saved", brief.status === 201 && /^ENQ-\d{6}$/.test(brief.json.reference), JSON.stringify(brief.json).slice(0, 120));
  const reference = brief.json.reference;

  const briefReplay = await api("POST", "/api/enquiries", {
    form: { ...briefFields, preferred_month: months.json.months[0].month, project_slug: stations[0].slug },
    headers: { "Idempotency-Key": "smoke-brief-1" },
  });
  check("brief replay returns same reference", briefReplay.status === 201 && briefReplay.json.reference === reference);

  const briefConflict = await api("POST", "/api/enquiries", {
    form: { ...briefFields, brief: "Different brief text for the conflict test, longer than 20 chars." },
    headers: { "Idempotency-Key": "smoke-brief-1" },
  });
  check("brief key conflict answers 409", briefConflict.status === 409 && briefConflict.json.error === "idempotency_conflict");

  const briefInvalid = await api("POST", "/api/enquiries", {
    form: { name: "X", email: "not-an-email", studio: "", brief: "short" },
  });
  check("invalid brief answers 422 with field errors", briefInvalid.status === 422 && briefInvalid.json.errors.email !== undefined);

  // Wait for the receipt and alert to reach Mailpit.
  await sleep(1500);
  const mail = await mailpitCount();
  const receipt = mail.messages.find((m) => m.subject === `Your brief reached Kettlehole Audio (${reference})`);
  const alert = mail.messages.find((m) => m.subject === `New brief ${reference} from Ålborg Lydværk`);
  check("receipt email delivered", Boolean(receipt));
  check("alert email delivered with exact studio", Boolean(alert));
  check("exactly one receipt and one alert", mail.messages.filter((m) => m.subject.includes(reference)).length === 2);
  check(
    "alert reply-to is the director under exact name",
    alert && alert.replyTo.length === 1 && alert.replyTo[0].name === 'Hale, Imogen "Imo"' && alert.replyTo[0].address === "imogen.hale@brackwater.example",
    JSON.stringify(alert && alert.replyTo),
  );

  // Console session.
  const badSignIn = await api("POST", "/api/console/session", {
    body: { email: "operator@kettlehole.example", password: "wrong" },
  });
  check("wrong password answers 401 invalid_credentials", badSignIn.status === 401 && badSignIn.json.error === "invalid_credentials");
  const signIn = await api("POST", "/api/console/session", {
    body: { email: "operator@kettlehole.example", password: "ladder-console-2026" },
  });
  check("operator signs in", signIn.status === 200);
  const cookie = cookieFrom(signIn);
  const noSession = await api("GET", "/api/console/projects");
  check("console without session answers 401", noSession.status === 401 && noSession.json.error === "unauthenticated");

  // Enquiries list and detail.
  const list = await api("GET", "/api/console/enquiries?limit=25", { cookie });
  const listed = list.json.enquiries.find((e) => e.reference === reference);
  check("new enquiry appears in console list", Boolean(listed));
  const detail = await api("GET", `/api/console/enquiries/${listed.id}`, { cookie });
  const etag = detail.headers.get("etag");
  check("enquiry detail carries ETag version", etag === '"1"', `etag ${etag}`);

  // Triage.
  const triage = await api("PATCH", `/api/console/enquiries/${listed.id}`, {
    cookie,
    headers: { "If-Match": '"1"' },
    body: { triage_notes: "Budget looks strong", fit_score: 4, rate_floor_cents: 800000 },
  });
  check("triage save bumps version to 2", triage.status === 200 && triage.json.enquiry.version === 2);
  const stale = await api("PATCH", `/api/console/enquiries/${listed.id}`, {
    cookie,
    headers: { "If-Match": '"1"' },
    body: { fit_score: 2 },
  });
  check("stale triage save answers 412 with current", stale.status === 412 && stale.json.current.version === 2);
  const noIfMatch = await api("PATCH", `/api/console/enquiries/${listed.id}`, {
    cookie,
    body: { fit_score: 3 },
  });
  check("missing If-Match answers 428", noIfMatch.status === 428 && noIfMatch.json.error === "precondition_required");
  const writableOnly = await api("PATCH", `/api/console/enquiries/${listed.id}`, {
    cookie,
    headers: { "If-Match": '"2"' },
    body: { status: "accepted" },
  });
  check("non-writable field answers 422 naming it", writableOnly.status === 422 && writableOnly.json.errors.status === "Field is not writable.");

  // Qualify.
  const qualified = await api("POST", `/api/console/enquiries/${listed.id}/transition`, {
    cookie,
    headers: { "If-Match": '"2"' },
    body: { to: "qualified" },
  });
  check("enquiry qualified", qualified.status === 200 && qualified.json.enquiry.status === "qualified");
  const version = qualified.json.enquiry.version;

  // Milestone preview.
  const preview = await api("POST", "/api/console/milestones/preview", { cookie, body: { fee_cents: 499999 } });
  check(
    "split adds up exactly with remainder on milestone 4",
    preview.status === 200 &&
      JSON.stringify(preview.json.milestones.map((m) => m.amount_cents)) === JSON.stringify([149999, 99999, 99999, 150002]),
  );

  // Send a proposal.
  const proposalResponse = await api("POST", `/api/console/enquiries/${listed.id}/proposal`, {
    cookie,
    headers: { "If-Match": `"${version}"` },
    body: {
      producer_name: "Søren Ålund",
      producer_email: "soren@example.com",
      project_title: "Roguelite Combat Score",
      scope: "Four intensity tiers with adaptive layering.",
      fee_cents: 800000,
      production_month: months.json.months[0].month,
    },
  });
  check("proposal sent", proposalResponse.status === 201, JSON.stringify(proposalResponse.json).slice(0, 200));
  const proposalToken = proposalResponse.json.enquiry.proposal.token;
  const proposalVersion = proposalResponse.json.enquiry.version;

  await sleep(1500);
  const mail2 = await mailpitCount();
  const proposalMail = mail2.messages.find((m) => m.subject === `Proposal ${reference} from Kettlehole Audio: Roguelite Combat Score`);
  check("proposal email delivered to producer", Boolean(proposalMail));

  // Producer reads the proposal.
  const proposalRead = await api("GET", `/api/proposals/${proposalToken}`);
  check(
    "proposal page shows same milestones",
    proposalRead.status === 200 &&
      JSON.stringify(proposalRead.json.milestones.map((m) => m.amount_cents)) === JSON.stringify([240000, 160000, 160000, 240000]),
  );
  check("proposal status is proposal_sent", proposalRead.json.status === "proposal_sent");
  check("proposal month is open", proposalRead.json.month_open === true);

  // Accept twice at once; exactly one 201.
  const acceptA = api("POST", `/api/proposals/${proposalToken}/accept`, { body: {} });
  const acceptB = api("POST", `/api/proposals/${proposalToken}/accept`, { body: {} });
  const [first, second] = await Promise.all([acceptA, acceptB]);
  const successes = [first, second].filter((r) => r.status === 201).length;
  check("exactly one acceptance succeeds", successes === 1, `statuses ${first.status}/${second.status}`);
  const deposit = (first.status === 201 ? first : second).json.deposit;
  check("deposit invoice has exact amount", deposit.amount_cents === 240000, JSON.stringify(deposit));
  check("deposit is unpaid initially", deposit.paid === false);
  const loser = first.status === 201 ? second : first;
  check("second accept answers 409 illegal_transition", loser.status === 409 && loser.json.error === "illegal_transition");

  await sleep(1500);
  const mail3 = await mailpitCount();
  const heldMail = mail3.messages.find((m) => m.subject === `${months.json.months[0].label} held for Roguelite Combat Score: deposit due`);
  check("month-held email delivered exactly once", mail3.messages.filter((m) => heldMail && m.subject === heldMail.subject).length === 1);

  // Pay the deposit with idempotency.
  const pay = await api("POST", `/api/proposals/${proposalToken}/deposit`, {
    headers: { "Idempotency-Key": "smoke-deposit-1" },
    body: { payer_name: "Søren Ålund", amount_cents: 240000 },
  });
  check("deposit paid", pay.status === 200 && pay.json.status === "deposit_paid", JSON.stringify(pay.json).slice(0, 200));
  const payReplay = await api("POST", `/api/proposals/${proposalToken}/deposit`, {
    headers: { "Idempotency-Key": "smoke-deposit-1" },
    body: { payer_name: "Søren Ålund", amount_cents: 240000 },
  });
  check("deposit replay returns stored response", payReplay.status === 200 && payReplay.json.payment_id === pay.json.payment_id);
  const payConflict = await api("POST", `/api/proposals/${proposalToken}/deposit`, {
    headers: { "Idempotency-Key": "smoke-deposit-1" },
    body: { payer_name: "Different Name", amount_cents: 149999 },
  });
  check("deposit key with different body answers 409", payConflict.status === 409 && payConflict.json.error === "idempotency_conflict");

  await sleep(1500);
  const mail4 = await mailpitCount();
  const depositMail = mail4.messages.find((m) => m.subject === `Deposit received: ${months.json.months[0].label} confirmed for Roguelite Combat Score`);
  check("deposit-received email delivered once", mail4.messages.filter((m) => m.subject === (depositMail && depositMail.subject)).length === 1);

  // Deposit read-back shows paid.
  const proposalAfter = await api("GET", `/api/proposals/${proposalToken}`);
  check("proposal page shows deposit paid", proposalAfter.json.status === "deposit_paid" && proposalAfter.json.deposit.paid === true);

  // Start production.
  const enquiryBeforeBooking = await api("GET", `/api/console/enquiries/${listed.id}`, { cookie });
  const depositPaidVersion = enquiryBeforeBooking.json.enquiry.version;
  const startProduction = await api("POST", `/api/console/enquiries/${listed.id}/transition`, {
    cookie,
    headers: { "If-Match": `"${depositPaidVersion}"` },
    body: { to: "booked" },
  });
  check(
    "production starts from deposit_paid",
    startProduction.status === 200 && startProduction.json.enquiry.status === "booked",
    JSON.stringify(startProduction.json).slice(0, 160),
  );

  // Invoice milestones 2-4 in order.
  const enquiryAfterBooked = await api("GET", `/api/console/enquiries/${listed.id}`, { cookie });
  const bookedVersion = enquiryAfterBooked.json.enquiry.version;
  const m2 = await api("POST", `/api/console/enquiries/${listed.id}/milestones/2/invoice`, {
    cookie,
    headers: { "If-Match": `"${bookedVersion}"` },
    body: {},
  });
  check("milestone 2 invoiced", m2.status === 201 && m2.json.milestone.amount_cents === 160000, JSON.stringify(m2.json).slice(0, 160));
  check("milestone 2 invoice dated today (operator zone)", /^\d{4}-\d{2}-\d{2}$/.test(m2.json.milestone.invoice_date), m2.json.milestone.invoice_date);
  const m3 = await api("POST", `/api/console/enquiries/${listed.id}/milestones/3/invoice`, {
    cookie,
    headers: { "If-Match": `"${m2.json.enquiry.version}"` },
    body: {},
  });
  check("milestone 3 invoiced", m3.status === 201 && m3.json.milestone.amount_cents === 160000);
  const m4 = await api("POST", `/api/console/enquiries/${listed.id}/milestones/4/invoice`, {
    cookie,
    headers: { "If-Match": `"${m3.json.enquiry.version}"` },
    body: {},
  });
  check("milestone 4 invoiced with remainder", m4.status === 201 && m4.json.milestone.amount_cents === 240000);
  const m4Replay = await api("POST", `/api/console/enquiries/${listed.id}/milestones/4/invoice`, {
    cookie,
    headers: { "If-Match": `"${m4.json.enquiry.version}"` },
    body: {},
  });
  check("milestone replay answers milestone_already_invoiced", m4Replay.status === 409 && m4Replay.json.error === "milestone_already_invoiced");

  // Kill Bill state: 4 non-VOID invoices totalling the fee.
  const kbCheck = await fetch(
    `http://killbill:8080/1.0/kb/accounts?externalKey=earshot-${reference}`,
    {
      headers: {
        "X-Killbill-ApiKey": "gfkit-dev",
        "X-Killbill-ApiSecret": "gfkit-dev-secret",
        Authorization: "Basic " + Buffer.from("admin:password").toString("base64"),
      },
    },
  );
  const account = await kbCheck.json();
  check("one Kill Bill account with operator time zone", account.timeZone === "America/Toronto", account.timeZone || "none");
  const invoicesResponse = await fetch(
    `http://killbill:8080/1.0/kb/accounts/${account.accountId}/invoices?includeInvoiceComponents=true`,
    {
      headers: {
        "X-Killbill-ApiKey": "gfkit-dev",
        "X-Killbill-ApiSecret": "gfkit-dev-secret",
        Authorization: "Basic " + Buffer.from("admin:password").toString("base64"),
      },
    },
  );
  const invoices = await invoicesResponse.json();
  const consoleEnquiry = await api("GET", `/api/console/enquiries/${listed.id}`, { cookie });
  const storedProposal = consoleEnquiry.json.enquiry.proposal || {};
  const depositInvoiceNumber = storedProposal.deposit_invoice_number || pay.json.invoice_number;
  const milestoneNumbers = (storedProposal.milestone_invoice_numbers || [
    m2.json.milestone.invoice_number,
    m3.json.milestone.invoice_number,
    m4.json.milestone.invoice_number,
  ]).map(String);
  const byNumber = new Map(invoices.map((i) => [String(i.invoiceNumber), i]));
  const liveDeposit = depositInvoiceNumber ? [byNumber.get(String(depositInvoiceNumber))].filter(Boolean) : [];
  const liveMilestones = milestoneNumbers.map((n) => byNumber.get(n)).filter(Boolean);
  const total = [...liveDeposit, ...liveMilestones].reduce((sum, i) => sum + Math.round(i.amount * 100), 0);
  check(
    "exactly one live deposit invoice and three milestone invoices totalling the fee",
    liveDeposit.length === 1 && liveMilestones.length === 3 && total === 800000,
    `deposit ${liveDeposit.length} milestones ${liveMilestones.length} total ${total}`,
  );

  // Months table.
  const consoleMonths = await api("GET", "/api/console/months", { cookie });
  const usedMonth = consoleMonths.json.months.find((m) => m.month === months.json.months[0].month);
  check("month claimed count is 1", usedMonth.claimed === 1, JSON.stringify(usedMonth));

  // CSV export.
  const csvResponse = await fetch(`${BASE}/api/console/enquiries.csv`, { headers: { Cookie: cookie } });
  const csv = await csvResponse.text();
  check("csv has the exact header", csv.startsWith("reference,received_at,status,name,email,studio,brief,preferred_month,project_slug,fit_score,receipt"));
  check("csv quotes comma-laden names", csv.includes('"Hale, Imogen ""Imo"""'));
  check("csv neutralises formula cells", !/(^|,|\n)[=+@](?!")/.test(csv));

  // Mail queue is empty.
  const queue = await api("GET", "/api/console/mail-queue", { cookie });
  check("mail queue is empty at the end", queue.json.emails.length === 0, JSON.stringify(queue.json.emails).slice(0, 120));

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Smoke test crashed:", error);
  process.exit(1);
});
