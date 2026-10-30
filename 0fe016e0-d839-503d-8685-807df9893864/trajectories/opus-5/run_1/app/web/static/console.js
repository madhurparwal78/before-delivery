"use strict";

const OUTAGE_COPY = "The rollout store did not answer. Check the promotion history before trying again.";
const PENDING_COPY = "Working\u2026";
const RELOAD_INTERVAL_MS = 10000;

const live = {
	cohortsByCode: new Map(),
	flagDetails: new Map(),
	packs: [],
	promotions: []
};

const statusLine = document.getElementById("console-status");
const flagSections = Array.from(document.querySelectorAll("section.flag"));
const flagCodes = flagSections.map((section) => section.dataset.flag);

function textOrNone(value) {
	return value === null || value === undefined || value === "" ? "none" : String(value);
}

function rungListText(values) {
	return values.length === 0 ? "none" : values.join(", ");
}

async function readJSON(path) {
	const response = await fetch(path, { headers: { Accept: "application/json" } });
	if (!response.ok) {
		throw new Error("read failed");
	}
	return response.json();
}

async function reloadAll() {
	const [cohorts, packs, promotions] = await Promise.all([
		readJSON("/api/cohort"),
		readJSON("/api/evidence_pack"),
		readJSON("/api/promotion")
	]);
	live.cohortsByCode = new Map(cohorts.map((cohort) => [cohort.cohort_code, cohort]));
	live.packs = packs;
	live.promotions = promotions;
	const details = await Promise.all(flagCodes.map((code) => readJSON("/api/capability_flag/" + code)));
	details.forEach((detail) => live.flagDetails.set(detail.flag_code, detail));
	render();
}

function render() {
	flagSections.forEach((section) => renderLadder(section));
	renderEvidencePack();
	renderHistory();
}

function renderLadder(section) {
	const detail = live.flagDetails.get(section.dataset.flag);
	if (!detail) {
		return;
	}
	const ladder = section.querySelector('[data-role="ladder"]');
	ladder.textContent = "";
	detail.rungs.forEach((rung) => ladder.appendChild(rungCard(rung)));
}

function rungCard(rung) {
	const item = document.createElement("li");
	item.className = "rung";
	item.dataset.rung = String(rung.rung_index_count);

	const title = document.createElement("p");
	title.className = "rung-title";
	title.textContent = "Rung " + rung.rung_index_count + " \u00b7 " + rung.cohort_label;
	item.appendChild(title);

	const stateLine = document.createElement("p");
	stateLine.className = "rung-state";
	const word = document.createElement("span");
	word.className = "state-word state-" + rung.state.toLowerCase().replace(" ", "-");
	word.textContent = rung.state;
	stateLine.appendChild(word);
	if (rung.attested) {
		const attested = document.createElement("span");
		attested.className = "attested";
		attested.textContent = "Attested";
		stateLine.appendChild(attested);
	}
	item.appendChild(stateLine);

	let promotedLine = "Promoted at minute " + textOrNone(rung.promoted_at_minutes);
	if (rung.demoted_at_minutes !== null && rung.demoted_at_minutes !== undefined) {
		promotedLine += ", demoted at minute " + rung.demoted_at_minutes;
	}
	item.appendChild(figureLine(promotedLine));
	item.appendChild(figureLine(
		"Soak " + textOrNone(rung.soak_elapsed_minutes) + " minutes of " + rung.min_soak_minutes + " minutes"
	));
	item.appendChild(figureLine(
		"Rate " + rung.rate_bp + " basis points from " + rung.event_count + " events on " +
		rung.device_count + " devices, maximum " + rung.max_adverse_rate_bp + " basis points"
	));
	item.appendChild(figureLine("Attestation " + textOrNone(rung.attestation_reference)));
	return item;
}

function figureLine(text) {
	const line = document.createElement("p");
	line.className = "rung-figure";
	line.textContent = text;
	return line;
}

