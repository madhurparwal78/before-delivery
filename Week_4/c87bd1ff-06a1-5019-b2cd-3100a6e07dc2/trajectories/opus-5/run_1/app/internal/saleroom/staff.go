package saleroom

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// DeskLots lists the lots the specialist's desk shows in one state.
func (s *Saleroom) DeskLots(ctx context.Context, state string) ([]map[string]any, error) {
	var out []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		lots, err := loadLots(ctx, tx,
			`WHERE l.state = $1 ORDER BY l.catalogue_position NULLS LAST, l.created_at`, state)
		if err != nil {
			return err
		}
		out = make([]map[string]any, 0, len(lots))
		for _, l := range lots {
			bids, err := loadBids(ctx, tx, l.ID)
			if err != nil {
				return err
			}
			out = append(out, staffLot(l, standing(l, bids), serverNow, nil))
		}
		return nil
	})
	return out, err
}

// Estimate is the specialist's figures and notes for one intake lot.
type Estimate struct {
	EstimateLow  *int
	EstimateHigh *int
	OpeningBid   *int
	Reserve      *int
	Condition    string
	Portrait     string
}

// SaveEstimate sets a lot's estimate, opening bid, hidden reserve, condition
// notes and portrait, which moves it to estimated.
func (s *Saleroom) SaveEstimate(ctx context.Context, lotID string, e Estimate) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		l, err := loadLot(ctx, tx, lotID)
		if err != nil {
			return err
		}
		switch l.State {
		case domain.LotIntake, domain.LotEstimated, domain.LotPlaced:
		default:
			return conflict("invalid_transition", "This lot is already in an open sale.")
		}
		if fields := validateEstimate(e); len(fields) > 0 {
			return &Invalid{Fields: fields}
		}
		_, err = tx.Exec(ctx,
			`UPDATE lots SET estimate_low = $2, estimate_high = $3, opening_bid = $4,
			     reserve = $5, condition = $6, portrait = $7,
			     state = CASE WHEN state = 'intake' THEN 'estimated' ELSE state END
			  WHERE id = $1`,
			lotID, *e.EstimateLow, *e.EstimateHigh, *e.OpeningBid, *e.Reserve, e.Condition, e.Portrait)
		if err != nil {
			return fmt.Errorf("save estimate for lot %s: %w", lotID, err)
		}
		l, err = loadLot(ctx, tx, lotID)
		if err != nil {
			return err
		}
		out = map[string]any{"lot": staffLot(l, standing(l, nil), serverNow, nil)}
		return nil
	})
	return out, err
}

// validateEstimate runs the per-field checks first, then the three
// comparisons in order, skipping any comparison whose fields already carry a
// sentence. Every failing key is reported together.
func validateEstimate(e Estimate) map[string]string {
	fields := map[string]string{}
	amounts := []struct {
		key   string
		value *int
	}{
		{"estimate_low", e.EstimateLow},
		{"estimate_high", e.EstimateHigh},
		{"opening_bid", e.OpeningBid},
		{"reserve", e.Reserve},
	}
	for _, a := range amounts {
		if a.value == nil || *a.value < 1 || *a.value > domain.MaxBidEuros {
			fields[a.key] = domain.MsgEstimateAmount
		}
	}
	if len([]rune(e.Condition)) > 2000 {
		fields["condition"] = domain.MsgConditionTooLong
	}
	if !domain.IsPortrait(e.Portrait) {
		fields["portrait"] = domain.MsgChoosePortrait
	}
	clean := func(keys ...string) bool {
		for _, k := range keys {
			if _, bad := fields[k]; bad {
				return false
			}
		}
		return true
	}
	if clean("estimate_low", "estimate_high") && *e.EstimateLow > *e.EstimateHigh {
		fields["estimate_high"] = domain.MsgLowAboveHigh
	}
	if clean("opening_bid", "estimate_low") && *e.OpeningBid > *e.EstimateLow {
		fields["opening_bid"] = domain.MsgOpeningAboveLow
	}
	if clean("reserve", "opening_bid", "estimate_low") &&
		(*e.Reserve < *e.OpeningBid || *e.Reserve > *e.EstimateLow) {
		fields["reserve"] = domain.MsgReserveOutOfBand
	}
	return fields
}

