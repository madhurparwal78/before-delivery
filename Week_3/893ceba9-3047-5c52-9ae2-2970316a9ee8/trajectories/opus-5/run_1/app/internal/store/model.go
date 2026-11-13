package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/marlowquill/interline-desk/internal/domain"
)

// DB is the part of pgx that both the pool and a transaction answer, so every
// query runs the same way inside and outside a transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type User struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	PasswordHash string `json:"-"`
}

type Project struct {
	ID              string            `json:"id"`
	Slug            string            `json:"slug"`
	Name            string            `json:"name"`
	Client          string            `json:"client"`
	SourceLanguage  string            `json:"source_language"`
	TargetLanguages []string          `json:"target_languages"`
	Repository      string            `json:"repository"`
	MQMThreshold    int               `json:"mqm_threshold"`
	AIRoutes        map[string]string `json:"ai_routes"`
	CreatedAt       time.Time         `json:"created_at"`
	ChangeSeq       int64             `json:"-"`
}

type Branch struct {
	ID        string        `json:"-"`
	ProjectID string        `json:"-"`
	Name      string        `json:"name"`
	State     string        `json:"state"`
	IsMain    bool          `json:"is_main"`
	CreatedAt time.Time     `json:"created_at"`
	Base      domain.KeySet `json:"-"`
}

// Reported is the branch state the API shows; main always reports open.
func (b *Branch) Reported() string {
	if b.IsMain {
		return domain.BranchOpen
	}
	return b.State
}

type Operation struct {
	ID         string     `json:"id"`
	Kind       string     `json:"kind"`
	Label      string     `json:"label"`
	Branch     string     `json:"-"`
	At         time.Time  `json:"at"`
	RestoredAt *time.Time `json:"restored_at"`
	Restorable bool       `json:"restorable"`
}

type Assignment struct {
	ID         string    `json:"id"`
	ReviewerID string    `json:"reviewer_id"`
	Branch     string    `json:"branch"`
	Language   string    `json:"language"`
	SegmentIDs []string  `json:"segment_ids"`
	State      string    `json:"state"`
	ExpiresAt  time.Time `json:"expires_at"`
}

type Publish struct {
	ID            string            `json:"id"`
	Branch        string            `json:"branch"`
	State         string            `json:"state"`
	FailureReason *string           `json:"failure_reason"`
	Languages     []string          `json:"languages"`
	PullRequest   *PullRequest      `json:"pull_request"`
	Bundles       map[string]Bundle `json:"bundles"`
	CreatedAt     time.Time         `json:"created_at"`
	ConfirmedAt   *time.Time        `json:"confirmed_at"`
}

type PullRequest struct {
	Number int    `json:"number"`
	URL    string `json:"url"`
}

type Bundle struct {
	ObjectKey string `json:"object_key"`
	SHA256    string `json:"sha256"`
}

type Event struct {
	EventID   string     `json:"event_id"`
	Type      string     `json:"type"`
	State     string     `json:"state"`
	Attempts  int        `json:"attempts"`
	CreatedAt time.Time  `json:"created_at"`
	SentAt    *time.Time `json:"sent_at"`
}

type AuditEntry struct {
	ID      string    `json:"id"`
	At      time.Time `json:"at"`
	Actor   string    `json:"actor"`
	Action  string    `json:"action"`
	Project string    `json:"project"`
	Detail  string    `json:"detail"`
}

type TMEntry struct {
	ID             string  `json:"id"`
	Source         string  `json:"source"`
	Target         string  `json:"target"`
	TargetLanguage string  `json:"target_language"`
	ImportID       *string `json:"import_id"`
}

type TMImport struct {
	ImportID   string           `json:"import_id"`
	Filename   string           `json:"filename"`
	Format     string           `json:"format"`
	Size       int64            `json:"size"`
	SHA256     string           `json:"sha256"`
	At         time.Time        `json:"at"`
	RestoredAt *time.Time       `json:"restored_at"`
	Added      int              `json:"added"`
	Duplicates int              `json:"duplicates"`
	Applied    int              `json:"applied"`
	Rows       []ImportRowIssue `json:"rows"`
}

type SourceFile struct {
	FileID      string    `json:"file_id"`
	Branch      string    `json:"branch"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	Size        int64     `json:"size"`
	SHA256      string    `json:"sha256"`
	At          time.Time `json:"at"`
}

type ReviewRow struct {
	SegmentID    string         `json:"segment_id"`
	Project      string         `json:"project"`
	Branch       string         `json:"branch"`
	Language     string         `json:"language"`
	Key          string         `json:"key"`
	Source       *string        `json:"source"`
	Value        *string        `json:"value"`
	Status       string         `json:"status"`
	Score        *int           `json:"score"`
	Issues       []domain.Issue `json:"issues"`
	AssignmentID *string        `json:"assignment_id"`
	ExpiresAt    *time.Time     `json:"expires_at"`
	Removed      bool           `json:"removed"`
}
