package sim

import (
	"errors"
	"time"

	"github.com/cinderlatch/holdfast/internal/store"
)

// The room's domain failures. The API maps each onto its published code.
var (
	ErrRoomFull            = errors.New("room full")
	ErrMatchInProgress     = errors.New("match in progress")
	ErrSeatReleased        = errors.New("seat released")
	ErrInviteExpired       = errors.New("invite expired")
	ErrWrongPhase          = errors.New("wrong phase")
	ErrNotAllReady         = errors.New("not all ready")
	ErrNotHost             = errors.New("not host")
	ErrNotSeated           = errors.New("not seated")
	ErrShopClosed          = errors.New("shop closed")
	ErrInsufficientCredits = errors.New("insufficient credits")
	ErrAtCapacity          = errors.New("at capacity")
	ErrPurchaseConflict    = errors.New("purchase conflict")
	ErrReportConflict      = errors.New("report conflict")
	ErrRoomPaused          = errors.New("room paused")
	ErrPricesUnavailable   = errors.New("prices unavailable")
)

// Seat reports a player's seat in the room.
func (r *Room) Seat(playerID string) (int, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p := r.playerByID(playerID); p != nil {
		return p.Seat, true
	}
	return 0, false
}

// HoldsSeat reports whether a player holds a seat that has not been released.
func (r *Room) HoldsSeat(playerID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	p := r.playerByID(playerID)
	return p != nil && p.Connection != ConnLeft
}

// Touch renews a seated player's lease and reconnects them inside their grace.
func (r *Room) Touch(playerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p := r.playerByID(playerID); p != nil {
		r.touchLocked(p)
	}
}

func (r *Room) touchLocked(p *Player) {
	switch p.Connection {
	case ConnConnected:
		p.LeaseRemainingMS = SeatLeaseMS
	case ConnDisconnected:
		p.Connection = ConnConnected
		p.LeaseRemainingMS = SeatLeaseMS
		p.GraceRemainingMS = 0
		r.logEvent("reconnected", map[string]any{"player": p.ID, "callsign": p.Callsign})
		r.migrateHost()
	}
}

// Join seats a player in the lowest free seat, or hands back the seat they hold.
func (r *Room) Join(playerID, callsign string) (int, StateView, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if existing := r.playerByID(playerID); existing != nil {
		if existing.Connection == ConnLeft {
			return 0, StateView{}, ErrSeatReleased
		}
		r.touchLocked(existing)
		return existing.Seat, r.snapshotLocked(), nil
	}

	if r.phase != PhaseLobby {
		return 0, StateView{}, ErrMatchInProgress
	}
	if !r.clock.Now().Before(r.inviteExpiresAt) {
		return 0, StateView{}, ErrInviteExpired
	}
	seat := r.freeSeat()
	if seat == 0 {
		return 0, StateView{}, ErrRoomFull
	}
	r.seatPlayer(seat, playerID, callsign)
	return seat, r.snapshotLocked(), nil
}

func (r *Room) freeSeat() int {
	for i, p := range r.seats {
		if p == nil {
			return i + 1
		}
	}
	return 0
}

func (r *Room) seatPlayer(seat int, playerID, callsign string) *Player {
	spawn := r.spawnFor(seat)
	aim := 0.0
	if spawn.Aim != nil {
		aim = *spawn.Aim
	}
	p := &Player{
		ID: playerID, Callsign: callsign, Seat: seat,
		Connection: ConnConnected, LeaseRemainingMS: SeatLeaseMS,
		Status: StatusUp, HP: StartHP, X: spawn.X, Z: spawn.Z, Aim: aim,
		Mag: MagSize, Reserve: StartReserve, Grenades: StartGrenades,
	}
	r.seats[seat-1] = p
	return p
}

// Ready toggles a seated player's readiness, which is legal only in the lobby.
func (r *Room) Ready(playerID string, ready bool) (StateView, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.phase != PhaseLobby {
		return StateView{}, ErrWrongPhase
	}
	r.playerByID(playerID).Ready = ready
	return r.snapshotLocked(), nil
}

// Start begins the server countdown.
func (r *Room) Start(playerID string) (StateView, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.hostID != playerID {
		return StateView{}, ErrNotHost
	}
	if r.phase != PhaseLobby {
		return StateView{}, ErrWrongPhase
	}
	seated := r.seated()
	if len(seated) == 0 {
		return StateView{}, ErrNotAllReady
	}
	for _, p := range seated {
		if !p.Ready {
			return StateView{}, ErrNotAllReady
		}
	}

	r.phase = PhaseCountdown
	r.phaseRemainingMS = CountdownMS
	r.wave = 0
	r.startedAt = r.clock.Now()
	r.loadLoadout()
	r.logEvent("phase", map[string]any{
		"phase": PhaseCountdown, "wave": 0, "remaining_ms": CountdownMS,
	})
	return r.snapshotLocked(), nil
}