// CreateSale opens a draft sale for the specialist to order lots into.
func (s *Saleroom) CreateSale(ctx context.Context, title string, endsAt time.Time, firstLotNumber int) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		id := newID()
		_, err := tx.Exec(ctx,
			`INSERT INTO sales (id, title, ends_at, state, first_lot_number)
			 VALUES ($1,$2,$3,$4,$5)`, id, title, endsAt, domain.SaleDraft, firstLotNumber)
		if err != nil {
			return fmt.Errorf("insert sale: %w", err)
		}
		sale, err := scanSale(tx.QueryRow(ctx, `SELECT `+saleColumns+` FROM sales WHERE id = $1`, id))
		if err != nil {
			return err
		}
		out = map[string]any{"sale": sale.project()}
		return nil
	})
	return out, err
}

// Sales lists every sale for the specialist's Sale combobox.
func (s *Saleroom) Sales(ctx context.Context) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+saleColumns+` FROM sales ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("query sales: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var sale saleRow
		if err := rows.Scan(&sale.ID, &sale.Title, &sale.EndsAt, &sale.State, &sale.FirstLotNumber); err != nil {
			return nil, fmt.Errorf("scan sale: %w", err)
		}
		out = append(out, sale.project())
	}
	return out, rows.Err()
}

// OrderSaleLots places estimated lots in a draft sale in catalogue order.
func (s *Saleroom) OrderSaleLots(ctx context.Context, saleID string, lotIDs []string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		sale, err := scanSale(tx.QueryRow(ctx,
			`SELECT `+saleColumns+` FROM sales WHERE id = $1 FOR UPDATE`, saleID))
		if err != nil {
			return err
		}
		if sale.State != domain.SaleDraft {
			return conflict("sale_published", "This sale is already published.")
		}
		wanted := map[string]bool{}
		for _, id := range lotIDs {
			wanted[id] = true
		}
		placed, err := loadLots(ctx, tx, `WHERE l.sale_id = $1`, saleID)
		if err != nil {
			return err
		}
		for _, l := range placed {
			if wanted[l.ID] {
				continue
			}
			if _, err := tx.Exec(ctx,
				`UPDATE lots SET sale_id = NULL, catalogue_position = NULL, state = $2
				  WHERE id = $1`, l.ID, domain.LotEstimated); err != nil {
				return fmt.Errorf("remove lot %s from the sale: %w", l.ID, err)
			}
		}
		for i, id := range lotIDs {
			l, err := loadLot(ctx, tx, id)
			if err != nil {
				return err
			}
			if l.State == domain.LotPlaced && strOr(l.SaleID, "") != saleID {
				return conflict("invalid_transition", "That lot is already placed in another sale.")
			}
			if l.State != domain.LotEstimated && l.State != domain.LotPlaced {
				return conflict("invalid_transition", "Only estimated lots can be placed in a sale.")
			}
			if _, err := tx.Exec(ctx,
				`UPDATE lots SET sale_id = $2, catalogue_position = $3, state = $4 WHERE id = $1`,
				id, saleID, i, domain.LotPlaced); err != nil {
				return fmt.Errorf("place lot %s in the sale: %w", id, err)
			}
		}
		lots, err := loadLots(ctx, tx, `WHERE l.sale_id = $1 ORDER BY l.catalogue_position`, saleID)
		if err != nil {
			return err
		}
		projected := make([]map[string]any, 0, len(lots))
		for _, l := range lots {
			projected = append(projected, staffLot(l, standing(l, nil), serverNow, nil))
		}
		out = map[string]any{"sale": sale.project(), "lots": projected}
		return nil
	})
	return out, err
}

// PublishSale numbers the sale's lots from its first lot number upward in
// catalogue order and closes them one lot gap apart from the sale's end.
func (s *Saleroom) PublishSale(ctx context.Context, saleID string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		sale, err := scanSale(tx.QueryRow(ctx,
			`SELECT `+saleColumns+` FROM sales WHERE id = $1 FOR UPDATE`, saleID))
		if err != nil {
			return err
		}
		if sale.State != domain.SaleDraft {
			return conflict("sale_published", "This sale is already published.")
		}
		if !sale.EndsAt.After(serverNow) {
			return invalidField("ends_at", domain.MsgSaleMustEndFuture)
		}
		lots, err := loadLots(ctx, tx, `WHERE l.sale_id = $1 ORDER BY l.catalogue_position`, saleID)
		if err != nil {
			return err
		}
		if len(lots) == 0 {
			return invalidField("lots", domain.MsgAddLotBeforePublish)
		}
		for k, l := range lots {
			closesAt := sale.EndsAt.Add(time.Duration(k) * s.cfg.LotGap)
			if _, err := tx.Exec(ctx,
				`UPDATE lots SET lot_number = $2, closes_at = $3, state = $4 WHERE id = $1`,
				l.ID, sale.FirstLotNumber+k, closesAt, domain.LotOpen); err != nil {
				return fmt.Errorf("open lot %s: %w", l.ID, err)
			}
		}
		if _, err := tx.Exec(ctx,
			`UPDATE sales SET state = $2, published_at = $3 WHERE id = $1`,
			saleID, domain.SaleOpen, serverNow); err != nil {
			return fmt.Errorf("publish sale %s: %w", saleID, err)
		}
		sale.State = domain.SaleOpen
		lots, err = loadLots(ctx, tx, `WHERE l.sale_id = $1 ORDER BY l.lot_number`, saleID)
		if err != nil {
			return err
		}
		projected := make([]map[string]any, 0, len(lots))
		for _, l := range lots {
			projected = append(projected, staffLot(l, standing(l, nil), serverNow, nil))
			if err := recordLotChange(ctx, tx, CauseClose, l.ID); err != nil {
				return err
			}
		}
		out = map[string]any{"sale": sale.project(), "lots": projected}
		return nil
	})
	return out, err
}

// DeskInvoices lists the cashier's invoices in one status, or all of them.
func (s *Saleroom) DeskInvoices(ctx context.Context, status string) ([]map[string]any, error) {
	var out []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		where := `WHERE ($1 = '' OR i.status = $1) ORDER BY i.issued_at DESC, i.number DESC`
		invoices, err := loadInvoices(ctx, tx, where, status)
		if err != nil {
			return err
		}
		out = make([]map[string]any, 0, len(invoices))
		for _, inv := range invoices {
			out = append(out, inv.project(true))
		}
		return nil
	})
	return out, err
}

// DeskInvoice reads one invoice for the cashier.
func (s *Saleroom) DeskInvoice(ctx context.Context, invoiceID string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		invoices, err := loadInvoices(ctx, tx, `WHERE i.id = $1`, invoiceID)
		if err != nil {
			return err
		}
		if len(invoices) == 0 {
			return ErrNotFound
		}
		out = map[string]any{"invoice": invoices[0].project(true)}
		return nil
	})
	return out, err
}

// RecordPayment records a payment against an invoice before its due time. The
// invoice turns paid when nothing is outstanding.
func (s *Saleroom) RecordPayment(ctx context.Context, invoiceID, amountRaw, method string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, invoiceID); err != nil {
			return fmt.Errorf("take the invoice's turn: %w", err)
		}
		invoices, err := loadInvoices(ctx, tx, `WHERE i.id = $1`, invoiceID)
		if err != nil {
			return err
		}
		if len(invoices) == 0 {
			return ErrNotFound
		}
		inv := invoices[0]
		switch inv.Status {
		case domain.InvoiceDefaulted:
			return conflict("invoice_defaulted", domain.MsgInvoiceDefaulted(inv.Number))
		case domain.InvoicePaid:
			return conflict("invoice_paid", fmt.Sprintf("Invoice %s is already paid.", inv.Number))
		}
		amount, ok := domain.ParseCents(amountRaw)
		if !ok || amount <= 0 {
			return invalidField("amount", domain.MsgPaymentMalformed)
		}
		if amount > inv.Outstanding {
			return invalidField("amount", domain.MsgMoreThanOwed(inv.Outstanding))
		}
		_, err = tx.Exec(ctx,
			`INSERT INTO payments (id, invoice_id, amount_cents, method, recorded_at)
			 VALUES ($1,$2,$3,$4,$5)`, newID(), invoiceID, int64(amount), method, serverNow)
		if err != nil {
			return fmt.Errorf("record payment on invoice %s: %w", inv.Number, err)
		}
		if amount == inv.Outstanding {
			if _, err := tx.Exec(ctx,
				`UPDATE invoices SET status = $2, paid_at = $3 WHERE id = $1`,
				invoiceID, domain.InvoicePaid, serverNow); err != nil {
				return fmt.Errorf("settle invoice %s: %w", inv.Number, err)
			}
			for _, ln := range inv.Lines {
				if _, err := tx.Exec(ctx, `UPDATE lots SET state = $2 WHERE id = $1`,
					ln.LotID, domain.LotPaid); err != nil {
					return fmt.Errorf("mark lot %s paid: %w", ln.LotID, err)
				}
				if err := recordLotChange(ctx, tx, CauseOffer, ln.LotID); err != nil {
					return err
				}
			}
		} else if err := recordLotChange(ctx, tx, CauseOffer, inv.Lines[0].LotID); err != nil {
			return err
		}
		invoices, err = loadInvoices(ctx, tx, `WHERE i.id = $1`, invoiceID)
		if err != nil {
			return err
		}
		out = map[string]any{
			"payment": map[string]any{
				"amount":      amount.String(),
				"method":      method,
				"recorded_at": serverNow.UTC().Format(time.RFC3339),
			},
			"invoice": invoices[0].project(true),
		}
		return nil
	})
	return out, err
}

// PendingRegistrations lists the bidders waiting for a spending limit.
func (s *Saleroom) PendingRegistrations(ctx context.Context, status string) ([]map[string]any, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, full_name, phone, address, status, created_at FROM registrations
		  WHERE ($1 = '' OR status = $1) AND role = 'bidder' ORDER BY created_at`, status)
	if err != nil {
		return nil, fmt.Errorf("query registrations: %w", err)
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, fullName, phone, address, st string
		var createdAt time.Time
		if err := rows.Scan(&id, &fullName, &phone, &address, &st, &createdAt); err != nil {
			return nil, fmt.Errorf("scan registration: %w", err)
		}
		out = append(out, map[string]any{
			"id": id, "full_name": fullName, "phone": phone, "address": address,
			"status": st, "created_at": createdAt.UTC().Format(time.RFC3339),
		})
	}
	return out, rows.Err()
}

