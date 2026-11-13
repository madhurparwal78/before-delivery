package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type Issue struct {
	Category string `json:"category"`
	Severity string `json:"severity"`
	Note     string `json:"note"`
}

type Comment struct {
	ID     string `json:"id"`
	Author string `json:"author"`
	Body   string `json:"body"`
	At     string `json:"at"`
}

type HistoryEntry struct {
	At    string  `json:"at"`
	Actor string  `json:"actor"`
	From  *string `json:"from"`
	To    string  `json:"to"`
	Value *string `json:"value"`
	Note  string  `json:"note,omitempty"`
}

// Segment is one key's translation in one language on one branch, with the context it is shown in.
type Segment struct {
	ID          string
	ProjectID   string
	BranchID    string
	KeyID       string
	Language    string
	Value       *string
	Status      string
	Score       *int
	Origin      *string
	Issues      []Issue
	Comments    []Comment
	History     []HistoryEntry
	KeyName     string
	Source      string
	Removed     bool
	BranchName  string
	BranchState string
	BranchMain  bool
	ProjectSlug string
	Threshold   int
}

const segmentColumns = `s.id, s.project_id, s.branch_id, s.key_id, s.language, s.value, s.status, s.score, s.origin,
	s.issues, s.comments, s.history, k.name, k.source, k.deleted, b.name, b.state, b.is_main, p.slug, p.mqm_threshold`

const segmentSelect = `SELECT ` + segmentColumns + `
	FROM segments s
	JOIN branch_keys k ON k.branch_id = s.branch_id AND k.key_id = s.key_id
	JOIN branches b ON b.id = s.branch_id
	JOIN projects p ON p.id = s.project_id `

func scanSegment(row pgx.Row) (*Segment, error) {
	var s Segment
	err := row.Scan(&s.ID, &s.ProjectID, &s.BranchID, &s.KeyID, &s.Language, &s.Value, &s.Status, &s.Score, &s.Origin,
		&s.Issues, &s.Comments, &s.History, &s.KeyName, &s.Source, &s.Removed, &s.BranchName, &s.BranchState,
		&s.BranchMain, &s.ProjectSlug, &s.Threshold)
	if err != nil {
		return nil, err
	}
	s.ensureLists()
	return &s, nil
}

func (s *Segment) ensureLists() {
	if s.Issues == nil {
		s.Issues = []Issue{}
	}
	if s.Comments == nil {
		s.Comments = []Comment{}
	}
	if s.History == nil {
		s.History = []HistoryEntry{}
	}
}

func segmentByID(ctx context.Context, q db, id string) (*Segment, error) {
	s, err := scanSegment(q.QueryRow(ctx, segmentSelect+"WHERE s.id = $1", id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, errNotFound()
	}
	if err != nil {
		return nil, fmt.Errorf("load segment: %w", err)
	}
	return s, nil
}

// branchSegments loads every segment of a branch's live keys, keyed by key id then language.
func branchSegments(ctx context.Context, q db, branchID string, lang string) (map[string]map[string]*Segment, error) {
	sql := segmentSelect + "WHERE s.branch_id = $1 AND NOT k.deleted"
	args := []any{branchID}
	if lang != "" {
		sql += " AND s.language = $2"
		args = append(args, lang)
	}
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, fmt.Errorf("list segments: %w", err)
	}
	defer rows.Close()
	out := map[string]map[string]*Segment{}
	for rows.Next() {
		s, err := scanSegment(rows)
		if err != nil {
			return nil, fmt.Errorf("scan segment: %w", err)
		}
		if out[s.KeyID] == nil {
			out[s.KeyID] = map[string]*Segment{}
		}
		out[s.KeyID][s.Language] = s
	}
	return out, rows.Err()
}

func (s *Segment) save(ctx context.Context, q db) error {
	s.ensureLists()
	_, err := q.Exec(ctx, `UPDATE segments SET value = $2, status = $3, score = $4, origin = $5,
		issues = $6, comments = $7, history = $8 WHERE id = $1`,
		s.ID, s.Value, s.Status, s.Score, s.Origin, s.Issues, s.Comments, s.History)
	if err != nil {
		return fmt.Errorf("save segment: %w", err)
	}
	return nil
}

