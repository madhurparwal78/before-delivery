package saleroom

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// addNotice writes one in-app notice for one recipient and records it on the
// change feed, so the recipient's open pages hear it at once.
func addNotice(ctx context.Context, tx pgx.Tx, personID, kind, body, lotID string, at time.Time) error {
	id := newID()
	_, err := tx.Exec(ctx,
		`INSERT INTO notices (id, person_id, kind, body, lot_id, created_at)
		 VALUES ($1,$2,$3,$4,nullif($5,''),$6)`, id, personID, kind, body, lotID, at)
	if err != nil {
		return fmt.Errorf("write %s notice: %w", kind, err)
	}
	return record(ctx, tx, Event{Type: EventNotice, PersonID: personID, NoticeID: id, LotID: lotID})
}

// settle carries out every timed event whose due moment has passed: lot
// closes and their invoices and statements, offer expiries, invoice defaults
// and the watchers' closing-soon notices. It runs inside the caller's
// transaction, so a request that reads a lot past its close sees the close.
func (s *Saleroom) settle(ctx context.Context, tx pgx.Tx, serverNow time.Time) error {
	due, err := s.anythingDue(ctx, tx, serverNow)
	if err != nil || !due {
		return err
	}
	if err := s.closeDueLots(ctx, tx, serverNow); err != nil {
		return err
	}
	if err := s.expireDueOffers(ctx, tx, serverNow); err != nil {
		return err
	}
	if err := s.defaultDueInvoices(ctx, tx, serverNow); err != nil {
		return err
	}
	return s.sendClosingSoonNotices(ctx, tx, serverNow)
}

