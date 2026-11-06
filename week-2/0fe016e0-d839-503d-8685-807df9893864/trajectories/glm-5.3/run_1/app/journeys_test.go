package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

// frozenNowMinutes is the instant every journey test runs at, so every gate
// figure is exact. It sits well after the seed's last instant (115000).
const frozenNowMinutes = 200000

func TestMain(m *testing.M) {
	clockOverrideSeconds = frozenNowMinutes * 60
	code := m.Run()
	// The shipped app contains none of the three render files.
	for _, name := range []string{"ladder-state.csv", "evidence-pack.json", "adverse-rates.txt"} {
		os.Remove(name)
	}
	os.Exit(code)
}

// resetStore empties the store and re-seeds it, so every test starts from
// the seed and a clean journey trace.
func resetStore(t *testing.T) {
	t.Helper()
	db, err := openDB()
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer db.Close()
	if _, err := db.Exec(`TRUNCATE capability_flag, cohort, device, promotion, adverse_event,
		evidence_pack, ledger_entry, promotion_sequence, idempotency_record, journey_step`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	if err := ensureSchema(db); err != nil {
		t.Fatalf("schema: %v", err)
	}
	if err := seedOnce(db); err != nil {
		t.Fatalf("seed: %v", err)
	}
	ok, err := seeded(db)
	if err != nil || !ok {
		t.Fatalf("seed check: %v %v", ok, err)
	}
}

func newTestApp(t *testing.T) (*app, *httptest.Server) {
	t.Helper()
	resetStore(t)
	db, err := openDB()
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	a := &app{db: db, svc: &service{db: db, clock: serverClock{}}}
	a.ready.Store(true)
	server := httptest.NewServer(a.routes())
	t.Cleanup(server.Close)
	return a, server
}

// response is one API answer.
type response struct {
	status  int
	headers http.Header
	body    map[string]any
}

func call(t *testing.T, server *httptest.Server, method, path string, body any, headers map[string]string) response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, server.URL+path, reader)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	out := response{status: res.StatusCode, headers: res.Header}
	if len(raw) > 0 {
		var parsed map[string]any
		if err := json.Unmarshal(raw, &parsed); err != nil {
			t.Fatalf("non-json body %q: %v", raw, err)
		}
		out.body = parsed
	}
	return out
}

func callRaw(t *testing.T, server *httptest.Server, method, path string, body string, headers map[string]string) (int, string, http.Header) {
	t.Helper()
	req, err := http.NewRequest(method, server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return res.StatusCode, string(raw), res.Header
}

func callList(t *testing.T, server *httptest.Server, path string) []map[string]any {
	t.Helper()
	req, err := http.NewRequest("GET", server.URL+path, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if res.StatusCode != 200 {
		t.Fatalf("list %s: status %d body %s", path, res.StatusCode, raw)
	}
	var out []map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("list %s not a top-level array: %s", path, raw)
	}
	return out
}

func flagDetail(t *testing.T, server *httptest.Server, flagCode string) map[string]any {
	t.Helper()
	res := call(t, server, "GET", "/api/capability_flag/"+flagCode, nil, nil)
	if res.status != 200 {
		t.Fatalf("flag detail %s: status %d", flagCode, res.status)
	}
	return res.body
}

func rungsOf(detail map[string]any) []map[string]any {
	raw, _ := detail["rungs"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.(map[string]any))
	}
	return out
}

func promote(t *testing.T, server *httptest.Server, flagCode, cohortCode, reference string, headers map[string]string) response {
	t.Helper()
	body := map[string]any{"flag_code": flagCode, "cohort_code": cohortCode, "attestation_reference": reference}
	return call(t, server, "POST", "/api/promotion", body, headers)
}

func forceEnable(t *testing.T, server *httptest.Server, flagCode, cohortCode string, headers map[string]string) response {
	t.Helper()
	body := map[string]any{"flag_code": flagCode, "cohort_code": cohortCode}
	return call(t, server, "POST", "/api/promotion/force-enable", body, headers)
}

func rollback(t *testing.T, server *httptest.Server, flagCode string, headers map[string]string) response {
	t.Helper()
	return call(t, server, "POST", "/api/promotion/rollback", map[string]any{"flag_code": flagCode}, headers)
}

func recordEvent(t *testing.T, server *httptest.Server, code, device, flagCode string, occurred int64, band string) response {
	t.Helper()
	body := map[string]any{
		"event_code":          code,
		"device_code":         device,
		"flag_code":           flagCode,
		"occurred_at_minutes": occurred,
		"severity_band_code":  band,
	}
	return call(t, server, "POST", "/api/adverse_event", body, nil)
}

