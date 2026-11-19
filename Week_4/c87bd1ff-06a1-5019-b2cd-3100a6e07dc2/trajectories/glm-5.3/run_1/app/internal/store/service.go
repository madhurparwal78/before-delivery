package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Sentinel errors the handlers translate.
var ErrNoRows = errors.New("no rows")

// Register records a bidder or consignor registration.
func (s *Store) Register(ctx context.Context, viewer Person, role, fullName, phone, address string) (Registration, string, error) {
	var reg Registration
	var landing string
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		existing, err := tx.GetRegistrationByPerson(ctx, viewer.ID)
		if err != nil {
			return fmt.Errorf("reading the registration: %w", err)
		}
		if existing != nil {
			return Conflict("already_registered", "You are already registered.")
		}
		fields := map[string]string{}
		if role != "bidder" && role != "consignor" {
			fields["role"] = "Choose bid or consign."
		}
		if len(fullName) < 1 || len(fullName) > 120 {
			fields["full_name"] = "Enter your full name."
		}
		if len(phone) < 6 || len(phone) > 30 {
			fields["phone"] = "Enter a phone number."
		}
		if len(address) < 1 || len(address) > 300 {
			fields["address"] = "Enter your address."
		}
		if len(fields) > 0 {
			return Invalid(fields)
		}
		status := "pending"
		if role == "consignor" {
			status = "active"
		}
		reg = Registration{ID: ID(), PersonID: viewer.ID, Role: role, Status: status, FullName: fullName, Phone: phone, Address: address}
		if err := tx.CreateRegistration(ctx, reg); err != nil {
			return fmt.Errorf("saving the registration: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "approval", nil, nil); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		if role == "bidder" {
			landing = "/bidder"
		} else {
			landing = "/consign"
		}
		return nil
	})
	if err != nil {
		return Registration{}, "", err
	}
	return reg, landing, nil
}

// ApproveRegistration gives a pending bidder their paddle and spending limit.
func (s *Store) ApproveRegistration(ctx context.Context, regID string, limit int) (Registration, error) {
	var out Registration
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		reg, err := tx.GetRegistration(ctx, regID)
		if err != nil {
			return fmt.Errorf("reading the registration: %w", err)
		}
		if reg == nil {
			return NotFound()
		}
		if reg.Status == "active" {
			return Conflict("invalid_transition", "This registration is already active.")
		}
		if limit < 100 || limit > 1000000 {
			return Invalid(map[string]string{"spending_limit": "Enter a spending limit between €100 and €1,000,000."})
		}
		paddle, err := tx.NextPaddle(ctx)
		if err != nil {
			return fmt.Errorf("giving the next paddle: %w", err)
		}
		if err := tx.ApproveRegistration(ctx, regID, paddle, limit); err != nil {
			return fmt.Errorf("approving the registration: %w", err)
		}
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: reg.PersonID, Kind: "limit_approved", Text: "Your spending limit of " + fmtEuros(limit) + " is approved. You can bid now."}); err != nil {
			return fmt.Errorf("sending the approval notice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "approval", nil, &reg.PersonID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		reg.Status = "active"
		reg.Paddle = &paddle
		reg.SpendingLimit = &limit
		out = *reg
		return nil
	})
	return out, err
}

// Consign takes a new lot into intake.
func (s *Store) Consign(ctx context.Context, viewer Person, category, title, description string) (LotFull, string, error) {
	var lot LotFull
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		reg, err := tx.GetRegistrationByPerson(ctx, viewer.ID)
		if err != nil {
			return fmt.Errorf("reading the registration: %w", err)
		}
		if reg == nil || reg.Role != "consignor" {
			return Forbidden()
		}
		fields := map[string]string{}
		if category != "wristwatch" && category != "camera" {
			fields["category"] = "Choose wristwatch or film camera."
		}
		if len(title) < 1 || len(title) > 120 {
			fields["title"] = "Enter a title of up to 120 characters."
		}
		if len(description) < 1 || len(description) > 2000 {
			fields["description"] = "Describe the item in up to 2,000 characters."
		}
		if len(fields) > 0 {
			return Invalid(fields)
		}
		created, err := tx.CreateLot(ctx, Lot{ID: ID(), ConsignorID: viewer.ID, ConsignorName: viewer.Name, Title: title, Category: category, Description: description, State: "intake"})
		if err != nil {
			return fmt.Errorf("saving the lot: %w", err)
		}
		lot = LotFull{Lot: created}
		if _, err := tx.AppendEvent(ctx, "lot_new", &created.ID, &viewer.ID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		return nil
	})
	if err != nil {
		return LotFull{}, "", err
	}
	return lot, "/consign", nil
}

// SaveEstimate validates and stores the specialist's estimate.
func (s *Store) SaveEstimate(ctx context.Context, lotID string, low, high, opening, reserve *int, condition, portrait string) (LotFull, error) {
	var lot LotFull
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		l, err := tx.GetLot(ctx, lotID)
		if err != nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		if l == nil {
			return NotFound()
		}
		if l.State != "intake" && l.State != "estimated" && l.State != "placed" {
			return Conflict("invalid_transition", "This lot can no longer be estimated.")
		}
		fields := map[string]string{}
		bad := "Enter a whole number of euros from €1 to €1,000,000."
		if !amountOK(low) {
			fields["estimate_low"] = bad
		}
		if !amountOK(high) {
			fields["estimate_high"] = bad
		}
		if !amountOK(opening) {
			fields["opening_bid"] = bad
		}
		if !amountOK(reserve) {
			fields["reserve"] = bad
		}
		if len(condition) > 2000 {
			fields["condition"] = "Condition notes can be up to 2,000 characters."
		}
		if !portraitOK(portrait) {
			fields["portrait"] = "Choose a portrait."
		}
		// The comparisons run in order, skipped when a compared field already failed.
		if fields["estimate_high"] == "" && *low > *high {
			fields["estimate_high"] = "The low estimate must not be above the high estimate."
		}
		if fields["opening_bid"] == "" && *opening > *low {
			fields["opening_bid"] = "The opening bid must not be above the low estimate."
		}
		if fields["reserve"] == "" && fields["opening_bid"] == "" && (*reserve < *opening || *reserve > *low) {
			fields["reserve"] = "The reserve must be between the opening bid and the low estimate."
		}
		if len(fields) > 0 {
			return Invalid(fields)
		}
		l.EstimateLow, l.EstimateHigh, l.OpeningBid, l.Reserve = low, high, opening, reserve
		l.Condition, l.Portrait = condition, portrait
		if l.State == "intake" {
			l.State = "estimated"
		}
		if err := tx.UpdateLotEstimate(ctx, *l); err != nil {
			return fmt.Errorf("saving the estimate: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "estimate", &l.ID, nil); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		lot = LotFull{Lot: *l}
		return nil
	})
	return lot, err
}