function renderEvidencePack() {
	const body = document.getElementById("evidence-rows");
	body.textContent = "";
	flagCodes.forEach((flagCode) => {
		const pack = live.packs.find((candidate) => candidate.flag_code === flagCode);
		if (!pack) {
			return;
		}
		body.appendChild(tableRow([
			pack.flag_code,
			String(pack.highest_rung_index_count),
			rungListText(pack.gap_rung_index_counts),
			rungListText(pack.soak_satisfied_rung_index_counts),
			rungListText(pack.rate_satisfied_rung_index_counts)
		]));
	});
}

function renderHistory() {
	const body = document.getElementById("history-rows");
	body.textContent = "";
	live.promotions.forEach((promotion) => {
		body.appendChild(tableRow([
			promotion.promotion_code,
			promotion.flag_code,
			promotion.cohort_code,
			String(promotion.promoted_at_minutes),
			textOrNone(promotion.demoted_at_minutes),
			textOrNone(promotion.attestation_reference)
		]));
	});
}

function tableRow(cells) {
	const row = document.createElement("tr");
	cells.forEach((cell) => {
		const element = document.createElement("td");
		element.textContent = cell;
		row.appendChild(element);
	});
	return row;
}

function announce(copy) {
	statusLine.textContent = copy;
}

function fieldErrorCopy(errors) {
	const lines = Object.keys(errors).sort().map((field) => field + ": " + errors[field]);
	return "Not accepted:\n" + lines.join("\n");
}

function freshIdempotencyKey() {
	return "console-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

async function attempt(method, path, body, key) {
	const headers = { "Content-Type": "application/json" };
	if (key) {
		headers["Idempotency-Key"] = key;
	}
	try {
		const response = await fetch(path, { method: method, headers: headers, body: JSON.stringify(body) });
		let payload = null;
		try {
			payload = await response.json();
		} catch (error) {
			payload = null;
		}
		return { status: response.status, payload: payload };
	} catch (error) {
		return null;
	}
}

// send runs one console action: it never changes a rung before the server
// answers, and it reloads live state after every response.
async function send(options) {
	const button = options.button;
	const alertBox = options.alert;
	const label = button.textContent;
	button.disabled = true;
	button.textContent = PENDING_COPY;

	const key = options.idempotent ? freshIdempotencyKey() : "";
	let response = await attempt(options.method, options.path, options.body, key);
	if (response === null && options.idempotent) {
		response = await attempt(options.method, options.path, options.body, key);
	}

	button.textContent = label;
	button.disabled = false;
	button.focus();

	if (response === null || response.status === 503) {
		alertBox.textContent = OUTAGE_COPY;
	} else if (response.status === 200 || response.status === 201) {
		alertBox.textContent = "";
		announce(options.successCopy(response.payload));
		if (options.onSuccess) {
			options.onSuccess();
		}
	} else if (response.status === 422 && response.payload && response.payload.errors) {
		alertBox.textContent = fieldErrorCopy(response.payload.errors);
	} else if (response.payload && response.payload.error) {
		alertBox.textContent = response.payload.error;
	} else {
		alertBox.textContent = OUTAGE_COPY;
	}

	try {
		await reloadAll();
	} catch (error) {
		alertBox.textContent = alertBox.textContent || OUTAGE_COPY;
	}
}

function rungOf(cohortCode) {
	const cohort = live.cohortsByCode.get(cohortCode);
	return cohort ? cohort.rung_index_count : 0;
}

function flagLabelOf(flagCode) {
	const detail = live.flagDetails.get(flagCode);
	return detail ? detail.flag_label : flagCode;
}

flagSections.forEach((section) => {
	const flagCode = section.dataset.flag;
	const cohortSelect = section.querySelector('[data-role="cohort"]');
	const referenceField = section.querySelector('[data-role="reference"]');
	const alertBox = section.querySelector('[data-role="alert"]');

	const promoteButton = section.querySelector('[data-action="promote"]');
	const forceButton = section.querySelector('[data-action="force-enable"]');
	const rollbackButton = section.querySelector('[data-action="rollback"]');

	promoteButton.addEventListener("click", () => send({
		button: promoteButton,
		alert: alertBox,
		method: "POST",
		path: "/api/promotion",
		idempotent: true,
		body: {
			flag_code: flagCode,
			cohort_code: cohortSelect.value,
			attestation_reference: referenceField.value
		},
		successCopy: (row) => "Promoted " + flagLabelOf(flagCode) + " to rung " + rungOf(row.cohort_code) + "."
	}));

	forceButton.addEventListener("click", () => send({
		button: forceButton,
		alert: alertBox,
		method: "POST",
		path: "/api/promotion/force-enable",
		idempotent: true,
		body: { flag_code: flagCode, cohort_code: cohortSelect.value },
		successCopy: (row) => "Force enabled " + flagLabelOf(flagCode) + " at rung " + rungOf(row.cohort_code) + "."
	}));

	rollbackButton.addEventListener("click", () => send({
		button: rollbackButton,
		alert: alertBox,
		method: "POST",
		path: "/api/promotion/rollback",
		idempotent: true,
		body: { flag_code: flagCode },
		successCopy: (row) => "Rolled back " + flagLabelOf(flagCode) + " to rung " + (rungOf(row.cohort_code) - 1) + "."
	}));

	referenceField.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			promoteButton.click();
		}
	});
});