func journey(t *testing.T, server *httptest.Server, code string) []map[string]any {
	t.Helper()
	steps := callList(t, server, "/api/"+code+"/events")
	out := make([]map[string]any, 0, len(steps))
	for _, s := range steps {
		out = append(out, s)
	}
	return out
}

func journeyNames(steps []map[string]any) []string {
	out := make([]string, 0, len(steps))
	for _, s := range steps {
		out = append(out, s["name"].(string))
	}
	return out
}

func assertEqual(t *testing.T, what string, got, want any) {
	t.Helper()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("%s: got %v want %v", what, got, want)
	}
}

// ---- seed state ----

func TestSeedState(t *testing.T) {
	_, server := newTestApp(t)

	for entity, want := range map[string]int{
		"capability_flag": 3, "cohort": 5, "device": 6,
		"promotion": 3, "adverse_event": 2, "evidence_pack": 3,
	} {
		res := call(t, server, "GET", "/api/"+entity+"/summary", nil, nil)
		if res.status != 200 {
			t.Fatalf("summary %s: status %d", entity, res.status)
		}
		assertEqual(t, "summary "+entity, res.body["total"], float64(want))
	}

	telem := flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "telemetry highest rung", telem["highest_rung_index_count"], float64(2))
	wantStates := []string{"Active", "Active", "Not promoted", "Not promoted", "Not promoted"}
	wantAttested := []bool{true, true, false, false, false}
	for i, rung := range rungsOf(telem) {
		assertEqual(t, "telemetry rung state", rung["state"], wantStates[i])
		assertEqual(t, "telemetry rung attested", rung["attested"], wantAttested[i])
	}
	pilot := rungsOf(telem)[1]
	assertEqual(t, "telemetry pilot event count", pilot["event_count"], float64(1))
	assertEqual(t, "telemetry pilot rate", pilot["rate_bp"], float64(83))

	adaptive := flagDetail(t, server, "FLG-ADAPTIVE")
	assertEqual(t, "adaptive bench rate", rungsOf(adaptive)[0]["rate_bp"], float64(500))
}

func TestSeedExports(t *testing.T) {
	_, server := newTestApp(t)

	for _, dp := range []string{"DP-09", "DP-10", "DP-11"} {
		res := call(t, server, "POST", "/api/"+dp+"/render", map[string]any{}, nil)
		if res.status != 201 {
			t.Fatalf("%s render: status %d", dp, res.status)
		}
	}
	latest := call(t, server, "GET", "/api/DP-09/latest", nil, nil)
	if latest.status != 200 {
		t.Fatalf("DP-09 latest: %d", latest.status)
	}
	csv := latest.body["content"].(string)
	if !strings.Contains(csv, "FLG-TELEM,2,COH-2,true,111000,,ATT-TEL-2\n") {
		t.Fatalf("ladder-state.csv telemetry row wrong:\n%s", csv)
	}
	if lineCount(csv) != 16 {
		t.Fatalf("ladder-state.csv lines: %d", lineCount(csv))
	}
	rates := call(t, server, "GET", "/api/DP-11/latest", nil, nil).body["content"].(string)
	if !strings.Contains(rates, "FLG-TELEM COH-2 1 120 83 300\n") {
		t.Fatalf("adverse-rates.txt telemetry pilot line wrong:\n%s", rates)
	}
	if lineCount(rates) != 15 {
		t.Fatalf("adverse-rates.txt lines: %d", lineCount(rates))
	}
	pack := call(t, server, "GET", "/api/DP-10/latest", nil, nil).body["content"].(string)
	if !strings.Contains(pack, `"gap_rung_index_counts":[]`) {
		t.Fatalf("evidence-pack.json empty lists not empty arrays:\n%s", pack)
	}
	if !strings.HasSuffix(pack, "]\\n") && !strings.HasSuffix(pack, "]\n") {
		t.Fatalf("evidence-pack.json ending wrong: %q", pack)
	}
}

func lineCount(s string) int {
	return len(strings.Split(strings.TrimSuffix(s, "\n"), "\n"))
}

// ---- WF-01 ----