func (s *Saleroom) anythingDue(ctx context.Context, tx pgx.Tx, serverNow time.Time) (bool, error) {
	var due bool
	err := tx.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM lots
		          WHERE state IN ('open','extended') AND closes_at <= $1)
		     OR EXISTS(SELECT 1 FROM offers WHERE status = 'open' AND expires_at <= $1)
		     OR EXISTS(SELECT 1 FROM invoices WHERE status = 'issued' AND due_at <= $1)
		     OR EXISTS(SELECT 1 FROM watches w JOIN lots l ON l.id = w.lot_id
		          WHERE NOT w.closing_notice_sent AND l.state IN ('open','extended')
		            AND l.closes_at - make_interval(secs => $2) <= $1)`,
		serverNow, s.cfg.WatchNoticeSeconds).Scan(&due)
	if err != nil {
		return false, fmt.Errorf("check for due timed events: %w", err)
	}
	return due, nil
}

func (s *Saleroom) closeDueLots(ctx context.Context, tx pgx.Tx, serverNow time.Time) error {
	rows, err := tx.Query(ctx,
		`SELECT id FROM lots WHERE state IN ('open','extended') AND closes_at <= $1
		  ORDER BY closes_at, lot_number FOR UPDATE`, serverNow)
	if err != nil {
		return fmt.Errorf("claim lots due to close: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan lot due to close: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	touchedSales := map[string]bool{}
	for _, id := range ids {
		saleID, closed, err := s.closeLot(ctx, tx, id, serverNow)
		if err != nil {
			return err
		}
		if closed && saleID != "" {
			touchedSales[saleID] = true
		}
	}
	for saleID := range touchedSales {
		if err := s.closeSaleIfDone(ctx, tx, saleID, serverNow); err != nil {
			return err
		}
	}
	return nil
}

// closeLot decides sold or unsold from the remaining bids and the reserve,
// writes the result and tells everyone involved. It is carried out exactly
// once, whether a request or the timed pass reaches the lot first.
func (s *Saleroom) closeLot(ctx context.Context, tx pgx.Tx, lotID string, serverNow time.Time) (string, bool, error) {
	l, err := loadLot(ctx, tx, lotID)
	if err != nil {
		return "", false, err
	}
	if !domain.IsLive(l.State) {
		return "", false, nil
	}
	bids, err := loadBids(ctx, tx, lotID)
	if err != nil {
		return "", false, err
	}
	st := standing(l, bids)
	sold := st.HasLeader && st.LeaderMax >= intOr(l.Reserve, 0)

	state := domain.LotClosedUnsold
	var hammer any
	if sold {
		state = domain.LotClosedSold
		hammer = st.Price
	}
	_, err = tx.Exec(ctx,
		`UPDATE lots SET state = $2, sold_at_hammer = $3, hammer = $4, closed_at = $5 WHERE id = $1`,
		lotID, state, sold, hammer, serverNow)
	if err != nil {
		return "", false, fmt.Errorf("close lot %s: %w", lotID, err)
	}
	if _, err := tx.Exec(ctx,
		`UPDATE watches SET closing_notice_sent = true WHERE lot_id = $1`, lotID); err != nil {
		return "", false, fmt.Errorf("retire closing-soon notices for lot %s: %w", lotID, err)
	}

	lotNumber := intOr(l.LotNumber, 0)
	winner := ""
	if sold {
		winner = st.LeaderID
		body := domain.NoticeWonText(lotNumber, st.Price)
		if err := addNotice(ctx, tx, winner, domain.NoticeWon, body, lotID, serverNow); err != nil {
			return "", false, err
		}
	}
	recipients, err := otherBiddersAndWatchers(ctx, tx, lotID, winner)
	if err != nil {
		return "", false, err
	}
	closedBody := domain.NoticeLotClosedText(lotNumber, sold, st.Price)
	for _, personID := range recipients {
		if err := addNotice(ctx, tx, personID, domain.NoticeLotClosed, closedBody, lotID, serverNow); err != nil {
			return "", false, err
		}
	}
	secondChance := !sold && st.BidCount > 0
	resultBody := domain.NoticeLotResultText(lotNumber, sold, st.Price, secondChance)
	if err := addNotice(ctx, tx, l.ConsignorID, domain.NoticeLotResult, resultBody, lotID, serverNow); err != nil {
		return "", false, err
	}
	if err := recordLotChange(ctx, tx, CauseClose, lotID); err != nil {
		return "", false, err
	}
	return strOr(l.SaleID, ""), true, nil
}

func otherBiddersAndWatchers(ctx context.Context, tx pgx.Tx, lotID, winnerID string) ([]string, error) {
	rows, err := tx.Query(ctx,
		`SELECT DISTINCT person_id FROM (
		     SELECT bidder_id AS person_id FROM bids WHERE lot_id = $1 AND removed_at IS NULL
		     UNION
		     SELECT person_id FROM watches WHERE lot_id = $1
		 ) involved WHERE person_id <> $2 ORDER BY person_id`, lotID, winnerID)
	if err != nil {
		return nil, fmt.Errorf("list people involved in lot %s: %w", lotID, err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan involved person: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// closeSaleIfDone closes the sale once its last lot has closed, which issues
// one invoice per winning bidder and one draft statement per consignor.
func (s *Saleroom) closeSaleIfDone(ctx context.Context, tx pgx.Tx, saleID string, serverNow time.Time) error {
	var state string
	var open int
	err := tx.QueryRow(ctx,
		`SELECT s.state, (SELECT count(*) FROM lots
		      WHERE sale_id = s.id AND state IN ('open','extended'))
		   FROM sales s WHERE s.id = $1 FOR UPDATE`, saleID).Scan(&state, &open)
	if err != nil {
		return fmt.Errorf("read sale %s for close: %w", saleID, err)
	}
	if state != domain.SaleOpen || open > 0 {
		return nil
	}
	_, err = tx.Exec(ctx,
		`UPDATE sales SET state = $2, closed_at = $3, last_close_at = $3 WHERE id = $1`,
		saleID, domain.SaleClosed, serverNow)
	if err != nil {
		return fmt.Errorf("close sale %s: %w", saleID, err)
	}
	dueAt := serverNow.Add(s.cfg.PaymentDue)

	buyers, err := s.hammerWinners(ctx, tx, saleID)
	if err != nil {
		return err
	}
	for _, buyer := range buyers {
		var lines []invoiceLine
		for _, lot := range buyer.lots {
			lines = append(lines, lineFor(lot.id, lot.number, lot.title, domain.SourceHammer, lot.hammer))
			if _, err := tx.Exec(ctx, `UPDATE lots SET state = $2 WHERE id = $1`,
				lot.id, domain.LotInvoiced); err != nil {
				return fmt.Errorf("invoice lot %s: %w", lot.id, err)
			}
		}
		if _, _, _, err := issueInvoice(ctx, tx, saleID, buyer.personID, lines, serverNow, dueAt); err != nil {
			return err
		}
		for _, lot := range buyer.lots {
			if err := recordLotChange(ctx, tx, CauseClose, lot.id); err != nil {
				return err
			}
		}
	}

	consignors, err := tx.Query(ctx,
		`SELECT DISTINCT consignor_id FROM lots WHERE sale_id = $1 ORDER BY consignor_id`, saleID)
	if err != nil {
		return fmt.Errorf("list sale consignors: %w", err)
	}
	var consignorIDs []string
	for consignors.Next() {
		var id string
		if err := consignors.Scan(&id); err != nil {
			consignors.Close()
			return fmt.Errorf("scan consignor: %w", err)
		}
		consignorIDs = append(consignorIDs, id)
	}
	consignors.Close()
	for _, id := range consignorIDs {
		if _, _, err := createDraftStatement(ctx, tx, saleID, id, 1, ""); err != nil {
			return err
		}
	}
	return nil
}

type wonLot struct {
	id     string
	number int
	title  string
	hammer int
}

type hammerBuyer struct {
	personID string
	lots     []wonLot
}

// hammerWinners groups the sale's hammered lots by the bidder who led at the
// close, so each winning bidder gets exactly one invoice.
func (s *Saleroom) hammerWinners(ctx context.Context, tx pgx.Tx, saleID string) ([]hammerBuyer, error) {
	lots, err := loadLots(ctx, tx,
		`WHERE l.sale_id = $1 AND l.state = 'closed_sold' ORDER BY l.lot_number`, saleID)
	if err != nil {
		return nil, err
	}
	order := []string{}
	byPerson := map[string][]wonLot{}
	for _, l := range lots {
		bids, err := loadBids(ctx, tx, l.ID)
		if err != nil {
			return nil, err
		}
		st := standing(l, bids)
		if !st.HasLeader {
			continue
		}
		if _, ok := byPerson[st.LeaderID]; !ok {
			order = append(order, st.LeaderID)
		}
		byPerson[st.LeaderID] = append(byPerson[st.LeaderID], wonLot{
			id: l.ID, number: intOr(l.LotNumber, 0), title: l.Title, hammer: intOr(l.Hammer, st.Price),
		})
	}
	out := make([]hammerBuyer, 0, len(order))
	for _, id := range order {
		out = append(out, hammerBuyer{personID: id, lots: byPerson[id]})
	}
	return out, nil
}

func (s *Saleroom) expireDueOffers(ctx context.Context, tx pgx.Tx, serverNow time.Time) error {
	rows, err := tx.Query(ctx,
		`SELECT id, lot_id FROM offers WHERE status = 'open' AND expires_at <= $1
		  ORDER BY expires_at FOR UPDATE`, serverNow)
	if err != nil {
		return fmt.Errorf("claim offers due to expire: %w", err)
	}
	type expiring struct{ offerID, lotID string }
	var due []expiring
	for rows.Next() {
		var e expiring
		if err := rows.Scan(&e.offerID, &e.lotID); err != nil {
			rows.Close()
			return fmt.Errorf("scan expiring offer: %w", err)
		}
		due = append(due, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, e := range due {
		if _, err := tx.Exec(ctx,
			`UPDATE offers SET status = $2, answered_at = $3 WHERE id = $1`,
			e.offerID, domain.OfferExpired, serverNow); err != nil {
			return fmt.Errorf("expire offer %s: %w", e.offerID, err)
		}
		if err := lapseLot(ctx, tx, e.lotID, serverNow); err != nil {
			return err
		}
	}
	return nil
}

// lapseLot records that a lot's offer came to nothing.
func lapseLot(ctx context.Context, tx pgx.Tx, lotID string, serverNow time.Time) error {
	l, err := loadLot(ctx, tx, lotID)
	if err != nil {
		return err
	}
	if l.State != domain.LotSecondChanceOffer && l.State != domain.LotUnderbidderOffered {
		return nil
	}
	if _, err := tx.Exec(ctx, `UPDATE lots SET state = $2 WHERE id = $1`,
		lotID, domain.LotOfferLapsed); err != nil {
		return fmt.Errorf("lapse lot %s: %w", lotID, err)
	}
	body := domain.NoticeOfferLapsedText(intOr(l.LotNumber, 0))
	if err := addNotice(ctx, tx, l.ConsignorID, domain.NoticeOfferLapsed, body, lotID, serverNow); err != nil {
		return err
	}
	return recordLotChange(ctx, tx, CauseOffer, lotID)
}

func (s *Saleroom) defaultDueInvoices(ctx context.Context, tx pgx.Tx, serverNow time.Time) error {
	rows, err := tx.Query(ctx,
		`SELECT id FROM invoices WHERE status = 'issued' AND due_at <= $1
		  ORDER BY due_at FOR UPDATE`, serverNow)
	if err != nil {
		return fmt.Errorf("claim invoices due to default: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("scan defaulting invoice: %w", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		if err := s.defaultInvoice(ctx, tx, id, serverNow); err != nil {
			return err
		}
	}
	return nil
}

// defaultInvoice marks an unpaid invoice defaulted at its due time and offers
// each of its hammer lots to that lot's underbidder.
func (s *Saleroom) defaultInvoice(ctx context.Context, tx pgx.Tx, invoiceID string, serverNow time.Time) error {
	invoices, err := loadInvoices(ctx, tx, `WHERE i.id = $1`, invoiceID)
	if err != nil {
		return err
	}
	inv := invoices[0]
	if inv.Status != domain.InvoiceIssued {
		return nil
	}
	if _, err := tx.Exec(ctx,
		`UPDATE invoices SET status = $2, defaulted_at = $3 WHERE id = $1`,
		invoiceID, domain.InvoiceDefaulted, serverNow); err != nil {
		return fmt.Errorf("default invoice %s: %w", inv.Number, err)
	}
	body := domain.NoticeInvoiceDefaultedText(inv.Number)
	if err := addNotice(ctx, tx, inv.PersonID, domain.NoticeInvoiceDefaulted, body, "", serverNow); err != nil {
		return err
	}
	for _, ln := range inv.Lines {
		if _, err := tx.Exec(ctx, `UPDATE lots SET state = $2 WHERE id = $1`,
			ln.LotID, domain.LotDefaulted); err != nil {
			return fmt.Errorf("default lot %s: %w", ln.LotID, err)
		}
		if err := recordLotChange(ctx, tx, CauseOffer, ln.LotID); err != nil {
			return err
		}
		if ln.Source != domain.SourceHammer {
			continue
		}
		if err := s.offerToUnderbidder(ctx, tx, ln.LotID, inv.PersonID, serverNow); err != nil {
			return err
		}
	}
	return nil
}

func (s *Saleroom) offerToUnderbidder(ctx context.Context, tx pgx.Tx, lotID, winnerID string,
	serverNow time.Time) error {
	l, err := loadLot(ctx, tx, lotID)
	if err != nil {
		return err
	}
	bids, err := loadBids(ctx, tx, lotID)
	if err != nil {
		return err
	}
	under, ok := domain.Underbidder(winnerID, bidsOf(bids))
	if !ok {
		return nil
	}
	expiresAt := serverNow.Add(s.cfg.OfferWindow)
	if err := insertOffer(ctx, tx, lotID, under.BidderID, domain.OfferDefault,
		under.MaxEuros, expiresAt, serverNow); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE lots SET state = $2 WHERE id = $1`,
		lotID, domain.LotUnderbidderOffered); err != nil {
		return fmt.Errorf("offer lot %s to the underbidder: %w", lotID, err)
	}
	lotNumber := intOr(l.LotNumber, 0)
	body := domain.NoticeDefaultOfferText(lotNumber, under.MaxEuros, expiresAt)
	if err := addNotice(ctx, tx, under.BidderID, domain.NoticeDefaultOffer, body, lotID, serverNow); err != nil {
		return err
	}
	return recordLotChange(ctx, tx, CauseOffer, lotID)
}

