package main

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
)

// ---- request boundary and error precedence ----

func TestWriteBoundary(t *testing.T) {
	_, server := newTestApp(t)

	// A write without the JSON content type answers 415.
	status, body, _ := callRaw(t, server, "POST", "/api/promotion", `{"flag_code":"FLG-TELEM","cohort_code":"COH-3"}`, map[string]string{"Content-Type": "text/plain"})
	if status != 415 {
		t.Fatalf("content type: %d %s", status, body)
	}

	// A body over the limit answers 413.
	huge := strings.Repeat("a", 16385)
	status, body, _ = callRaw(t, server, "POST", "/api/promotion",
		`{"flag_code":"FLG-TELEM","cohort_code":"COH-3","attestation_reference":"`+huge+`"}`, nil)
	if status != 413 {
		t.Fatalf("body size: %d %s", status, body)
	}

	// The whole-number checks: a fraction, an exponent and a string all fail.
	for _, bad := range []string{"50.5", "50.0", "5e1", `"50"`} {
		status, body, _ = callRaw(t, server, "PATCH", "/api/capability_flag/FLG-TELEM",
			`{"max_adverse_rate_bp":`+bad+`}`, nil)
		if status != 422 {
			t.Fatalf("whole number %s: %d %s", bad, status, body)
		}
		if !strings.Contains(body, "must be a whole number from 0 to 10000") {
			t.Fatalf("whole number %s message: %s", bad, body)
		}
	}
	// A JSON number written with no fraction part passes.
	status, body, _ = callRaw(t, server, "PATCH", "/api/capability_flag/FLG-TELEM",
		`{"max_adverse_rate_bp":300}`, nil)
	if status != 200 {
		t.Fatalf("whole number 300: %d %s", status, body)
	}
}

func TestErrorPrecedence(t *testing.T) {
	_, server := newTestApp(t)

	// 415 comes before 413.
	status, body, _ := callRaw(t, server, "POST", "/api/promotion",
		`{"flag_code":"FLG-TELEM","cohort_code":"COH-3","attestation_reference":"`+strings.Repeat("a", 16385)+`"}`,
		map[string]string{"Content-Type": "text/plain"})
	if status != 415 {
		t.Fatalf("415 before 413: %d %s", status, body)
	}

	// The idempotency key format comes before field validation.
	status, body, _ = callRaw(t, server, "POST", "/api/promotion",
		`{"flag_code":"NOPE","cohort_code":"COH-3"}`,
		map[string]string{"Idempotency-Key": "bad key!"})
	if status != 422 {
		t.Fatalf("key format: %d %s", status, body)
	}
	if !strings.Contains(body, `"idempotency_key":"must be 1 to 64 letters, digits, hyphens or underscores"`) {
		t.Fatalf("key format message: %s", body)
	}

	// An unknown code in the path answers 404 before field validation.
	res := call(t, server, "PATCH", "/api/capability_flag/FLG-NOPE", map[string]any{"max_adverse_rate_bp": 1}, nil)
	if res.status != 404 {
		t.Fatalf("unknown flag: %d", res.status)
	}

	// Every failing field is listed at once.
	res = call(t, server, "POST", "/api/promotion", map[string]any{
		"flag_code": "FLG-NOPE", "cohort_code": "COH-NOPE", "attestation_reference": strings.Repeat("x", 65),
	}, nil)
	if res.status != 422 {
		t.Fatalf("field errors: %d %v", res.status, res.body)
	}
	errors := res.body["errors"].(map[string]any)
	for _, field := range []string{"flag_code", "cohort_code", "attestation_reference"} {
		if _, ok := errors[field]; !ok {
			t.Fatalf("missing field error %s in %v", field, errors)
		}
	}

	// An unknown field is its own 422 entry.
	status, body, _ = callRaw(t, server, "POST", "/api/promotion",
		`{"flag_code":"FLG-TELEM","cohort_code":"COH-3","attestation_reference":"ATT-X-1","extra":"x"}`, nil)
	if status != 422 || !strings.Contains(body, `"extra":"is not an accepted field"`) {
		t.Fatalf("unknown field: %d %s", status, body)
	}

	// A body that is not a JSON object is the body field error.
	status, body, _ = callRaw(t, server, "POST", "/api/promotion", `[1,2]`, nil)
	if status != 422 || !strings.Contains(body, `"body":"must be a JSON object"`) {
		t.Fatalf("body shape: %d %s", status, body)
	}

	// Force enable rejects an attestation reference: it is not in its shape.
	status, body, _ = callRaw(t, server, "POST", "/api/promotion/force-enable",
		`{"flag_code":"FLG-TELEM","cohort_code":"COH-3","attestation_reference":"ATT-X"}`, nil)
	if status != 422 || !strings.Contains(body, `"attestation_reference":"is not an accepted field"`) {
		t.Fatalf("force enable shape: %d %s", status, body)
	}
}

