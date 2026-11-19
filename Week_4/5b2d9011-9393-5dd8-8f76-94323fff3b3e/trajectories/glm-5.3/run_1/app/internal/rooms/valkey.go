package rooms

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/valkey-io/valkey-go"

	"holdfast/internal/apperr"
	"holdfast/internal/clock"
	"holdfast/internal/maps"
	"holdfast/internal/sim"
	"holdfast/internal/store"
)

// Valkey wraps the Valkey client for the live room registry, the seat leases
// and the report dedupe.
type Valkey struct {
	Client valkey.Client
}

// NewValkey connects and pings.
func NewValkey(url string) (*Valkey, error) {
	opts, err := valkey.ParseURL(url)
	if err != nil {
		return nil, err
	}
	client, err := valkey.NewClient(opts)
	if err != nil {
		return nil, err
	}
	return &Valkey{Client: client}, nil
}

// Ping reports whether Valkey answers.
func (v *Valkey) Ping() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return v.Client.Do(ctx, v.Client.B().Ping().Build()).Error() == nil
}

// ClearStale removes stale registry keys at boot.
func (v *Valkey) ClearStale() error {
	ctx := context.Background()
	keys, err := v.Client.Do(ctx, v.Client.B().Keys().Pattern("hf:room:*").Build()).AsStrSlice()
	if err != nil {
		return err
	}
	for _, k := range keys {
		if err := v.Client.Do(ctx, v.Client.B().Del().Key(k).Build()).Error(); err != nil {
			return err
		}
	}
	return nil
}

// writeRoomKey writes the room hash.
func (v *Valkey) writeRoomKey(ctx context.Context, r *sim.Room) error {
	return v.Client.Do(ctx, v.Client.B().Hmset().Key("hf:room:" + r.Code).
		FieldValue().FieldValue("mode", r.Mode).
		FieldValue("host", r.HostID).
		FieldValue("phase", string(r.PhasePublic())).
		FieldValue("created_at", clock.Instant(r.CreatedAtPublic())).
		FieldValue("invite_expires_at", clock.Instant(r.InviteExpiresAtPublic())).
		Build()).Error()
}

// removeRoomKey removes a room's registry key.
func (v *Valkey) removeRoomKey(ctx context.Context, code string) error {
	return v.Client.Do(ctx, v.Client.B().Del().Key("hf:room:" + code).Build()).Error()
}

// renewSeatLease renews hf:seat:<CODE>:<player>, expiring with the lease time.
func (v *Valkey) renewSeatLease(ctx context.Context, code, playerID string) error {
	return v.Client.Do(ctx, v.Client.B().Set().Key("hf:seat:"+code+":"+playerID).
		Value("1").Ex(sim.LeaseMs).Build()).Error()
}

// startGrace writes hf:grace:<CODE>:<player>, present only during a grace.
func (v *Valkey) startGrace(ctx context.Context, code, playerID string) error {
	return v.Client.Do(ctx, v.Client.B().Set().Key("hf:grace:"+code+":"+playerID).
		Value("1").Ex(sim.ReconnectGraceMs).Build()).Error()
}

// clearGrace removes the grace key.
func (v *Valkey) clearGrace(ctx context.Context, code, playerID string) error {
	return v.Client.Do(ctx, v.Client.B().Del().Key("hf:grace:"+code+":"+playerID).Build()).Error()
}

// errValkeyNil marks a missing key result.
var errValkeyNil = errors.New("valkey: nil")

// storedReport is the Valkey value for a report: the stored result plus the
// canonical body it was first applied with.
type storedReport struct {
	Body   string           `json:"body"`
	Result sim.ReportResult `json:"result"`
}

// getReport fetches a stored report result, for idempotent replays.
func (v *Valkey) getReport(ctx context.Context, code, reportID string) (sim.ReportResult, bool, error) {
	sr, found, err := v.getStoredReport(ctx, code, reportID)
	return sr.Result, found, err
}

// getStoredReport fetches the stored report with its canonical body.
func (v *Valkey) getStoredReport(ctx context.Context, code, reportID string) (storedReport, bool, error) {
	var out storedReport
	res, err := v.Client.Do(ctx, v.Client.B().Hget().Key("hf:reports:"+code).Field(reportID).Build()).ToString()
	if err != nil {
		if errors.Is(err, valkey.Nil) {
			return out, false, nil
		}
		return out, false, err
	}
	if err := json.Unmarshal([]byte(res), &out); err != nil {
		return out, false, err
	}
	return out, true, nil
}

// putReport stores a report result. It returns ErrReportConflict when the id
// is already stored with a different body.
func (v *Valkey) putReport(ctx context.Context, code string, rr sim.ReportResult) error {
	data, err := json.Marshal(storedReport{Body: rr.Body, Result: rr})
	if err != nil {
		return err
	}
	// Hsetnx guards the first application; a same-moment duplicate with the
	// same body is harmless, and a different body is a conflict.
	ok, err := v.Client.Do(ctx, v.Client.B().Hsetnx().Key("hf:reports:"+code).Field(rr.ReportID).Value(string(data)).Build()).AsBool()
	if err != nil {
		return err
	}
	if ok {
		return nil
	}
	stored, found, err := v.getStoredReport(ctx, code, rr.ReportID)
	if err != nil {
		return err
	}
	if found && stored.Body != rr.Body {
		return apperr.ReportConflict
	}
	return nil
}

// purchaseRecordJSON is the stored purchase for idempotency.
type purchaseRecordJSON struct {
	PurchaseID string    `json:"purchase_id"`
	Item       string    `json:"item"`
	UnitPrice  int       `json:"unit_price"`
	EffectiveAt string   `json:"price_effective_at"`
	Balance    int64     `json:"balance"`
	PlayerID   string    `json:"player_id"`
}

var _ = maps.SiegeMapID
var _ = store.ErrNotFound
var _ = strings.ToUpper
