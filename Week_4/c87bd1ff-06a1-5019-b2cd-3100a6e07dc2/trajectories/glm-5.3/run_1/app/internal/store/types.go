package store

import (
	"context"
	"fmt"
	"time"
)

// Person is any signed-in identity.
type Person struct {
	ID    string
	Sub   string
	Name  string
	Roles []string
}

// Registration is a bidder or consignor registration.
type Registration struct {
	ID            string
	PersonID      string
	Role          string
	Status        string
	FullName      string
	Phone         string
	Address       string
	Paddle        *int
	SpendingLimit *int
	CreatedAt     time.Time
}

// Sale is a weekly timed sale.
type Sale struct {
	ID             string
	Title          string
	EndsAt         time.Time
	FirstLotNumber int
	State          string
}

// Lot is one watch or camera in a sale.
type Lot struct {
	ID               string
	SaleID           *string
	Position         *int
	ConsignorID      string
	ConsignorName    string
	LotNumber        *int
	Title            string
	Category         string
	Description      string
	Condition        string
	Portrait         string
	EstimateLow      *int
	EstimateHigh     *int
	OpeningBid       *int
	Reserve          *int
	Price            *int
	LeaderBidID      *string
	LeaderPersonID   *string
	LeaderMax        *int
	LeaderPaddle     *int
	ReserveMet       bool
	State            string
	ClosesAt         *time.Time
	ClosedAt         *time.Time
	Hammer           *int
	SecondChanceDone bool
}

func (l *Lot) Asking() int {
	if l.OpeningBid == nil {
		return 0
	}
	if l.Price == nil {
		return *l.OpeningBid
	}
	return NextBid(*l.OpeningBid, true, *l.Price)
}

func (l *Lot) IsOpenish() bool {
	return l.State == "open" || l.State == "extended"
}

// Status records the hammer result and never changes after the close.
func (l *Lot) Status() string {
	switch l.State {
	case "open", "extended":
		return "open"
	case "closed_sold", "invoiced", "paid", "defaulted", "sold_by_offer":
		return "closed_sold"
	case "closed_unsold", "second_chance_offered", "offer_lapsed", "underbidder_offered":
		return "closed_unsold"
	default:
		return ""
	}
}

// LotFull is a lot with the remaining bids attached.
type LotFull struct {
	Lot
	Bids []Bid // remaining bids in acceptance order
}

// Bid is one accepted maximum.
type Bid struct {
	ID         string
	LotID      string
	BidderID   string
	BidderName string
	Paddle     int
	MaxAmount  int
	PriceAfter int
	AcceptedAt time.Time
	RemovedAt  *time.Time
}

// Offer is a second-chance or default offer.
type Offer struct {
	ID        string
	LotID     string
	ToPerson  string
	Kind      string
	Amount    int
	ExpiresAt time.Time
	Status    string
}

// InvoiceLine is one lot on an invoice.
type InvoiceLine struct {
	LotID     string
	LotNumber int
	Title     string
	Source    string
	Hammer    int
	Premium   int
	VAT       int
}

// Payment is money recorded by the cashier.
type Payment struct {
	Amount     int
	Method     string
	RecordedAt time.Time
}

// Invoice is a buyer's bill for one sale, or for one accepted offer.
type Invoice struct {
	ID         string
	Number     string
	SaleID     *string
	SaleTitle  string
	Paddle     int
	BidderID   string
	BidderName string
	Status     string
	IssuedAt   time.Time
	DueAt      time.Time
	Lines      []InvoiceLine
	Paid       int
	Payments   []Payment
}

func (inv *Invoice) Totals() (hammer, premium, vat int) {
	for _, l := range inv.Lines {
		hammer += l.Hammer
		premium += l.Premium
		vat += l.VAT
	}
	return
}

func (inv *Invoice) Outstanding() int {
	h, p, v := inv.Totals()
	t := h + p + v - inv.Paid
	if t < 0 {
		return 0
	}
	return t
}

// StatementLine is one lot on a seller statement.
type StatementLine struct {
	LotID      string
	LotNumber  int
	Title      string
	Result     string
	Hammer     *int
	Commission *int
	Net        *int
}

// Statement is a consignor's sale account.
type Statement struct {
	ID           string
	Number       string
	SaleID       string
	SaleTitle    string
	ConsignorID  string
	Version      int
	Status       string
	IssuedAt     *time.Time
	Supersedes   *string
	SupersededBy *string
	Lines        []StatementLine
}

// Notice is one in-app message to one person.
type Notice struct {
	ID        string
	PersonID  string
	Kind      string
	Text      string
	LotID     *string
	CreatedAt time.Time
}

