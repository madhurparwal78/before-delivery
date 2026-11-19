package main

import (
	"net/http"
	"sort"
	"time"
)

type shopItem struct {
	item string
	name string
}

var shopItems = []shopItem{
	{"ammo_pack", "Ammo pack"},
	{"grenade", "Grenade"},
	{"med_kit", "Med kit"},
}

func itemName(item string) (string, bool) {
	for _, it := range shopItems {
		if it.item == item {
			return it.name, true
		}
	}
	return "", false
}

const (
	minPrice = 1
	maxPrice = 5000
)

// priceBook is the schedule of price changes. `at` is the one place that decides which price
// is in effect at an instant.
type priceBook struct {
	rows []priceChange
}

func (b priceBook) at(item string, t time.Time) (priceChange, bool) {
	var best priceChange
	found := false
	for _, c := range b.rows {
		if c.Item != item || c.EffectiveAt.After(t) {
			continue
		}
		if !found || c.EffectiveAt.After(best.EffectiveAt) {
			best, found = c, true
		}
	}
	return best, found
}

func (b priceBook) next(item string, t time.Time) (priceChange, bool) {
	var best priceChange
	found := false
	for _, c := range b.rows {
		if c.Item != item || !c.EffectiveAt.After(t) {
			continue
		}
		if !found || c.EffectiveAt.Before(best.EffectiveAt) {
			best, found = c, true
		}
	}
	return best, found
}

func (b priceBook) status(c priceChange, t time.Time) string {
	if c.EffectiveAt.After(t) {
		return "pending"
	}
	if current, ok := b.at(c.Item, t); ok && current.ID == c.ID {
		return "in_effect"
	}
	return "superseded"
}

type pricesBody struct {
	Item           string `json:"item"`
	Price          int    `json:"price"`
	EffectiveLocal string `json:"effective_local"`
}

func scheduleRowJSON(b priceBook, c priceChange, now time.Time) map[string]any {
	return map[string]any{
		"id": c.ID, "item": c.Item, "price": c.Price, "effective_local": c.EffectiveLocal,
		"effective_at": formatInstant(c.EffectiveAt), "status": b.status(c, now),
	}
}

func (s *server) getPrices(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.store.priceSchedule(r.Context())
	if err != nil {
		return err
	}
	book := priceBook{rows: rows}
	now := s.clock.Now()
	items := []map[string]any{}
	for _, it := range shopItems {
		current, _ := book.at(it.item, now)
		entry := map[string]any{"item": it.item, "name": it.name, "current_price": current.Price, "next_change": nil}
		if nx, ok := book.next(it.item, now); ok {
			entry["next_change"] = map[string]any{
				"id": nx.ID, "price": nx.Price, "effective_local": nx.EffectiveLocal,
				"effective_at": formatInstant(nx.EffectiveAt), "in_ms": nx.EffectiveAt.Sub(now).Milliseconds(),
			}
		}
		items = append(items, entry)
	}
	sort.SliceStable(rows, func(i, j int) bool {
		if !rows[i].EffectiveAt.Equal(rows[j].EffectiveAt) {
			return rows[i].EffectiveAt.Before(rows[j].EffectiveAt)
		}
		return rows[i].Item < rows[j].Item
	})
	schedule := []map[string]any{}
	for _, c := range rows {
		schedule = append(schedule, scheduleRowJSON(book, c, now))
	}
	writeJSON(w, http.StatusOK, map[string]any{"zone": studioZone, "items": items, "schedule": schedule})
	return nil
}

func (s *server) postPrice(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.requireFounder(r); err != nil {
		return err
	}
	var body pricesBody
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	now := s.clock.Now()
	fields := map[string]string{}
	if _, ok := itemName(body.Item); !ok {
		fields["item"] = "Pick Ammo pack, Grenade or Med kit."
	}
	at, normalized, parsed := parseStudioLocal(body.EffectiveLocal)
	if !parsed || !at.After(now) {
		fields["effective_local"] = "Pick a time after now, in studio time."
	}
	if body.Price < minPrice || body.Price > maxPrice {
		fields["price"] = "Use a whole number from 1 to 5000."
	}
	if fields["item"] != "" || fields["effective_local"] != "" {
		return failFields(fields)
	}
	exists, err := s.store.priceChangeExists(r.Context(), body.Item, at)
	if err != nil {
		return err
	}
	if exists {
		return fail("price_change_exists")
	}
	if len(fields) > 0 {
		return failFields(fields)
	}
	change := priceChange{ID: newID("pc_"), Item: body.Item, Price: body.Price, EffectiveLocal: normalized, EffectiveAt: at}
	if err := s.store.insertPriceChange(r.Context(), change); err != nil {
		return err
	}
	s.refreshPrices()
	writeJSON(w, http.StatusCreated, scheduleRowJSON(priceBook{rows: []priceChange{change}}, change, now))
	return nil
}

func (s *server) deletePrice(w http.ResponseWriter, r *http.Request) error {
	caller, err := s.requirePlayer(r)
	if err != nil {
		return err
	}
	change, found, err := s.store.priceChangeByID(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	if !found {
		return fail("not_found")
	}
	if caller.Role != roleFounder {
		return fail("founder_only")
	}
	if !change.EffectiveAt.After(s.clock.Now()) {
		return fail("price_change_in_effect")
	}
	if err := s.store.deletePriceChange(r.Context(), change.ID); err != nil {
		return err
	}
	s.refreshPrices()
	w.WriteHeader(http.StatusNoContent)
	return nil
}
