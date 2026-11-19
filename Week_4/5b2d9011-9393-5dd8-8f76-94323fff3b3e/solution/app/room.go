package main

import (
	"context"
	"log"
	"math"
	"sort"
	"strconv"
	"sync"
	"time"
)

const (
	tickDur           = 50 * time.Millisecond
	tickHz            = 20
	countdownTicks    = 100
	intermissionTicks = 400
	reloadTicks       = 36
	fuseTicks         = 60
	reviveTicks       = 200
	leaseDur          = leaseSeconds * time.Second
	graceDur          = graceSeconds * time.Second
	inviteLifetime    = 15 * time.Minute
	maxSeats          = 4
	maxEvents         = 100
	lingerAfterOver   = roomLingerSecond * time.Second
)

const (
	modeSiege  = "siege"
	modeConvoy = "convoy"
)

const (
	phaseLobby        = "lobby"
	phaseCountdown    = "countdown"
	phaseWave         = "wave"
	phaseIntermission = "intermission"
	phaseBossWave     = "boss_wave"
	phaseRace         = "race"
	phaseOver         = "over"
	degradedRegistry  = "room_registry"
)

const (
	connConnected    = "connected"
	connDisconnected = "disconnected"
	connLeft         = "left"
	statusUp         = "up"
	statusDowned     = "downed"
	statusOut        = "out"
)

type seat struct {
	playerID   string
	callsign   string
	number     int
	ready      bool
	connection string
	leaseUntil time.Duration
	graceEnd   time.Duration
	lastMirror time.Time

	status       string
	hp           int
	x, z, aim    float64
	lastInputSeq int
	moveX, moveZ float64
	mag, reserve int
	grenades     int
	reloadEnd    time.Duration
	reloading    bool
	lastShotAt   time.Duration
	hasShot      bool
	reviveEnd    time.Duration
	credits      int
	score, kills int
	vehicle      *vehicle
}

type room struct {
	mu  sync.Mutex
	srv *server

	code            string
	mode            string
	gmap            *gameMap
	createdAt       time.Time
	inviteExpiresAt time.Time
	nightID         string

	phase        string
	wave         int
	phaseEndTick int
	result       string
	host         string
	seats        []*seat
	degraded     string

	epoch       time.Time
	lastAdvance time.Time
	clockNow    time.Duration
	tick        int
	overSince   time.Time

	enemies  []*enemy
	barrels  []*barrel
	grenades []*grenade

	events   []map[string]any
	eventSeq int

	reports   map[string]*storedReport
	purchases map[string]*storedPurchase
	ledger    []ledgerEntry

	matchID      string
	startedAt    time.Time
	wavesCleared int
	grenadeCount int
}

func newRoom(srv *server, code, mode string, now time.Time) *room {
	r := &room{
		srv: srv, code: code, mode: mode, createdAt: now, inviteExpiresAt: now.Add(inviteLifetime).Truncate(time.Second),
		phase: phaseLobby, epoch: time.Now(), lastAdvance: time.Now(),
		reports: map[string]*storedReport{}, purchases: map[string]*storedPurchase{},
	}
	if mode == modeSiege {
		r.gmap = breakwaterYard
		for _, b := range r.gmap.barrels {
			r.barrels = append(r.barrels, &barrel{id: b.id, x: b.x, z: b.z, hp: barrelHealth})
		}
	} else {
		r.gmap = saltpanLoop
	}
	return r
}

// inviteOpen reports whether new joins are still accepted: strictly before the expiry instant.
func (r *room) inviteOpen(now time.Time) bool { return now.Before(r.inviteExpiresAt) }

func (r *room) tickTime() time.Duration { return time.Duration(r.tick) * tickDur }

func (r *room) remainingMs(end time.Duration) int64 {
	return (end - r.tickTime()).Milliseconds()
}

func ticksFrom(now time.Duration, ticks int) time.Duration { return now + time.Duration(ticks)*tickDur }

func (r *room) seatOf(playerID string) *seat {
	for _, s := range r.seats {
		if s.playerID == playerID {
			return s
		}
	}
	return nil
}

func (r *room) fields() roomFields {
	return roomFields{code: r.code, mode: r.mode, host: r.host, phase: r.phase,
		createdAt: r.createdAt, inviteExpiresAt: r.inviteExpiresAt}
}

