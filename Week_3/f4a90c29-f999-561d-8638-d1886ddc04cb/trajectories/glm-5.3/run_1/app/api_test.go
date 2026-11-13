package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

// api_test.go — the server answers its published contract. These tests run
// against a live server when TEST_WREN_URL names one, and skip otherwise.

func testURL(t *testing.T) string {
	u := os.Getenv("TEST_WREN_URL")
	if u == "" {
		t.Skip("set TEST_WREN_URL to run the API tests")
	}
	return u
}

type testClient struct {
	t     *testing.T
	base  string
	token string
}

func newClient(t *testing.T) *testClient {
	return &testClient{t: t, base: testURL(t)}
}

// etagOf renders the event's version as the If-Match value.
func etagOf(v any) string {
	if f, ok := v.(float64); ok {
		return fmt.Sprintf(`"%d"`, int(f))
	}
	return fmt.Sprintf("%q", v)
}

var keyCounter int

// uniqKey gives each test run its own idempotency key.
func uniqKey() string {
	keyCounter++
	return fmt.Sprintf("test-key-%d-%d", time.Now().UnixNano(), keyCounter)
}

func (c *testClient) do(method, path, body string, headers map[string]string) (int, map[string]any, string) {
	c.t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if c.token != "" {
		req.AddCookie(&http.Cookie{Name: "wren_session", Value: c.token})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res.StatusCode, out, string(raw)
}

func (c *testClient) signIn(email string) {
	c.t.Helper()
	body := fmt.Sprintf(`{"email":%q,"passcode":"wren-seed-2027"}`, email)
	req, err := http.NewRequest("POST", c.base+"/api/session", strings.NewReader(body))
	if err != nil {
		c.t.Fatalf("sign in %s: %v", email, err)
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("sign in %s: %v", email, err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		raw, _ := io.ReadAll(res.Body)
		c.t.Fatalf("sign in %s: %d %s", email, res.StatusCode, raw)
	}
	for _, ck := range res.Cookies() {
		if ck.Name == "wren_session" {
			c.token = ck.Value
		}
	}
	if c.token == "" {
		c.t.Fatal("sign in set no cookie")
	}
}

func TestHealthAndTime(t *testing.T) {
	c := newClient(t)
	status, out, _ := c.do("GET", "/api/health", "", nil)
	if status != 200 || out["status"] != "ok" {
		t.Fatalf("health = %d %v", status, out)
	}
	status, out, _ = c.do("GET", "/api/time", "", nil)
	if status != 200 {
		t.Fatalf("time = %d", status)
	}
	if out["now_utc"] == nil {
		t.Fatal("time has no now_utc")
	}
}

func TestBadCredentials(t *testing.T) {
	c := newClient(t)
	status, out, _ := c.do("POST", "/api/session", `{"email":"nobody@sundialwren.example","passcode":"wrong"}`, nil)
	if status != 401 || out["error"] != "bad_credentials" {
		t.Fatalf("expected 401 bad_credentials, got %d %v", status, out)
	}
}

func TestUnauthenticated(t *testing.T) {
	c := newClient(t)
	status, out, _ := c.do("GET", "/api/calendars", "", nil)
	if status != 401 || out["error"] != "unauthenticated" {
		t.Fatalf("expected 401 unauthenticated, got %d %v", status, out)
	}
}

func TestCrossOrigin(t *testing.T) {
	c := newClient(t)
	status, out, _ := c.do("POST", "/api/session", `{"email":"ines@sundialwren.example","passcode":"wren-seed-2027"}`, map[string]string{"Origin": "https://evil.example"})
	if status != 403 || out["error"] != "cross_origin" {
		t.Fatalf("expected 403 cross_origin, got %d %v", status, out)
	}
}

func TestSeedPartnersWeekly(t *testing.T) {
	c := newClient(t)
	c.signIn("dara@sundialwren.example")
	status, out, _ := c.do("GET", "/api/events/evt-partners-weekly?occurrence_id=evt-partners-weekly@20270309T0900", "", nil)
	if status != 200 {
		t.Fatalf("get event: %d", status)
	}
	rsvp, _ := out["rsvp"].(map[string]any)
	if rsvp == nil || rsvp["yes"] != float64(1) || rsvp["maybe"] != float64(1) || rsvp["invited"] != float64(1) {
		t.Fatalf("rsvp = %v", rsvp)
	}
	// the spec's clocks for 9 Mar 2027: NY 09:00, London 14:00, Auckland 03:00
	clocks := out["clocks"].([]any)
	want := []string{"09:00", "14:00", "03:00"}
	for i, w := range want {
		entry := clocks[i].(map[string]any)
		if entry["time"] != w {
			t.Errorf("clock[%d] = %v want %s", i, entry["time"], w)
		}
	}
}

func TestFieldProjectionByAccess(t *testing.T) {
	// Joss at free_busy on cal-dara sees the private pay talk as Busy
	c := newClient(t)
	c.signIn("joss@sundialwren.example")
	status, out, _ := c.do("GET", "/api/events/evt-pay-talk", "", nil)
	if status != 200 {
		t.Fatalf("pay talk: %d", status)
	}
	if out["title"] != "Busy" {
		t.Fatalf("title = %v want Busy", out["title"])
	}
	for _, forbidden := range []string{"notes", "location", "guests", "rsvp", "visibility"} {
		if _, present := out[forbidden]; present {
			t.Errorf("busy access leaked %s", forbidden)
		}
	}
	// a guest of Northgate board review (switches all off) gets no guest list
	c2 := newClient(t)
	c2.signIn("sam@sundialwren.example")
	status, out, _ = c2.do("GET", "/api/events/evt-board-review", "", nil)
	if status != 200 {
		t.Fatalf("board review: %d", status)
	}
	if _, present := out["guests"]; present {
		t.Error("guest list leaked with See guest list off")
	}
	if _, present := out["rsvp"]; present {
		t.Error("rsvp leaked with See guest list off")
	}
	// a guest of Harbour kickoff sees the list: its switch is on
	status, out, _ = c2.do("GET", "/api/events/evt-harbour-kickoff", "", nil)
	if status != 200 {
		t.Fatalf("harbour: %d", status)
	}
	if _, present := out["guests"]; !present {
		t.Error("Harbour kickoff should show the guest list")
	}
}

func TestVersionConflict(t *testing.T) {
	c := newClient(t)
	c.signIn("dara@sundialwren.example")
	// missing If-Match
	status, out, _ := c.do("PATCH", "/api/events/evt-client-readout", `{"title":"New title"}`, nil)
	if status != 428 || out["error"] != "version_required" {
		t.Fatalf("expected 428, got %d %v", status, out)
	}
	// wrong version
	status, out, _ = c.do("PATCH", "/api/events/evt-client-readout", `{"title":"New title"}`, map[string]string{"If-Match": `"999"`})
	if status != 412 || out["error"] != "version_conflict" {
		t.Fatalf("expected 412, got %d %v", status, out)
	}
	if out["current"] == nil {
		t.Error("conflict response has no current values")
	}
}

func TestRruleValidation(t *testing.T) {
	c := newClient(t)
	c.signIn("dara@sundialwren.example")
	badRules := []string{
		"freq=daily", "FREQ=HOURLY", "FREQ=WEEKLY;BYDAY=mo", "FREQ=WEEKLY;BYDAY=MO,MO",
		"FREQ=WEEKLY;INTERVAL=0", "FREQ=WEEKLY;COUNT=0", "FREQ=WEEKLY;COUNT=1000",
		"FREQ=MONTHLY;BYDAY=5TU", "FREQ=MONTHLY;BYMONTHDAY=1", "INTERVAL=2",
		"FREQ=YEARLY;COUNT=2;UNTIL=20301231", "FREQ=MONTHLY;UNTIL=20271231T000000Z",
	}
	for _, rule := range badRules {
		body := fmt.Sprintf(`{"calendar_id":"cal-dara","title":"T","start_local":"2027-03-02 09:00","end_local":"2027-03-02 10:00","zone":"America/New_York","rrule":%q}`, rule)
		status, out, _ := c.do("POST", "/api/events", body, nil)
		if status != 422 {
			t.Errorf("rule %q accepted: %d", rule, status)
		}
		fields, _ := out["fields"].(map[string]any)
		if fields == nil || fields["rrule"] == nil {
			t.Errorf("rule %q: no field error", rule)
		}
	}
}

func TestZoneRuleRecordAndWarning(t *testing.T) {
	c := newClient(t)
	c.signIn("marit@sundialwren.example")
	// only the office manager records rules
	ruleDate := fmt.Sprintf("2026-06-%02d", 1+time.Now().Nanosecond()%20)
	body := fmt.Sprintf(`{"zone":"Pacific/Auckland","effective_date":%q,"new_offset":"+13:00","note":"Permanent summer time trial"}`, ruleDate)
	status, out, _ := c.do("POST", "/api/zone-rules", body, nil)
	if status != 201 {
		t.Fatalf("record rule: %d %v", status, out)
	}
	ruleID, _ := out["id"].(string)
	if ruleID == "" {
		t.Fatal("rule has no id")
	}
	// duplicate rule
	status, _, _ = c.do("POST", "/api/zone-rules", body, nil)
	if status != 409 {
		t.Fatalf("duplicate rule: %d", status)
	}
	// Wellington workshop saved 2026-08-01, after the effective date: warned
	c2 := newClient(t)
	c2.signIn("oren@sundialwren.example")
	status, out, _ = c2.do("GET", "/api/events/evt-wellington-workshop", "", nil)
	if status != 200 {
		t.Fatalf("wellington: %d", status)
	}
	warnings := out["zone_warnings"].([]any)
	if len(warnings) != 1 {
		t.Fatalf("expected 1 warning, got %v", warnings)
	}
	w := warnings[0].(map[string]any)
	if w["shift_minutes"] != float64(60) || w["saved_time"] != "10:00" || w["shown_time"] != "11:00" {
		t.Errorf("warning = %v", w)
	}
	// Queen Street review was saved 2026-03-01, before the effective date: no
	// warning. Marit has edit on cal-lia, where it lives.
	status, out, _ = c.do("GET", "/api/events/evt-queen-street", "", nil)
	if status != 200 {
		t.Fatalf("queen street: %d", status)
	}
	if warnings := out["zone_warnings"].([]any); len(warnings) != 0 {
		t.Errorf("Queen Street warned: %v", warnings)
	}
	// Hana's Focus time warns only the NZ-standard weeks: 29 Mar keeps +13
	// (no warning), while 5, 12 and 19 Apr shift by 60 minutes
	cHana := newClient(t)
	cHana.signIn("hana@sundialwren.example")
	status, out, _ = cHana.do("GET", "/api/occurrences?from=2027-03-25&to=2027-04-21", "", nil)
	if status != 200 {
		t.Fatalf("occurrences: %d", status)
	}
	occs := out["occurrences"].([]any)
	warned, plain := 0, 0
	for _, o := range occs {
		m := o.(map[string]any)
		if m["title"] != "Focus time" {
			continue
		}
		if ws, _ := m["zone_warnings"].([]any); len(ws) > 0 {
			warned++
		} else {
			plain++
		}
	}
	if warned != 3 || plain != 1 {
		t.Fatalf("focus warnings: warned=%d plain=%d", warned, plain)
	}
	// a guest cannot Move
	c3 := newClient(t)
	c3.signIn("ines@sundialwren.example")
	status, _, _ = c3.do("POST", "/api/events/evt-wellington-workshop/zone-moves", fmt.Sprintf(`{"rule_id":%q}`, ruleID), map[string]string{"If-Match": `"1"`})
	if status != 403 {
		t.Fatalf("guest zone move: %d", status)
	}
}

func TestSearchAndFindATime(t *testing.T) {
	c := newClient(t)
	c.signIn("ines@sundialwren.example")
	status, out, _ := c.do("GET", "/api/search?q=t", "", nil)
	if status != 422 {
		t.Fatalf("short search: %d", status)
	}
	status, out, _ = c.do("GET", "/api/search?q=Tane", "", nil)
	if status != 200 {
		t.Fatalf("search: %d", status)
	}
	results := out["results"].([]any)
	if len(results) == 0 {
		t.Fatal("search found nothing for Tane")
	}
	// find a time: an Auckland viewer checking Tane Whitcombe over 15 to 19
	// March 2027 sees one block from Mon 15 Mar 00:00 to Fri 19 Mar 24:00
	c3 := newClient(t)
	c3.signIn("hana@sundialwren.example")
	status, out, _ = c3.do("GET", "/api/find-a-time?people=p-tane&minutes=30&from=2027-03-15&to=2027-03-19", "", nil)
	if status != 200 {
		t.Fatalf("find a time: %d %v", status, out)
	}
	busy := out["busy"].([]any)
	if len(busy) != 2 {
		t.Fatalf("busy entries = %d", len(busy))
	}
	tane := busy[1].(map[string]any)
	blocks := tane["blocks"].([]any)
	if len(blocks) != 1 {
		t.Fatalf("Tane busy blocks = %d", len(blocks))
	}
	b := blocks[0].(map[string]any)
	if b["start_utc"] != "2027-03-14T11:00:00Z" {
		t.Errorf("block start = %v", b["start_utc"])
	}
	if b["end_utc"] != "2027-03-19T11:00:00Z" {
		t.Errorf("block end = %v", b["end_utc"])
	}
}

func TestFindATimeSlots(t *testing.T) {
	// a free week offers the earliest common slot inside working hours
	c := newClient(t)
	c.signIn("ines@sundialwren.example")
	status, out, _ := c.do("GET", "/api/find-a-time?people=p-edith&minutes=30&from=2027-05-03&to=2027-05-07", "", nil)
	if status != 200 {
		t.Fatalf("find a time: %d %v", status, out)
	}
	slots := out["slots"].([]any)
	if len(slots) == 0 {
		t.Fatal("no slots in a free week")
	}
	first := slots[0].(map[string]any)
	// 09:00 London on Monday 3 May 2027
	if !strings.HasPrefix(first["start_utc"].(string), "2027-05-03T08:00") {
		t.Errorf("first slot = %v", first["start_utc"])
	}
	clockList := first["clocks"].([]any)
	if len(clockList) != 3 {
		t.Fatalf("slot clocks = %d", len(clockList))
	}
}

func TestTrashRestorePurge(t *testing.T) {
	c := newClient(t)
	c.signIn("tane@sundialwren.example")
	// trash a single event with its guests, using its current version
	status, out, _ := c.do("GET", "/api/events/evt-harbour-kickoff", "", nil)
	if status != 200 {
		t.Fatalf("load harbour: %d", status)
	}
	version := out["version"]
	status, out, _ = c.do("DELETE", "/api/events/evt-harbour-kickoff?scope=all", "", map[string]string{"If-Match": etagOf(version)})
	if status != 200 {
		t.Fatalf("delete harbour: %d %v", status, out)
	}
	trashID, _ := out["trash_id"].(string)
	if trashID == "" {
		t.Fatal("no trash_id")
	}
	// the shared link answers dead while trashed
	status, out, _ = c.do("GET", "/api/share/seed-harbour-link", "", nil)
	if status != 404 || out["message"] != "This link no longer works." {
		t.Fatalf("trashed link: %d %v", status, out)
	}
	// the organiser no longer sees it
	status, out, _ = c.do("GET", "/api/occurrences?from=2027-03-08&to=2027-03-18", "", nil)
	for _, o := range out["occurrences"].([]any) {
		if o.(map[string]any)["title"] == "Harbour kickoff" {
			t.Fatal("trashed event still on the grid")
		}
	}
	// restore it exactly
	status, out, _ = c.do("POST", "/api/trash/"+trashID+"/restore", "", nil)
	if status != 200 {
		t.Fatalf("restore: %d %v", status, out)
	}
	status, out, _ = c.do("GET", "/api/events/evt-harbour-kickoff", "", nil)
	if status != 200 {
		t.Fatalf("harbour after restore: %d", status)
	}
	if _, present := out["guests"]; !present {
		t.Error("restored event lost its guests")
	}
	// restoring again is refused
	status, _, _ = c.do("POST", "/api/trash/"+trashID+"/restore", "", nil)
	if status != 404 {
		t.Fatalf("restore twice: %d", status)
	}
}

func TestReplyRules(t *testing.T) {
	c := newClient(t)
	c.signIn("ines@sundialwren.example")
	// Ines is a guest: answering works
	status, out, _ := c.do("PUT", "/api/events/evt-partners-weekly/replies/me", `{"scope":"occurrence","occurrence_id":"evt-partners-weekly@20270323T0900","answer":"no"}`, nil)
	if status != 200 {
		t.Fatalf("reply: %d %v", status, out)
	}
	// a guest may not return to invited
	status, out, _ = c.do("PUT", "/api/events/evt-partners-weekly/replies/me", `{"scope":"occurrence","occurrence_id":"evt-partners-weekly@20270323T0900","answer":"invited"}`, nil)
	if status != 422 {
		t.Fatalf("answer invited: %d", status)
	}
	// the organiser is not a guest row
	c2 := newClient(t)
	c2.signIn("dara@sundialwren.example")
	status, out, _ = c2.do("PUT", "/api/events/evt-partners-weekly/replies/me", `{"scope":"series","answer":"yes"}`, nil)
	if status != 403 || out["error"] != "not_a_guest" {
		t.Fatalf("organiser reply: %d %v", status, out)
	}
}

func TestProposalFlow(t *testing.T) {
	c := newClient(t)
	c.signIn("tane@sundialwren.example")
	occ := "evt-partners-weekly@20270330T0900"
	body := fmt.Sprintf(`{"occurrence_id":%q,"start_local":"2027-03-30T11:00","end_local":"2027-03-30T12:00","note":"Later please"}`, occ)
	status, out, _ := c.do("POST", "/api/events/evt-partners-weekly/proposals", body, nil)
	if status != 201 {
		t.Fatalf("propose: %d %v", status, out)
	}
	proposalID, _ := out["id"].(string)
	// a second open proposal is refused
	status, out, _ = c.do("POST", "/api/events/evt-partners-weekly/proposals", body, nil)
	if status != 409 || out["error"] != "proposal_open" {
		t.Fatalf("second proposal: %d %v", status, out)
	}
	// the organiser accepts; the occurrence moves
	c2 := newClient(t)
	c2.signIn("dara@sundialwren.example")
	status, out, _ = c2.do("POST", "/api/proposals/"+proposalID+"/accept", "", nil)
	if status != 200 {
		t.Fatalf("accept: %d %v", status, out)
	}
	event := out["event"].(map[string]any)
	found := false
	for _, ex := range event["exceptions"].([]any) {
		m := ex.(map[string]any)
		if m["occurrence_id"] == occ && m["start_local"] == "2027-03-30T11:00" {
			found = true
		}
	}
	if !found {
		t.Errorf("accepted proposal did not move the occurrence: %v", event["exceptions"])
	}
	// deciding twice is refused
	status, _, _ = c2.do("POST", "/api/proposals/"+proposalID+"/decline", "", nil)
	if status != 409 {
		t.Fatalf("decide twice: %d", status)
	}
}

func TestSharingRules(t *testing.T) {
	// Priya has manage on cal-dara; Marit has details
	c := newClient(t)
	c.signIn("priya@sundialwren.example")
	status, out, _ := c.do("PUT", "/api/calendars/cal-dara/shares/p-joss", `{"level":"details"}`, nil)
	if status != 200 {
		t.Fatalf("manage sets share: %d %v", status, out)
	}
	// Joss cannot read the share list
	c2 := newClient(t)
	c2.signIn("joss@sundialwren.example")
	status, _, _ = c2.do("GET", "/api/shares?calendar_id=cal-dara", "", nil)
	if status != 403 {
		t.Fatalf("non-manager reads shares: %d", status)
	}
	// a plain member cannot change shares
	c3 := newClient(t)
	c3.signIn("callum@sundialwren.example")
	status, _, _ = c3.do("PUT", "/api/calendars/cal-dara/shares/p-callum", `{"level":"manage"}`, nil)
	if status != 403 {
		t.Fatalf("member changes shares: %d", status)
	}
	// Public holidays has no shares
	status, _, _ = c3.do("PUT", "/api/calendars/cal-holidays/shares/p-callum", `{"level":"details"}`, nil)
	if status != 403 {
		t.Fatalf("holidays shares: %d", status)
	}
	// restore Joss's original level
	c.do("PUT", "/api/calendars/cal-dara/shares/p-joss", `{"level":"free_busy"}`, nil)
}

func TestPrintsFlow(t *testing.T) {
	c := newClient(t)
	c.signIn("marit@sundialwren.example")
	// a non-Monday is refused
	status, out, _ := c.do("POST", "/api/prints", `{"week_start":"2027-03-12"}`, map[string]string{"Idempotency-Key": uniqKey()})
	if status != 422 {
		t.Fatalf("non-Monday print: %d %v", status, out)
	}
	// create once with a stable key, then replay and conflict with it
	key := uniqKey()
	status, out, _ = c.do("POST", "/api/prints", `{"week_start":"2027-03-08"}`, map[string]string{"Idempotency-Key": key})
	if status != 202 {
		t.Fatalf("print: %d %v", status, out)
	}
	printID, _ := out["id"].(string)
	// the same key with the same body replays the job
	status, out, _ = c.do("POST", "/api/prints", `{"week_start":"2027-03-08"}`, map[string]string{"Idempotency-Key": key})
	if status != 202 || out["id"] != printID {
		t.Fatalf("idempotent replay: %d %v", status, out)
	}
	// the same key with a different body conflicts
	status, _, _ = c.do("POST", "/api/prints", `{"week_start":"2027-03-15"}`, map[string]string{"Idempotency-Key": key})
	if status != 409 {
		t.Fatalf("idempotency conflict: %d", status)
	}
	// wait for the job to store, then download
	stored := false
	for i := 0; i < 40; i++ {
		status, out, _ = c.do("GET", "/api/prints/"+printID, "", nil)
		if out["status"] == "stored" {
			stored = true
			break
		}
		time.Sleep(250 * time.Millisecond)
	}
	if !stored {
		t.Fatalf("print never stored: %v", out)
	}
	// the PDF download answers
	status, _, body := c.do("GET", "/api/prints/"+printID+"/pdf", "", nil)
	if status != 200 || !strings.HasPrefix(body, "%PDF") {
		t.Fatalf("pdf download: %d %q", status, body[:8])
	}
	// a member cannot print
	c2 := newClient(t)
	c2.signIn("ines@sundialwren.example")
	status, _, _ = c2.do("POST", "/api/prints", `{"week_start":"2027-03-08"}`, map[string]string{"Idempotency-Key": uniqKey()})
	if status != 403 {
		t.Fatalf("member prints: %d", status)
	}
}

func TestICalendarRoundTrip(t *testing.T) {
	c := newClient(t)
	c.signIn("dara@sundialwren.example")
	status, out, _ := c.do("POST", "/api/calendars/cal-dara/exports", "", nil)
	if status != 201 {
		t.Fatalf("export: %d %v", status, out)
	}
	exportID, _ := out["id"].(string)
	status, _, ics := c.do("GET", "/api/exports/"+exportID+"/file", "", nil)
	if status != 200 {
		t.Fatalf("export file: %d", status)
	}
	if !strings.Contains(ics, "BEGIN:VCALENDAR") || !strings.Contains(ics, "UID:evt-partners-weekly") {
		t.Fatalf("bad export: %q", ics[:200])
	}
	if !strings.Contains(ics, "EXDATE") {
		t.Error("export is missing the deleted occurrence's EXDATE")
	}
	if !strings.Contains(ics, "RECURRENCE-ID") {
		t.Error("export is missing the modified occurrence")
	}
	if strings.Contains(ics, "ATTENDEE") {
		t.Error("export carries attendees")
	}
	if strings.Contains(ics, "SUMMARY:Busy") == false {
		// the private pay talk exports as Busy
		if !strings.Contains(ics, "CLASS:PRIVATE") {
			t.Error("private event lost its class")
		}
	}
	// import into Dara's own calendar reproduces the occurrences
	status, out, _ = c.do("POST", "/api/calendars/cal-dara/imports", ics, map[string]string{"Content-Type": "text/calendar"})
	if status != 201 {
		t.Fatalf("import: %d %v", status, out)
	}
	// the imported series matches the original: same UID, no doubling
	status, out, _ = c.do("GET", "/api/events/evt-partners-weekly?occurrence_id=evt-partners-weekly@20270323T0900", "", nil)
	if status != 200 {
		t.Fatalf("reimported event: %d", status)
	}
	if out["start_local"] != "2027-03-23T10:00" {
		t.Errorf("imported exception start = %v", out["start_local"])
	}
}

func TestScopeSplitAndExceptions(t *testing.T) {
	c := newClient(t)
	c.signIn("dara@sundialwren.example")
	// move one occurrence, then change this and following from a later date
	occ := "evt-partners-weekly@20270406T0900"
	// first a this-scope move of 6 Apr
	status, out, _ := c.do("GET", "/api/events/evt-partners-weekly", "", nil)
	version := out["version"]
	body := fmt.Sprintf(`{"start_local":"2027-04-06T10:30","end_local":"2027-04-06T11:30","scope":"this","occurrence_id":%q}`, occ)
	status, out, _ = c.do("PATCH", "/api/events/evt-partners-weekly", body, map[string]string{"If-Match": etagOf(version)})
	if status != 200 {
		t.Fatalf("this-scope move: %d %v", status, out)
	}
	// the exception stays on its date with its own time
	status, out, _ = c.do("GET", "/api/events/evt-partners-weekly?occurrence_id="+occ, "", nil)
	if status != 200 || out["start_local"] != "2027-04-06T10:30" {
		t.Fatalf("exception did not keep its values: %d %v", status, out)
	}
	// all-scope edit leaves the exception's overridden title in place
	version = out["version"]
	status, out, _ = c.do("PATCH", "/api/events/evt-partners-weekly", `{"title":"Partners weekly","scope":"all"}`, map[string]string{"If-Match": etagOf(version)})
	if status != 200 {
		t.Fatalf("all-scope edit: %d", status)
	}
}

func TestBusyAccessHidesEverything(t *testing.T) {
	// Callum has no share on cal-tane: Tane's events are not readable at all
	c := newClient(t)
	c.signIn("callum@sundialwren.example")
	status, out, _ := c.do("GET", "/api/events/evt-harbour-kickoff", "", nil)
	if status != 404 {
		t.Fatalf("unreadable event: %d %v", status, out)
	}
	// search never matches unreadable events
	status, out, _ = c.do("GET", "/api/search?q=Harbour", "", nil)
	if status != 200 {
		t.Fatalf("search: %d", status)
	}
	for _, r := range out["results"].([]any) {
		if strings.Contains(fmt.Sprint(r), "Harbour") {
			t.Error("search leaked an unreadable event")
		}
	}
}

func TestDraftLifecycle(t *testing.T) {
	c := newClient(t)
	c.signIn("edith@sundialwren.example")
	draft := `{"title":"Half written","calendar_id":"cal-edith","start_local":"2027-03-02 09:00","end_local":"2027-03-02 10:00"}`
	status, out, _ := c.do("PUT", "/api/draft", draft, nil)
	if status != 200 {
		t.Fatalf("put draft: %d", status)
	}
	status, out, _ = c.do("GET", "/api/draft", "", nil)
	if status != 200 || out["draft"] == nil {
		t.Fatalf("get draft: %d %v", status, out)
	}
	status, _, _ = c.do("DELETE", "/api/draft", "", nil)
	if status != 204 {
		t.Fatalf("delete draft: %d", status)
	}
	status, out, _ = c.do("GET", "/api/draft", "", nil)
	if out["draft"] != nil {
		t.Error("draft survived its delete")
	}
}

func TestGuestDefaultsAndOfficeHours(t *testing.T) {
	// the office manager reads the firm's settings
	c := newClient(t)
	c.signIn("marit@sundialwren.example")
	status, out, _ := c.do("GET", "/api/settings", "", nil)
	if status != 200 {
		t.Fatalf("office manager reads settings: %d", status)
	}
	if out["guest_defaults"] == nil || out["office_hours"] == nil {
		t.Fatalf("settings shape: %v", out)
	}
	// a guest cannot read them or list people
	c2 := newClient(t)
	c2.signIn("sam@sundialwren.example")
	status, _, _ = c2.do("GET", "/api/settings", "", nil)
	if status != 403 {
		t.Fatalf("guest reads settings: %d", status)
	}
	status, _, _ = c2.do("GET", "/api/people", "", nil)
	if status != 403 {
		t.Fatalf("guest lists people: %d", status)
	}
}

func TestSharedLinkLifecycle(t *testing.T) {
	c := newClient(t)
	c.signIn("ines@sundialwren.example")
	// turn See guest list on first: a link cannot be created while it is off
	status, out, _ := c.do("GET", "/api/events/evt-board-review", "", nil)
	if status != 200 {
		t.Fatalf("board review: %d", status)
	}
	version := out["version"]
	status, out, _ = c.do("PATCH", "/api/events/evt-board-review", `{"switches":{"modify_event":false,"invite_others":false,"see_guest_list":true},"scope":"all"}`, map[string]string{"If-Match": etagOf(version)})
	if status != 200 {
		t.Fatalf("show guest list: %d %v", status, out)
	}
	status, out, _ = c.do("POST", "/api/events/evt-board-review/share-link", "", nil)
	if status != 201 {
		t.Fatalf("share link: %d %v", status, out)
	}
	token, _ := out["token"].(string)
	// turning See guest list off kills the link
	status, out, _ = c.do("GET", "/api/events/evt-board-review", "", nil)
	version = out["version"]
	body := fmt.Sprintf(`{"switches":{"modify_event":false,"invite_others":false,"see_guest_list":false},"scope":"all"}`)
	status, out, _ = c.do("PATCH", "/api/events/evt-board-review", body, map[string]string{"If-Match": etagOf(version)})
	if status != 200 {
		t.Fatalf("hide guest list: %d %v", status, out)
	}
	status, out, _ = c.do("GET", "/api/share/"+token, "", nil)
	if status != 404 {
		t.Fatalf("dead link: %d", status)
	}
	// turning it on again does not revive the link
	status, out, _ = c.do("GET", "/api/events/evt-board-review", "", nil)
	version = out["version"]
	body = fmt.Sprintf(`{"switches":{"modify_event":false,"invite_others":false,"see_guest_list":true},"scope":"all"}`)
	status, out, _ = c.do("PATCH", "/api/events/evt-board-review", body, map[string]string{"If-Match": etagOf(version)})
	if status != 200 {
		t.Fatalf("show guest list: %d", status)
	}
	status, _, _ = c.do("GET", "/api/share/"+token, "", nil)
	if status != 404 {
		t.Error("a dead link came back to life")
	}
	// an unknown token answers the same
	status, out, _ = c.do("GET", "/api/share/not-a-real-token", "", nil)
	if status != 404 || out["message"] != "This link no longer works." {
		t.Fatalf("unknown token: %d %v", status, out)
	}
	// put the seeded switch back the way the seed left it
	status, out, _ = c.do("GET", "/api/events/evt-board-review", "", nil)
	version = out["version"]
	c.do("PATCH", "/api/events/evt-board-review", `{"switches":{"modify_event":false,"invite_others":false,"see_guest_list":false},"scope":"all"}`, map[string]string{"If-Match": etagOf(version)})
}