// ApproveRegistration gives a pending bidder the next paddle number and a
// spending limit, and tells them.
func (s *Saleroom) ApproveRegistration(ctx context.Context, registrationID string, limit *int) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		var personID, role, status string
		err = tx.QueryRow(ctx,
			`SELECT person_id, role, status FROM registrations WHERE id = $1 FOR UPDATE`,
			registrationID).Scan(&personID, &role, &status)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return fmt.Errorf("read registration %s: %w", registrationID, err)
		}
		if status != "pending" {
			return conflict("invalid_transition", "That registration is already active.")
		}
		if limit == nil || *limit < 100 || *limit > domain.MaxBidEuros {
			return invalidField("spending_limit", domain.MsgSpendingLimitRange)
		}
		paddle, err := nextCounter(ctx, tx, "paddle")
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx,
			`UPDATE registrations SET status = 'active', paddle = $2, spending_limit = $3
			  WHERE id = $1`, registrationID, int(paddle), *limit)
		if err != nil {
			return fmt.Errorf("approve registration %s: %w", registrationID, err)
		}
		body := domain.NoticeLimitApprovedText(*limit)
		if err := addNotice(ctx, tx, personID, domain.NoticeLimitApproved, body, "", serverNow); err != nil {
			return err
		}
		p := int(paddle)
		out = map[string]any{"registration": Registration{
			ID: registrationID, Role: role, Status: "active", Paddle: &p, SpendingLimit: limit,
		}.project()}
		return nil
	})
	return out, err
}

