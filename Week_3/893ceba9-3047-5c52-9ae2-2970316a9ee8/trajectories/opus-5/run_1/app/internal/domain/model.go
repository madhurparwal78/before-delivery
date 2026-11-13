package domain

import "time"

// Comment is one reviewer or owner note on a segment.
type Comment struct {
	ID     string    `json:"id"`
	Author string    `json:"author"`
	Body   string    `json:"body"`
	At     time.Time `json:"at"`
}

// Segment is one key's translation into one language on one branch.
type Segment struct {
	ID       string    `json:"id"`
	Language string    `json:"language"`
	Value    *string   `json:"value"`
	Status   string    `json:"status"`
	Score    *int      `json:"score"`
	Origin   *string   `json:"origin"`
	Issues   []Issue   `json:"issues"`
	Comments []Comment `json:"comments"`
}

// Key is one translation key in a branch's working copy.
type Key struct {
	KeyID    string              `json:"key_id"`
	Name     string              `json:"name"`
	Source   string              `json:"source"`
	Segments map[string]*Segment `json:"segments"`
}

// KeySet is a branch's live working copy, or a stored base snapshot of one.
type KeySet map[string]*Key

// Resolution is the owner's answer to one conflict.
type Resolution struct {
	Choice string    `json:"choice"`
	Value  *string   `json:"value"`
	By     string    `json:"by"`
	At     time.Time `json:"at"`
	// MainSeen is the main value the resolution saw; a later main change on
	// that field voids the resolution.
	MainSeen *string `json:"-"`
}

// Conflict is one field changed on both sides to different values.
type Conflict struct {
	ID         string      `json:"id"`
	KeyID      string      `json:"key_id"`
	Key        string      `json:"key"`
	Field      string      `json:"field"`
	Base       *string     `json:"base"`
	Main       *string     `json:"main"`
	Branch     *string     `json:"branch"`
	Resolution *Resolution `json:"resolution"`
	HeldUntil  *time.Time  `json:"held_until"`
}

// FieldEdit is one branch change the merge applies to main.
type FieldEdit struct {
	KeyID string
	Field string
}

// Preview is the merge classification of a branch against its base and main.
type Preview struct {
	NewKeys     []string
	EditedKeys  []string
	DeletedKeys []string
	Conflicts   []Conflict
	Edits       []FieldEdit
}

func segmentValue(k *Key, lang string) *string {
	if k == nil {
		return nil
	}
	if s, ok := k.Segments[lang]; ok {
		return s.Value
	}
	return nil
}

func sameValue(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func strPtr(s string) *string { return &s }
