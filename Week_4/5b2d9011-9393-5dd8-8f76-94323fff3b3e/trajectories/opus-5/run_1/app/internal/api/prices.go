package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/cinderlatch/holdfast/internal/apierr"
	"github.com/cinderlatch/holdfast/internal/calendar"
	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/pricing"
	"github.com/cinderlatch/holdfast/internal/store"
)

func scheduleRow(row store.PriceChange, status string) map[string]any {
	return map[string]any{
		"id":              row.ID,
		"item":            row.Item,
		"price":           row.Price,
		"effective_local": row.EffectiveLocal,
		"effective_at":    row.EffectiveAt.Format(time.RFC3339),
		"status":          status,
	}
}

func (s *Server) handleGetPrices(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.PriceSchedule(r.Context())
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	schedule := pricing.NewSchedule(rows)
	now := s.clock.Now()

	items := make([]map[string]any, 0, len(store.SeedItems))
	for _, item := range store.SeedItems {
		entry := map[string]any{
			"item":          item.Item,
			"name":          item.Name,
			"current_price": schedule.PriceAt(item.Item, now),
			"next_change":   nil,
		}
		if next, ok := schedule.NextChangeAt(item.Item, now); ok {
			entry["next_change"] = map[string]any{
				"id":              next.ID,
				"price":           next.Price,
				"effective_local": next.EffectiveLocal,
				"effective_at":    next.EffectiveAt.Format(time.RFC3339),
				"in_ms":           next.EffectiveAt.Sub(now).Milliseconds(),
			}
		}
		items = append(items, entry)
	}

	table := make([]map[string]any, 0, len(rows))
	for _, row := range schedule.Rows() {
		table = append(table, scheduleRow(row, schedule.StatusAt(row, now)))
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"zone": s.zone.String(), "items": items, "schedule": table,
	})
}

func (s *Server) handlePostPrice(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Item           string `json:"item"`
		Price          *int   `json:"price"`
		EffectiveLocal string `json:"effective_local"`
	}
	if failure := decode(r, &body); failure != nil {
		apierr.Write(w, failure)
		return
	}
	if _, failure := s.founder(r); failure != nil {
		apierr.Write(w, failure)
		return
	}

	fields := map[string]string{}
	if !store.KnownItem(body.Item) {
		fields["item"] = "Pick an ammo-station item."
	}
	if body.Price == nil || *body.Price < 1 || *body.Price > 5000 {
		fields["price"] = msgPrice
	}

	var effectiveAt time.Time
	var effectiveLocal string
	year, month, day, hour, minute, second, ok := calendar.ParseLocalWallTime(body.EffectiveLocal)
	if !ok {
		fields["effective_local"] = msgEffective
	} else {
		effectiveAt, _, _ = clockx.ResolveLocal(s.zone, year, month, day, hour, minute, second)
		effectiveLocal = calendar.FormatLocalWallTime(year, month, day, hour, minute)
		if !effectiveAt.After(s.clock.Now()) {
			fields["effective_local"] = msgEffective
		}
	}
	if len(fields) > 0 {
		apierr.Write(w, apierr.Validation(fields))
		return
	}

	saved, err := s.store.InsertPriceChange(r.Context(), store.PriceChange{
		Item: body.Item, Price: *body.Price,
		EffectiveLocal: effectiveLocal, EffectiveAt: effectiveAt,
	})
	if errors.Is(err, store.ErrPriceChangeExists) {
		apierr.Write(w, apierr.New(http.StatusConflict, "price_change_exists",
			"A change for that item at that time already exists."))
		return
	}
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	if err := s.prices.Refresh(r.Context()); err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	writeJSON(w, http.StatusCreated, scheduleRow(saved, pricing.StatusPending))
}

func (s *Server) handleDeletePrice(w http.ResponseWriter, r *http.Request) {
	if _, failure := s.founder(r); failure != nil {
		apierr.Write(w, failure)
		return
	}
	row, found, err := s.store.PriceChangeByID(r.Context(), r.PathValue("id"))
	if err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	if !found {
		apierr.Write(w, apierr.NotFound())
		return
	}
	if !row.EffectiveAt.After(s.clock.Now()) {
		apierr.Write(w, apierr.New(http.StatusConflict, "price_change_in_effect",
			"That price is already in effect and can't be removed."))
		return
	}
	if err := s.store.DeletePriceChange(r.Context(), row.ID); err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	if err := s.prices.Refresh(r.Context()); err != nil {
		apierr.Write(w, apierr.StorageUnavailable())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
