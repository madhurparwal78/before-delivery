package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"gavelhouse/internal/store"
)

// ---- offers ----

func (t *Tx) InsertOffer(ctx context.Context, o store.Offer) error {
	_, err := t.tx.ExecContext(ctx, `INSERT INTO offers (id, lot_id, to_person_id, kind, amount, expires_at, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, o.ID, o.LotID, o.ToPerson, o.Kind, o.Amount, o.ExpiresAt, o.Status)
	if err != nil {
		return fmt.Errorf("saving the offer: %w", err)
	}
	return nil
}

func offerFromRow(id, lotID, toPerson, kind string, amount int, expires time.Time, status string) store.Offer {
	return store.Offer{ID: id, LotID: lotID, ToPerson: toPerson, Kind: kind, Amount: amount, ExpiresAt: expires.UTC(), Status: status}
}

func (t *Tx) GetOffer(ctx context.Context, id string) (*store.Offer, error) {
	var lotID, toPerson, kind, status string
	var amount int
	var expires time.Time
	err := t.tx.QueryRowContext(ctx, `SELECT id, lot_id, to_person_id, kind, amount, expires_at, status FROM offers WHERE id = $1`, id).
		Scan(&id, &lotID, &toPerson, &kind, &amount, &expires, &status)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the offer: %w", err)
	}
	o := offerFromRow(id, lotID, toPerson, kind, amount, expires, status)
	return &o, nil
}

func (t *Tx) OpenOfferForLot(ctx context.Context, lotID string) (*store.Offer, error) {
	var id, toPerson, kind, status string
	var amount int
	var expires time.Time
	err := t.tx.QueryRowContext(ctx, `SELECT id, lot_id, to_person_id, kind, amount, expires_at, status FROM offers
		WHERE lot_id = $1 AND status = 'open' LIMIT 1`, lotID).
		Scan(&id, &lotID, &toPerson, &kind, &amount, &expires, &status)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the offer: %w", err)
	}
	o := offerFromRow(id, lotID, toPerson, kind, amount, expires, status)
	return &o, nil
}

func (t *Tx) AnswerOffer(ctx context.Context, offerID, status string, at time.Time) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE offers SET status = $2, answered_at = $3 WHERE id = $1 AND status = 'open'`, offerID, status, at); err != nil {
		return fmt.Errorf("answering the offer: %w", err)
	}
	return nil
}

func (t *Tx) PersonOffers(ctx context.Context, personID string, openOnly bool) ([]store.Offer, error) {
	q := `SELECT id, lot_id, to_person_id, kind, amount, expires_at, status FROM offers WHERE to_person_id = $1`
	if openOnly {
		q += ` AND status = 'open'`
	}
	q += ` ORDER BY expires_at, id`
	rows, err := t.tx.QueryContext(ctx, q, personID)
	if err != nil {
		return nil, fmt.Errorf("reading the offers: %w", err)
	}
	defer rows.Close()
	var out []store.Offer
	for rows.Next() {
		var id, lotID, toPerson, kind, status string
		var amount int
		var expires time.Time
		if err := rows.Scan(&id, &lotID, &toPerson, &kind, &amount, &expires, &status); err != nil {
			return nil, fmt.Errorf("reading an offer: %w", err)
		}
		out = append(out, offerFromRow(id, lotID, toPerson, kind, amount, expires, status))
	}
	return out, rows.Err()
}

func (t *Tx) OpenOffersPastExpiry(ctx context.Context, now time.Time) ([]string, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id FROM offers WHERE status = 'open' AND expires_at <= $1 ORDER BY expires_at`, now)
	if err != nil {
		return nil, fmt.Errorf("finding due offers: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("reading a due offer: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ---- invoices ----

func (t *Tx) CreateInvoice(ctx context.Context, inv store.Invoice) (store.Invoice, error) {
	number, err := t.NextInvoiceNumber(ctx)
	if err != nil {
		return store.Invoice{}, err
	}
	inv.Number = number
	_, err = t.tx.ExecContext(ctx, `INSERT INTO invoices (id, number, sale_id, sale_title, paddle, bidder_id, status, issued_at, due_at, paid)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
		inv.ID, inv.Number, nullStr(inv.SaleID), inv.SaleTitle, inv.Paddle, inv.BidderID, inv.Status, inv.IssuedAt, inv.DueAt, inv.Paid)
	if err != nil {
		return store.Invoice{}, fmt.Errorf("saving the invoice: %w", err)
	}
	return inv, nil
}

