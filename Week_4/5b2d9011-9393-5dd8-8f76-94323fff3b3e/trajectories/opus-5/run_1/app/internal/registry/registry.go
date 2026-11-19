// Package registry keeps the live room registry, seat leases and report dedupe in
// Valkey. The simulation itself runs in the game server's memory.
package registry

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

// Registry is the Valkey gateway.
type Registry struct {
	client *redis.Client
	up     atomic.Bool
}

// ErrDown reports that Valkey is unreachable.
var ErrDown = errors.New("valkey unavailable")

const callTimeout = 2 * time.Second

// Key prefixes, named once.
const (
	roomKey    = "hf:room:"
	seatKey    = "hf:seat:"
	graceKey   = "hf:grace:"
	reportsKey = "hf:reports:"
)

// New opens a lazy client. It does not wait for Valkey.
func New(url string) (*Registry, error) {
	// The registry reports its own up or down state, so the driver's dial chatter
	// would only repeat it.
	redis.SetLogger(quietLogger{})

	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	opts.DialTimeout = callTimeout
	opts.ReadTimeout = callTimeout
	opts.WriteTimeout = callTimeout
	return &Registry{client: redis.NewClient(opts)}, nil
}

type quietLogger struct{}

func (quietLogger) Printf(context.Context, string, ...any) {}

// Close releases the client.
func (r *Registry) Close() { _ = r.client.Close() }

// Up reports the latest probe result.
func (r *Registry) Up() bool { return r.up.Load() }

// Probe checks Valkey.
func (r *Registry) Probe(ctx context.Context) {
	c, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	r.up.Store(r.client.Ping(c).Err() == nil)
}

func (r *Registry) call(ctx context.Context) (context.Context, context.CancelFunc, error) {
	if !r.up.Load() {
		return nil, nil, ErrDown
	}
	c, cancel := context.WithTimeout(ctx, callTimeout)
	return c, cancel, nil
}

func (r *Registry) down(err error) error {
	if err == nil {
		return nil
	}
	r.up.Store(false)
	return ErrDown
}

// ClearStale removes the registry keys left by an earlier run, since rooms are
// never restored after a restart.
func (r *Registry) ClearStale(ctx context.Context) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()

	for _, prefix := range []string{roomKey, seatKey, graceKey, reportsKey} {
		var cursor uint64
		for {
			keys, next, err := r.client.Scan(c, cursor, prefix+"*", 500).Result()
			if err != nil {
				return r.down(err)
			}
			if len(keys) > 0 {
				if err := r.client.Del(c, keys...).Err(); err != nil {
					return r.down(err)
				}
			}
			if next == 0 {
				break
			}
			cursor = next
		}
	}
	return nil
}

// RoomFields are the room registry hash fields.
type RoomFields struct {
	Mode            string
	Host            string
	Phase           string
	CreatedAt       string
	InviteExpiresAt string
}

func (f RoomFields) values() []any {
	return []any{
		"mode", f.Mode,
		"host", f.Host,
		"phase", f.Phase,
		"created_at", f.CreatedAt,
		"invite_expires_at", f.InviteExpiresAt,
	}
}

// ClaimRoom writes a room's registry hash only when its code is free, so a code
// is unique among live rooms.
func (r *Registry) ClaimRoom(ctx context.Context, code string, fields RoomFields) (bool, error) {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return false, err
	}
	defer cancel()

	claimed, err := r.client.HSetNX(c, roomKey+code, "mode", fields.Mode).Result()
	if err != nil {
		return false, r.down(err)
	}
	if !claimed {
		return false, nil
	}
	if err := r.client.HSet(c, roomKey+code, fields.values()...).Err(); err != nil {
		return false, r.down(err)
	}
	return true, nil
}

// WriteRoom rewrites a room's registry hash, which a room does after Valkey
// returns.
func (r *Registry) WriteRoom(ctx context.Context, code string, fields RoomFields) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	return r.down(r.client.HSet(c, roomKey+code, fields.values()...).Err())
}

// DropRoom removes a room's registry keys.
func (r *Registry) DropRoom(ctx context.Context, code string) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()

	keys := []string{roomKey + code, reportsKey + code}
	var cursor uint64
	for _, prefix := range []string{seatKey + code + ":", graceKey + code + ":"} {
		cursor = 0
		for {
			found, next, err := r.client.Scan(c, cursor, prefix+"*", 200).Result()
			if err != nil {
				return r.down(err)
			}
			keys = append(keys, found...)
			if next == 0 {
				break
			}
			cursor = next
		}
	}
	return r.down(r.client.Del(c, keys...).Err())
}

// RenewSeat renews a seat lease for the lease time.
func (r *Registry) RenewSeat(ctx context.Context, code, playerID string, lease time.Duration) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	return r.down(r.client.Set(c, seatKey+code+":"+playerID, "held", lease).Err())
}

// ReleaseSeat drops a seat lease.
func (r *Registry) ReleaseSeat(ctx context.Context, code, playerID string) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	return r.down(r.client.Del(c, seatKey+code+":"+playerID).Err())
}

// StartGrace marks a reconnect grace, expiring when the grace ends.
func (r *Registry) StartGrace(ctx context.Context, code, playerID string, grace time.Duration) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	return r.down(r.client.Set(c, graceKey+code+":"+playerID, "holding", grace).Err())
}

// EndGrace clears a reconnect grace.
func (r *Registry) EndGrace(ctx context.Context, code, playerID string) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	return r.down(r.client.Del(c, graceKey+code+":"+playerID).Err())
}

// StoreReport remembers a report's stored result, keyed by its report id.
func (r *Registry) StoreReport(ctx context.Context, code, reportID, payload string) error {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return err
	}
	defer cancel()
	return r.down(r.client.HSet(c, reportsKey+code, reportID, payload).Err())
}

// Report reads a report's stored result.
func (r *Registry) Report(ctx context.Context, code, reportID string) (string, bool, error) {
	c, cancel, err := r.call(ctx)
	if err != nil {
		return "", false, err
	}
	defer cancel()

	payload, err := r.client.HGet(c, reportsKey+code, reportID).Result()
	if errors.Is(err, redis.Nil) {
		return "", false, nil
	}
	if err != nil {
		return "", false, r.down(err)
	}
	return payload, true, nil
}