// IdemRecord is one stored idempotency response.
type IdemRecord struct {
	BodyHash string
	Status   int
	Response []byte
}

// SigninAttempt is one Keycloak sign-in attempt, bound to one browser.
type SigninAttempt struct {
	State     string
	Verifier  string
	Nonce     string
	ReturnTo  string
	ExpiresAt time.Time
}

// EventRow is one committed change in the feed.
type EventRow struct {
	Seq      int64
	Kind     string
	LotID    *string
	PersonID *string
}

// DueEvent is one timed thing to carry out.
type DueEvent struct {
	ID        string
	Kind      string
	LotID     *string
	PersonID  *string
	InvoiceID *string
	OfferID   *string
	DueAt     time.Time
}

// Tx is the transaction-bound view of the database.
type Tx interface {
	Now(ctx context.Context) (time.Time, error)

	UpsertPerson(ctx context.Context, p Person) error
	GetPersonBySub(ctx context.Context, sub string) (*Person, error)
	CreateSession(ctx context.Context, token string, p Person) error
	GetSession(ctx context.Context, token string) (*Person, error)
	DeleteSession(ctx context.Context, token string) error
	DeleteSessionsOfPerson(ctx context.Context, personID string) error
	// Rebind the seeded person's record to their Keycloak identity.
	RebindPerson(ctx context.Context, personID, sub string) error
	InsertSigninAttempt(ctx context.Context, a SigninAttempt) error
	TakeSigninAttempt(ctx context.Context, state string) (*SigninAttempt, error)

	CreateRegistration(ctx context.Context, r Registration) error
	GetRegistrationByPerson(ctx context.Context, personID string) (*Registration, error)
	GetRegistration(ctx context.Context, id string) (*Registration, error)
	PendingRegistrations(ctx context.Context) ([]Registration, error)
	ApproveRegistration(ctx context.Context, id string, paddle, limit int) error
	NextPaddle(ctx context.Context) (int, error)

	CreateSale(ctx context.Context, sale Sale) (Sale, error)
	GetSale(ctx context.Context, id string) (*Sale, error)
	CurrentSale(ctx context.Context) (*Sale, error)
	AllSales(ctx context.Context) ([]Sale, error)
	SetSaleState(ctx context.Context, id, state string) error
	SaleLotCount(ctx context.Context, saleID string) (int, error)
	OpenSaleLotCount(ctx context.Context, saleID string, exceptLotID string) (int, error)

	CreateLot(ctx context.Context, lot Lot) (Lot, error)
	GetLot(ctx context.Context, id string) (*Lot, error)
	ConsignorLots(ctx context.Context, consignorID string) ([]Lot, error)
	DeskLotsByState(ctx context.Context, states []string) ([]Lot, error)
	SaleLots(ctx context.Context, saleID string) ([]Lot, error)
	UpdateLotEstimate(ctx context.Context, lot Lot) error
	SetLotOrder(ctx context.Context, saleID string, lotIDs []string) error
	AssignLotNumbers(ctx context.Context, saleID string, first int, gap time.Duration, ends time.Time) error
	LotBids(ctx context.Context, lotID string) ([]Bid, error)
	InsertBid(ctx context.Context, bid Bid, seq int64) error
	RemoveBid(ctx context.Context, bidID string, reason string, removedAt time.Time) error
	GetBid(ctx context.Context, bidID string) (*Bid, error)
	ApplyBidResult(ctx context.Context, lotID string, price int, leaderBidID string, reserveMet bool, lastBidID string) error
	SetLotState(ctx context.Context, lotID, state string) error
	SetLotClose(ctx context.Context, lotID string, closesAt time.Time) error
	CloseLotRow(ctx context.Context, lotID, state string, hammer int, closedAt time.Time) error
	SetLotHammer(ctx context.Context, lotID string, hammer int, state string) error
	MarkSecondChanceDone(ctx context.Context, lotID string) error
	SetWatch(ctx context.Context, personID, lotID string, watching bool) error
	IsWatching(ctx context.Context, personID, lotID string) (bool, error)
	Watchers(ctx context.Context, lotID string) ([]string, error)
	WatchedLots(ctx context.Context, personID string) ([]Lot, error)
	MyMax(ctx context.Context, personID, lotID string) (*int, error)
	Committed(ctx context.Context, personID string) (int, error)
	ForEachLeadingLot(ctx context.Context, personID string, fn func(*LotFull) error) error
	ForEachWonLot(ctx context.Context, personID string, fn func(*LotFull) error) error

	GetIdempotency(ctx context.Context, bidderID, key string) (*IdemRecord, error)
	InsertIdempotency(ctx context.Context, bidderID, key, bodyHash string, status int, body []byte) error

	InsertOffer(ctx context.Context, o Offer) error
	GetOffer(ctx context.Context, id string) (*Offer, error)
	OpenOfferForLot(ctx context.Context, lotID string) (*Offer, error)
	AnswerOffer(ctx context.Context, offerID, status string, at time.Time) error
	PersonOffers(ctx context.Context, personID string, openOnly bool) ([]Offer, error)
	OpenOffersPastExpiry(ctx context.Context, now time.Time) ([]string, error)

	CreateInvoice(ctx context.Context, inv Invoice) (Invoice, error)
	AddInvoiceLine(ctx context.Context, invoiceID string, position int, line InvoiceLine) error
	GetInvoice(ctx context.Context, id string) (*Invoice, error)
	InvoicesByStatus(ctx context.Context, statuses []string) ([]Invoice, error)
	BidderInvoices(ctx context.Context, bidderID string) ([]Invoice, error)
	InvoicesDue(ctx context.Context, now time.Time) ([]string, error)
	AddPayment(ctx context.Context, invoiceID string, p Payment) error
	MarkInvoicePaid(ctx context.Context, invoiceID string) error
	MarkInvoiceDefaulted(ctx context.Context, invoiceID string) error
	SetLotInvoiceState(ctx context.Context, lotID, state string) error

	GetDraftStatement(ctx context.Context, saleID, consignorID string) (*Statement, error)
	CreateDraftStatement(ctx context.Context, st Statement) (Statement, error)
	CreateIssuedStatement(ctx context.Context, st Statement, lines []StatementLine) error
	IssueStatement(ctx context.Context, id, number string, lines []StatementLine, at time.Time) error
	SupersedeStatement(ctx context.Context, id string, byID string) error
	GetStatement(ctx context.Context, id string) (*Statement, error)
	ConsignorStatements(ctx context.Context, consignorID string) ([]Statement, error)
	SaleStatements(ctx context.Context, saleID string) ([]Statement, error)
	AllStatements(ctx context.Context) ([]Statement, error)
	NextInvoiceNumber(ctx context.Context) (string, error)
	NextStatementNumber(ctx context.Context) (string, error)

	InsertNotice(ctx context.Context, n Notice) (Notice, error)
	PersonNotices(ctx context.Context, personID string) ([]Notice, error)

	AppendEvent(ctx context.Context, kind string, lotID *string, personID *string) (int64, error)
	LatestSeq(ctx context.Context) (int64, error)
	EventsAfter(ctx context.Context, since int64) ([]EventRow, error)

	OpenLotsPastClose(ctx context.Context, now time.Time) ([]string, error)
	InsertDueEvent(ctx context.Context, kind string, lotID *string, personID *string, invoiceID *string, offerID *string, dueAt time.Time) error
	DueEvents(ctx context.Context, now time.Time) ([]DueEvent, error)
	MarkDueEventDone(ctx context.Context, id string) error
	ClosingNoticesDue(ctx context.Context, now time.Time) ([]DueEvent, error)
	MarkClosingNoticeSent(ctx context.Context, lotID, personID string) error
	MarkClosingNoticeDone(ctx context.Context, id string) error
	ClosingNoticeSent(ctx context.Context, lotID, personID string) (bool, error)
}

