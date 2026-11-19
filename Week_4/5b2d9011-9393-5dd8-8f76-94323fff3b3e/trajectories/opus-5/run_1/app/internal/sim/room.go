package sim

import (
	"math"
	"strconv"
	"sync"
	"time"

	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/gamemap"
	"github.com/cinderlatch/holdfast/internal/pricing"
	"github.com/cinderlatch/holdfast/internal/store"
)

// Room is one live room. Every field is guarded by its mutex, and every rule the
// room decides runs under it, so reports resolve in the order received.
type Room struct {
	mu sync.Mutex

	code    string
	mode    string
	gmap    *gamemap.Map
	nightID *string

	clock  *clockx.Clock
	prices *pricing.Cache

	phase  string
	wave   int
	result string
	hostID string

	createdAt       time.Time
	inviteExpiresAt time.Time
	startedAt       time.Time
	endedAt         time.Time
	overSince       time.Time

	tick             int64
	phaseRemainingMS int64

	seats    [Seats]*Player
	enemies  []*Enemy
	barrels  []*Barrel
	grenades []*Grenade
	vehicles map[string]*Vehicle

	events   []Event
	eventSeq int64

	ledger    *Ledger
	reports   map[string]ReportResult
	bodies    map[string]string
	purchases map[string]PurchaseResult
	laps      []store.Lap

	wavesCleared int
	finished     *FinishedMatch

	grenadeSeq int

	degraded string

	subscribers map[int]chan StateView
	nextSub     int
}

const eventHistory = 100

func newRoom(code, mode string, nightID *string, clock *clockx.Clock, prices *pricing.Cache) *Room {
	// Published instants read to the second, so the invite's expiry sits on a
	// whole second and the boundary the API publishes is the one it enforces.
	now := clock.Now().Truncate(time.Second)
	return &Room{
		code:            code,
		mode:            mode,
		gmap:            gamemap.ForMode(mode),
		nightID:         nightID,
		clock:           clock,
		prices:          prices,
		phase:           PhaseLobby,
		createdAt:       now,
		inviteExpiresAt: now.Add(InviteTTL),
		vehicles:        map[string]*Vehicle{},
		ledger:          newLedger(),
		reports:         map[string]ReportResult{},
		bodies:          map[string]string{},
		purchases:       map[string]PurchaseResult{},
		subscribers:     map[int]chan StateView{},
	}
}

// Code reports the room code, always upper case.
func (r *Room) Code() string { return r.code }

// Mode reports the room mode.
func (r *Room) Mode() string { return r.mode }

// logEvent appends an event, keeping the latest hundred.
func (r *Room) logEvent(kind string, fields map[string]any) {
	r.eventSeq++
	r.events = append(r.events, Event{Seq: r.eventSeq, Type: kind, Tick: r.tick, Fields: fields})
	if len(r.events) > eventHistory {
		r.events = r.events[len(r.events)-eventHistory:]
	}
}

// seated reports the occupied seats in seat order.
func (r *Room) seated() []*Player {
	out := make([]*Player, 0, Seats)
	for _, p := range r.seats {
		if p != nil {
			out = append(out, p)
		}
	}
	return out
}

func (r *Room) playerByID(id string) *Player {
	for _, p := range r.seats {
		if p != nil && p.ID == id {
			return p
		}
	}
	return nil
}

// isUp reports whether a player counts as up. A released seat never does.
func (p *Player) isUp() bool {
	return p.Status == StatusUp && p.Connection != ConnLeft
}

// inWave reports whether the phase is one a shot or grenade may happen in.
func (r *Room) inWave() bool {
	return r.phase == PhaseWave || r.phase == PhaseBossWave
}

// Tick advances the room one server tick.
func (r *Room) Tick() {
	r.mu.Lock()
	defer r.mu.Unlock()

	// A room that lost the room registry freezes every timer and enemy until it
	// is back, and keeps streaming the frozen values.
	if r.degraded != "" {
		r.broadcastLocked()
		return
	}

	r.tick++

	switch r.phase {
	case PhaseCountdown:
		r.advancePhaseTimer()
	case PhaseWave, PhaseBossWave:
		r.simulateWave()
	case PhaseIntermission:
		r.simulateIntermission()
	case PhaseRace:
		r.simulateRace()
	}

	if r.phase != PhaseOver {
		r.tickLeases()
		r.checkAbandoned()
	}
	r.broadcastLocked()
}

