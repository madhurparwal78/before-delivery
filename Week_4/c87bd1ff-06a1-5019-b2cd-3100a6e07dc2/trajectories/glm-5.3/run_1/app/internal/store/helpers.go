package store

import (
	"context"
	"time"
)

// Refresh recomputes the price, leader and reserve-met from the remaining bids.
func (l *LotFull) Refresh() {
	if len(l.Bids) == 0 {
		l.Price = nil
		l.LeaderBidID = nil
		l.LeaderPersonID = nil
		l.LeaderPaddle = nil
		l.LeaderMax = nil
		l.ReserveMet = false
		return
	}
	p, lead, met := recompute(l)
	l.Price = &p
	if lead != nil {
		l.LeaderBidID = &lead.ID
		l.LeaderPersonID = &lead.BidderID
		l.LeaderMax = &lead.MaxAmount
		l.LeaderPaddle = &lead.Paddle
	} else {
		l.LeaderBidID = nil
		l.LeaderPersonID = nil
		l.LeaderPaddle = nil
		l.LeaderMax = nil
	}
	l.ReserveMet = met
}

// ConsignedLotView gives the consignor's projection of their own lot.
func (s *Store) ConsignedLotView(lot LotFull, offer *Offer, now time.Time) map[string]any {
	return s.consignorLotView(&lot, offer, now)
}

// StaffLotView gives the staff projection of a lot.
func (s *Store) StaffLotView(lot LotFull, offer *Offer, now time.Time) map[string]any {
	return s.staffLotView(&lot, offer, now)
}

// ConsignorHistory gives the anonymous bid rows for a consignor.
func (s *Store) ConsignorHistory(lot LotFull) []map[string]any {
	return historyView(lot.Bids, "consignor")
}

// AdminHistory gives the admin's bid rows.
func (s *Store) AdminHistory(lot LotFull) []map[string]any {
	return historyView(lot.Bids, "admin")
}

// CloseDueLots closes every open lot whose moment has passed, in this transaction.
func (s *Store) CloseDueLots(ctx context.Context, tx Tx) error {
	return s.closeDueLots(ctx, tx)
}

// CodedErr builds one API error with a code.
func CodedErr(status int, code, message string) error {
	return coded(status, code, message, nil)
}

// StatementLinesFor works out a draft statement's lines from current results.
func (s *Store) StatementLinesFor(ctx context.Context, tx Tx, st Statement) ([]StatementLine, error) {
	return s.statementLines(ctx, tx, st)
}

// LotAccess decides whether a viewer may know a lot exists. It is the one
// place this rule is decided, used by reads and the live feed alike.
func LotAccess(viewer Person, lot *Lot) bool {
	return lotAccess(viewer, lot)
}

// PublicLotView gives the anonymous projection of a lot.
func (s *Store) PublicLotView(lot LotFull, now time.Time) map[string]any {
	return s.publicLotView(&lot, now)
}

// PublicHistory gives the anonymous bid rows.
func (s *Store) PublicHistory(lot LotFull) []map[string]any {
	return historyView(lot.Bids, "public")
}

// HistoryFor gives the bid rows for the viewer's audience.
func (s *Store) HistoryFor(lot LotFull, viewer Person, owned *Lot) []map[string]any {
	switch {
	case isStaff(viewer.Roles):
		return historyView(lot.Bids, "admin")
	case owned != nil && owned.ConsignorID == viewer.ID:
		return historyView(lot.Bids, "consignor")
	default:
		return historyView(lot.Bids, "public")
	}
}

// ViewerLotView picks the projection for the viewer's role, inside a transaction.
func (s *Store) ViewerLotView(ctx context.Context, tx Tx, viewer Person, lot *LotFull, offer *Offer, now time.Time) (map[string]any, error) {
	return s.viewerLotView(ctx, tx, viewer, lot, offer, now)
}

// KeycloakHealthy reports whether sign-in can start right now.
func (s *Store) SetKeycloakCheck(check func() bool) { s.keycloakHealthy = check }

// KeycloakHealthy reports whether Keycloak answers.
func (s *Store) KeycloakHealthy() bool {
	if s.keycloakHealthy == nil {
		return true
	}
	return s.keycloakHealthy()
}

// AddRealmRole gives the person the realm role in Keycloak.
func (s *Store) SetRealmRoleAdder(fn func(sub, role string) error) { s.addRealmRole = fn }

// AddRealmRole gives the person the realm role through Keycloak.
func (s *Store) AddRealmRole(ctx context.Context, sub, role string) error {
	if s.addRealmRole == nil {
		return nil
	}
	return s.addRealmRole(sub, role)
}