func amountOK(p *int) bool {
	return p != nil && *p >= 1 && *p <= 1000000
}

func portraitOK(p string) bool {
	switch p {
	case "chronograph", "rangefinder", "diver", "twin_lens", "dress", "bellows":
		return true
	}
	return false
}

// CreateSale makes a draft sale.
func (s *Store) CreateSale(ctx context.Context, title string, endsAt time.Time, firstLot int) (Sale, error) {
	var sale Sale
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		fields := map[string]string{}
		if len(title) < 1 || len(title) > 80 {
			fields["title"] = "Enter a sale title of up to 80 characters."
		}
		if firstLot < 1 || firstLot > 9999 {
			fields["first_lot_number"] = "Enter a first lot number from 1 to 9999."
		}
		if len(fields) > 0 {
			return Invalid(fields)
		}
		created, err := tx.CreateSale(ctx, Sale{ID: ID(), Title: title, EndsAt: endsAt, FirstLotNumber: firstLot, State: "draft"})
		if err != nil {
			return fmt.Errorf("saving the sale: %w", err)
		}
		sale = created
		return nil
	})
	return sale, err
}

// SetSaleOrder places estimated lots in catalogue order.
func (s *Store) SetSaleOrder(ctx context.Context, saleID string, lotIDs []string) ([]Lot, error) {
	var lots []Lot
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		sale, err := tx.GetSale(ctx, saleID)
		if err != nil {
			return fmt.Errorf("reading the sale: %w", err)
		}
		if sale == nil {
			return NotFound()
		}
		if sale.State != "draft" {
			return Conflict("sale_published", "This sale is already published.")
		}
		ids := map[string]bool{}
		for _, id := range lotIDs {
			ids[id] = true
		}
		for _, id := range lotIDs {
			l, err := tx.GetLot(ctx, id)
			if err != nil {
				return fmt.Errorf("reading the lot: %w", err)
			}
			if l == nil {
				return NotFound()
			}
			if l.State == "placed" && (l.SaleID == nil || *l.SaleID != saleID) {
				return Conflict("invalid_transition", "That lot is already placed in another sale.")
			}
			if l.State != "estimated" && l.State != "placed" {
				return Conflict("invalid_transition", "Only estimated lots can be placed in a sale.")
			}
		}
		// Unplace lots that were in the sale but are no longer in the order.
		current, err := tx.SaleLots(ctx, saleID)
		if err != nil {
			return fmt.Errorf("reading the sale's lots: %w", err)
		}
		for _, l := range current {
			if !ids[l.ID] {
				if err := tx.SetLotState(ctx, l.ID, "estimated"); err != nil {
					return fmt.Errorf("removing the lot from the sale: %w", err)
				}
				if _, err := tx.AppendEvent(ctx, "estimate", &l.ID, nil); err != nil {
					return fmt.Errorf("recording the event: %w", err)
				}
			}
		}
		if err := tx.SetLotOrder(ctx, saleID, lotIDs); err != nil {
			return fmt.Errorf("saving the sale order: %w", err)
		}
		lots, err = tx.SaleLots(ctx, saleID)
		if err != nil {
			return fmt.Errorf("reading the sale's lots: %w", err)
		}
		return nil
	})
	return lots, err
}

// PublishSale numbers the lots and opens them, one lot gap apart.
func (s *Store) PublishSale(ctx context.Context, saleID string) (Sale, []Lot, error) {
	var sale Sale
	var lots []Lot
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		s0, err := tx.GetSale(ctx, saleID)
		if err != nil {
			return fmt.Errorf("reading the sale: %w", err)
		}
		if s0 == nil {
			return NotFound()
		}
		if s0.State != "draft" {
			return Conflict("sale_published", "This sale is already published.")
		}
		fields := map[string]string{}
		if !s0.EndsAt.After(now) {
			fields["ends_at"] = "The sale must end in the future."
		}
		count, err := tx.SaleLotCount(ctx, saleID)
		if err != nil {
			return fmt.Errorf("counting the sale's lots: %w", err)
		}
		if count == 0 {
			fields["lots"] = "Add at least one lot before publishing."
		}
		if len(fields) > 0 {
			return Invalid(fields)
		}
		if err := tx.AssignLotNumbers(ctx, saleID, s0.FirstLotNumber, s.cfg.LotGap, s0.EndsAt); err != nil {
			return fmt.Errorf("numbering the lots: %w", err)
		}
		if err := tx.SetSaleState(ctx, saleID, "open"); err != nil {
			return fmt.Errorf("opening the sale: %w", err)
		}
		s0.State = "open"
		sale = *s0
		lots, err = tx.SaleLots(ctx, saleID)
		if err != nil {
			return fmt.Errorf("reading the sale's lots: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "sale_published", nil, nil); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		return nil
	})
	return sale, lots, err
}