func (r *Room) advancePhaseTimer() {
	r.phaseRemainingMS -= tickMS
	if r.phaseRemainingMS > 0 {
		return
	}
	r.phaseRemainingMS = 0
	if r.mode == "convoy" {
		r.beginRace()
		return
	}
	r.beginWave(1)
}

func (r *Room) simulateIntermission() {
	r.phaseRemainingMS -= tickMS
	r.advanceGrenades()
	r.advanceReloads()
	r.advanceReviveWindows()
	if r.checkDefeat() {
		return
	}
	if r.phaseRemainingMS <= 0 {
		r.phaseRemainingMS = 0
		r.beginWave(r.wave + 1)
	}
}

func (r *Room) simulateWave() {
	r.movePlayers()
	r.advanceEnemies()
	r.advanceGrenades()
	r.advanceReloads()
	r.advanceReviveWindows()
	if r.checkDefeat() {
		return
	}
	r.checkWaveCleared()
}

// beginWave spawns a wave's enemies. Wave 4 is the boss wave.
func (r *Room) beginWave(wave int) {
	r.wave = wave
	if wave == BossWave {
		r.phase = PhaseBossWave
	} else {
		r.phase = PhaseWave
	}
	r.phaseRemainingMS = 0
	r.enemies = nil
	for _, spec := range r.gmap.Waves {
		if spec.Wave != wave {
			continue
		}
		for _, e := range spec.Enemies {
			r.enemies = append(r.enemies, &Enemy{
				ID: e.ID, Kind: e.Kind, State: EnemyPatrol, HP: enemyHP(e.Kind),
				X: e.X, Z: e.Z, spawnX: e.X, spawnZ: e.Z, patrolDir: 1,
			})
		}
	}
	fields := map[string]any{"phase": r.phase, "wave": wave}
	r.logEvent("phase", fields)
}

// checkWaveCleared ends a wave the tick its last enemy dies.
func (r *Room) checkWaveCleared() {
	for _, e := range r.enemies {
		if e.State != EnemyDead {
			return
		}
	}
	cleared := r.wave
	r.payWaveBonus()
	r.wavesCleared++
	r.logEvent("wave_cleared", map[string]any{"wave": cleared, "bonus": WaveBonus})

	if cleared == BossWave {
		r.endMatch(ResultVictory)
		return
	}
	r.phase = PhaseIntermission
	r.phaseRemainingMS = IntermissionMS
	r.respawnOutPlayers()
	next := cleared + 1
	r.logEvent("phase", map[string]any{
		"phase": PhaseIntermission, "wave": r.wave,
		"remaining_ms": IntermissionMS, "next_wave": next,
	})
}

// payWaveBonus pays every player who is up in this tick.
func (r *Room) payWaveBonus() {
	now := r.clock.Now()
	ref := "wave_bonus:" + r.code + ":" + strconv.Itoa(r.wave)
	for _, p := range r.seated() {
		if !p.isUp() {
			continue
		}
		r.ledger.Post(p.ID, AccountRewards, WaveBonus, KindWaveBonus, ref, nil, nil, now)
	}
}

// respawnOutPlayers puts every out player back at their seat's spawn point at the
// start of an intermission.
func (r *Room) respawnOutPlayers() {
	for _, p := range r.seated() {
		if p.Status != StatusOut || p.Connection == ConnLeft {
			continue
		}
		spawn := r.spawnFor(p.Seat)
		p.Status = StatusUp
		p.HP = StartHP
		p.Mag = MagSize
		p.X, p.Z = spawn.X, spawn.Z
		if spawn.Aim != nil {
			p.Aim = *spawn.Aim
		}
		p.ReloadRemainingMS = 0
		p.ReviveRemainingMS = 0
		r.logEvent("player_respawned", map[string]any{"player": p.ID, "callsign": p.Callsign})
	}
}

func (r *Room) spawnFor(seat int) gamemap.Spawn {
	for _, s := range r.gmap.Spawns {
		if s.Seat == seat {
			return s
		}
	}
	return r.gmap.Spawns[0]
}

// checkDefeat ends the match the tick no player is up.
func (r *Room) checkDefeat() bool {
	for _, p := range r.seated() {
		if p.isUp() {
			return false
		}
	}
	if len(r.seated()) == 0 {
		return false
	}
	r.endMatch(ResultDefeat)
	return true
}