// AdminLotBids reads a lot with the bid rows the admin removes from.
func (s *Saleroom) AdminLotBids(ctx context.Context, lotID string) (map[string]any, []map[string]any, error) {
	var lot map[string]any
	var history []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		l, err := loadLot(ctx, tx, lotID)
		if err != nil {
			return err
		}
		bids, err := loadBids(ctx, tx, lotID)
		if err != nil {
			return err
		}
		st := standing(l, bids)
		lot = staffLot(l, st, serverNow, nil)
		history = adminHistory(bids)
		return nil
	})
	return lot, history, err
}

// AdminOpenLots lists the open lots the admin's Lot combobox offers.
func (s *Saleroom) AdminOpenLots(ctx context.Context) ([]map[string]any, error) {
	var out []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		if err := s.settle(ctx, tx, serverNow); err != nil {
			return err
		}
		lots, err := loadLots(ctx, tx,
			`WHERE l.state IN ('open','extended') ORDER BY l.lot_number`)
		if err != nil {
			return err
		}
		out = make([]map[string]any, 0, len(lots))
		for _, l := range lots {
			bids, err := loadBids(ctx, tx, l.ID)
			if err != nil {
				return err
			}
			out = append(out, staffLot(l, standing(l, bids), serverNow, nil))
		}
		return nil
	})
	return out, err
}