func insertOffer(ctx context.Context, tx pgx.Tx, lotID, personID, kind string, amount int,
	expiresAt, createdAt time.Time) error {
	_, err := tx.Exec(ctx,
		`INSERT INTO offers (id, lot_id, person_id, kind, amount, expires_at, status, created_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		newID(), lotID, personID, kind, amount, expiresAt, domain.OfferOpen, createdAt)
	if err != nil {
		return fmt.Errorf("insert %s offer on lot %s: %w", kind, lotID, err)
	}
	return nil
}

func (s *Saleroom) sendClosingSoonNotices(ctx context.Context, tx pgx.Tx, serverNow time.Time) error {
	rows, err := tx.Query(ctx,
		`SELECT w.lot_id, w.person_id, l.lot_number, l.closes_at
		   FROM watches w JOIN lots l ON l.id = w.lot_id
		  WHERE NOT w.closing_notice_sent AND l.state IN ('open','extended')
		    AND l.closes_at - make_interval(secs => $2) <= $1
		  ORDER BY l.closes_at FOR UPDATE OF w`, serverNow, s.cfg.WatchNoticeSeconds)
	if err != nil {
		return fmt.Errorf("claim closing-soon notices: %w", err)
	}
	type watcher struct {
		lotID, personID string
		lotNumber       int
		closesAt        time.Time
	}
	var dueWatchers []watcher
	for rows.Next() {
		var w watcher
		if err := rows.Scan(&w.lotID, &w.personID, &w.lotNumber, &w.closesAt); err != nil {
			rows.Close()
			return fmt.Errorf("scan watcher: %w", err)
		}
		dueWatchers = append(dueWatchers, w)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, w := range dueWatchers {
		tag, err := tx.Exec(ctx,
			`UPDATE watches SET closing_notice_sent = true
			  WHERE lot_id = $1 AND person_id = $2 AND NOT closing_notice_sent`, w.lotID, w.personID)
		if err != nil {
			return fmt.Errorf("mark closing-soon notice sent: %w", err)
		}
		if tag.RowsAffected() == 0 {
			continue
		}
		body := domain.NoticeClosingSoonText(w.lotNumber, w.closesAt)
		if err := addNotice(ctx, tx, w.personID, domain.NoticeClosingSoon, body, w.lotID, serverNow); err != nil {
			return err
		}
	}
	return nil
}

func strOr(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}

// RunTimedEvents carries out every due timed event, within one second of its
// due moment, in its own transaction.
func (s *Saleroom) RunTimedEvents(ctx context.Context) error {
	return s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		return s.settle(ctx, tx, serverNow)
	})
}