// checkAbandoned ends a room whose seats are all released.
func (r *Room) checkAbandoned() {
	for _, p := range r.seated() {
		if p.Connection != ConnLeft {
			return
		}
	}
	if r.phase == PhaseLobby && len(r.seated()) == 0 {
		r.endMatch(ResultEnded)
		return
	}
	if len(r.seated()) == 0 {
		return
	}
	r.endMatch(ResultEnded)
}

// endMatch moves the room to over, stamps its result and makes up the record the
// match history stores.
func (r *Room) endMatch(result string) {
	r.phase = PhaseOver
	r.result = result
	r.phaseRemainingMS = 0
	r.endedAt = r.clock.Now()
	r.overSince = time.Now()
	r.logEvent("phase", map[string]any{"phase": PhaseOver, "wave": r.wave, "result": result})
	r.finished = r.buildFinishedMatch()
}

// buildFinishedMatch records the result, each seated player in seat order and the
// room's laps and ledger entries.
func (r *Room) buildFinishedMatch() *FinishedMatch {
	matchID := store.NewID()
	match := store.Match{
		ID: matchID, Code: r.code, Mode: r.mode, Result: r.result,
		WavesCleared: r.wavesCleared, NightID: r.nightID,
		StartedAt: r.startedAt, EndedAt: r.endedAt,
	}
	for _, p := range r.seated() {
		row := store.MatchPlayer{
			Seat: p.Seat, PlayerID: p.ID, Callsign: p.Callsign,
			Score: p.Score, Kills: p.Kills,
			CreditsEarned: r.ledger.CreditsEarned(p.ID),
		}
		if best := r.bestLapFor(p.ID); best > 0 {
			row.BestLapMS = ptrInt(best)
		}
		match.Players = append(match.Players, row)
	}

	entries := make([]store.LedgerEntry, 0, len(r.ledger.entries))
	for _, e := range r.ledger.Entries() {
		entries = append(entries, store.LedgerEntry{
			ID: matchID + ":" + e.ID, Code: r.code, Account: e.Account,
			Amount: e.Amount, Kind: e.Kind, Ref: e.Ref,
			Item: e.Item, UnitPrice: e.UnitPrice, At: e.at,
		})
	}
	laps := make([]store.Lap, len(r.laps))
	copy(laps, r.laps)
	return &FinishedMatch{Match: match, Laps: laps, Entries: entries}
}

// TakeFinished hands the finished record to its one writer.
func (r *Room) TakeFinished() (*FinishedMatch, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.finished == nil {
		return nil, false
	}
	record := r.finished
	r.finished = nil
	return record, true
}

func (r *Room) movePlayers() {
	const dt = float64(tickMS) / 1000
	for _, p := range r.seated() {
		if !p.isUp() {
			continue
		}
		moveX, moveZ := p.MoveX, p.MoveZ
		length := math.Hypot(moveX, moveZ)
		if length == 0 {
			continue
		}
		if length > 1 {
			moveX, moveZ = moveX/length, moveZ/length
		}
		p.X, p.Z = r.step(p.X, p.Z, moveX*PlayerSpeed*dt, moveZ*PlayerSpeed*dt)
	}
}

// step moves a point by a delta without ever entering a solid block cell or
// leaving the map, sliding along a block it would have entered.
func (r *Room) step(x, z, dx, dz float64) (float64, float64) {
	tryX, tryZ := r.gmap.Clamp(x+dx, z+dz)
	if !r.gmap.SolidAt(tryX, tryZ) {
		return tryX, tryZ
	}
	if slideX, _ := r.gmap.Clamp(x+dx, z); !r.gmap.SolidAt(slideX, z) {
		return slideX, z
	}
	if _, slideZ := r.gmap.Clamp(x, z+dz); !r.gmap.SolidAt(x, slideZ) {
		return x, slideZ
	}
	return x, z
}

func (r *Room) advanceReloads() {
	for _, p := range r.seated() {
		if p.ReloadRemainingMS <= 0 {
			continue
		}
		p.ReloadRemainingMS -= tickMS
		if p.ReloadRemainingMS > 0 {
			continue
		}
		p.ReloadRemainingMS = 0
		moved := MagSize - p.Mag
		if p.Reserve < moved {
			moved = p.Reserve
		}
		p.Mag += moved
		p.Reserve -= moved
	}
}