// SetWatch turns watching on or off, safe to repeat.
func (s *Store) SetWatch(ctx context.Context, viewer Person, lotID string, watching bool) (bool, error) {
	var out bool
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		lot, err := tx.GetLot(ctx, lotID)
		if err != nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		if lot == nil || !lotAccess(viewer, lot) {
			return NotFound()
		}
		if err := tx.SetWatch(ctx, viewer.ID, lotID, watching); err != nil {
			return fmt.Errorf("saving the watch: %w", err)
		}
		out = watching
		if _, err := tx.AppendEvent(ctx, "watch", &lotID, &viewer.ID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		if watching && lot.ClosesAt != nil && lot.IsOpenish() {
			// A closing-soon notice is due only if the watcher still has time for it.
			due := lot.ClosesAt.Add(-s.cfg.WatchNotice)
			now, err := tx.Now(ctx)
			if err != nil {
				return fmt.Errorf("reading the clock: %w", err)
			}
			if now.Before(due) {
				sent, err := tx.ClosingNoticeSent(ctx, lotID, viewer.ID)
				if err != nil {
					return fmt.Errorf("checking the closing notice: %w", err)
				}
				if !sent {
					if err := tx.InsertDueEvent(ctx, "closing_notice", &lotID, &viewer.ID, nil, nil, due); err != nil {
						return fmt.Errorf("scheduling the closing notice: %w", err)
					}
				}
			}
		}
		return nil
	})
	return out, err
}

// SecondChance makes the consignor's offer to the top bidder.
func (s *Store) SecondChance(ctx context.Context, viewer Person, lotID string, amount int) (Offer, error) {
	var offer Offer
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		lot, err := tx.GetLot(ctx, lotID)
		if err != nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		if lot == nil || lot.ConsignorID != viewer.ID {
			return NotFound()
		}
		lf, err := s.loadLotFull(ctx, tx, lotID)
		if err != nil || lf == nil {
			return NotFound()
		}
		if !s.secondChanceOpen(lf) {
			return Conflict("invalid_transition", "The second-chance choice is not open for this lot.")
		}
		if len(lf.Bids) == 0 {
			return Conflict("invalid_transition", "The second-chance choice is not open for this lot.")
		}
		fields := map[string]string{}
		final := 0
		if lf.Price != nil {
			final = *lf.Price
		}
		if amount < 1 {
			fields["amount"] = "Enter a whole number of euros."
		} else if amount < final {
			fields["amount"] = "Offer at least " + fmtEuros(final) + ", the lot's final price."
		} else if amount > *lf.LeaderMax {
			fields["amount"] = "That is above what the top bidder offered."
		}
		if len(fields) > 0 {
			return Invalid(fields)
		}
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		offer = Offer{ID: ID(), LotID: lotID, ToPerson: *lf.LeaderPersonID, Kind: "second_chance", Amount: amount, ExpiresAt: now.Add(s.cfg.OfferWindow), Status: "open"}
		if err := tx.InsertOffer(ctx, offer); err != nil {
			return fmt.Errorf("saving the offer: %w", err)
		}
		if err := tx.SetLotState(ctx, lotID, "second_chance_offered"); err != nil {
			return fmt.Errorf("updating the lot: %w", err)
		}
		if err := tx.InsertDueEvent(ctx, "offer_expiry", nil, nil, nil, &offer.ID, offer.ExpiresAt); err != nil {
			return fmt.Errorf("scheduling the offer expiry: %w", err)
		}
		text := "Second chance: lot " + fmt.Sprint(*lf.LotNumber) + " can be yours for " + fmtEuros(amount) + " until " + Rotterdam(offer.ExpiresAt) + "."
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: *lf.LeaderPersonID, Kind: "second_chance", Text: text, LotID: &lotID}); err != nil {
			return fmt.Errorf("sending the offer notice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "offer", &lotID, lf.LeaderPersonID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "offer", &lotID, &viewer.ID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		return nil
	})
	return offer, err
}

// LeaveUnsold records the consignor's decision and closes the choice.
func (s *Store) LeaveUnsold(ctx context.Context, viewer Person, lotID string) (LotFull, error) {
	var lot LotFull
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		l, err := tx.GetLot(ctx, lotID)
		if err != nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		if l == nil || l.ConsignorID != viewer.ID {
			return NotFound()
		}
		lf, err := s.loadLotFull(ctx, tx, lotID)
		if err != nil || lf == nil {
			return NotFound()
		}
		if !s.secondChanceOpen(lf) {
			return Conflict("invalid_transition", "The second-chance choice is not open for this lot.")
		}
		if err := tx.MarkSecondChanceDone(ctx, lotID); err != nil {
			return fmt.Errorf("closing the choice: %w", err)
		}
		lf.SecondChanceDone = true
		lot = *lf
		if _, err := tx.AppendEvent(ctx, "offer", &lotID, &viewer.ID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		return nil
	})
	return lot, err
}

