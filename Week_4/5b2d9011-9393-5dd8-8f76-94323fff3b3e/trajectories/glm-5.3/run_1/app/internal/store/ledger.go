package store

import (
	"context"
	"sort"
	"time"
)

// LedgerEntry is one credit movement. Every movement writes two entries with
// equal and opposite amounts and the same ref.
type LedgerEntry struct {
	ID        int64
	MatchID   string
	Account   string
	Amount    int64
	Kind      string
	Ref       string
	Item      string
	UnitPrice int
	At        time.Time
}

// AppendLedger writes a credit movement as its two opposite entries.
func (s *Store) AppendLedger(ctx context.Context, matchID, playerID string, amount int64, kind, ref, item string, unitPrice int) error {
	now := time.Now().UTC()
	counterparty := "studio:rewards"
	if kind == "purchase" {
		counterparty = "studio:ammo_station"
	}
	// positive entry on the player, opposite on the counterparty
	if amount < 0 {
		// player pays: negative on player, positive on counterparty
		if _, err := s.DB.ExecContext(ctx,
			`INSERT INTO ledger_entries (match_id, account, amount, kind, ref, item, unit_price, at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			matchID, playerID, amount, kind, ref, item, unitPrice, now); err != nil {
			return err
		}
		_, err := s.DB.ExecContext(ctx,
			`INSERT INTO ledger_entries (match_id, account, amount, kind, ref, item, unit_price, at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			matchID, counterparty, -amount, kind, ref, item, unitPrice, now)
		return err
	}
	if _, err := s.DB.ExecContext(ctx,
		`INSERT INTO ledger_entries (match_id, account, amount, kind, ref, item, unit_price, at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		matchID, playerID, amount, kind, ref, item, unitPrice, now); err != nil {
		return err
	}
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO ledger_entries (match_id, account, amount, kind, ref, item, unit_price, at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		matchID, counterparty, -amount, kind, ref, item, unitPrice, now)
	return err
}

// Balances sums every account's entries.
func (s *Store) Balances(ctx context.Context, matchID string) (map[string]int64, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT account, sum(amount) FROM ledger_entries WHERE match_id=$1 GROUP BY account`, matchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var acct string
		var sum int64
		if err := rows.Scan(&acct, &sum); err != nil {
			return nil, err
		}
		out[acct] = sum
	}
	return out, rows.Err()
}

// LedgerEntries lists a match's entries in id order.
func (s *Store) LedgerEntries(ctx context.Context, matchID string) ([]LedgerEntry, error) {
	rows, err := s.DB.QueryContext(ctx,
		`SELECT id, match_id, account, amount, kind, ref, item, unit_price, at
		 FROM ledger_entries WHERE match_id=$1 ORDER BY id`, matchID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.MatchID, &e.Account, &e.Amount, &e.Kind, &e.Ref, &e.Item, &e.UnitPrice, &e.At); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// PlayerBalance sums one player's entries for a match.
func (s *Store) PlayerBalance(ctx context.Context, matchID, playerID string) (int64, error) {
	var sum sqlNullInt64Alias
	err := s.DB.QueryRowContext(ctx,
		`SELECT COALESCE(sum(amount),0) FROM ledger_entries WHERE match_id=$1 AND account=$2`,
		matchID, playerID).Scan(&sum)
	return sum.v, err
}

// PlayerCreditsEarned sums a player's positive ledger entries for a match.
func (s *Store) PlayerCreditsEarned(ctx context.Context, matchID, playerID string) (int64, error) {
	var sum sqlNullInt64Alias
	err := s.DB.QueryRowContext(ctx,
		`SELECT COALESCE(sum(amount),0) FROM ledger_entries WHERE match_id=$1 AND account=$2 AND amount>0`,
		matchID, playerID).Scan(&sum)
	return sum.v, err
}

type sqlNullInt64Alias struct {
	v int64
}

// Scan implements sql.Scanner.
func (n *sqlNullInt64Alias) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		n.v = 0
	case int64:
		n.v = v
	default:
		return errBadScan
	}
	return nil
}

var errBadScan = errBadScanType{}

type errBadScanType struct{}

func (errBadScanType) Error() string { return "store: bad scan" }

// SortedAccounts returns the ledger accounts in a stable order.
func SortedAccounts(m map[string]int64) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