func (t *Tx) AddInvoiceLine(ctx context.Context, invoiceID string, position int, line store.InvoiceLine) error {
	if _, err := t.tx.ExecContext(ctx, `INSERT INTO invoice_lines (invoice_id, position, lot_id, lot_number, title, source, hammer, premium, vat)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		invoiceID, position, line.LotID, line.LotNumber, line.Title, line.Source, line.Hammer, line.Premium, line.VAT); err != nil {
		return fmt.Errorf("saving the invoice line: %w", err)
	}
	return nil
}

func (t *Tx) loadInvoiceBody(ctx context.Context, inv *store.Invoice) error {
	lineRows, err := t.tx.QueryContext(ctx, `SELECT lot_id, lot_number, title, source, hammer, premium, vat FROM invoice_lines
		WHERE invoice_id = $1 ORDER BY position`, inv.ID)
	if err != nil {
		return fmt.Errorf("reading the invoice lines: %w", err)
	}
	for lineRows.Next() {
		var l store.InvoiceLine
		if err := lineRows.Scan(&l.LotID, &l.LotNumber, &l.Title, &l.Source, &l.Hammer, &l.Premium, &l.VAT); err != nil {
			lineRows.Close()
			return fmt.Errorf("reading an invoice line: %w", err)
		}
		inv.Lines = append(inv.Lines, l)
	}
	lineRows.Close()
	if err := lineRows.Err(); err != nil {
		return fmt.Errorf("reading the invoice lines: %w", err)
	}
	payRows, err := t.tx.QueryContext(ctx, `SELECT amount, method, recorded_at FROM payments WHERE invoice_id = $1 ORDER BY recorded_at`, inv.ID)
	if err != nil {
		return fmt.Errorf("reading the payments: %w", err)
	}
	for payRows.Next() {
		var p store.Payment
		if err := payRows.Scan(&p.Amount, &p.Method, &p.RecordedAt); err != nil {
			payRows.Close()
			return fmt.Errorf("reading a payment: %w", err)
		}
		inv.Payments = append(inv.Payments, p)
	}
	payRows.Close()
	return payRows.Err()
}

func (t *Tx) GetInvoice(ctx context.Context, id string) (*store.Invoice, error) {
	var inv store.Invoice
	var saleID any
	var name any
	err := t.tx.QueryRowContext(ctx, `SELECT i.id, i.number, i.sale_id, i.sale_title, i.paddle, i.bidder_id,
		COALESCE(r.full_name, p.name), i.status, i.issued_at, i.due_at, i.paid
		FROM invoices i
		JOIN people p ON p.id = i.bidder_id
		LEFT JOIN registrations r ON r.person_id = i.bidder_id
		WHERE i.id = $1`, id).
		Scan(&inv.ID, &inv.Number, &saleID, &inv.SaleTitle, &inv.Paddle, &inv.BidderID, &name, &inv.Status, &inv.IssuedAt, &inv.DueAt, &inv.Paid)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the invoice: %w", err)
	}
	inv.SaleID = strPtr(saleID)
	inv.BidderName = stringOf(name)
	if err := t.loadInvoiceBody(ctx, &inv); err != nil {
		return nil, err
	}
	return &inv, nil
}

func (t *Tx) queryInvoices(ctx context.Context, where string, args ...any) ([]store.Invoice, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT i.id, i.number, i.sale_id, i.sale_title, i.paddle, i.bidder_id,
		COALESCE(r.full_name, p.name), i.status, i.issued_at, i.due_at, i.paid
		FROM invoices i
		JOIN people p ON p.id = i.bidder_id
		LEFT JOIN registrations r ON r.person_id = i.bidder_id
		`+where, args...)
	if err != nil {
		return nil, fmt.Errorf("reading the invoices: %w", err)
	}
	// Read every header before the line queries borrow the connection again.
	var headers []store.Invoice
	for rows.Next() {
		var inv store.Invoice
		var saleID any
		if err := rows.Scan(&inv.ID, &inv.Number, &saleID, &inv.SaleTitle, &inv.Paddle, &inv.BidderID, &inv.BidderName, &inv.Status, &inv.IssuedAt, &inv.DueAt, &inv.Paid); err != nil {
			rows.Close()
			return nil, fmt.Errorf("reading an invoice: %w", err)
		}
		inv.SaleID = strPtr(saleID)
		headers = append(headers, inv)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading the invoices: %w", err)
	}
	out := make([]store.Invoice, 0, len(headers))
	for _, inv := range headers {
		if err := t.loadInvoiceBody(ctx, &inv); err != nil {
			return nil, err
		}
		out = append(out, inv)
	}
	return out, nil
}