// closeLot carries out a lot's close and, for the last lot, the sale's close.
func (s *Store) closeLot(ctx context.Context, tx Tx, lot *LotFull, now time.Time) error {
	if lot.State != "open" && lot.State != "extended" {
		return nil
	}
	hammer := 0
	sold := false
	if lot.LeaderPersonID != nil && lot.LeaderMax != nil {
		reserve := 0
		if lot.Reserve != nil {
			reserve = *lot.Reserve
		}
		if *lot.LeaderMax >= reserve {
			sold = true
			if lot.Price != nil {
				hammer = *lot.Price
			}
		}
	}
	state := "closed_unsold"
	if sold {
		state = "closed_sold"
	}
	if err := tx.CloseLotRow(ctx, lot.ID, state, hammer, now); err != nil {
		return fmt.Errorf("closing the lot: %w", err)
	}
	lot.State = state
	lot.ClosedAt = &now
	lotNumber := 0
	if lot.LotNumber != nil {
		lotNumber = *lot.LotNumber
	}

	if sold {
		text := "You won lot " + fmt.Sprint(lotNumber) + " at " + fmtEuros(hammer) + "."
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: *lot.LeaderPersonID, Kind: "won", Text: text, LotID: &lot.ID}); err != nil {
			return fmt.Errorf("sending the won notice: %w", err)
		}
	} else if lot.LeaderPersonID != nil {
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: *lot.LeaderPersonID, Kind: "lot_closed", Text: "Lot " + fmt.Sprint(lotNumber) + " closed unsold.", LotID: &lot.ID}); err != nil {
			return fmt.Errorf("sending the close notice: %w", err)
		}
	}
	// Other bidders and watchers hear the result; the winner hears it once only.
	recipients := map[string]bool{}
	for _, b := range lot.Bids {
		if lot.LeaderPersonID == nil || b.BidderID != *lot.LeaderPersonID {
			recipients[b.BidderID] = true
		}
	}
	watchers, err := tx.Watchers(ctx, lot.ID)
	if err != nil {
		return fmt.Errorf("reading the watchers: %w", err)
	}
	for _, w := range watchers {
		if lot.LeaderPersonID == nil || w != *lot.LeaderPersonID {
			recipients[w] = true
		}
	}
	sentence := "Lot " + fmt.Sprint(lotNumber) + " closed unsold."
	if sold {
		sentence = "Lot " + fmt.Sprint(lotNumber) + " sold for " + fmtEuros(hammer) + "."
	}
	for personID := range recipients {
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: personID, Kind: "lot_closed", Text: sentence, LotID: &lot.ID}); err != nil {
			return fmt.Errorf("sending the close notice: %w", err)
		}
	}
	// The consignor hears the result and, when it opens, the second-chance choice.
	consignorText := "Your lot " + fmt.Sprint(lotNumber) + " closed unsold."
	if sold {
		consignorText = "Your lot " + fmt.Sprint(lotNumber) + " sold for " + fmtEuros(hammer) + "."
	} else if s.secondChanceOpen(lot) {
		consignorText = "Your lot " + fmt.Sprint(lotNumber) + " closed unsold. You can offer it to the top bidder."
	}
	if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: lot.ConsignorID, Kind: "lot_result", Text: consignorText, LotID: &lot.ID}); err != nil {
		return fmt.Errorf("sending the result notice: %w", err)
	}

	// Last lot of the sale: close the sale, invoice the winners, draft statements.
	if lot.SaleID != nil {
		remaining, err := tx.OpenSaleLotCount(ctx, *lot.SaleID, lot.ID)
		if err != nil {
			return fmt.Errorf("counting the sale's lots: %w", err)
		}
		if remaining == 0 {
			if err := s.closeSale(ctx, tx, *lot.SaleID, now); err != nil {
				return err
			}
		}
	}
	if _, err := tx.AppendEvent(ctx, "close", &lot.ID, nil); err != nil {
		return fmt.Errorf("recording the event: %w", err)
	}
	return nil
}

// closeSale runs when a sale's last lot closes.
func (s *Store) closeSale(ctx context.Context, tx Tx, saleID string, now time.Time) error {
	sale, err := tx.GetSale(ctx, saleID)
	if err != nil {
		return fmt.Errorf("reading the sale: %w", err)
	}
	if sale == nil || sale.State != "open" {
		return nil
	}
	lots, err := tx.SaleLots(ctx, saleID)
	if err != nil {
		return fmt.Errorf("reading the sale's lots: %w", err)
	}
	if err := tx.SetSaleState(ctx, saleID, "closed"); err != nil {
		return fmt.Errorf("closing the sale: %w", err)
	}
	// Group sold lots by winning bidder.
	winners := map[string][]Lot{}
	for _, l := range lots {
		if l.State != "closed_sold" || l.LeaderBidID == nil {
			continue
		}
		bid, err := tx.GetBid(ctx, *l.LeaderBidID)
		if err != nil {
			return fmt.Errorf("reading the winning bid: %w", err)
		}
		if bid == nil {
			continue
		}
		winners[bid.BidderID] = append(winners[bid.BidderID], l)
	}
	due := now.Add(s.cfg.PaymentDue)
	for bidderID, wonLots := range winners {
		paddle := 0
		if reg, err := tx.GetRegistrationByPerson(ctx, bidderID); err == nil && reg != nil && reg.Paddle != nil {
			paddle = *reg.Paddle
		}
		inv, err := tx.CreateInvoice(ctx, Invoice{ID: ID(), SaleID: &saleID, SaleTitle: sale.Title, Paddle: paddle, BidderID: bidderID, Status: "issued", IssuedAt: now, DueAt: due})
		if err != nil {
			return fmt.Errorf("creating the invoice: %w", err)
		}
		total := 0
		for i, l := range wonLots {
			line := InvoiceLine{LotID: l.ID, LotNumber: *l.LotNumber, Title: l.Title, Source: "hammer", Hammer: *l.Hammer * 100, Premium: PremiumCents(*l.Hammer), VAT: VatCents(PremiumCents(*l.Hammer))}
			if err := tx.AddInvoiceLine(ctx, inv.ID, i, line); err != nil {
				return fmt.Errorf("adding the invoice line: %w", err)
			}
			total += line.Hammer + line.Premium + line.VAT
			if err := tx.SetLotInvoiceState(ctx, l.ID, "invoiced"); err != nil {
				return fmt.Errorf("invoicing the lot: %w", err)
			}
		}
		text := "Invoice " + inv.Number + " for " + fmtEuroCents(total) + " is ready. Payment is due by " + Rotterdam(due) + "."
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: bidderID, Kind: "invoice_issued", Text: text}); err != nil {
			return fmt.Errorf("sending the invoice notice: %w", err)
		}
	}
	// Draft statements, one per consignor with lots in the sale.
	consignors := map[string]bool{}
	for _, l := range lots {
		consignors[l.ConsignorID] = true
	}
	for consignorID := range consignors {
		existing, err := tx.GetDraftStatement(ctx, saleID, consignorID)
		if err != nil {
			return fmt.Errorf("reading the draft statement: %w", err)
		}
		if existing != nil {
			continue
		}
		if _, err := tx.CreateDraftStatement(ctx, Statement{ID: ID(), SaleID: saleID, SaleTitle: sale.Title, ConsignorID: consignorID, Version: 1, Status: "draft"}); err != nil {
			return fmt.Errorf("creating the draft statement: %w", err)
		}
	}
	return nil
}