func TestWF01LadderClimbsOneRungAtATime(t *testing.T) {
	_, server := newTestApp(t)

	// 1. The jump to the regional cohort is refused and names rung 1.
	res := promote(t, server, "FLG-ALERT", "COH-3", "ATT-ALERT-A", nil)
	if res.status != 409 {
		t.Fatalf("jump: status %d body %v", res.status, res.body)
	}
	assertEqual(t, "jump rule", res.body["rule"], "DP-01")
	assertEqual(t, "jump copy", res.body["error"],
		"Refused: rung 3 needs an active promotion at rung 1 first (DP-01).")
	assertEqual(t, "missing rung", res.body["missing_rung_index_count"], float64(1))
	assertEqual(t, "journey after jump", journeyNames(journey(t, server, "WF-01")), "[WF-01-1 WF-01-2]")

	// 2. The over-long reference is a field error before any gate.
	long := strings.Repeat("x", 65)
	res = promote(t, server, "FLG-ALERT", "COH-1", long, nil)
	if res.status != 422 {
		t.Fatalf("over-long: status %d body %v", res.status, res.body)
	}
	errors := res.body["errors"].(map[string]any)
	assertEqual(t, "over-long message", errors["attestation_reference"], "must be 1 to 64 printable characters")
	// Nothing was written and no code was consumed.
	promotions := callList(t, server, "/api/promotion")
	assertEqual(t, "promotion count", len(promotions), 3)

	// 3. The padded reference is stored without the spaces.
	res = promote(t, server, "FLG-ALERT", "COH-1", "  ATT-ALERT-BENCH  ", nil)
	if res.status != 201 {
		t.Fatalf("bench promote: status %d body %v", res.status, res.body)
	}
	assertEqual(t, "bench reference", res.body["attestation_reference"], "ATT-ALERT-BENCH")
	assertEqual(t, "bench code", res.body["promotion_code"], "PRM-04")
	assertEqual(t, "journey after bench", journeyNames(journey(t, server, "WF-01")), "[WF-01-1 WF-01-2 WF-01-3]")

	// 4. The clinical pilot at once is refused by the soak gate.
	res = promote(t, server, "FLG-ALERT", "COH-2", "ATT-ALERT-C", nil)
	if res.status != 409 || res.body["rule"] != "DP-02" {
		t.Fatalf("pilot at once: status %d body %v", res.status, res.body)
	}
	assertEqual(t, "soak copy", res.body["error"],
		"Refused: rung 1 has soaked 0 minutes of 4320 minutes; 4320 minutes remain (DP-02).")
	assertEqual(t, "elapsed", res.body["elapsed_minutes"], float64(0))
	assertEqual(t, "minimum", res.body["minimum_minutes"], float64(4320))
	assertEqual(t, "remaining", res.body["remaining_minutes"], float64(4320))

	// 5. Setting the minimum soak to exactly the elapsed minutes lets it pass.
	res = call(t, server, "PATCH", "/api/cohort/COH-1", map[string]any{"min_soak_minutes": 0}, nil)
	if res.status != 200 {
		t.Fatalf("patch soak: status %d body %v", res.status, res.body)
	}
	res = promote(t, server, "FLG-ALERT", "COH-2", "ATT-ALERT-PILOT", nil)
	if res.status != 201 {
		t.Fatalf("pilot promote: status %d body %v", res.status, res.body)
	}

	// 6. The evidence pack lists no gap for the alert flag.
	packs := callList(t, server, "/api/evidence_pack")
	for _, pack := range packs {
		if pack["flag_code"] == "FLG-ALERT" {
			assertEqual(t, "alert gaps", pack["gap_rung_index_counts"], []any{})
			assertEqual(t, "alert highest", pack["highest_rung_index_count"], float64(2))
		}
	}

	detail := flagDetail(t, server, "FLG-ALERT")
	rungs := rungsOf(detail)
	assertEqual(t, "rung 1 state", rungs[0]["state"], "Active")
	assertEqual(t, "rung 2 state", rungs[1]["state"], "Soaking")
	assertEqual(t, "rung 1 attested", rungs[0]["attested"], true)
	assertEqual(t, "rung 2 attested", rungs[1]["attested"], true)
	assertEqual(t, "rung 1 reference", rungs[0]["attestation_reference"], "ATT-ALERT-BENCH")
	assertEqual(t, "rung 2 reference", rungs[1]["attestation_reference"], "ATT-ALERT-PILOT")
	assertEqual(t, "journey", journeyNames(journey(t, server, "WF-01")),
		"[WF-01-1 WF-01-2 WF-01-3 WF-01-4]")
}

// ---- WF-02 ----