// loadLoadout puts every seated player at their spawn with a full loadout and
// places the map's barrels.
func (r *Room) loadLoadout() {
	for _, p := range r.seated() {
		spawn := r.spawnFor(p.Seat)
		p.Status = StatusUp
		p.HP = StartHP
		p.X, p.Z = spawn.X, spawn.Z
		if spawn.Aim != nil {
			p.Aim = *spawn.Aim
		}
		p.Mag = MagSize
		p.Reserve = StartReserve
		p.Grenades = StartGrenades
		p.ReloadRemainingMS = 0
		p.ReviveRemainingMS = 0
		p.Score = 0
		p.Kills = 0
		p.MoveX, p.MoveZ = 0, 0
		p.hasShot = false
	}
	r.barrels = nil
	for _, b := range r.gmap.Barrels {
		r.barrels = append(r.barrels, &Barrel{ID: b.ID, HP: BarrelHP, X: b.X, Z: b.Z})
	}
}

// End stops a running match at the host's word.
func (r *Room) End(playerID string) (StateView, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.hostID != playerID {
		return StateView{}, ErrNotHost
	}
	if r.phase == PhaseLobby || r.phase == PhaseOver {
		return StateView{}, ErrWrongPhase
	}
	r.endMatch(ResultEnded)
	return r.snapshotLocked(), nil
}

// Leave frees a seat in the lobby and starts the reconnect grace in a match.
func (r *Room) Leave(playerID string) StateView {
	r.mu.Lock()
	defer r.mu.Unlock()

	p := r.playerByID(playerID)
	if p == nil {
		return r.snapshotLocked()
	}
	if r.phase == PhaseLobby {
		r.seats[p.Seat-1] = nil
	} else if p.Connection != ConnLeft {
		p.Connection = ConnDisconnected
		p.GraceRemainingMS = ReconnectGraceMS
		p.LeaseRemainingMS = 0
	}
	r.migrateHost()
	return r.snapshotLocked()
}

// Input applies a movement intent, ignoring a stale sequence number.
func (r *Room) Input(playerID string, seq int64, moveX, moveZ, aim float64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	p := r.playerByID(playerID)
	if seq <= p.LastInputSeq {
		return false
	}
	p.LastInputSeq = seq
	p.MoveX, p.MoveZ = moveX, moveZ
	p.Aim = aim
	return true
}

// ReportInput is one report exactly as it arrived, with the fingerprint that
// decides whether a reused report id is a replay or a conflict.
type ReportInput struct {
	ReportID     string
	Type         string
	Aim          float64
	TargetX      float64
	TargetZ      float64
	TargetPlayer string
	Fingerprint  string
}

// ApplyReport judges a report at most once per room, storing the full result so a
// replay returns it unchanged.
func (r *Room) ApplyReport(playerID string, in ReportInput) (ReportResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.applyReportLocked(playerID, in)
}

func (r *Room) applyReportLocked(playerID string, in ReportInput) (ReportResult, error) {
	if stored, ok := r.reports[in.ReportID]; ok {
		if r.bodies[in.ReportID] != in.Fingerprint {
			return ReportResult{}, ErrReportConflict
		}
		return stored, nil
	}
	if r.degraded != "" {
		return ReportResult{}, ErrRoomPaused
	}

	p := r.playerByID(playerID)
	result := ReportResult{ReportID: in.ReportID, Type: in.Type, Tick: r.tick}

	var accepted bool
	var reason string
	switch in.Type {
	case "shot":
		var outcome *ShotOutcome
		accepted, reason, outcome = r.shot(p, in.Aim, time.Now())
		if outcome != nil {
			result.Outcome = outcome
		}
	case "reload":
		var outcome *ReloadOutcome
		accepted, reason, outcome = r.reload(p)
		if outcome != nil {
			result.Outcome = outcome
		}
	case "grenade":
		var outcome *GrenadeOutcome
		accepted, reason, outcome = r.grenade(p, in.TargetX, in.TargetZ)
		if outcome != nil {
			result.Outcome = outcome
		}
	case "revive":
		var outcome *ReviveOutcome
		accepted, reason, outcome = r.revive(p, in.TargetPlayer)
		if outcome != nil {
			result.Outcome = outcome
		}
	}

	result.Accepted = accepted
	if !accepted {
		result.Reason = ptrString(reason)
		result.Outcome = nil
	}
	r.reports[in.ReportID] = result
	r.bodies[in.ReportID] = in.Fingerprint
	return result, nil
}

