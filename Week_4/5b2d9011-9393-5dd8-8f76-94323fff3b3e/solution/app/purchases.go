package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
)

var purchaseIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type storedPurchase struct {
	playerID string
	item     string
	response string
}

const (
	ammoPackRounds = 90
	medKitHealing  = 50
)

type purchaseBody struct {
	PurchaseID string `json:"purchase_id"`
	Item       string `json:"item"`
}

func (h *hub) postPurchase(w http.ResponseWriter, r *http.Request) error {
	var body purchaseBody
	if err := decodeBody(r, &body); err != nil {
		return err
	}
	replayOrPause := func(rm *room, s *seat) (string, error) {
		if known, seen := rm.purchases[body.PurchaseID]; seen {
			if known.playerID != s.playerID || known.item != body.Item {
				return "", fail("purchase_conflict")
			}
			return known.response, nil
		}
		if rm.degraded != "" {
			return "", fail("room_paused")
		}
		return "", nil
	}
	var stored string
	if err := h.withSeat(w, r, func(rm *room, s *seat) error {
		var err error
		stored, err = replayOrPause(rm, s)
		return err
	}); err != nil || stored != "" {
		if err == nil {
			writeStatus(w, http.StatusCreated, stored)
		}
		return err
	}
	book, err := h.srv.store.priceSchedule(r.Context())
	if err != nil {
		return err
	}
	return h.withSeat(w, r, func(rm *room, s *seat) error {
		if stored, err := replayOrPause(rm, s); err != nil || stored != "" {
			if err == nil {
				writeStatus(w, http.StatusCreated, stored)
			}
			return err
		}
		if rm.phase != phaseIntermission {
			return fail("shop_closed")
		}
		name, known := itemName(body.Item)
		if !purchaseIDPattern.MatchString(body.PurchaseID) || !known {
			fields := map[string]string{}
			if !purchaseIDPattern.MatchString(body.PurchaseID) {
				fields["purchase_id"] = "Use 1 to 64 letters, digits, underscores or hyphens."
			}
			if !known {
				fields["item"] = "Pick Ammo pack, Grenade or Med kit."
			}
			return failFields(fields)
		}
		price, _ := priceBook{rows: book}.at(body.Item, h.srv.clock.Now())
		switch {
		case s.credits < price.Price:
			return failMessage("insufficient_credits", "Not enough credits — "+name+" costs "+strconv.Itoa(price.Price)+" cr.")
		case body.Item == "grenade" && s.grenades >= maxGrenades:
			return fail("at_capacity")
		}
		rm.pay(s, -price.Price, "purchase", body.Item, price.Price)
		switch body.Item {
		case "ammo_pack":
			s.reserve = min(maxReserve, s.reserve+ammoPackRounds)
		case "grenade":
			s.grenades++
		case "med_kit":
			if s.status == statusUp {
				s.hp = min(startHealth, s.hp+medKitHealing)
			}
		}
		rm.emit("purchase", map[string]any{"player": s.playerID, "item": body.Item, "unit_price": price.Price})
		payload, err := json.Marshal(map[string]any{"purchase_id": body.PurchaseID, "item": body.Item,
			"unit_price": price.Price, "price_effective_at": formatInstant(price.EffectiveAt),
			"balance": s.credits, "player": rm.playerState(s)})
		if err != nil {
			return err
		}
		rm.purchases[body.PurchaseID] = &storedPurchase{playerID: s.playerID, item: body.Item, response: string(payload)}
		writeStatus(w, http.StatusCreated, string(payload))
		return nil
	})
}