func TestWF02ForceEnableLeavesGap(t *testing.T) {
	_, server := newTestApp(t)

	// 1. The jump is refused with DP-01 naming rung 2.
	res := forceEnable(t, server, "FLG-ADAPTIVE", "COH-3", nil)
	if res.status != 409 || res.body["rule"] != "DP-01" {
		t.Fatalf("force jump: status %d body %v", res.status, res.body)
	}
	assertEqual(t, "force jump copy", res.body["error"],
		"Refused: rung 3 needs an active promotion at rung 2 first (DP-01).")
	assertEqual(t, "journey after force refusal", journeyNames(journey(t, server, "WF-02")), "[WF-02-1]")

	// 2. The raised maximum lets the bench fleet's rate pass.
	res = call(t, server, "PATCH", "/api/capability_flag/FLG-ADAPTIVE",
		map[string]any{"max_adverse_rate_bp": 1000}, nil)
	if res.status != 200 {
		t.Fatalf("patch max: status %d body %v", res.status, res.body)
	}

	// 3. Two consoles force enable at the same moment.
	const workers = 8
	results := make([]response, workers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i] = forceEnable(t, server, "FLG-ADAPTIVE", "COH-2",
				map[string]string{"Idempotency-Key": fmt.Sprintf("key-%d", i)})
		}(i)
	}
	close(start)
	wg.Wait()

	created, refused := 0, 0
	for _, res := range results {
		switch res.status {
		case 201:
			created++
		case 422:
			refused++
			errors := res.body["errors"].(map[string]any)
			assertEqual(t, "already active message", errors["cohort_code"], "rung 2 is already active")
		default:
			t.Fatalf("simultaneous force enable: status %d body %v", res.status, res.body)
		}
	}
	assertEqual(t, "force enables recorded", created, 1)
	assertEqual(t, "force enables refused", refused, workers-1)

	// Exactly one new promotion at rung 2 with no reference and the next code.
	promotions := callList(t, server, "/api/promotion")
	assertEqual(t, "promotion rows", len(promotions), 4)
	var forceRow map[string]any
	for _, p := range promotions {
		if p["promotion_code"] == "PRM-04" {
			forceRow = p
		}
	}
	if forceRow == nil {
		t.Fatalf("PRM-04 missing: %v", promotions)
	}
	assertEqual(t, "force row cohort", forceRow["cohort_code"], "COH-2")
	if forceRow["attestation_reference"] != nil {
		t.Fatalf("force row reference: %v", forceRow["attestation_reference"])
	}

	// The rung reads Gap and the evidence pack lists the gap once.
	detail := flagDetail(t, server, "FLG-ADAPTIVE")
	assertEqual(t, "rung 2 state", rungsOf(detail)[1]["state"], "Gap")
	packs := callList(t, server, "/api/evidence_pack")
	for _, pack := range packs {
		if pack["flag_code"] == "FLG-ADAPTIVE" {
			gaps := pack["gap_rung_index_counts"].([]any)
			assertEqual(t, "adaptive gaps", len(gaps), 1)
			assertEqual(t, "adaptive gap rung", gaps[0], float64(2))
		}
	}
	// The reads record the journey steps of the losing console's story.
	assertEqual(t, "journey", journeyNames(journey(t, server, "WF-02")), "[WF-02-1 WF-02-2 WF-02-3]")
}

// ---- WF-03 ----