// LotsDueToClose returns open lots whose close moment has passed.
func (s *Store) LotsDueToClose(ctx context.Context) ([]string, error) {
	var ids []string
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		ids, err = tx.OpenLotsPastClose(ctx, now)
		if err != nil {
			return fmt.Errorf("finding due closes: %w", err)
		}
		return nil
	})
	return ids, err
}

// CloseOneLot closes a single lot, whoever reaches it first.
func (s *Store) CloseOneLot(ctx context.Context, lotID string) error {
	return s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		lot, err := tx.GetLot(ctx, lotID)
		if err != nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		if lot == nil || !lot.IsOpenish() {
			return nil
		}
		if lot.ClosesAt != nil && now.Before(*lot.ClosesAt) {
			return nil
		}
		lf, err := s.loadLotFull(ctx, tx, lotID)
		if err != nil || lf == nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		return s.closeLot(ctx, tx, lf, now)
	})
}

// RemoveBid removes one bid and recomputes at once, keeping any extension.
func (s *Store) RemoveBid(ctx context.Context, bidID, reason string) (LotFull, error) {
	var lot LotFull
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		bid, err := tx.GetBid(ctx, bidID)
		if err != nil {
			return fmt.Errorf("reading the bid: %w", err)
		}
		if bid == nil {
			return NotFound()
		}
		l, err := tx.GetLot(ctx, bid.LotID)
		if err != nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		if l == nil {
			return NotFound()
		}
		if !l.IsOpenish() {
			return Conflict("lot_closed", "This lot has closed.")
		}
		if l.ClosedAt != nil {
			return Conflict("already_removed", "That bid has already been removed.")
		}
		if bid.RemovedAt != nil {
			return Conflict("already_removed", "That bid has already been removed.")
		}
		if err := tx.RemoveBid(ctx, bidID, reason, now); err != nil {
			return fmt.Errorf("removing the bid: %w", err)
		}
		lf, err := s.loadLotFull(ctx, tx, bid.LotID)
		if err != nil || lf == nil {
			return fmt.Errorf("re-reading the lot: %w", err)
		}
		price, leader, met := recompute(lf)
		leaderBidID := ""
		if leader != nil {
			leaderBidID = leader.ID
		}
		if err := tx.ApplyBidResult(ctx, bid.LotID, price, leaderBidID, met, ""); err != nil {
			return fmt.Errorf("updating the lot: %w", err)
		}
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: bid.BidderID, Kind: "bid_removed", Text: "Your bid on lot " + fmt.Sprint(*lf.LotNumber) + " was removed by the saleroom.", LotID: &bid.LotID}); err != nil {
			return fmt.Errorf("sending the removal notice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "removal", &bid.LotID, nil); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		lot = *lf
		return nil
	})
	return lot, err
}

// AcceptOffer lets the top bidder or underbidder take an offered lot.
func (s *Store) AcceptOffer(ctx context.Context, viewer Person, offerID string) (Offer, Invoice, error) {
	var offer Offer
	var invoice Invoice
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		o, err := tx.GetOffer(ctx, offerID)
		if err != nil {
			return fmt.Errorf("reading the offer: %w", err)
		}
		if o == nil || o.ToPerson != viewer.ID {
			return NotFound()
		}
		if o.Status != "open" {
			return Conflict("offer_closed", "This offer has already been answered.")
		}
		if !now.Before(o.ExpiresAt) {
			if err := tx.AnswerOffer(ctx, offerID, "expired", now); err != nil {
				return fmt.Errorf("expiring the offer: %w", err)
			}
			if err := tx.SetLotState(ctx, o.LotID, "offer_lapsed"); err != nil {
				return fmt.Errorf("lapsing the lot: %w", err)
			}
			return Conflict("offer_expired", "This offer has expired.")
		}
		lot, err := tx.GetLot(ctx, o.LotID)
		if err != nil || lot == nil {
			return NotFound()
		}
		if err := tx.AnswerOffer(ctx, offerID, "accepted", now); err != nil {
			return fmt.Errorf("accepting the offer: %w", err)
		}
		if err := tx.SetLotHammer(ctx, o.LotID, o.Amount, "sold_by_offer"); err != nil {
			return fmt.Errorf("selling the lot by offer: %w", err)
		}
		source := "second_chance"
		if o.Kind == "default" {
			source = "default_offer"
		}
		reg, err := tx.GetRegistrationByPerson(ctx, viewer.ID)
		if err != nil {
			return fmt.Errorf("reading the registration: %w", err)
		}
		paddle := 0
		if reg != nil && reg.Paddle != nil {
			paddle = *reg.Paddle
		}
		line := InvoiceLine{LotID: o.LotID, LotNumber: *lot.LotNumber, Title: lot.Title, Source: source, Hammer: o.Amount * 100, Premium: PremiumCents(o.Amount), VAT: VatCents(PremiumCents(o.Amount))}
		due := now.Add(s.cfg.PaymentDue)
		inv, err := tx.CreateInvoice(ctx, Invoice{ID: ID(), SaleID: lot.SaleID, SaleTitle: s.invoiceSaleTitle(tx, lot), Paddle: paddle, BidderID: viewer.ID, Status: "issued", IssuedAt: now, DueAt: due, Lines: []InvoiceLine{line}})
		if err != nil {
			return fmt.Errorf("creating the invoice: %w", err)
		}
		total := line.Hammer + line.Premium + line.VAT
		text := "Lot " + fmt.Sprint(*lot.LotNumber) + " is yours for " + fmtEuros(o.Amount) + ". Invoice " + inv.Number + " is ready."
		_ = total
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: viewer.ID, Kind: "offer_accepted", Text: text, LotID: &o.LotID}); err != nil {
			return fmt.Errorf("sending the acceptance notice: %w", err)
		}
		consignorText := "Your lot " + fmt.Sprint(*lot.LotNumber) + " sold by offer for " + fmtEuros(o.Amount) + "."
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: lot.ConsignorID, Kind: "offer_accepted", Text: consignorText, LotID: &o.LotID}); err != nil {
			return fmt.Errorf("sending the sale notice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "offer", &o.LotID, &viewer.ID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "invoice", nil, &viewer.ID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		o.Status = "accepted"
		offer = *o
		invoice = inv
		return nil
	})
	return offer, invoice, err
}

