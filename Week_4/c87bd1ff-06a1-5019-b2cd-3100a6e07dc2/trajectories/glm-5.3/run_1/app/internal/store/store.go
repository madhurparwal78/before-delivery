// Package store holds every rule about lots, bids, sales, offers, invoices,
// statements and notices, decided in one place for the whole app.
package store

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"time"
)

type Store struct {
	cfg Config
	db  DB

	keycloakHealthy func() bool
	addRealmRole    func(sub, role string) error
}

type Config struct {
	LotGap      time.Duration
	SoftClose   time.Duration
	PaymentDue  time.Duration
	OfferWindow time.Duration
	WatchNotice time.Duration
}

func New(cfg Config, db DB) *Store {
	return &Store{cfg: cfg, db: db}
}

func (s *Store) Config() Config { return s.cfg }

// ID makes an opaque 128-bit id.
func ID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand is required for unguessable ids and cannot fail here.
		panic(err)
	}
	return hex.EncodeToString(b)
}

// CodedError carries an API error code. Handlers render the one error shape.
type CodedError struct {
	Code    string
	Message string
	Fields  map[string]string
	Status  int
	Extra   any
}

func (e *CodedError) Error() string { return e.Message }

func coded(status int, code, message string, fields map[string]string) *CodedError {
	return &CodedError{Status: status, Code: code, Message: message, Fields: fields}
}

func (e *CodedError) with(extra any) *CodedError {
	cp := *e
	cp.Extra = extra
	return &cp
}

var (
	ErrNotFound = errors.New("not found")
)

func IsCoded(err error) (*CodedError, bool) {
	var ce *CodedError
	if errors.As(err, &ce) {
		return ce, true
	}
	return nil, false
}

func NotFound() error { return coded(404, "not_found", "That page is not in the saleroom.", nil) }
func Forbidden() error {
	return coded(403, "forbidden", "This desk belongs to another role.", nil)
}
func Invalid(fields map[string]string) error {
	return coded(422, "invalid", "The details you entered are not right.", fields)
}
func Conflict(code, message string) error { return coded(409, code, message, nil) }

func wrap(err error, msg string) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", msg, err)
}

func wrapf(err error, format string, args ...any) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("%s: %w", fmt.Sprintf(format, args...), err)
}

// IncrementFor gives the published increment for a price.
func IncrementFor(price int) int {
	switch {
	case price < 100:
		return 5
	case price < 500:
		return 10
	case price < 1000:
		return 25
	case price < 5000:
		return 50
	default:
		return 100
	}
}

// NextBid gives the asking price for a lot: the opening bid before any bid,
// otherwise the price plus its increment.
func NextBid(openingBid int, hasPrice bool, price int) int {
	if !hasPrice {
		return openingBid
	}
	return price + IncrementFor(price)
}

// PremiumCents works out the tiered buyer's premium on a hammer in whole
// euros, rounded half up to the cent exactly once.
func PremiumCents(hammerEuros int) int {
	h := int64(hammerEuros) * 100 // hammer in cents
	var hundredths int64          // premium in hundredths of a cent, exact
	if h <= 200000 {
		hundredths = h * 25
	} else {
		hundredths = 200000*25 + (h-200000)*20
	}
	return int((hundredths + 50) / 100)
}

// VatCents works out VAT at 21% of a premium in cents, rounded half up once.
func VatCents(premiumCents int) int {
	hundredths := int64(premiumCents) * 21
	return int((hundredths + 50) / 100)
}

// CommissionCents works out the seller commission at 12.5% of a hammer in
// whole euros, rounded half up once, with a €15.00 per-lot minimum.
func CommissionCents(hammerEuros int) int {
	h := int64(hammerEuros) * 100 // hammer in cents
	thousandths := h * 125        // commission in thousandths of a cent, exact
	c := (thousandths*2 + 1000) / 2000
	if c < 1500 {
		c = 1500
	}
	return int(c)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// bigRand returns a cryptographically random int64 in [0, n).
func bigRand(n int64) int64 {
	v, err := rand.Int(rand.Reader, big.NewInt(n))
	if err != nil {
		// crypto/rand is required for unguessable values and cannot fail here.
		panic(err)
	}
	return v.Int64()
}

func thousands(n int) string {
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	var parts []string
	for len(s) > 3 {
		parts = append([]string{s[len(s)-3:]}, parts...)
		s = s[:len(s)-3]
	}
	parts = append([]string{s}, parts...)
	out := parts[0]
	for _, p := range parts[1:] {
		out += "," + p
	}
	return out
}

func fmtEuros(n int) string { return "€" + thousands(n) }

// fmtEuroCents writes cents as €1,628.13.
func fmtEuroCents(c int) string {
	negative := c < 0
	if negative {
		c = -c
	}
	return fmt.Sprintf("€%s.%02d", thousands(c/100), c%100)
}

func (s *Store) Now(ctx context.Context) (time.Time, error) {
	t, err := s.db.Now(ctx)
	return t, wrap(err, "reading the clock")
}

// WithTx runs one database transaction.
func (s *Store) WithTx(ctx context.Context, fn func(ctx context.Context, tx Tx) error) error {
	return s.db.WithTx(ctx, fn)
}