// mirror records the outcome of a registry write; a Valkey outage is handled by the room
// degrading, so only other failures are logged.
func (r *room) mirror(err error) {
	if err != nil && !isValkeyDown(err) {
		log.Printf("room %s: registry: %v", r.code, err)
	}
}

func (r *room) emit(kind string, fields map[string]any) {
	r.eventSeq++
	event := map[string]any{"seq": r.eventSeq, "type": kind, "tick": r.tick}
	for k, v := range fields {
		event[k] = v
	}
	r.events = append(r.events, event)
	if len(r.events) > maxEvents {
		r.events = r.events[len(r.events)-maxEvents:]
	}
}

func (r *room) setPhase(phase string) {
	r.phase = phase
	r.mirror(r.srv.reg.syncRoom(r.fields()))
}

// advance runs the simulation up to the present moment. Every handler calls it first.
func (r *room) advance() {
	if r.phase == phaseOver {
		return
	}
	now := time.Now()
	available := r.srv.reg.available()
	if r.degraded == "" && !available {
		r.degraded = degradedRegistry
	} else if r.degraded != "" && available && r.rewriteRegistry() == nil {
		r.degraded = ""
		r.lastAdvance = now
	}
	if r.degraded != "" {
		r.epoch = r.epoch.Add(now.Sub(r.lastAdvance))
		r.lastAdvance = now
		return
	}
	r.lastAdvance = now
	r.clockNow = now.Sub(r.epoch)
	target := int(r.clockNow / tickDur)
	for r.tick < target && r.phase != phaseOver {
		r.step()
	}
}

// rewriteRegistry restores this room's registry keys after Valkey returns.
func (r *room) rewriteRegistry() error {
	commands := [][]string{r.srv.reg.hashCommand(r.fields())}
	for _, s := range r.seats {
		switch s.connection {
		case connConnected:
			commands = append(commands, []string{"SET", seatKey(r.code, s.playerID), "1", "EX", strconv.Itoa(leaseSeconds)})
		case connDisconnected:
			left := int((s.graceEnd - r.tickTime() + time.Second - 1) / time.Second)
			commands = append(commands, []string{"SET", graceKey(r.code, s.playerID), "1", "EX", strconv.Itoa(max(1, left))})
		}
	}
	if len(r.reports) > 0 {
		args := []string{"HSET", reportsKey(r.code)}
		for id, rep := range r.reports {
			args = append(args, id, rep.resultJSON)
		}
		commands = append(commands, args)
	}
	return r.srv.reg.run(commands...)
}

// step advances the simulation by one 50 ms tick.
func (r *room) step() {
	r.tick++
	r.checkLeases()
	switch r.phase {
	case phaseCountdown:
		if r.tick >= r.phaseEndTick {
			if r.mode == modeSiege {
				r.startWave(1)
			} else {
				r.startRace()
			}
		}
	case phaseWave, phaseBossWave:
		r.simulateSiege()
	case phaseIntermission:
		r.movePlayers()
		r.expireRevives()
		if r.tick >= r.phaseEndTick {
			r.startWave(r.wave + 1)
		}
	case phaseRace:
		r.simulateConvoy()
	}
}

// ---- seats, leases, grace and host

func (r *room) connectedSeats() []*seat {
	var out []*seat
	for _, s := range r.seats {
		if s.connection == connConnected {
			out = append(out, s)
		}
	}
	return out
}

// touch renews a seat's lease; a disconnected seat inside its grace reconnects.
func (r *room) touch(s *seat) {
	switch s.connection {
	case connLeft:
		return
	case connDisconnected:
		if s.graceEnd <= r.tickTime() {
			return
		}
		s.connection = connConnected
		r.mirror(r.srv.reg.endGrace(r.code, s.playerID))
		r.emit("reconnected", map[string]any{"player": s.playerID})
		if r.host == "" {
			r.setHost(s.playerID)
		}
	}
	s.leaseUntil = r.clockNow + leaseDur
	if time.Since(s.lastMirror) > time.Second {
		s.lastMirror = time.Now()
		r.mirror(r.srv.reg.renewLease(r.code, s.playerID))
	}
}

func (r *room) setHost(playerID string) {
	r.host = playerID
	r.emit("host_changed", map[string]any{"host": playerID})
	r.mirror(r.srv.reg.syncRoom(r.fields()))
}