func (s *Store) invoiceSaleTitle(tx Tx, lot *Lot) string {
	if lot.SaleID == nil {
		return ""
	}
	sale, err := tx.GetSale(context.Background(), *lot.SaleID)
	if err != nil || sale == nil {
		return ""
	}
	return sale.Title
}

// DeclineOffer lapses the lot and records the refusal.
func (s *Store) DeclineOffer(ctx context.Context, viewer Person, offerID string) (Offer, error) {
	var offer Offer
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		o, err := tx.GetOffer(ctx, offerID)
		if err != nil {
			return fmt.Errorf("reading the offer: %w", err)
		}
		if o == nil || o.ToPerson != viewer.ID {
			return NotFound()
		}
		if o.Status != "open" {
			return Conflict("offer_closed", "This offer has already been answered.")
		}
		if !now.Before(o.ExpiresAt) {
			if err := tx.AnswerOffer(ctx, offerID, "expired", now); err != nil {
				return fmt.Errorf("expiring the offer: %w", err)
			}
			if err := tx.SetLotState(ctx, o.LotID, "offer_lapsed"); err != nil {
				return fmt.Errorf("lapsing the lot: %w", err)
			}
			return Conflict("offer_expired", "This offer has expired.")
		}
		if err := tx.AnswerOffer(ctx, offerID, "declined", now); err != nil {
			return fmt.Errorf("declining the offer: %w", err)
		}
		if err := tx.SetLotState(ctx, o.LotID, "offer_lapsed"); err != nil {
			return fmt.Errorf("lapsing the lot: %w", err)
		}
		lot, err := tx.GetLot(ctx, o.LotID)
		if err != nil || lot == nil {
			return NotFound()
		}
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: lot.ConsignorID, Kind: "offer_lapsed", Text: "The offer on your lot " + fmt.Sprint(*lot.LotNumber) + " has lapsed.", LotID: &o.LotID}); err != nil {
			return fmt.Errorf("sending the lapse notice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "offer", &o.LotID, &viewer.ID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		o.Status = "declined"
		offer = *o
		return nil
	})
	return offer, err
}

// RecordPayment takes the cashier's payment against an invoice.
func (s *Store) RecordPayment(ctx context.Context, invoiceID string, amountCents int, method string) (Invoice, error) {
	var out Invoice
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		inv, err := tx.GetInvoice(ctx, invoiceID)
		if err != nil {
			return fmt.Errorf("reading the invoice: %w", err)
		}
		if inv == nil {
			return NotFound()
		}
		if inv.Status == "defaulted" {
			return Conflict("invoice_defaulted", "Invoice "+inv.Number+" has defaulted and can no longer be paid.")
		}
		if inv.Status == "paid" {
			return Conflict("invoice_paid", "Invoice "+inv.Number+" is already paid.")
		}
		if !now.Before(inv.DueAt) {
			if err := s.defaultInvoice(ctx, tx, *inv, now); err != nil {
				return err
			}
			return Conflict("invoice_defaulted", "Invoice "+inv.Number+" has defaulted and can no longer be paid.")
		}
		if amountCents <= 0 {
			return Invalid(map[string]string{"amount": "Enter an amount in euros and cents, for example 125.50."})
		}
		if amountCents > inv.Outstanding() {
			return Invalid(map[string]string{"amount": "That is more than the " + fmtEuroCents(inv.Outstanding()) + " still owed."})
		}
		if err := tx.AddPayment(ctx, invoiceID, Payment{Amount: amountCents, Method: method, RecordedAt: now}); err != nil {
			return fmt.Errorf("saving the payment: %w", err)
		}
		inv.Paid += amountCents
		if inv.Outstanding() == 0 {
			if err := tx.MarkInvoicePaid(ctx, invoiceID); err != nil {
				return fmt.Errorf("paying the invoice: %w", err)
			}
			inv.Status = "paid"
			for _, l := range inv.Lines {
				if err := tx.SetLotInvoiceState(ctx, l.LotID, "paid"); err != nil {
					return fmt.Errorf("paying the lot: %w", err)
				}
			}
		}
		fresh, err := tx.GetInvoice(ctx, invoiceID)
		if err != nil || fresh == nil {
			return fmt.Errorf("re-reading the invoice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "payment", nil, nil); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		out = *fresh
		return nil
	})
	return out, err
}