// AdminStatements lists every statement, drafts included, for one sale or all.
func (s *Saleroom) AdminStatements(ctx context.Context, saleID string) ([]map[string]any, error) {
	var out []map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		statements, err := loadStatements(ctx, tx,
			`WHERE ($1 = '' OR st.sale_id = $1) ORDER BY st.created_at DESC`, saleID)
		if err != nil {
			return err
		}
		out = make([]map[string]any, 0, len(statements))
		for _, st := range statements {
			m := st.project()
			m["consignor_id"] = st.ConsignorID
			out = append(out, m)
		}
		return nil
	})
	return out, err
}

// AdminStatement reads one statement for the admin.
func (s *Saleroom) AdminStatement(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		statements, err := loadStatements(ctx, tx, `WHERE st.id = $1`, id)
		if err != nil {
			return err
		}
		if len(statements) == 0 {
			return ErrNotFound
		}
		out = map[string]any{"statement": statements[0].project()}
		return nil
	})
	return out, err
}

// IssueStatement freezes a draft statement's lines and totals and locks it.
func (s *Saleroom) IssueStatement(ctx context.Context, id string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		st, err := lockStatement(ctx, tx, id)
		if err != nil {
			return err
		}
		if st.Status != domain.StatementDraft {
			return conflict("statement_locked", domain.MsgStatementLocked(st.Number))
		}
		if err := freezeStatement(ctx, tx, st, serverNow); err != nil {
			return err
		}
		statements, err := loadStatements(ctx, tx, `WHERE st.id = $1`, id)
		if err != nil {
			return err
		}
		out = map[string]any{"statement": statements[0].project()}
		return nil
	})
	return out, err
}

// CorrectStatement issues a new statement from the current results that
// supersedes an issued one and links to it.
func (s *Saleroom) CorrectStatement(ctx context.Context, id, note string) (map[string]any, error) {
	var out map[string]any
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		serverNow, err := now(ctx, tx)
		if err != nil {
			return err
		}
		old, err := lockStatement(ctx, tx, id)
		if err != nil {
			return err
		}
		if old.Status != domain.StatementIssued {
			return conflict("invalid_transition", "Only an issued statement can be corrected.")
		}
		newID, _, err := createDraftStatement(ctx, tx, old.SaleID, old.ConsignorID, old.Version+1, old.ID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE statements SET note = $2 WHERE id = $1`, newID, note); err != nil {
			return fmt.Errorf("record the correction note: %w", err)
		}
		fresh, err := lockStatement(ctx, tx, newID)
		if err != nil {
			return err
		}
		if err := freezeStatement(ctx, tx, fresh, serverNow); err != nil {
			return err
		}
		_, err = tx.Exec(ctx,
			`UPDATE statements SET status = $2, superseded_by_id = $3 WHERE id = $1`,
			old.ID, domain.StatementSuperseded, newID)
		if err != nil {
			return fmt.Errorf("supersede statement %s: %w", old.Number, err)
		}
		statements, err := loadStatements(ctx, tx, `WHERE st.id = $1 OR st.id = $2`, newID, old.ID)
		if err != nil {
			return err
		}
		var newStatement, superseded map[string]any
		for _, st := range statements {
			if st.ID == newID {
				newStatement = st.project()
			} else {
				superseded = st.project()
			}
		}
		out = map[string]any{"statement": newStatement, "superseded": superseded}
		return nil
	})
	return out, err
}

func lockStatement(ctx context.Context, tx pgx.Tx, id string) (*statementRecord, error) {
	var locked string
	err := tx.QueryRow(ctx, `SELECT id FROM statements WHERE id = $1 FOR UPDATE`, id).Scan(&locked)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("read statement %s: %w", id, err)
	}
	statements, err := loadStatements(ctx, tx, `WHERE st.id = $1`, id)
	if err != nil {
		return nil, err
	}
	return statements[0], nil
}