func (t *Tx) InvoicesByStatus(ctx context.Context, statuses []string) ([]store.Invoice, error) {
	return t.queryInvoices(ctx, ` WHERE i.status = ANY($1) ORDER BY i.issued_at DESC, i.number`, statuses)
}

func (t *Tx) BidderInvoices(ctx context.Context, bidderID string) ([]store.Invoice, error) {
	return t.queryInvoices(ctx, ` WHERE i.bidder_id = $1 ORDER BY i.issued_at DESC, i.number`, bidderID)
}

func (t *Tx) InvoicesDue(ctx context.Context, now time.Time) ([]string, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id FROM invoices WHERE status = 'issued' AND due_at <= $1 ORDER BY due_at`, now)
	if err != nil {
		return nil, fmt.Errorf("finding due invoices: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("reading a due invoice: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (t *Tx) AddPayment(ctx context.Context, invoiceID string, p store.Payment) error {
	if _, err := t.tx.ExecContext(ctx, `INSERT INTO payments (id, invoice_id, amount, method, recorded_at)
		VALUES ($1,$2,$3,$4,$5)`, store.ID(), invoiceID, p.Amount, p.Method, p.RecordedAt); err != nil {
		return fmt.Errorf("saving the payment: %w", err)
	}
	if _, err := t.tx.ExecContext(ctx, `UPDATE invoices SET paid = paid + $2 WHERE id = $1`, invoiceID, p.Amount); err != nil {
		return fmt.Errorf("updating the invoice: %w", err)
	}
	return nil
}

func (t *Tx) MarkInvoicePaid(ctx context.Context, invoiceID string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE invoices SET status = 'paid' WHERE id = $1`, invoiceID); err != nil {
		return fmt.Errorf("paying the invoice: %w", err)
	}
	return nil
}

func (t *Tx) MarkInvoiceDefaulted(ctx context.Context, invoiceID string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE invoices SET status = 'defaulted' WHERE id = $1`, invoiceID); err != nil {
		return fmt.Errorf("defaulting the invoice: %w", err)
	}
	return nil
}

func (t *Tx) SetLotInvoiceState(ctx context.Context, lotID, state string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE lots SET state = $2 WHERE id = $1`, lotID, state); err != nil {
		return fmt.Errorf("updating the lot: %w", err)
	}
	return nil
}

func (t *Tx) NextInvoiceNumber(ctx context.Context) (string, error) {
	var n int
	if err := t.tx.QueryRowContext(ctx, `SELECT nextval('invoice_seq')`).Scan(&n); err != nil {
		return "", fmt.Errorf("numbering the invoice: %w", err)
	}
	return fmt.Sprintf("INV-%05d", n), nil
}

func (t *Tx) NextStatementNumber(ctx context.Context) (string, error) {
	var n int
	if err := t.tx.QueryRowContext(ctx, `SELECT nextval('statement_seq')`).Scan(&n); err != nil {
		return "", fmt.Errorf("numbering the statement: %w", err)
	}
	return fmt.Sprintf("ST-%05d", n), nil
}

// ---- statements ----

func (t *Tx) GetDraftStatement(ctx context.Context, saleID, consignorID string) (*store.Statement, error) {
	var id string
	err := t.tx.QueryRowContext(ctx, `SELECT id FROM statements WHERE sale_id = $1 AND consignor_id = $2 AND status = 'draft'`,
		saleID, consignorID).Scan(&id)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the draft statement: %w", err)
	}
	return t.GetStatement(ctx, id)
}