func (s *Segment) record(actor, to string, at time.Time, note string) {
	from := s.Status
	s.History = append(s.History, HistoryEntry{At: fmtTime(at), Actor: actor, From: &from, To: to, Value: s.Value, Note: note})
	s.Status = to
}

// setValue is a manual or TM value: the segment becomes drafted and loses its score and issues.
func (s *Segment) setValue(value, origin, actor string, at time.Time) {
	s.Value, s.Origin, s.Score, s.Issues = &value, &origin, nil, []Issue{}
	s.record(actor, statusDrafted, at, "")
}

// rescore recomputes the score from the issues against the project's threshold.
func (s *Segment) rescore(issues []Issue, actor string, at time.Time) {
	score := mqmScore(s.Source, issues)
	s.Issues, s.Score = issues, &score
	s.record(actor, statusForScore(score, s.Threshold), at, "")
}

func (s *Segment) approve(actor string, at time.Time) {
	s.record(actor, statusApproved, at, "")
}

func (s *Segment) correct(value, comment, actor string, at time.Time) {
	origin := "review"
	s.Value, s.Origin = &value, &origin
	if comment != "" {
		s.Comments = append(s.Comments, Comment{ID: newID(), Author: actor, Body: comment, At: fmtTime(at)})
	}
	s.record(actor, statusApproved, at, "")
}

// sourceChanged sends a translated segment to review, keeping its value, score and issues.
func (s *Segment) sourceChanged(actor string, at time.Time) {
	if s.Value == nil || allowMove("source_change", s.Status) != nil {
		return
	}
	s.record(actor, statusNeedsReview, at, "source changed")
}

// draftFromAI records the engine's draft and then its score.
func (s *Segment) draftFromAI(draft, engine string, issues []Issue, actor string, at time.Time) {
	s.setValue(draft, "ai:"+engine, actor, at)
	s.rescore(issues, actor, at)
}

func (s *Segment) json() map[string]any {
	var source any = s.Source
	if s.Removed {
		source = nil
	}
	return map[string]any{
		"id": s.ID, "project": s.ProjectSlug, "branch": s.BranchName, "key_id": s.KeyID, "key": s.KeyName,
		"source": source, "language": s.Language, "value": s.Value, "status": s.Status, "score": s.Score,
		"origin": s.Origin, "issues": s.Issues, "comments": s.Comments, "history": s.History, "removed": s.Removed,
	}
}

func (s *Segment) summary() map[string]any {
	return map[string]any{"segment_id": s.ID, "value": s.Value, "status": s.Status, "score": s.Score}
}

func validIssue(i Issue) *apiError {
	if !issueCategories[i.Category] {
		return errField("category", "Choose accuracy, fluency, terminology, style or locale-convention.")
	}
	if _, ok := severityPenalty[i.Severity]; !ok {
		return errField("severity", "Choose minor, major or critical.")
	}
	if utf8.RuneCountInString(i.Note) > 500 {
		return errField("note", "Use 500 characters or fewer.")
	}
	return nil
}

func validValue(field, value string) *apiError {
	if n := utf8.RuneCountInString(value); n < 1 || n > 4000 {
		return errField(field, "Use 1 to 4,000 characters.")
	}
	return nil
}

func validSource(source string) *apiError {
	if n := utf8.RuneCountInString(source); n < 1 || n > 2000 || strings.TrimSpace(source) == "" {
		return errField("source", "Use 1 to 2,000 characters that aren't only whitespace.")
	}
	return nil
}

// newSegments inserts one untranslated segment per target language for a key on a branch.
func newSegments(ctx context.Context, q db, p *Project, branchID, keyID string) error {
	for _, lang := range p.TargetLanguages {
		_, err := q.Exec(ctx, `INSERT INTO segments (id, project_id, branch_id, key_id, language, status)
			VALUES ($1, $2, $3, $4, $5, 'untranslated')`, newID(), p.ID, branchID, keyID, lang)
		if err != nil {
			return fmt.Errorf("create segment: %w", err)
		}
	}
	return nil
}