// migrateHost passes hosting to the connected player in the lowest seat.
func (r *room) migrateHost() {
	for _, s := range r.connectedSeats() {
		r.setHost(s.playerID)
		return
	}
	r.host = ""
	r.mirror(r.srv.reg.syncRoom(r.fields()))
}

func (r *room) checkLeases() {
	for _, s := range append([]*seat(nil), r.seats...) {
		switch s.connection {
		case connConnected:
			if r.clockNow >= s.leaseUntil {
				r.disconnect(s)
			}
		case connDisconnected:
			if r.tickTime() >= s.graceEnd {
				r.release(s)
			}
		}
	}
}

func (r *room) disconnect(s *seat) {
	s.connection = connDisconnected
	s.graceEnd = r.tickTime() + graceDur
	s.moveX, s.moveZ = 0, 0
	r.emit("disconnected", map[string]any{"player": s.playerID})
	r.mirror(r.srv.reg.dropLease(r.code, s.playerID))
	r.mirror(r.srv.reg.startGrace(r.code, s.playerID))
	if r.host == s.playerID {
		r.migrateHost()
	}
	if r.phase == phaseRace {
		r.finishRaceIfDone()
	}
}

// release ends a seat's grace: the lobby seat is freed, a match seat becomes left.
func (r *room) release(s *seat) {
	r.mirror(r.srv.reg.endGrace(r.code, s.playerID))
	r.emit("released", map[string]any{"player": s.playerID})
	if r.phase == phaseLobby {
		r.removeSeat(s)
	} else {
		s.connection = connLeft
		s.status = statusOut
		s.moveX, s.moveZ = 0, 0
		r.srv.hub.forget(s.playerID)
	}
	r.endIfEmpty()
}

func (r *room) removeSeat(s *seat) {
	for i, other := range r.seats {
		if other == s {
			r.seats = append(r.seats[:i], r.seats[i+1:]...)
			break
		}
	}
	r.srv.hub.forget(s.playerID)
	r.mirror(r.srv.reg.dropLease(r.code, s.playerID))
	r.mirror(r.srv.reg.endGrace(r.code, s.playerID))
	if r.host == s.playerID {
		r.migrateHost()
	}
}

// endIfEmpty ends a room whose seats are all released.
func (r *room) endIfEmpty() {
	if r.phase == phaseOver {
		return
	}
	for _, s := range r.seats {
		if s.connection != connLeft {
			return
		}
	}
	r.finish("ended")
}

func (r *room) leave(s *seat) {
	if r.phase == phaseLobby {
		r.removeSeat(s)
		r.endIfEmpty()
		return
	}
	if s.connection == connConnected {
		r.disconnect(s)
	}
}

// ---- lobby commands

func (r *room) addSeat(p player) *seat {
	number := 1
	for r.seatNumbered(number) != nil {
		number++
	}
	sp := r.gmap.spawn(number)
	s := &seat{playerID: p.ID, callsign: p.Callsign, number: number, connection: connConnected,
		status: statusUp, hp: startHealth, x: sp.x, z: sp.z, aim: sp.heading,
		mag: magazineSize, reserve: startReserve, grenades: startGrenades}
	r.seats = append(r.seats, s)
	sort.Slice(r.seats, func(i, j int) bool { return r.seats[i].number < r.seats[j].number })
	r.srv.hub.remember(p.ID, r.code)
	r.touch(s)
	return s
}

func (r *room) seatNumbered(number int) *seat {
	for _, s := range r.seats {
		if s.number == number {
			return s
		}
	}
	return nil
}

func (r *room) allReady() bool {
	for _, s := range r.seats {
		if !s.ready {
			return false
		}
	}
	return len(r.seats) > 0
}

func (r *room) start() {
	r.startedAt = r.srv.clock.Now()
	r.matchID = newID("m_")
	r.phaseEndTick = r.tick + countdownTicks
	if r.mode == modeConvoy {
		r.createVehicles()
	}
	r.setPhase(phaseCountdown)
	r.emit("phase", map[string]any{"phase": phaseCountdown, "wave": r.wave, "remaining_ms": countdownTicks * int(tickDur.Milliseconds())})
}