func (t *Tx) CreateDraftStatement(ctx context.Context, st store.Statement) (store.Statement, error) {
	// A draft carries no number; the next one is stamped when it is issued.
	_, err := t.tx.ExecContext(ctx, `INSERT INTO statements (id, sale_id, sale_title, consignor_id, version, status)
		VALUES ($1,$2,$3,$4,$5,'draft')`, st.ID, st.SaleID, st.SaleTitle, st.ConsignorID, st.Version)
	if err != nil {
		return store.Statement{}, fmt.Errorf("saving the statement: %w", err)
	}
	return st, nil
}

func (t *Tx) CreateIssuedStatement(ctx context.Context, st store.Statement, lines []store.StatementLine) error {
	if _, err := t.tx.ExecContext(ctx, `INSERT INTO statements (id, number, sale_id, sale_title, consignor_id, version, status, issued_at, supersedes, lines)
		VALUES ($1,$2,$3,$4,$5,$6,'issued',$7,$8,$9)`,
		st.ID, st.Number, st.SaleID, st.SaleTitle, st.ConsignorID, st.Version, nullTime(st.IssuedAt), nullStr(st.Supersedes),
		mustJSON(lines)); err != nil {
		return fmt.Errorf("saving the statement: %w", err)
	}
	return nil
}

// decodeStatementLines reads the frozen lines of an issued statement.
func decodeStatementLines(raw any) []store.StatementLine {
	switch x := raw.(type) {
	case nil:
		return nil
	case []byte:
		var lines []store.StatementLine
		if err := json.Unmarshal(x, &lines); err != nil {
			return nil
		}
		return lines
	}
	return nil
}

func mustJSON(v any) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

func (t *Tx) IssueStatement(ctx context.Context, id, number string, lines []store.StatementLine, at time.Time) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE statements SET status = 'issued', number = $2, issued_at = $3, lines = $4 WHERE id = $1`,
		id, number, at, mustJSON(lines)); err != nil {
		return fmt.Errorf("issuing the statement: %w", err)
	}
	return nil
}

func (t *Tx) SupersedeStatement(ctx context.Context, id string, byID string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE statements SET status = 'superseded', superseded_by = $2 WHERE id = $1`, id, byID); err != nil {
		return fmt.Errorf("superseding the statement: %w", err)
	}
	return nil
}

func (t *Tx) GetStatement(ctx context.Context, id string) (*store.Statement, error) {
	var st store.Statement
	var number, issuedAt, supersedes, supersededBy any
	var lines any
	err := t.tx.QueryRowContext(ctx, `SELECT id, number, sale_id, sale_title, consignor_id, version, status, issued_at, supersedes, superseded_by, lines
		FROM statements WHERE id = $1`, id).
		Scan(&st.ID, &number, &st.SaleID, &st.SaleTitle, &st.ConsignorID, &st.Version, &st.Status, &issuedAt, &supersedes, &supersededBy, &lines)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("reading the statement: %w", err)
	}
	st.Number = stringOf(number)
	st.IssuedAt = timePtr(issuedAt)
	st.Supersedes = strPtr(supersedes)
	st.SupersededBy = strPtr(supersededBy)
	st.Lines = decodeStatementLines(lines)
	return &st, nil
}

func (t *Tx) ConsignorStatements(ctx context.Context, consignorID string) ([]store.Statement, error) {
	return t.queryStatements(ctx, ` WHERE consignor_id = $1 AND status IN ('issued','superseded') ORDER BY issued_at DESC, number DESC`, consignorID)
}

