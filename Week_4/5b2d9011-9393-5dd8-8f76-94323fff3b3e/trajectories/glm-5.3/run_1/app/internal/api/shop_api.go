package api

import (
	"time"

	"holdfast/internal/sim"
)

// liveShopItems renders the shop's current prices and any pending price
// change countdown for the snapshot.
func (a *App) liveShopItems(now time.Time) []sim.ShopItem {
	if err := a.requireStorage(); err != nil {
		return nil
	}
	ctx, cancel := ctxWithTimeout()
	defer cancel()
	rows, err := a.Store.PriceChanges(ctx)
	if err != nil {
		return nil
	}
	items := []sim.ShopItem{
		{Item: "ammo_pack", Name: "Ammo pack"},
		{Item: "grenade", Name: "Grenade"},
		{Item: "med_kit", Name: "Med kit"},
	}
	for i := range items {
		it := &items[i]
		var currentAt time.Time
		haveCurrent := false
		for _, pc := range rows {
			if pc.Item != it.Item || pc.EffectiveAt.After(now) {
				continue
			}
			if !haveCurrent || pc.EffectiveAt.After(currentAt) {
				currentAt = pc.EffectiveAt
				it.Price = pc.Price
				haveCurrent = true
			}
		}
		// The next change for this item.
		var nextAt time.Time
		haveNext := false
		var nextPrice int
		for _, pc := range rows {
			if pc.Item != it.Item || !pc.EffectiveAt.After(now) {
				continue
			}
			if !haveNext || pc.EffectiveAt.Before(nextAt) {
				nextAt = pc.EffectiveAt
				nextPrice = pc.Price
				haveNext = true
			}
		}
		if haveNext {
			np := nextPrice
			it.NextPrice = &np
			inMs := nextAt.Sub(now).Milliseconds()
			it.NextChangeInMs = &inMs
		}
	}
	return items
}