// ApplyReports judges a batch in request order, so a conflicting entry does not
// stop the rest.
func (r *Room) ApplyReports(playerID string, batch []ReportInput) ([]ReportResult, []error, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.degraded != "" {
		return nil, nil, ErrRoomPaused
	}
	results := make([]ReportResult, len(batch))
	failures := make([]error, len(batch))
	for i, in := range batch {
		result, err := r.applyReportLocked(playerID, in)
		results[i], failures[i] = result, err
	}
	return results, failures, nil
}

// Pose judges a vehicle pose.
func (r *Room) Pose(playerID string, seq int64, x, z, heading float64) (PoseResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.degraded != "" {
		return PoseResult{}, ErrRoomPaused
	}
	return r.pose(r.playerByID(playerID), seq, x, z, heading), nil
}

// Purchase buys an item at the price in effect at the server moment of purchase,
// idempotently by purchase id.
func (r *Room) Purchase(playerID, purchaseID, item string) (PurchaseResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if stored, ok := r.purchases[purchaseID]; ok {
		if stored.Item != item {
			return PurchaseResult{}, ErrPurchaseConflict
		}
		return stored, nil
	}
	if r.degraded != "" {
		return PurchaseResult{}, ErrRoomPaused
	}
	if r.phase != PhaseIntermission {
		return PurchaseResult{}, ErrShopClosed
	}

	schedule, loaded := r.prices.Schedule()
	if !loaded {
		return PurchaseResult{}, ErrPricesUnavailable
	}
	now := r.clock.Now()
	row, ok := schedule.InEffectAt(item, now)
	if !ok {
		return PurchaseResult{}, ErrPricesUnavailable
	}

	p := r.playerByID(playerID)
	if r.ledger.Balance(p.ID) < row.Price {
		return PurchaseResult{}, ErrInsufficientCredits
	}
	if item == ItemGrenade && p.Grenades >= MaxGrenades {
		return PurchaseResult{}, ErrAtCapacity
	}

	switch item {
	case ItemAmmoPack:
		p.Reserve = min(p.Reserve+AmmoPackRounds, MaxReserve)
	case ItemGrenade:
		p.Grenades++
	case ItemMedKit:
		p.HP = min(p.HP+MedKitHeal, StartHP)
	}

	priceCopy := row.Price
	itemCopy := item
	r.ledger.Post(p.ID, AccountAmmoStation, -row.Price, KindPurchase,
		"purchase:"+purchaseID, &itemCopy, &priceCopy, now)
	r.logEvent("purchase", map[string]any{
		"player": p.ID, "callsign": p.Callsign, "item": item, "unit_price": row.Price,
	})

	result := PurchaseResult{
		PurchaseID:       purchaseID,
		Item:             item,
		UnitPrice:        row.Price,
		PriceEffectiveAt: row.EffectiveAt.Format(time.RFC3339),
		Balance:          r.ledger.Balance(p.ID),
		Player:           r.playerView(p),
	}
	r.purchases[purchaseID] = result
	return result, nil
}

// LedgerView reports the room's balances and entries.
func (r *Room) LedgerView() (map[string]int, []LedgerEntry, int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.ledger.Balances(), r.ledger.Entries(), r.ledger.Total()
}

// SetDegraded freezes or resumes the room when the room registry goes and
// returns.
func (r *Room) SetDegraded(reason string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.degraded == reason {
		return false
	}
	r.degraded = reason
	return true
}

// Degraded reports the room's degraded reason.
func (r *Room) Degraded() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.degraded
}

// RegistryFields reports what the room writes into the room registry.
func (r *Room) RegistryFields() (mode, host, phase, createdAt, inviteExpiresAt string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.mode, r.hostID, r.phase, r.createdAt.Format(time.RFC3339), r.inviteExpiresAt.Format(time.RFC3339)
}

// FinishedMatch is everything a finished match writes to Postgres.
type FinishedMatch struct {
	Match   store.Match
	Laps    []store.Lap
	Entries []store.LedgerEntry
}

// OverSince reports when the room reached over, and whether it has.
func (r *Room) OverSince() (time.Time, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.overSince, r.phase == PhaseOver
}