// finish ends the match with a result and stores it in history.
func (r *room) finish(result string) {
	r.result = result
	r.overSince = time.Now()
	r.phase = phaseOver
	r.emit("phase", map[string]any{"phase": phaseOver, "wave": r.wave, "result": result})
	ids := make([]string, 0, len(r.seats))
	for _, s := range r.seats {
		ids = append(ids, s.playerID)
		r.srv.hub.forget(s.playerID)
	}
	r.mirror(r.srv.reg.syncRoom(r.fields()))
	r.mirror(r.srv.reg.retire(r.code, ids))
	if !r.startedAt.IsZero() {
		r.saveMatch(result)
	}
}

func (r *room) creditsEarned(playerID string) int {
	total := 0
	for _, e := range r.ledger {
		if e.account == playerID && e.amount > 0 {
			total += e.amount
		}
	}
	return total
}

func (r *room) saveMatch(result string) {
	rec := matchRecord{ID: r.matchID, Code: r.code, Mode: r.mode, Result: result, WavesCleared: r.wavesCleared,
		NightID: r.nightID, StartedAt: r.startedAt, EndedAt: r.srv.clock.Now()}
	for _, s := range r.seats {
		p := matchPlayerRecord{Seat: s.number, PlayerID: s.playerID, Callsign: s.callsign, Score: s.score,
			Kills: s.kills, CreditsEarned: r.creditsEarned(s.playerID)}
		if s.vehicle != nil && s.vehicle.best > 0 {
			best := s.vehicle.best
			p.BestLapMs = &best
		}
		rec.Players = append(rec.Players, p)
	}
	r.srv.persist.add(func(ctx context.Context) error { return r.srv.store.saveMatch(ctx, rec) })
}

// ---- state JSON

type playerJSON struct {
	ID                string  `json:"id"`
	Callsign          string  `json:"callsign"`
	Seat              int     `json:"seat"`
	Ready             bool    `json:"ready"`
	Connection        string  `json:"connection"`
	GraceRemainingMs  *int64  `json:"grace_remaining_ms"`
	Status            string  `json:"status"`
	HP                int     `json:"hp"`
	X                 float64 `json:"x"`
	Z                 float64 `json:"z"`
	Aim               float64 `json:"aim"`
	LastInputSeq      int     `json:"last_input_seq"`
	Mag               int     `json:"mag"`
	Reserve           int     `json:"reserve"`
	Grenades          int     `json:"grenades"`
	ReloadRemainingMs *int64  `json:"reload_remaining_ms"`
	ReviveRemainingMs *int64  `json:"revive_remaining_ms"`
	Credits           int     `json:"credits"`
	Score             int     `json:"score"`
	Kills             int     `json:"kills"`
}

type enemyJSON struct {
	ID    string  `json:"id"`
	Kind  string  `json:"kind"`
	State string  `json:"state"`
	HP    int     `json:"hp"`
	X     float64 `json:"x"`
	Z     float64 `json:"z"`
}

type barrelJSON struct {
	ID        string  `json:"id"`
	HP        int     `json:"hp"`
	X         float64 `json:"x"`
	Z         float64 `json:"z"`
	Destroyed bool    `json:"destroyed"`
}

type grenadeJSON struct {
	ID              string  `json:"id"`
	Owner           string  `json:"owner"`
	X               float64 `json:"x"`
	Z               float64 `json:"z"`
	FuseRemainingMs int64   `json:"fuse_remaining_ms"`
}

type shopItemJSON struct {
	Item         string `json:"item"`
	Name         string `json:"name"`
	Price        int    `json:"price"`
	NextPrice    *int   `json:"next_price"`
	NextChangeMs *int64 `json:"next_change_in_ms"`
}

type shopJSON struct {
	Open  bool           `json:"open"`
	Items []shopItemJSON `json:"items"`
}