const eventForm = document.getElementById("adverse-event-form");
const eventCodeField = document.getElementById("event-code");
const eventSubmit = document.getElementById("event-submit");
const eventAlert = document.getElementById("event-alert");

function numberOrNull(field) {
	return field.value === "" ? null : Number(field.value);
}

eventForm.addEventListener("submit", (event) => {
	event.preventDefault();
	send({
		button: eventSubmit,
		alert: eventAlert,
		method: "POST",
		path: "/api/adverse_event",
		idempotent: false,
		body: {
			event_code: eventCodeField.value,
			device_code: document.getElementById("event-device").value,
			flag_code: document.getElementById("event-flag").value,
			occurred_at_minutes: numberOrNull(document.getElementById("event-minutes")),
			severity_band_code: document.getElementById("event-band").value
		},
		successCopy: (row) => "Recorded adverse event " + row.event_code + ".",
		onSuccess: () => {
			eventCodeField.value = "";
		}
	});
});

document.querySelectorAll("[data-save-flag]").forEach((button) => {
	const flagCode = button.dataset.saveFlag;
	const field = document.getElementById("maximum-" + flagCode);
	const alertBox = document.getElementById("settings-alert");
	const save = () => send({
		button: button,
		alert: alertBox,
		method: "PATCH",
		path: "/api/capability_flag/" + flagCode,
		idempotent: false,
		body: { max_adverse_rate_bp: numberOrNull(field) },
		successCopy: () => "Saved."
	});
	button.addEventListener("click", save);
	field.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			save();
		}
	});
});

document.querySelectorAll("[data-save-cohort]").forEach((button) => {
	const cohortCode = button.dataset.saveCohort;
	const field = document.getElementById("soak-" + cohortCode);
	const alertBox = document.getElementById("settings-alert");
	const save = () => send({
		button: button,
		alert: alertBox,
		method: "PATCH",
		path: "/api/cohort/" + cohortCode,
		idempotent: false,
		body: { min_soak_minutes: numberOrNull(field) },
		successCopy: () => "Saved."
	});
	button.addEventListener("click", save);
	field.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			save();
		}
	});
});

reloadAll().catch(() => {
	statusLine.textContent = OUTAGE_COPY;
});
window.setInterval(() => {
	reloadAll().catch(() => undefined);
}, RELOAD_INTERVAL_MS);
