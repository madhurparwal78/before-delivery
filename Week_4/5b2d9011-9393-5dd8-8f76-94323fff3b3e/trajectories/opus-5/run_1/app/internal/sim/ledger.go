package sim

import (
	"fmt"
	"time"
)

// LedgerEntry is one side of a credit movement.
type LedgerEntry struct {
	ID        string  `json:"id"`
	Account   string  `json:"account"`
	Amount    int     `json:"amount"`
	Kind      string  `json:"kind"`
	Ref       string  `json:"ref"`
	Item      *string `json:"item"`
	UnitPrice *int    `json:"unit_price"`
	At        string  `json:"at"`

	at time.Time
}

// Ledger is a room's double-entry credit ledger. Every movement writes two
// opposite entries, so each balance is the sum of its entries and the whole
// ledger sums to zero.
type Ledger struct {
	entries  []LedgerEntry
	balances map[string]int
	next     int
}

func newLedger() *Ledger {
	return &Ledger{balances: map[string]int{}}
}

// Post writes a movement as two opposite entries sharing one ref.
func (l *Ledger) Post(account, counterparty string, amount int, kind, ref string, item *string, unitPrice *int, at time.Time) {
	l.add(account, amount, kind, ref, item, unitPrice, at)
	l.add(counterparty, -amount, kind, ref, item, unitPrice, at)
}

func (l *Ledger) add(account string, amount int, kind, ref string, item *string, unitPrice *int, at time.Time) {
	l.next++
	l.entries = append(l.entries, LedgerEntry{
		ID:        fmt.Sprintf("e%d", l.next),
		Account:   account,
		Amount:    amount,
		Kind:      kind,
		Ref:       ref,
		Item:      item,
		UnitPrice: unitPrice,
		At:        at.UTC().Format(time.RFC3339),
		at:        at,
	})
	l.balances[account] += amount
}

// Balance reports an account's balance, which equals the sum of its entries.
func (l *Ledger) Balance(account string) int { return l.balances[account] }

// Entries reports every entry in the order it was written.
func (l *Ledger) Entries() []LedgerEntry {
	out := make([]LedgerEntry, len(l.entries))
	copy(out, l.entries)
	return out
}

// Balances reports every account's balance.
func (l *Ledger) Balances() map[string]int {
	out := make(map[string]int, len(l.balances))
	for k, v := range l.balances {
		out[k] = v
	}
	return out
}

// Total reports the sum of every entry, which is always zero.
func (l *Ledger) Total() int {
	total := 0
	for _, e := range l.entries {
		total += e.Amount
	}
	return total
}

// CreditsEarned reports the sum of an account's positive entries.
func (l *Ledger) CreditsEarned(account string) int {
	earned := 0
	for _, e := range l.entries {
		if e.Account == account && e.Amount > 0 {
			earned += e.Amount
		}
	}
	return earned
}