func (r *Room) advanceReviveWindows() {
	for _, p := range r.seated() {
		if p.Status != StatusDowned {
			continue
		}
		p.ReviveRemainingMS -= tickMS
		if p.ReviveRemainingMS > 0 {
			continue
		}
		p.ReviveRemainingMS = 0
		p.Status = StatusOut
		r.logEvent("player_out", map[string]any{"player": p.ID, "callsign": p.Callsign})
	}
}

func (r *Room) advanceGrenades() {
	var queue []blast
	remaining := r.grenades[:0]
	for _, g := range r.grenades {
		g.FuseRemainingMS -= tickMS
		if g.FuseRemainingMS > 0 {
			remaining = append(remaining, g)
			continue
		}
		queue = append(queue, blast{
			source: "grenade:" + g.ID, owner: g.Owner, x: g.X, z: g.Z,
			radius: GrenadeRadius, maxDamage: GrenadeMaxDamage,
		})
	}
	r.grenades = remaining
	if len(queue) > 0 {
		r.resolveExplosions(queue)
	}
}

// tickLeases runs the seat leases, the reconnect graces and host migration.
func (r *Room) tickLeases() {
	changed := false
	for seat, p := range r.seats {
		if p == nil {
			continue
		}
		switch p.Connection {
		case ConnConnected:
			p.LeaseRemainingMS -= tickMS
			if p.LeaseRemainingMS > 0 {
				continue
			}
			p.LeaseRemainingMS = 0
			p.Connection = ConnDisconnected
			p.GraceRemainingMS = ReconnectGraceMS
			r.logEvent("disconnected", map[string]any{"player": p.ID, "callsign": p.Callsign})
			changed = true
		case ConnDisconnected:
			p.GraceRemainingMS -= tickMS
			if p.GraceRemainingMS > 0 {
				continue
			}
			p.GraceRemainingMS = 0
			r.releaseSeat(seat)
			changed = true
		}
	}
	if changed {
		r.migrateHost()
	}
}

// releaseSeat frees a seat in the lobby and marks it left during a match.
func (r *Room) releaseSeat(seat int) {
	p := r.seats[seat]
	r.logEvent("released", map[string]any{"player": p.ID, "callsign": p.Callsign})
	if r.phase == PhaseLobby {
		r.seats[seat] = nil
		return
	}
	p.Connection = ConnLeft
	p.Status = StatusOut
	p.ReviveRemainingMS = 0
}

// migrateHost passes hosting to the connected player in the lowest seat.
func (r *Room) migrateHost() {
	host := r.playerByID(r.hostID)
	if host != nil && host.Connection == ConnConnected {
		return
	}
	for _, p := range r.seats {
		if p == nil || p.Connection != ConnConnected {
			continue
		}
		if p.ID != r.hostID {
			r.hostID = p.ID
			r.logEvent("host_changed", map[string]any{"host": p.ID, "callsign": p.Callsign})
		}
		return
	}
}

// Snapshot renders the room state.
func (r *Room) Snapshot() StateView {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshotLocked()
}

func (r *Room) snapshotLocked() StateView {
	now := r.clock.Now()
	view := StateView{
		Code:            r.code,
		Mode:            r.mode,
		Phase:           r.phase,
		Wave:            r.wave,
		Tick:            r.tick,
		ServerTime:      now.Format(time.RFC3339),
		Host:            r.hostID,
		NightID:         r.nightID,
		InviteExpiresAt: r.inviteExpiresAt.Format(time.RFC3339),
		Players:         []PlayerView{},
		Enemies:         []EnemyView{},
		Barrels:         []BarrelView{},
		Grenades:        []GrenadeView{},
		Vehicles:        []VehicleView{},
		Events:          append([]Event{}, r.events...),
	}
	if r.phase == PhaseCountdown || r.phase == PhaseIntermission {
		view.PhaseRemainingMS = ptrInt64(r.phaseRemainingMS)
	}
	if r.phase == PhaseLobby && now.Before(r.inviteExpiresAt) {
		view.InviteRemainingMS = ptrInt64(r.inviteExpiresAt.Sub(now).Milliseconds())
	}
	if r.degraded != "" {
		view.Degraded = ptrString(r.degraded)
	}
	if r.result != "" {
		view.Result = ptrString(r.result)
	}

	for _, p := range r.seated() {
		view.Players = append(view.Players, r.playerView(p))
	}
	for _, e := range r.enemies {
		view.Enemies = append(view.Enemies, EnemyView{
			ID: e.ID, Kind: e.Kind, State: e.State, HP: e.HP,
			X: round4(e.X), Z: round4(e.Z),
		})
	}
	for _, b := range r.barrels {
		view.Barrels = append(view.Barrels, BarrelView{
			ID: b.ID, HP: b.HP, X: round4(b.X), Z: round4(b.Z), Destroyed: b.Destroyed,
		})
	}
	for _, g := range r.grenades {
		view.Grenades = append(view.Grenades, GrenadeView{
			ID: g.ID, Owner: g.Owner, X: round4(g.X), Z: round4(g.Z),
			FuseRemainingMS: g.FuseRemainingMS,
		})
	}
	view.Shop = r.shopView(now)
	for _, p := range r.seated() {
		if v, ok := r.vehicles[p.ID]; ok {
			view.Vehicles = append(view.Vehicles, r.vehicleView(v))
		}
	}
	return view
}