// DB is every database operation the store performs, inside one transaction.
type DB interface {
	Now(ctx context.Context) (time.Time, error)
	WithTx(ctx context.Context, fn func(ctx context.Context, tx Tx) error) error
}

// loadLotFull reads a lot with its remaining bids and leader details.
func (s *Store) loadLotFull(ctx context.Context, tx Tx, lotID string) (*LotFull, error) {
	lot, err := tx.GetLot(ctx, lotID)
	if err != nil {
		return nil, fmt.Errorf("reading the lot: %w", err)
	}
	if lot == nil {
		return nil, nil
	}
	bids, err := tx.LotBids(ctx, lotID)
	if err != nil {
		return nil, fmt.Errorf("reading the lot's bids: %w", err)
	}
	lf := &LotFull{Lot: *lot, Bids: bids}
	if len(bids) > 0 {
		// The leader is decided by the price rule from the remaining bids.
		p, lead, met := recompute(lf)
		lf.Price = &p
		if lead != nil {
			lf.LeaderBidID = &lead.ID
			lf.LeaderPersonID = &lead.BidderID
			lf.LeaderMax = &lead.MaxAmount
			lf.LeaderPaddle = &lead.Paddle
		} else {
			lf.LeaderBidID = nil
			lf.LeaderPersonID = nil
			lf.LeaderPaddle = nil
		}
		lf.ReserveMet = met
	}
	return lf, nil
}