// ---- idempotency ----

func TestIdempotency(t *testing.T) {
	_, server := newTestApp(t)

	key := map[string]string{"Idempotency-Key": "promote-once"}

	// Only 200 and 201 responses are stored: a refused key may succeed later.
	refused := promote(t, server, "FLG-ALERT", "COH-3", "ATT-ALERT-A", key)
	if refused.status != 409 {
		t.Fatalf("refused first: %d %v", refused.status, refused.body)
	}
	res := promote(t, server, "FLG-ALERT", "COH-1", "ATT-ALERT-A", key)
	if res.status != 201 {
		t.Fatalf("same key later: %d %v", res.status, res.body)
	}
	if res.headers.Get("Idempotent-Replayed") == "true" {
		t.Fatalf("first success carries the replay header")
	}

	// The same key, route and body replays the stored response.
	replay := promote(t, server, "FLG-ALERT", "COH-1", "ATT-ALERT-A", key)
	if replay.status != 201 {
		t.Fatalf("replay: %d %v", replay.status, replay.body)
	}
	if replay.headers.Get("Idempotent-Replayed") != "true" {
		t.Fatalf("replay header missing")
	}
	assertEqual(t, "replay body", replay.body["promotion_code"], res.body["promotion_code"])
	promotions := callList(t, server, "/api/promotion")
	assertEqual(t, "replay wrote nothing", len(promotions), 4)

	// The same key with a different body is a mismatch.
	status, body, _ := callRaw(t, server, "POST", "/api/promotion",
		`{"cohort_code":"COH-1","flag_code":"FLG-ALERT","attestation_reference":"ATT-ALERT-A"}`,
		map[string]string{"Idempotency-Key": "promote-once"})
	if status != 201 {
		t.Fatalf("key order ignored: %d %s", status, body)
	}
	mismatch := promote(t, server, "FLG-ALERT", "COH-2", "ATT-ALERT-A", key)
	if mismatch.status != 422 {
		t.Fatalf("mismatch body: %d %v", mismatch.status, mismatch.body)
	}
	errors := mismatch.body["errors"].(map[string]any)
	assertEqual(t, "mismatch message", errors["idempotency_key"], "was used with a different request")

	// The same key on a different route is a mismatch.
	status, body, _ = callRaw(t, server, "POST", "/api/promotion/rollback",
		`{"flag_code":"FLG-ALERT"}`, map[string]string{"Idempotency-Key": "promote-once"})
	if status != 422 || !strings.Contains(body, "was used with a different request") {
		t.Fatalf("mismatch route: %d %s", status, body)
	}

	// A key never expires: it replays the stored response unchanged.
	rollbackKey := map[string]string{"Idempotency-Key": "rollback-once"}
	first := rollback(t, server, "FLG-ALERT", rollbackKey)
	if first.status != 200 {
		t.Fatalf("rollback: %d %v", first.status, first.body)
	}
	demotedCode := first.body["promotion_code"]
	again := rollback(t, server, "FLG-ALERT", rollbackKey)
	if again.status != 200 || again.body["promotion_code"] != demotedCode {
		t.Fatalf("rollback replay: %d %v", again.status, again.body)
	}
	detail := flagDetail(t, server, "FLG-ALERT")
	assertEqual(t, "replayed rollback demoted once", detail["highest_rung_index_count"], float64(0))
}

// ---- field messages in check order ----

