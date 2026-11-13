package main

import (
	"testing"
)

// DP-06: the one exact-match normalisation.
func TestNormalise(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"Total:   {amount}", "total: %s", true},
		{"total: %s", " TOTAL: {{sum}} ", true},
		{"Hi %1$s, you have %2$d items", "hi %1$s, you have %2$d items", true},
		{"Remove", "remove", true},
		{"Remove", "Remove all", false},
		{"a b", "a b", true},
	}
	for _, c := range cases {
		if got := Normalise(c.a) == Normalise(c.b); got != c.want {
			t.Errorf("Normalise(%q) == Normalise(%q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}

func TestPlaceholders(t *testing.T) {
	want := []string{"{x}", "{{y}}", "%s", "%d", "%@", "%2$s", "%1$d"}
	got := Placeholders("a {x} b {{y}} c %s d %d e %@ f %2$s g %1$d")
	if len(got) != len(want) {
		t.Fatalf("Placeholders = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Placeholders[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// DP-06: placeholder mapping by position.
func TestMapPlaceholders(t *testing.T) {
	got := MapPlaceholders("Hi %1$s, you have %2$d items", "%2$d Artikel für %1$s", "Hi {name}, you have {count} items")
	if want := "{count} Artikel für {name}"; got != want {
		t.Errorf("MapPlaceholders = %q, want %q", got, want)
	}
	// tokens the TM source does not have stay as they are
	if got2 := MapPlaceholders("Hello", "Hello %s", "Hello {name}"); got2 != "Hello %s" {
		t.Errorf("extra token should stay: %q", got2)
	}
}

// DP-25: the one MQM score, with the published example.
func TestMqmScore(t *testing.T) {
	if got := MqmScore("Welcome back, {name}.", []IssueIn{{Category: "accuracy", Severity: "major"}}); got != 50 {
		t.Errorf("major on short source = %d, want 50", got)
	}
	if got := MqmScore("one two three four five six seven eight nine ten", []IssueIn{{Severity: "minor"}}); got != 90 {
		t.Errorf("one minor over ten words = %d, want 90", got)
	}
	if got := MqmScore("short", []IssueIn{{Severity: "critical"}}); got != 0 {
		t.Errorf("critical on short source = %d, want 0", got)
	}
	// rounding half up: 2.5 penalty points over ten words gives 97.5 -> 98
	if got := MqmScore("one two three four five six seven eight nine ten", []IssueIn{
		{Severity: "minor"}, {Severity: "minor"}, {Severity: "minor"},
	}); got != 70 {
		t.Errorf("three minors over ten words = %d, want 70", got)
	}
}

// DP-25: segment state machine legal moves.
func TestSegmentTransitions(t *testing.T) {
	if segmentCanApprove(StatusUntranslated) || segmentCanApprove(StatusDrafted) {
		t.Error("approving untranslated or drafted must be refused")
	}
	if !segmentCanApprove(StatusScored) || !segmentCanApprove(StatusNeedsReview) {
		t.Error("approving scored and needs review must be allowed")
	}
	if segmentCanCorrect(StatusScored) {
		t.Error("correcting a scored segment must be refused")
	}
	if !segmentCanCorrect(StatusNeedsReview) {
		t.Error("correcting needs review must be allowed")
	}
	if segmentCanScore(StatusUntranslated) || segmentCanScore(StatusApproved) {
		t.Error("scoring untranslated or approved must be refused")
	}
	if !segmentCanScore(StatusScored) || !segmentCanScore(StatusNeedsReview) {
		t.Error("a rescore of scored or needs review must be allowed")
	}
}

// DP-12: branch state machine legal edges.
func TestBranchTransitions(t *testing.T) {
	legal := [][2]string{
		{BranchOpen, BranchInReview}, {BranchInReview, BranchOpen},
		{BranchOpen, BranchAbandoned}, {BranchInReview, BranchAbandoned},
	}
	for _, c := range legal {
		if !branchTransition(c[0], c[1]) {
			t.Errorf("branch %s -> %s must be legal", c[0], c[1])
		}
	}
	illegal := [][2]string{
		{BranchOpen, BranchMerged}, {BranchMerged, BranchOpen}, {BranchMerged, BranchInReview},
		{BranchAbandoned, BranchOpen}, {BranchInReview, BranchMerged}, {BranchOpen, BranchOpen},
	}
	for _, c := range illegal {
		if branchTransition(c[0], c[1]) {
			t.Errorf("branch %s -> %s must be refused", c[0], c[1])
		}
	}
}

// DP-32/DP-36: the one bundle format.
func TestBuildBundle(t *testing.T) {
	got := string(buildBundle(map[string]string{"z.key": "ä value", "a.key": "first"}))
	want := "{\n  \"a.key\": \"first\",\n  \"z.key\": \"ä value\"\n}\n"
	if got != want {
		t.Errorf("buildBundle = %q, want %q", got, want)
	}
	if empty := string(buildBundle(nil)); empty != "{}\n" {
		t.Errorf("empty bundle = %q, want {} and a newline", empty)
	}
}

// DP-23: formula-safe CSV cells.
func TestCsvCell(t *testing.T) {
	cases := map[string]string{
		"=SUM(A1)": "'=SUM(A1)",
		"+1":       "'+1",
		"-1":       "'-1",
		"@cmd":     "'@cmd",
		"plain":    "plain",
		"a,b":      "\"a,b\"",
		"q\"uote":  "\"q\"\"uote\"",
	}
	for in, want := range cases {
		if got := csvCell(in); got != want {
			t.Errorf("csvCell(%q) = %q, want %q", in, got, want)
		}
	}
}

// DP-09: source file flattening and trimming.
func TestParseSourceJSON(t *testing.T) {
	flat, err := parseSourceJSON([]byte(`{"a":{"b":"  spaced  "},"c":"d"}`))
	if err != nil {
		t.Fatal(err)
	}
	if flat["a.b"] != "spaced" || flat["c"] != "d" {
		t.Errorf("flat = %v and %v", flat["a.b"], flat["c"])
	}
	if _, err := parseSourceJSON([]byte(`{"n":1}`)); err == nil {
		t.Error("a non-string leaf must be rejected")
	}
	if _, err := parseSourceJSON([]byte(`[1,2]`)); err == nil {
		t.Error("a non-object root must be rejected")
	}
}

// DP-05/DP-07: CSV row outcomes at their line numbers.
func TestParseTmCsv(t *testing.T) {
	p := &Project{SourceLanguage: "en", TargetLanguages: []string{"de"}}
	data := []byte("source,target,target_language\n" +
		"\"Remove\",\"Entfernen\",de\n" +
		"\"multi\nline\",\"Zwei\",de\n")
	rows, err := parseTmCsv(data, p)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if rows[0].Line != 2 {
		t.Errorf("first data row line = %d, want 2", rows[0].Line)
	}
	if rows[1].Line != 3 {
		t.Errorf("quoted multiline record starts at its own line = %d, want 3", rows[1].Line)
	}
	if rows[1].Source != "multi\nline" {
		t.Errorf("multiline field = %q, want the line break kept", rows[1].Source)
	}
	if _, err := parseTmCsv([]byte("wrong,header\n"), p); err == nil {
		t.Error("a header without the needed columns must be rejected")
	}
}

// DP-05: TMX tu/tuv/seg with the source found by primary language subtag.
func TestParseTmTmx(t *testing.T) {
	p := &Project{SourceLanguage: "en", TargetLanguages: []string{"de"}}
	data := []byte("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<tmx version=\"1.4\"><body>\n" +
		"<tu>\n<tuv xml:lang=\"en\"><seg>Hi %1$s, you have %2$d items</seg></tuv>\n" +
		"<tuv xml:lang=\"de-DE\"><seg>%2$d Artikel für %1$s</seg></tuv>\n</tu>\n</body></tmx>")
	rows, err := parseTmTmx(data, p)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0].Source != "Hi %1$s, you have %2$d items" {
		t.Errorf("source = %q", rows[0].Source)
	}
	if rows[0].Target != "%2$d Artikel für %1$s" {
		t.Errorf("target = %q", rows[0].Target)
	}
	if rows[0].Lang != "de-DE" {
		t.Errorf("lang = %q, want the code the file carries", rows[0].Lang)
	}
	if rows[0].Line != 3 {
		t.Errorf("tu opening line = %d, want 3", rows[0].Line)
	}
}

// A target code matches a project target exactly first, then by primary subtag.
func TestResolveTargetLanguage(t *testing.T) {
	p := &Project{SourceLanguage: "en", TargetLanguages: []string{"de", "pt-BR"}}
	if got := resolveTargetLanguage("de-DE", p); got != "de" {
		t.Errorf("de-DE resolves to %q, want de", got)
	}
	if got := resolveTargetLanguage("pt", p); got != "pt-BR" {
		t.Errorf("pt resolves to %q, want pt-BR", got)
	}
	if got := resolveTargetLanguage("hr", p); got != "hr" {
		t.Errorf("an unknown code stays %q", got)
	}
}