func (t *Tx) queryStatements(ctx context.Context, where string, args ...any) ([]store.Statement, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id, number, sale_id, sale_title, consignor_id, version, status, issued_at, supersedes, superseded_by, lines
		FROM statements`+where, args...)
	if err != nil {
		return nil, fmt.Errorf("reading the statements: %w", err)
	}
	// Read every header before other queries borrow the connection again.
	var headers []store.Statement
	for rows.Next() {
		var st store.Statement
		var number, issuedAt, supersedes, supersededBy any
		var lines any
		if err := rows.Scan(&st.ID, &number, &st.SaleID, &st.SaleTitle, &st.ConsignorID, &st.Version, &st.Status, &issuedAt, &supersedes, &supersededBy, &lines); err != nil {
			rows.Close()
			return nil, fmt.Errorf("reading a statement: %w", err)
		}
		st.Number = stringOf(number)
		st.IssuedAt = timePtr(issuedAt)
		st.Supersedes = strPtr(supersedes)
		st.SupersededBy = strPtr(supersededBy)
		st.Lines = decodeStatementLines(lines)
		headers = append(headers, st)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading the statements: %w", err)
	}
	return headers, nil
}

func (t *Tx) SaleStatements(ctx context.Context, saleID string) ([]store.Statement, error) {
	return t.queryStatements(ctx, ` WHERE sale_id = $1 ORDER BY version DESC, number DESC`, saleID)
}

func (t *Tx) AllStatements(ctx context.Context) ([]store.Statement, error) {
	return t.queryStatements(ctx, ` ORDER BY created_at DESC, number DESC`, nil)
}

// ---- notices ----

func (t *Tx) InsertNotice(ctx context.Context, n store.Notice) (store.Notice, error) {
	var created time.Time
	err := t.tx.QueryRowContext(ctx, `INSERT INTO notices (id, person_id, kind, text, lot_id, created_at)
		VALUES ($1,$2,$3,$4,$5, now() AT TIME ZONE 'UTC') RETURNING created_at`,
		n.ID, n.PersonID, n.Kind, n.Text, nullStr(n.LotID)).Scan(&created)
	if err != nil {
		return store.Notice{}, fmt.Errorf("saving the notice: %w", err)
	}
	n.CreatedAt = created.UTC()
	return n, nil
}

func (t *Tx) PersonNotices(ctx context.Context, personID string) ([]store.Notice, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id, person_id, kind, text, lot_id, created_at FROM notices
		WHERE person_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100`, personID)
	if err != nil {
		return nil, fmt.Errorf("reading the notices: %w", err)
	}
	defer rows.Close()
	var out []store.Notice
	for rows.Next() {
		var n store.Notice
		var lotID any
		if err := rows.Scan(&n.ID, &n.PersonID, &n.Kind, &n.Text, &lotID, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("reading a notice: %w", err)
		}
		n.LotID = strPtr(lotID)
		out = append(out, n)
	}
	return out, rows.Err()
}

// ---- events ----

func (t *Tx) AppendEvent(ctx context.Context, kind string, lotID *string, personID *string) (int64, error) {
	var seq int64
	err := t.tx.QueryRowContext(ctx, `INSERT INTO events (kind, lot_id, person_id) VALUES ($1,$2,$3) RETURNING seq`,
		kind, nullStr(lotID), nullStr(personID)).Scan(&seq)
	if err != nil {
		return 0, fmt.Errorf("recording the event: %w", err)
	}
	return seq, nil
}

func (t *Tx) LatestSeq(ctx context.Context) (int64, error) {
	var seq int64
	if err := t.tx.QueryRowContext(ctx, `SELECT COALESCE(max(seq), 0) FROM events`).Scan(&seq); err != nil {
		return 0, fmt.Errorf("reading the feed: %w", err)
	}
	return seq, nil
}