func (r *Room) playerView(p *Player) PlayerView {
	view := PlayerView{
		ID: p.ID, Callsign: p.Callsign, Seat: p.Seat, Ready: p.Ready,
		Connection: p.Connection, Status: p.Status, HP: p.HP,
		X: round4(p.X), Z: round4(p.Z), Aim: round4(p.Aim),
		LastInputSeq: p.LastInputSeq, Mag: p.Mag, Reserve: p.Reserve,
		Grenades: p.Grenades, Credits: r.ledger.Balance(p.ID),
		Score: p.Score, Kills: p.Kills,
	}
	if p.Connection == ConnDisconnected {
		view.GraceRemainingMS = ptrInt64(p.GraceRemainingMS)
	}
	if p.ReloadRemainingMS > 0 {
		view.ReloadRemainingMS = ptrInt64(p.ReloadRemainingMS)
	}
	if p.Status == StatusDowned {
		view.ReviveRemainingMS = ptrInt64(p.ReviveRemainingMS)
	}
	return view
}

func (r *Room) shopView(now time.Time) ShopView {
	view := ShopView{Open: r.phase == PhaseIntermission, Items: []ShopItemView{}}
	schedule, loaded := r.prices.Schedule()
	for _, item := range store.SeedItems {
		entry := ShopItemView{Item: item.Item, Name: item.Name}
		if loaded {
			entry.Price = schedule.PriceAt(item.Item, now)
			if next, ok := schedule.NextChangeAt(item.Item, now); ok {
				entry.NextPrice = ptrInt(next.Price)
				entry.NextChangeInMS = ptrInt64(next.EffectiveAt.Sub(now).Milliseconds())
			}
		}
		view.Items = append(view.Items, entry)
	}
	return view
}

func (r *Room) vehicleView(v *Vehicle) VehicleView {
	view := VehicleView{
		Player: v.PlayerID, State: v.State,
		X: round4(v.X), Z: round4(v.Z), Heading: round4(v.Heading),
		LastSeq: v.LastSeq, NextCheckpoint: v.NextCheckpoint, LapsDone: v.LapsDone,
	}
	if !v.lapClockFrozen {
		view.LapElapsedMS = time.Since(v.lapStart).Milliseconds()
	}
	if v.BestLapMS > 0 {
		view.BestLapMS = ptrInt(v.BestLapMS)
	}
	if v.State == VehicleWrecked {
		view.ResetRemainingMS = ptrInt64(v.ResetRemainingMS)
	}
	return view
}

// Subscribe opens a snapshot stream at the server tick rate.
func (r *Room) Subscribe() (<-chan StateView, func()) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.nextSub++
	id := r.nextSub
	ch := make(chan StateView, 4)
	r.subscribers[id] = ch
	return ch, func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		if existing, ok := r.subscribers[id]; ok {
			delete(r.subscribers, id)
			close(existing)
		}
	}
}

// broadcastLocked hands the latest snapshot to every open stream, skipping a
// stream that has not kept up.
func (r *Room) broadcastLocked() {
	if len(r.subscribers) == 0 {
		return
	}
	view := r.snapshotLocked()
	for _, ch := range r.subscribers {
		select {
		case ch <- view:
		default:
		}
	}
}

// nearestUpPlayer reports the up player closest to a point.
func (r *Room) nearestUpPlayer(x, z float64) (*Player, float64) {
	var best *Player
	bestDist := math.Inf(1)
	for _, p := range r.seated() {
		if !p.isUp() {
			continue
		}
		if d := math.Hypot(p.X-x, p.Z-z); d < bestDist {
			best, bestDist = p, d
		}
	}
	return best, bestDist
}