func TestFieldMessages(t *testing.T) {
	_, server := newTestApp(t)

	// An absent reference on a standard promotion is the DP-04 refusal.
	res := promote(t, server, "FLG-ALERT", "COH-1", "", nil)
	if res.status != 409 || res.body["rule"] != "DP-04" {
		t.Fatalf("empty reference: %d %v", res.status, res.body)
	}
	assertEqual(t, "DP-04 copy", res.body["error"],
		"Refused: an attestation reference is required for rung 1 (DP-04).")

	// A non-printable character fails the reference format.
	status, body, _ := callRaw(t, server, "POST", "/api/promotion",
		`{"flag_code":"FLG-ALERT","cohort_code":"COH-1","attestation_reference":"ATT-`+"é"+`"}`, nil)
	if status != 422 || !strings.Contains(body, "must be 1 to 64 printable characters") {
		t.Fatalf("accented reference: %d %s", status, body)
	}

	// 64 characters exactly is allowed.
	res = promote(t, server, "FLG-ALERT", "COH-1", strings.Repeat("r", 64), nil)
	if res.status != 201 {
		t.Fatalf("64 characters: %d %v", res.status, res.body)
	}

	// The event code normalisation: lower case and padding are stored upper.
	res = recordEvent(t, server, "  aev-10  ", "DEV-0001", "FLG-ALERT", frozenNowMinutes, "BAND-LOW")
	if res.status != 201 {
		t.Fatalf("event code: %d %v", res.status, res.body)
	}
	assertEqual(t, "stored code", res.body["event_code"], "AEV-10")

	// An event in the future is refused.
	res = recordEvent(t, server, "AEV-11", "DEV-0001", "FLG-ALERT", frozenNowMinutes+1, "BAND-LOW")
	if res.status != 422 {
		t.Fatalf("future event: %d %v", res.status, res.body)
	}
	errors := res.body["errors"].(map[string]any)
	assertEqual(t, "future message", errors["occurred_at_minutes"], "cannot be in the future")

	// An unknown severity band is refused.
	res = recordEvent(t, server, "AEV-12", "DEV-0001", "FLG-ALERT", frozenNowMinutes, "BAND-CRIT")
	errors = res.body["errors"].(map[string]any)
	assertEqual(t, "band message", errors["severity_band_code"], "must be BAND-LOW, BAND-MED or BAND-HIGH")

	// An unknown device is refused.
	res = recordEvent(t, server, "AEV-13", "DEV-NOPE", "FLG-ALERT", frozenNowMinutes, "BAND-LOW")
	errors = res.body["errors"].(map[string]any)
	assertEqual(t, "device message", errors["device_code"], "is not a known device")

	// Rollback with no active rung is the DP-05 refusal.
	res = rollback(t, server, "FLG-ALERT", nil)
	// FLG-ALERT has rung 1 active from the 64-character promotion above.
	if res.status != 200 {
		t.Fatalf("rollback rung 1: %d %v", res.status, res.body)
	}
	res = rollback(t, server, "FLG-ALERT", nil)
	if res.status != 409 || res.body["rule"] != "DP-05" {
		t.Fatalf("DP-05: %d %v", res.status, res.body)
	}
	assertEqual(t, "DP-05 copy", res.body["error"],
		"Refused: Predictive occlusion alert has no active rung to roll back (DP-05).")

	// A settings value outside the published range is refused.
	res = call(t, server, "PATCH", "/api/capability_flag/FLG-ALERT", map[string]any{"max_adverse_rate_bp": 10001}, nil)
	if res.status != 422 {
		t.Fatalf("max range: %d %v", res.status, res.body)
	}
	errors = res.body["errors"].(map[string]any)
	assertEqual(t, "max message", errors["max_adverse_rate_bp"], "must be a whole number from 0 to 10000")
	res = call(t, server, "PATCH", "/api/cohort/COH-1", map[string]any{"min_soak_minutes": 525601}, nil)
	errors = res.body["errors"].(map[string]any)
	assertEqual(t, "soak message", errors["min_soak_minutes"], "must be a whole number from 0 to 525600")
}

// ---- settings and refusal side effects ----