func (t *Tx) EventsAfter(ctx context.Context, since int64) ([]store.EventRow, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT seq, kind, lot_id, person_id FROM events WHERE seq > $1 ORDER BY seq LIMIT 500`, since)
	if err != nil {
		return nil, fmt.Errorf("reading the feed: %w", err)
	}
	defer rows.Close()
	var out []store.EventRow
	for rows.Next() {
		var e store.EventRow
		var lotID, personID any
		if err := rows.Scan(&e.Seq, &e.Kind, &lotID, &personID); err != nil {
			return nil, fmt.Errorf("reading an event: %w", err)
		}
		e.LotID = strPtr(lotID)
		e.PersonID = strPtr(personID)
		out = append(out, e)
	}
	return out, rows.Err()
}

// ---- timed events ----

func (t *Tx) OpenLotsPastClose(ctx context.Context, now time.Time) ([]string, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id FROM lots WHERE state IN ('open','extended') AND closes_at <= $1 ORDER BY closes_at, id`, now)
	if err != nil {
		return nil, fmt.Errorf("finding due closes: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("reading a due lot: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (t *Tx) InsertDueEvent(ctx context.Context, kind string, lotID *string, personID *string, invoiceID *string, offerID *string, dueAt time.Time) error {
	if _, err := t.tx.ExecContext(ctx, `INSERT INTO due_events (id, kind, lot_id, person_id, invoice_id, offer_id, due_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`, store.ID(), kind, nullStr(lotID), nullStr(personID), nullStr(invoiceID), nullStr(offerID), dueAt); err != nil {
		return fmt.Errorf("scheduling the event: %w", err)
	}
	return nil
}

func (t *Tx) DueEvents(ctx context.Context, now time.Time) ([]store.DueEvent, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT id, kind, lot_id, person_id, invoice_id, offer_id, due_at FROM due_events
		WHERE done = FALSE AND due_at <= $1 ORDER BY due_at, id`, now)
	if err != nil {
		return nil, fmt.Errorf("finding due events: %w", err)
	}
	defer rows.Close()
	var out []store.DueEvent
	for rows.Next() {
		var e store.DueEvent
		var lotID, personID, invoiceID, offerID any
		if err := rows.Scan(&e.ID, &e.Kind, &lotID, &personID, &invoiceID, &offerID, &e.DueAt); err != nil {
			return nil, fmt.Errorf("reading a due event: %w", err)
		}
		e.LotID = strPtr(lotID)
		e.PersonID = strPtr(personID)
		e.InvoiceID = strPtr(invoiceID)
		e.OfferID = strPtr(offerID)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (t *Tx) MarkDueEventDone(ctx context.Context, id string) error {
	if _, err := t.tx.ExecContext(ctx, `UPDATE due_events SET done = TRUE WHERE id = $1`, id); err != nil {
		return fmt.Errorf("closing the due event: %w", err)
	}
	return nil
}

func (t *Tx) ClosingNoticesDue(ctx context.Context, now time.Time) ([]store.DueEvent, error) {
	rows, err := t.tx.QueryContext(ctx, `SELECT d.id, d.kind, d.lot_id, d.person_id, d.invoice_id, d.offer_id, d.due_at FROM due_events d
		JOIN lots l ON l.id = d.lot_id
		WHERE d.done = FALSE AND d.kind = 'closing_notice' AND d.due_at <= $1
			AND l.state IN ('open','extended')
		ORDER BY d.due_at, d.id`, now)
	if err != nil {
		return nil, fmt.Errorf("finding due closing notices: %w", err)
	}
	defer rows.Close()
	var out []store.DueEvent
	for rows.Next() {
		var e store.DueEvent
		var lotID, personID, invoiceID, offerID any
		if err := rows.Scan(&e.ID, &e.Kind, &lotID, &personID, &invoiceID, &offerID, &e.DueAt); err != nil {
			return nil, fmt.Errorf("reading a due event: %w", err)
		}
		e.LotID = strPtr(lotID)
		e.PersonID = strPtr(personID)
		e.InvoiceID = strPtr(invoiceID)
		e.OfferID = strPtr(offerID)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (t *Tx) MarkClosingNoticeSent(ctx context.Context, lotID, personID string) error {
	if _, err := t.tx.ExecContext(ctx, `INSERT INTO closing_notices (lot_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, lotID, personID); err != nil {
		return fmt.Errorf("marking the closing notice: %w", err)
	}
	return nil
}

func (t *Tx) MarkClosingNoticeDone(ctx context.Context, id string) error {
	return t.MarkDueEventDone(ctx, id)
}

func (t *Tx) ClosingNoticeSent(ctx context.Context, lotID, personID string) (bool, error) {
	var one int
	err := t.tx.QueryRowContext(ctx, `SELECT 1 FROM closing_notices WHERE lot_id = $1 AND person_id = $2`, lotID, personID).Scan(&one)
	if isNoRows(err) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking the closing notice: %w", err)
	}
	return true, nil
}
