// Package pricing decides the ammo-station price in effect at an instant.
package pricing

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/cinderlatch/holdfast/internal/store"
)

// Status values for a schedule row.
const (
	StatusInEffect   = "in_effect"
	StatusPending    = "pending"
	StatusSuperseded = "superseded"
)

// Schedule is an immutable snapshot of the price schedule.
type Schedule struct {
	changes []store.PriceChange
}

// NewSchedule sorts rows oldest first so the rule below can scan them.
func NewSchedule(changes []store.PriceChange) Schedule {
	rows := make([]store.PriceChange, len(changes))
	copy(rows, changes)
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].EffectiveAt.Equal(rows[j].EffectiveAt) {
			return rows[i].Item < rows[j].Item
		}
		return rows[i].EffectiveAt.Before(rows[j].EffectiveAt)
	})
	return Schedule{changes: rows}
}

// Rows reports every schedule row, oldest effective instant first.
func (s Schedule) Rows() []store.PriceChange { return s.changes }

// PriceAt reports an item's price at an instant: the row with the latest
// effective instant at or before it. This is the only place that rule is decided.
func (s Schedule) PriceAt(item string, at time.Time) int {
	row, ok := s.InEffectAt(item, at)
	if !ok {
		return 0
	}
	return row.Price
}

// InEffectAt reports the row deciding an item's price at an instant.
func (s Schedule) InEffectAt(item string, at time.Time) (store.PriceChange, bool) {
	var found store.PriceChange
	ok := false
	for _, row := range s.changes {
		if row.Item != item || row.EffectiveAt.After(at) {
			continue
		}
		found, ok = row, true
	}
	return found, ok
}

// NextChangeAt reports an item's earliest row after an instant.
func (s Schedule) NextChangeAt(item string, at time.Time) (store.PriceChange, bool) {
	for _, row := range s.changes {
		if row.Item == item && row.EffectiveAt.After(at) {
			return row, true
		}
	}
	return store.PriceChange{}, false
}

// StatusAt reports a row's status at an instant.
func (s Schedule) StatusAt(row store.PriceChange, at time.Time) string {
	if row.EffectiveAt.After(at) {
		return StatusPending
	}
	if current, ok := s.InEffectAt(row.Item, at); ok && current.ID == row.ID {
		return StatusInEffect
	}
	return StatusSuperseded
}

// Cache keeps the schedule in memory so a live room can price a purchase without
// waiting on Postgres. The rows change only when the founder writes, and every
// write refreshes the cache, so the instant a change takes effect stays exact.
type Cache struct {
	st *store.Store

	mu       sync.RWMutex
	schedule Schedule
	loaded   bool
}

// NewCache builds an empty cache.
func NewCache(st *store.Store) *Cache { return &Cache{st: st} }

// Refresh reloads the schedule from Postgres.
func (c *Cache) Refresh(ctx context.Context) error {
	rows, err := c.st.PriceSchedule(ctx)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.schedule = NewSchedule(rows)
	c.loaded = true
	c.mu.Unlock()
	return nil
}

// Schedule reports the cached schedule and whether it has ever loaded.
func (c *Cache) Schedule() (Schedule, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.schedule, c.loaded
}