func TestWF03RollbackAndRestore(t *testing.T) {
	_, server := newTestApp(t)

	// 1. The rollback over a flaky network: the same key is sent twice.
	key := map[string]string{"Idempotency-Key": "flaky-rollback-1"}
	first := rollback(t, server, "FLG-TELEM", key)
	if first.status != 200 {
		t.Fatalf("rollback: status %d body %v", first.status, first.body)
	}
	demotedAt := first.body["demoted_at_minutes"]
	if demotedAt == nil {
		t.Fatalf("rollback: no demotion instant")
	}
	replay := rollback(t, server, "FLG-TELEM", key)
	if replay.status != 200 {
		t.Fatalf("rollback replay: status %d body %v", replay.status, replay.body)
	}
	if replay.headers.Get("Idempotent-Replayed") != "true" {
		t.Fatalf("rollback replay: no replay header")
	}
	if first.headers.Get("Idempotent-Replayed") == "true" {
		t.Fatalf("first rollback carries the replay header")
	}
	assertEqual(t, "replayed body", replay.body["promotion_code"], first.body["promotion_code"])
	assertEqual(t, "journey after rollback", journeyNames(journey(t, server, "WF-03")), "[WF-03-1]")

	// Exactly one rung was demoted: rung 1 is still active.
	detail := flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "highest after rollback", detail["highest_rung_index_count"], float64(1))

	// 2. The old reference has already been used.
	res := promote(t, server, "FLG-TELEM", "COH-2", "ATT-TEL-2", nil)
	if res.status != 422 {
		t.Fatalf("restore with old reference: status %d body %v", res.status, res.body)
	}
	errors := res.body["errors"].(map[string]any)
	assertEqual(t, "reuse message", errors["attestation_reference"], "has already been used")

	// 3. A fresh reference restores the rung as a new row.
	res = promote(t, server, "FLG-TELEM", "COH-2", "ATT-TEL-2B", nil)
	if res.status != 201 {
		t.Fatalf("restore: status %d body %v", res.status, res.body)
	}
	assertEqual(t, "restore code", res.body["promotion_code"], "PRM-04")
	assertEqual(t, "restore reference", res.body["attestation_reference"], "ATT-TEL-2B")

	// The demoted row is kept unchanged with its demotion instant.
	promotions := callList(t, server, "/api/promotion")
	for _, p := range promotions {
		if p["promotion_code"] == "PRM-02" {
			assertEqual(t, "demoted row instant", p["demoted_at_minutes"], demotedAt)
			assertEqual(t, "demoted row reference", p["attestation_reference"], "ATT-TEL-2")
		}
	}

	// 4. The regional cohort at once is refused: the soak restarted.
	res = promote(t, server, "FLG-TELEM", "COH-3", "ATT-TEL-3", nil)
	if res.status != 409 || res.body["rule"] != "DP-02" {
		t.Fatalf("regional at once: status %d body %v", res.status, res.body)
	}
	assertEqual(t, "restarted soak copy", res.body["error"],
		"Refused: rung 2 has soaked 0 minutes of 10080 minutes; 10080 minutes remain (DP-02).")

	// 5. The rung keeps its earlier events, so its rate is unchanged.
	detail = flagDetail(t, server, "FLG-TELEM")
	pilot := rungsOf(detail)[1]
	assertEqual(t, "pilot state", pilot["state"], "Soaking")
	assertEqual(t, "pilot attested", pilot["attested"], true)
	assertEqual(t, "pilot events", pilot["event_count"], float64(1))
	assertEqual(t, "pilot rate", pilot["rate_bp"], float64(83))

	// The reads record the journey steps.
	flagDetail(t, server, "FLG-TELEM")
	callList(t, server, "/api/promotion?flag_code=FLG-TELEM")
	assertEqual(t, "journey", journeyNames(journey(t, server, "WF-03")), "[WF-03-1 WF-03-2 WF-03-3]")
}

// ---- WF-04 ----

