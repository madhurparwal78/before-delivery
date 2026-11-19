package saleroom

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"gavelhouse/internal/domain"
)

// statementLine is one of the consignor's lots on a seller statement.
type statementLine struct {
	LotID      string
	LotNumber  int
	Title      string
	Result     string
	Hammer     domain.Cents
	Commission domain.Cents
	Net        domain.Cents
	Sold       bool
}

// statementRecord is a statement with its lines and totals.
type statementRecord struct {
	ID              string
	Number          string
	SaleID          string
	SaleTitle       string
	ConsignorID     string
	Version         int
	Status          string
	IssuedAt        *time.Time
	Supersedes      *string
	SupersededBy    *string
	Lines           []statementLine
	HammerTotal     domain.Cents
	CommissionTotal domain.Cents
	NetTotal        domain.Cents
}

const statementColumns = `st.id, st.number, st.sale_id, s.title, st.consignor_id,
	st.version, st.status, st.issued_at, st.supersedes_id, st.superseded_by_id`

const statementFrom = ` FROM statements st JOIN sales s ON s.id = st.sale_id`

func loadStatements(ctx context.Context, tx pgx.Tx, where string, args ...any) ([]*statementRecord, error) {
	rows, err := tx.Query(ctx, `SELECT `+statementColumns+statementFrom+` `+where, args...)
	if err != nil {
		return nil, fmt.Errorf("query statements: %w", err)
	}
	defer rows.Close()
	var out []*statementRecord
	for rows.Next() {
		st := &statementRecord{}
		err := rows.Scan(&st.ID, &st.Number, &st.SaleID, &st.SaleTitle, &st.ConsignorID,
			&st.Version, &st.Status, &st.IssuedAt, &st.Supersedes, &st.SupersededBy)
		if err != nil {
			return nil, fmt.Errorf("scan statement: %w", err)
		}
		out = append(out, st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, st := range out {
		if err := fillStatement(ctx, tx, st); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// fillStatement reads a draft's lines from the current results and an issued
// statement's lines from the frozen rows.
func fillStatement(ctx context.Context, tx pgx.Tx, st *statementRecord) error {
	if st.Status == domain.StatementDraft {
		lines, err := statementLinesFromResults(ctx, tx, st.SaleID, st.ConsignorID)
		if err != nil {
			return err
		}
		st.Lines = lines
	} else {
		rows, err := tx.Query(ctx,
			`SELECT lot_id, lot_number, title, result, hammer_cents, commission_cents, net_cents
			   FROM statement_lines WHERE statement_id = $1 ORDER BY position`, st.ID)
		if err != nil {
			return fmt.Errorf("query statement lines for %s: %w", st.Number, err)
		}
		defer rows.Close()
		for rows.Next() {
			var ln statementLine
			var hammer, commission, net *int64
			if err := rows.Scan(&ln.LotID, &ln.LotNumber, &ln.Title, &ln.Result,
				&hammer, &commission, &net); err != nil {
				return fmt.Errorf("scan statement line: %w", err)
			}
			ln.Sold = ln.Result == "sold"
			if hammer != nil {
				ln.Hammer = domain.Cents(*hammer)
			}
			if commission != nil {
				ln.Commission = domain.Cents(*commission)
			}
			if net != nil {
				ln.Net = domain.Cents(*net)
			}
			st.Lines = append(st.Lines, ln)
		}
		if err := rows.Err(); err != nil {
			return err
		}
	}
	for _, ln := range st.Lines {
		st.HammerTotal += ln.Hammer
		st.CommissionTotal += ln.Commission
		st.NetTotal += ln.Net
	}
	return nil
}

// statementLinesFromResults works a statement's lines out from the sale's
// current results. A lot counts as sold if it was hammered or sold by offer
// and has not defaulted.
func statementLinesFromResults(ctx context.Context, tx pgx.Tx, saleID, consignorID string) ([]statementLine, error) {
	rows, err := tx.Query(ctx,
		`SELECT id, lot_number, title, state, hammer FROM lots
		  WHERE sale_id = $1 AND consignor_id = $2 ORDER BY lot_number`, saleID, consignorID)
	if err != nil {
		return nil, fmt.Errorf("query statement results: %w", err)
	}
	defer rows.Close()
	var out []statementLine
	for rows.Next() {
		var id, title, state string
		var lotNumber int
		var hammer *int
		if err := rows.Scan(&id, &lotNumber, &title, &state, &hammer); err != nil {
			return nil, fmt.Errorf("scan statement result: %w", err)
		}
		ln := statementLine{LotID: id, LotNumber: lotNumber, Title: title, Result: "unsold"}
		if soldOnStatement(state) && hammer != nil {
			ln.Result = "sold"
			ln.Sold = true
			ln.Hammer = domain.EurosToCents(*hammer)
			ln.Commission = domain.Commission(ln.Hammer)
			ln.Net = ln.Hammer - ln.Commission
		}
		out = append(out, ln)
	}
	return out, rows.Err()
}

func soldOnStatement(state string) bool {
	switch state {
	case domain.LotClosedSold, domain.LotInvoiced, domain.LotSoldByOffer, domain.LotPaid:
		return true
	}
	return false
}

func (st *statementRecord) project() map[string]any {
	lines := make([]map[string]any, 0, len(st.Lines))
	for _, ln := range st.Lines {
		m := map[string]any{
			"lot_id":     ln.LotID,
			"lot_number": ln.LotNumber,
			"title":      ln.Title,
			"result":     ln.Result,
		}
		if ln.Sold {
			m["hammer"] = ln.Hammer.String()
			m["commission"] = ln.Commission.String()
			m["net"] = ln.Net.String()
		} else {
			m["hammer"] = nil
			m["commission"] = nil
			m["net"] = nil
		}
		lines = append(lines, m)
	}
	return map[string]any{
		"id":               st.ID,
		"number":           st.Number,
		"sale_id":          st.SaleID,
		"sale_title":       st.SaleTitle,
		"version":          st.Version,
		"status":           st.Status,
		"issued_at":        timeOrNil(st.IssuedAt),
		"supersedes":       strOrNil(st.Supersedes),
		"superseded_by":    strOrNil(st.SupersededBy),
		"lines":            lines,
		"hammer_total":     st.HammerTotal.String(),
		"commission_total": st.CommissionTotal.String(),
		"net_total":        st.NetTotal.String(),
	}
}

// createDraftStatement gives a consignor their draft statement for a sale.
func createDraftStatement(ctx context.Context, tx pgx.Tx, saleID, consignorID string, version int,
	supersedes string) (string, string, error) {
	n, err := nextCounter(ctx, tx, "statement")
	if err != nil {
		return "", "", err
	}
	number := fmt.Sprintf("ST-%05d", n)
	id := newID()
	_, err = tx.Exec(ctx,
		`INSERT INTO statements (id, number, sale_id, consignor_id, version, status, supersedes_id)
		 VALUES ($1,$2,$3,$4,$5,$6,nullif($7,''))`,
		id, number, saleID, consignorID, version, domain.StatementDraft, supersedes)
	if err != nil {
		return "", "", fmt.Errorf("insert draft statement %s: %w", number, err)
	}
	return id, number, nil
}

// freezeStatement writes the statement's lines and totals and locks it.
func freezeStatement(ctx context.Context, tx pgx.Tx, st *statementRecord, issuedAt time.Time) error {
	lines, err := statementLinesFromResults(ctx, tx, st.SaleID, st.ConsignorID)
	if err != nil {
		return err
	}
	var hammerTotal, commissionTotal, netTotal domain.Cents
	for i, ln := range lines {
		var hammer, commission, net any
		if ln.Sold {
			hammer, commission, net = int64(ln.Hammer), int64(ln.Commission), int64(ln.Net)
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO statement_lines (statement_id, lot_id, position, lot_number, title,
			     result, hammer_cents, commission_cents, net_cents)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			st.ID, ln.LotID, i, ln.LotNumber, ln.Title, ln.Result, hammer, commission, net)
		if err != nil {
			return fmt.Errorf("freeze statement line for lot %s: %w", ln.LotID, err)
		}
		hammerTotal += ln.Hammer
		commissionTotal += ln.Commission
		netTotal += ln.Net
	}
	_, err = tx.Exec(ctx,
		`UPDATE statements SET status = $2, issued_at = $3, hammer_total_cents = $4,
		     commission_total_cents = $5, net_total_cents = $6 WHERE id = $1`,
		st.ID, domain.StatementIssued, issuedAt, int64(hammerTotal), int64(commissionTotal), int64(netTotal))
	if err != nil {
		return fmt.Errorf("issue statement %s: %w", st.Number, err)
	}
	body := domain.NoticeStatementIssuedText(st.Number)
	return addNotice(ctx, tx, st.ConsignorID, domain.NoticeStatementIssued, body, "", issuedAt)
}