func TestSettingsAndRefusalSideEffects(t *testing.T) {
	_, server := newTestApp(t)

	// A refused promotion consumes no code and changes no record.
	before := len(callList(t, server, "/api/promotion"))
	res := promote(t, server, "FLG-ALERT", "COH-3", "ATT-ALERT-REFUSED", nil)
	if res.status != 409 {
		t.Fatalf("refused: %d %v", res.status, res.body)
	}
	after := len(callList(t, server, "/api/promotion"))
	assertEqual(t, "no code consumed", after, before)

	// A same-value PATCH answers 200 and demotes nothing.
	res = call(t, server, "PATCH", "/api/capability_flag/FLG-TELEM", map[string]any{"max_adverse_rate_bp": 300}, nil)
	if res.status != 200 {
		t.Fatalf("same value: %d %v", res.status, res.body)
	}
	detail := flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "highest rung", detail["highest_rung_index_count"], float64(2))

	// Lowering the soak never restores a demoted rung.
	key := map[string]string{"Idempotency-Key": "rollback-settings"}
	if res := rollback(t, server, "FLG-TELEM", key); res.status != 200 {
		t.Fatalf("rollback: %d %v", res.status, res.body)
	}
	if res := call(t, server, "PATCH", "/api/cohort/COH-2", map[string]any{"min_soak_minutes": 0}, nil); res.status != 200 {
		t.Fatalf("lower soak: %d %v", res.status, res.body)
	}
	detail = flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "demoted stays demoted", rungsOf(detail)[1]["state"], "Demoted")
	assertEqual(t, "highest rung after rollback", detail["highest_rung_index_count"], float64(1))

	// A refused PATCH alters nothing and triggers no reassessment.
	res = call(t, server, "PATCH", "/api/capability_flag/FLG-ADAPTIVE", map[string]any{"max_adverse_rate_bp": -1}, nil)
	if res.status != 422 {
		t.Fatalf("refused patch: %d %v", res.status, res.body)
	}
	detail = flagDetail(t, server, "FLG-ADAPTIVE")
	assertEqual(t, "maximum unchanged", detail["max_adverse_rate_bp"], float64(40))
}

// ---- concurrency ----

func TestSimultaneousWrites(t *testing.T) {
	_, server := newTestApp(t)

	const workers = 12
	var wg sync.WaitGroup
	start := make(chan struct{})
	promoteResults := make([]response, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			// Half standard promotions of the alert flag to rung 1, half
			// force enables of the telemetry flag at rung 3.
			if i%2 == 0 {
				promoteResults[i] = promote(t, server, "FLG-ALERT", "COH-1", fmt.Sprintf("ATT-ALERT-%d", i), nil)
			} else {
				promoteResults[i] = forceEnable(t, server, "FLG-TELEM", "COH-3", nil)
			}
		}(i)
	}
	close(start)
	wg.Wait()

	promoted, refused := 0, 0
	for _, res := range promoteResults {
		switch res.status {
		case 201:
			promoted++
		case 422:
			refused++
		default:
			t.Fatalf("simultaneous write answered %d: %v", res.status, res.body)
		}
	}
	assertEqual(t, "one promotion per flag and rung", promoted, 2)
	assertEqual(t, "rest refused", refused, workers-2)

	// The promotion codes stay consecutive with no number skipped.
	promotions := callList(t, server, "/api/promotion")
	assertEqual(t, "promotion rows", len(promotions), 5)
	wantCodes := []string{"PRM-01", "PRM-02", "PRM-03", "PRM-04", "PRM-05"}
	for i, p := range promotions {
		assertEqual(t, "code order", p["promotion_code"], wantCodes[i])
	}

	// Simultaneous adverse events with one code: exactly one is recorded.
	eventStart := make(chan struct{})
	eventResults := make([]response, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-eventStart
			eventResults[i] = recordEvent(t, server, "AEV-RACE", "DEV-0001", "FLG-ALERT", frozenNowMinutes, "BAND-LOW")
		}(i)
	}
	close(eventStart)
	wg.Wait()
	created := 0
	for _, res := range eventResults {
		switch res.status {
		case 201:
			created++
		case 422:
		default:
			t.Fatalf("simultaneous event answered %d: %v", res.status, res.body)
		}
	}
	assertEqual(t, "one event recorded", created, 1)
}

// ---- exports edge cases ----