func TestWF04BreachCascade(t *testing.T) {
	_, server := newTestApp(t)

	// 1. Minimum soak 0 lets the telemetry flag climb to rungs 3 and 4.
	if res := call(t, server, "PATCH", "/api/cohort/COH-3", map[string]any{"min_soak_minutes": 0}, nil); res.status != 200 {
		t.Fatalf("patch soak 3: %d %v", res.status, res.body)
	}
	if res := call(t, server, "PATCH", "/api/cohort/COH-4", map[string]any{"min_soak_minutes": 0}, nil); res.status != 200 {
		t.Fatalf("patch soak 4: %d %v", res.status, res.body)
	}
	if res := promote(t, server, "FLG-TELEM", "COH-3", "ATT-TEL-3A", nil); res.status != 201 {
		t.Fatalf("promote rung 3: %d %v", res.status, res.body)
	}
	if res := promote(t, server, "FLG-TELEM", "COH-4", "ATT-TEL-4A", nil); res.status != 201 {
		t.Fatalf("promote rung 4: %d %v", res.status, res.body)
	}

	// 2. The lowered maximum leaves the clinical pilot below it.
	if res := call(t, server, "PATCH", "/api/capability_flag/FLG-TELEM", map[string]any{"max_adverse_rate_bp": 100}, nil); res.status != 200 {
		t.Fatalf("patch max: %d %v", res.status, res.body)
	}
	detail := flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "highest stays", detail["highest_rung_index_count"], float64(4))

	// 3. The new event breaches the clinical pilot and cascades.
	res := recordEvent(t, server, "AEV-03", "DEV-0102", "FLG-TELEM", frozenNowMinutes, "BAND-MED")
	if res.status != 201 {
		t.Fatalf("record event: %d %v", res.status, res.body)
	}
	assertEqual(t, "stored code", res.body["event_code"], "AEV-03")
	assertEqual(t, "journey after breach", journeyNames(journey(t, server, "WF-04")), "[WF-04-1]")

	detail = flagDetail(t, server, "FLG-TELEM")
	rungs := rungsOf(detail)
	assertEqual(t, "pilot events after breach", rungs[1]["event_count"], float64(2))
	assertEqual(t, "pilot rate after breach", rungs[1]["rate_bp"], float64(166))
	assertEqual(t, "rung 3 demoted", rungs[2]["state"], "Demoted")
	assertEqual(t, "rung 4 demoted", rungs[3]["state"], "Demoted")
	assertEqual(t, "rung 2 still active", rungs[1]["state"], "Active")

	// 4. The same complaint again is refused, even re-typed.
	res = recordEvent(t, server, " aev-03 ", "DEV-0102", "FLG-TELEM", frozenNowMinutes, "BAND-MED")
	if res.status != 422 {
		t.Fatalf("duplicate event: %d %v", res.status, res.body)
	}
	errors := res.body["errors"].(map[string]any)
	assertEqual(t, "duplicate message", errors["event_code"], "has already been recorded")
	detail = flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "pilot events unchanged", rungsOf(detail)[1]["event_count"], float64(2))

	// The demotion instants: rung 4 first, each with its own instant.
	promotions := callList(t, server, "/api/promotion")
	demotions := map[string]float64{}
	for _, p := range promotions {
		if p["demoted_at_minutes"] != nil {
			demotions[p["promotion_code"].(string)] = p["demoted_at_minutes"].(float64)
		}
	}
	rung3First, rung4First := demotions["PRM-04"], demotions["PRM-05"]
	if rung3First == 0 || rung4First == 0 {
		t.Fatalf("missing demotions: %v", demotions)
	}
	assertEqual(t, "rung 4 demoted first", rung4First, float64(frozenNowMinutes))
	assertEqual(t, "rung 3 one minute later", rung3First, float64(frozenNowMinutes+1))

	// The reads record the journey steps.
	flagDetail(t, server, "FLG-TELEM")
	callList(t, server, "/api/promotion?flag_code=FLG-TELEM")
	assertEqual(t, "journey", journeyNames(journey(t, server, "WF-04")), "[WF-04-1 WF-04-2 WF-04-3]")

	// 6. Raising the maximum back restores nothing.
	if res := call(t, server, "PATCH", "/api/capability_flag/FLG-TELEM", map[string]any{"max_adverse_rate_bp": 300}, nil); res.status != 200 {
		t.Fatalf("patch max back: %d %v", res.status, res.body)
	}
	detail = flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "rung 3 stays demoted", rungsOf(detail)[2]["state"], "Demoted")
	assertEqual(t, "rung 4 stays demoted", rungsOf(detail)[3]["state"], "Demoted")
	promotions = callList(t, server, "/api/promotion")
	for _, p := range promotions {
		if p["promotion_code"] == "PRM-04" {
			assertEqual(t, "instant survives the raise", p["demoted_at_minutes"], float64(frozenNowMinutes+1))
		}
	}

	// Every surface agrees on the counts.
	if res := call(t, server, "POST", "/api/DP-11/render", map[string]any{}, nil); res.status != 201 {
		t.Fatalf("render rates: %d", res.status)
	}
	rates := call(t, server, "GET", "/api/DP-11/latest", nil, nil).body["content"].(string)
	if !strings.Contains(rates, "FLG-TELEM COH-2 2 120 166 300\n") {
		t.Fatalf("adverse-rates.txt pilot line wrong:\n%s", rates)
	}
	summary := call(t, server, "GET", "/api/adverse_event/summary", nil, nil)
	assertEqual(t, "reader adverse event total", summary.body["total"], float64(3))

	// 7. Only the new promotion brings rung 3 back.
	res = promote(t, server, "FLG-TELEM", "COH-3", "ATT-TEL-3B", nil)
	if res.status != 201 {
		t.Fatalf("re-promote rung 3: %d %v", res.status, res.body)
	}
	assertEqual(t, "re-promote code", res.body["promotion_code"], "PRM-06")
	detail = flagDetail(t, server, "FLG-TELEM")
	assertEqual(t, "rung 3 active again", rungsOf(detail)[2]["state"], "Active")
	assertEqual(t, "rung 4 still demoted", rungsOf(detail)[3]["state"], "Demoted")
}