type roomJSON struct {
	Code              string           `json:"code"`
	Mode              string           `json:"mode"`
	Phase             string           `json:"phase"`
	Wave              int              `json:"wave"`
	PhaseRemainingMs  *int64           `json:"phase_remaining_ms"`
	Tick              int              `json:"tick"`
	ServerTime        string           `json:"server_time"`
	Host              *string          `json:"host"`
	NightID           *string          `json:"night_id"`
	InviteExpiresAt   string           `json:"invite_expires_at"`
	InviteRemainingMs *int64           `json:"invite_remaining_ms"`
	Degraded          *string          `json:"degraded"`
	Result            *string          `json:"result"`
	Players           []playerJSON     `json:"players"`
	Enemies           []enemyJSON      `json:"enemies"`
	Barrels           []barrelJSON     `json:"barrels"`
	Grenades          []grenadeJSON    `json:"grenades"`
	Shop              shopJSON         `json:"shop"`
	Vehicles          []vehicleJSON    `json:"vehicles"`
	Events            []map[string]any `json:"events"`
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

func optional(v int64, set bool) *int64 {
	if !set {
		return nil
	}
	return &v
}

func (r *room) playerState(s *seat) playerJSON {
	p := playerJSON{ID: s.playerID, Callsign: s.callsign, Seat: s.number, Ready: s.ready, Connection: s.connection,
		Status: s.status, HP: s.hp, X: round3(s.x), Z: round3(s.z), Aim: round3(s.aim), LastInputSeq: s.lastInputSeq,
		Mag: s.mag, Reserve: s.reserve, Grenades: s.grenades, Credits: s.credits, Score: s.score, Kills: s.kills}
	p.GraceRemainingMs = optional(r.remainingMs(s.graceEnd), s.connection == connDisconnected)
	p.ReloadRemainingMs = optional(r.remainingMs(s.reloadEnd), s.reloading)
	p.ReviveRemainingMs = optional(r.remainingMs(s.reviveEnd), s.status == statusDowned)
	return p
}

func (r *room) shopState(now time.Time) shopJSON {
	book := r.srv.priceBookSnapshot()
	shop := shopJSON{Open: r.phase == phaseIntermission, Items: []shopItemJSON{}}
	for _, it := range shopItems {
		current, _ := book.at(it.item, now)
		entry := shopItemJSON{Item: it.item, Name: it.name, Price: current.Price}
		if nx, ok := book.next(it.item, now); ok {
			price, in := nx.Price, nx.EffectiveAt.Sub(now).Milliseconds()
			entry.NextPrice, entry.NextChangeMs = &price, &in
		}
		shop.Items = append(shop.Items, entry)
	}
	return shop
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// state serializes the room; the caller holds the lock and has advanced the simulation.
func (r *room) state() roomJSON {
	now := r.srv.clock.Now()
	st := roomJSON{Code: r.code, Mode: r.mode, Phase: r.phase, Wave: r.wave, Tick: r.tick,
		ServerTime: formatInstant(now), Host: strPtr(r.host), NightID: strPtr(r.nightID),
		InviteExpiresAt: formatInstant(r.inviteExpiresAt), Degraded: strPtr(r.degraded), Result: strPtr(r.result),
		Players: []playerJSON{}, Enemies: []enemyJSON{}, Barrels: []barrelJSON{}, Grenades: []grenadeJSON{},
		Vehicles: []vehicleJSON{}, Events: append([]map[string]any{}, r.events...), Shop: r.shopState(now)}
	if r.phase == phaseCountdown || r.phase == phaseIntermission {
		st.PhaseRemainingMs = optional(int64(r.phaseEndTick-r.tick)*tickDur.Milliseconds(), true)
	}
	if left := r.inviteExpiresAt.Sub(now).Milliseconds(); r.phase == phaseLobby && r.inviteOpen(now) {
		st.InviteRemainingMs = &left
	}
	for _, s := range r.seats {
		st.Players = append(st.Players, r.playerState(s))
		if s.vehicle != nil {
			st.Vehicles = append(st.Vehicles, r.vehicleState(s))
		}
	}
	for _, e := range r.enemies {
		st.Enemies = append(st.Enemies, enemyJSON{ID: e.id, Kind: e.kind, State: e.state, HP: e.hp, X: round3(e.x), Z: round3(e.z)})
	}
	for _, b := range r.barrels {
		st.Barrels = append(st.Barrels, barrelJSON{ID: b.id, HP: b.hp, X: b.x, Z: b.z, Destroyed: b.destroyed})
	}
	for _, g := range r.grenades {
		st.Grenades = append(st.Grenades, grenadeJSON{ID: g.id, Owner: g.owner, X: g.x, Z: g.z, FuseRemainingMs: r.remainingMs(g.fuseEnd)})
	}
	return st
}