func TestExportFormulaNeutralisation(t *testing.T) {
	_, server := newTestApp(t)

	// A reference that looks like a formula is neutralised only in the CSV.
	status, body, _ := callRaw(t, server, "POST", "/api/promotion",
		`{"flag_code":"FLG-ALERT","cohort_code":"COH-1","attestation_reference":"=SUM(A1),x"}`, nil)
	if status != 201 {
		t.Fatalf("promote: %d %s", status, body)
	}
	// Rung 2 needs the rung below's soak: lower the minimum first.
	if res := call(t, server, "PATCH", "/api/cohort/COH-1", map[string]any{"min_soak_minutes": 0}, nil); res.status != 200 {
		t.Fatalf("patch soak: %d %v", res.status, res.body)
	}
	status, body, _ = callRaw(t, server, "POST", "/api/promotion",
		`{"flag_code":"FLG-ALERT","cohort_code":"COH-2","attestation_reference":"@ATT-3"}`, nil)
	if status != 201 {
		t.Fatalf("promote 2: %d %s", status, body)
	}

	if res := call(t, server, "POST", "/api/DP-09/render", map[string]any{}, nil); res.status != 201 {
		t.Fatalf("render: %d %v", res.status, res.body)
	}
	content := call(t, server, "GET", "/api/DP-09/latest", nil, nil).body["content"].(string)
	if !strings.Contains(content, `,"'=SUM(A1),x"`) {
		t.Fatalf("formula with comma not neutralised and quoted:\n%s", content)
	}
	if !strings.Contains(content, `,'@ATT-3`) {
		t.Fatalf("leading at-sign not neutralised:\n%s", content)
	}

	// The raw value survives in the API and the other exports.
	detail := flagDetail(t, server, "FLG-ALERT")
	assertEqual(t, "raw reference in flag detail", rungsOf(detail)[0]["attestation_reference"], "=SUM(A1),x")
	if res := call(t, server, "POST", "/api/DP-10/render", map[string]any{}, nil); res.status != 201 {
		t.Fatalf("render pack: %d %v", res.status, res.body)
	}

	// Before the first render of an unrendered deliverable, latest is 404.
	for _, name := range []string{"ladder-state.csv", "evidence-pack.json", "adverse-rates.txt"} {
		os.Remove(name)
	}
	_, server2 := newTestApp(t)
	latest := call(t, server2, "GET", "/api/DP-10/latest", nil, nil)
	if latest.status != 404 || latest.body["error"] != "not rendered yet" {
		t.Fatalf("not rendered yet: %d %v", latest.status, latest.body)
	}

	// The render route accepts and ignores an optional format field.
	status, body, _ = callRaw(t, server, "POST", "/api/DP-11/render", `{"format":"txt"}`, nil)
	if status != 201 {
		t.Fatalf("render with format: %d %s", status, body)
	}
	status, body, _ = callRaw(t, server, "POST", "/api/DP-11/render", `{"format":1}`, nil)
	if status != 422 || !strings.Contains(body, `"format":"must be text"`) {
		t.Fatalf("format must be text: %d %s", status, body)
	}
}

func TestReaderPagesShowNoOperatorControls(t *testing.T) {
	_, server := newTestApp(t)

	for _, path := range []string{"/capability_flag", "/cohort", "/device", "/promotion", "/adverse_event", "/evidence_pack"} {
		status, body, _ := callRaw(t, server, "GET", path, "", nil)
		if status != 200 {
			t.Fatalf("reader page %s: %d", path, status)
		}
		if strings.Contains(body, "<button") || strings.Contains(body, "<form") {
			t.Fatalf("reader page %s exposes an operator control", path)
		}
		if !strings.Contains(body, " records</p>") {
			t.Fatalf("reader page %s missing the record count line", path)
		}
	}

	// The home page shows the product name and links, including the console.
	status, homeBody, _ := callRaw(t, server, "GET", "/", "", nil)
	if status != 200 || !strings.Contains(homeBody, `href="/console"`) {
		t.Fatalf("home page missing console link: %d", status)
	}

	status, body, _ := callRaw(t, server, "GET", "/console", "", nil)
	if status != 200 {
		t.Fatalf("console: %d", status)
	}
	if !strings.Contains(body, "Rollout console") {
		t.Fatalf("console shell missing")
	}
}