// defaultInvoice marks an unpaid invoice defaulted and offers its hammer lots on.
func (s *Store) defaultInvoice(ctx context.Context, tx Tx, inv Invoice, now time.Time) error {
	if inv.Status != "issued" {
		return nil
	}
	if err := tx.MarkInvoiceDefaulted(ctx, inv.ID); err != nil {
		return fmt.Errorf("defaulting the invoice: %w", err)
	}
	inv.Status = "defaulted"
	text := "Invoice " + inv.Number + " was not paid in time and has defaulted."
	if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: inv.BidderID, Kind: "invoice_defaulted", Text: text}); err != nil {
		return fmt.Errorf("sending the default notice: %w", err)
	}
	for _, l := range inv.Lines {
		if l.Source != "hammer" {
			continue
		}
		if err := tx.SetLotInvoiceState(ctx, l.LotID, "defaulted"); err != nil {
			return fmt.Errorf("defaulting the lot: %w", err)
		}
		lot, err := tx.GetLot(ctx, l.LotID)
		if err != nil || lot == nil {
			return fmt.Errorf("reading the lot: %w", err)
		}
		lf, err := s.loadLotFull(ctx, tx, l.LotID)
		if err != nil || lf == nil {
			return fmt.Errorf("reading the lot's bids: %w", err)
		}
		under, err := s.underbidderOf(lf, *lot.LeaderPersonID)
		if err != nil {
			return fmt.Errorf("finding the underbidder: %w", err)
		}
		if under == nil {
			continue
		}
		offer := Offer{ID: ID(), LotID: l.LotID, ToPerson: under.BidderID, Kind: "default", Amount: under.MaxAmount, ExpiresAt: now.Add(s.cfg.OfferWindow), Status: "open"}
		if err := tx.InsertOffer(ctx, offer); err != nil {
			return fmt.Errorf("saving the offer: %w", err)
		}
		if err := tx.SetLotState(ctx, l.LotID, "underbidder_offered"); err != nil {
			return fmt.Errorf("offering the lot on: %w", err)
		}
		text := "Lot " + fmt.Sprint(*lot.LotNumber) + " is offered to you for " + fmtEuros(under.MaxAmount) + " until " + Rotterdam(offer.ExpiresAt) + "."
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: under.BidderID, Kind: "default_offer", Text: text, LotID: &l.LotID}); err != nil {
			return fmt.Errorf("sending the offer notice: %w", err)
		}
	}
	if _, err := tx.AppendEvent(ctx, "default", nil, &inv.BidderID); err != nil {
		return fmt.Errorf("recording the event: %w", err)
	}
	return nil
}

// underbidderOf finds the highest non-winning bidder, earlier bid winning ties.
func (s *Store) underbidderOf(lot *LotFull, winnerID string) (*Bid, error) {
	var best *Bid
	for i := range lot.Bids {
		b := &lot.Bids[i]
		if b.BidderID == winnerID {
			continue
		}
		if best == nil || b.MaxAmount > best.MaxAmount {
			best = b
		}
	}
	return best, nil
}

// IssueStatement locks a draft statement.
func (s *Store) IssueStatement(ctx context.Context, statementID string) (Statement, []StatementLine, error) {
	var st Statement
	var lines []StatementLine
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		s0, err := tx.GetStatement(ctx, statementID)
		if err != nil {
			return fmt.Errorf("reading the statement: %w", err)
		}
		if s0 == nil {
			return NotFound()
		}
		if s0.Status == "issued" || s0.Status == "superseded" {
			return Conflict("statement_locked", "Statement "+s0.Number+" is issued and locked.")
		}
		number, err := tx.NextStatementNumber(ctx)
		if err != nil {
			return fmt.Errorf("numbering the statement: %w", err)
		}
		lines, err = s.statementLines(ctx, tx, *s0)
		if err != nil {
			return err
		}
		if err := tx.IssueStatement(ctx, statementID, number, lines, now); err != nil {
			return fmt.Errorf("issuing the statement: %w", err)
		}
		s0.Number = number
		s0.Status = "issued"
		s0.IssuedAt = &now
		text := "Your statement " + s0.Number + " is ready."
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: s0.ConsignorID, Kind: "statement_issued", Text: text}); err != nil {
			return fmt.Errorf("sending the statement notice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "statement", nil, &s0.ConsignorID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		st = *s0
		return nil
	})
	return st, lines, err
}

// CorrectStatement issues a new statement that supersedes the old one.
func (s *Store) CorrectStatement(ctx context.Context, statementID, note string) (Statement, []StatementLine, Statement, error) {
	var st, old Statement
	var lines []StatementLine
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		s0, err := tx.GetStatement(ctx, statementID)
		if err != nil {
			return fmt.Errorf("reading the statement: %w", err)
		}
		if s0 == nil {
			return NotFound()
		}
		if s0.Status != "issued" {
			return Conflict("invalid_transition", "Only an issued statement can be corrected.")
		}
		if len(note) < 1 || len(note) > 300 {
			return Invalid(map[string]string{"note": "Enter a note of up to 300 characters."})
		}
		number, err := tx.NextStatementNumber(ctx)
		if err != nil {
			return fmt.Errorf("numbering the statement: %w", err)
		}
		newSt := Statement{ID: ID(), Number: number, SaleID: s0.SaleID, SaleTitle: s0.SaleTitle, ConsignorID: s0.ConsignorID, Version: s0.Version + 1, Status: "issued", IssuedAt: &now, Supersedes: &s0.ID}
		lines, err = s.statementLines(ctx, tx, newSt)
		if err != nil {
			return err
		}
		if err := tx.CreateIssuedStatement(ctx, newSt, lines); err != nil {
			return fmt.Errorf("creating the corrected statement: %w", err)
		}
		if err := tx.SupersedeStatement(ctx, s0.ID, newSt.ID); err != nil {
			return fmt.Errorf("superseding the statement: %w", err)
		}
		text := "Your statement " + newSt.Number + " is ready."
		if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: s0.ConsignorID, Kind: "statement_issued", Text: text}); err != nil {
			return fmt.Errorf("sending the statement notice: %w", err)
		}
		if _, err := tx.AppendEvent(ctx, "statement", nil, &s0.ConsignorID); err != nil {
			return fmt.Errorf("recording the event: %w", err)
		}
		s0.Status = "superseded"
		s0.SupersededBy = &newSt.ID
		old = *s0
		st = newSt
		return nil
	})
	return st, lines, old, err
}

// statementLines works out a statement from the current results.
func (s *Store) statementLines(ctx context.Context, tx Tx, st Statement) ([]StatementLine, error) {
	lots, err := tx.SaleLots(ctx, st.SaleID)
	if err != nil {
		return nil, fmt.Errorf("reading the sale's lots: %w", err)
	}
	var lines []StatementLine
	for _, l := range lots {
		if l.ConsignorID != st.ConsignorID {
			continue
		}
		line := StatementLine{LotID: l.ID, LotNumber: *l.LotNumber, Title: l.Title, Result: "unsold"}
		switch {
		case l.State == "invoiced" || l.State == "paid":
			h := *l.Hammer * 100
			c := CommissionCents(*l.Hammer)
			n := h - c
			line.Result = "sold"
			line.Hammer = &h
			line.Commission = &c
			line.Net = &n
		case l.State == "sold_by_offer":
			h := *l.Hammer * 100
			c := CommissionCents(*l.Hammer)
			n := h - c
			line.Result = "sold"
			line.Hammer = &h
			line.Commission = &c
			line.Net = &n
		case l.State == "defaulted":
			line.Result = "unsold"
		}
		lines = append(lines, line)
	}
	return lines, nil
}

// InvoiceDueNow defaults every unpaid invoice whose due time has passed.
func (s *Store) InvoiceDueNow(ctx context.Context) ([]string, error) {
	var ids []string
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		ids, err = tx.InvoicesDue(ctx, now)
		if err != nil {
			return fmt.Errorf("finding due invoices: %w", err)
		}
		for _, id := range ids {
			inv, err := tx.GetInvoice(ctx, id)
			if err != nil || inv == nil {
				return fmt.Errorf("reading the invoice: %w", err)
			}
			if err := s.defaultInvoice(ctx, tx, *inv, now); err != nil {
				return err
			}
		}
		return nil
	})
	return ids, err
}

// ExpireOffers lapses every offer whose window has passed.
func (s *Store) ExpireOffers(ctx context.Context) ([]string, error) {
	var ids []string
	err := s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		offers, err := tx.OpenOffersPastExpiry(ctx, now)
		if err != nil {
			return fmt.Errorf("finding due offers: %w", err)
		}
		for _, id := range offers {
			o, err := tx.GetOffer(ctx, id)
			if err != nil || o == nil {
				return fmt.Errorf("reading the offer: %w", err)
			}
			if err := tx.AnswerOffer(ctx, id, "expired", now); err != nil {
				return fmt.Errorf("expiring the offer: %w", err)
			}
			if err := tx.SetLotState(ctx, o.LotID, "offer_lapsed"); err != nil {
				return fmt.Errorf("lapsing the lot: %w", err)
			}
			lot, err := tx.GetLot(ctx, o.LotID)
			if err != nil || lot == nil {
				return fmt.Errorf("reading the lot: %w", err)
			}
			if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: lot.ConsignorID, Kind: "offer_lapsed", Text: "The offer on your lot " + fmt.Sprint(*lot.LotNumber) + " has lapsed.", LotID: &o.LotID}); err != nil {
				return fmt.Errorf("sending the lapse notice: %w", err)
			}
			if _, err := tx.AppendEvent(ctx, "offer", &o.LotID, nil); err != nil {
				return fmt.Errorf("recording the event: %w", err)
			}
			ids = append(ids, id)
		}
		return nil
	})
	return ids, err
}

// ClosingNoticesDue sends the closing-soon notices that are now due.
func (s *Store) ClosingNoticesDue(ctx context.Context) error {
	return s.db.WithTx(ctx, func(ctx context.Context, tx Tx) error {
		now, err := tx.Now(ctx)
		if err != nil {
			return fmt.Errorf("reading the clock: %w", err)
		}
		rows, err := tx.ClosingNoticesDue(ctx, now)
		if err != nil {
			return fmt.Errorf("finding due closing notices: %w", err)
		}
		for _, r := range rows {
			if r.LotID == nil || r.PersonID == nil {
				if err := tx.MarkClosingNoticeDone(ctx, r.ID); err != nil {
					return fmt.Errorf("closing the due event: %w", err)
				}
				continue
			}
			lotID, personID := *r.LotID, *r.PersonID
			sent, err := tx.ClosingNoticeSent(ctx, lotID, personID)
			if err != nil {
				return fmt.Errorf("checking the closing notice: %w", err)
			}
			if sent {
				if err := tx.MarkClosingNoticeDone(ctx, r.ID); err != nil {
					return fmt.Errorf("closing the due event: %w", err)
				}
				continue
			}
			lot, err := tx.GetLot(ctx, lotID)
			if err != nil || lot == nil {
				return fmt.Errorf("reading the lot: %w", err)
			}
			if !lot.IsOpenish() {
				if err := tx.MarkClosingNoticeDone(ctx, r.ID); err != nil {
					return fmt.Errorf("closing the due event: %w", err)
				}
				continue
			}
			text := "Lot " + fmt.Sprint(*lot.LotNumber) + " closes soon, at " + Rotterdam(*lot.ClosesAt) + "."
			if _, err := tx.InsertNotice(ctx, Notice{ID: ID(), PersonID: personID, Kind: "closing_soon", Text: text, LotID: &lotID}); err != nil {
				return fmt.Errorf("sending the closing notice: %w", err)
			}
			if err := tx.MarkClosingNoticeSent(ctx, lotID, personID); err != nil {
				return fmt.Errorf("marking the closing notice: %w", err)
			}
			if err := tx.MarkClosingNoticeDone(ctx, r.ID); err != nil {
				return fmt.Errorf("closing the due event: %w", err)
			}
		}
		return nil
	})
}

func trimAll(s string) string { return strings.TrimSpace(s) }
