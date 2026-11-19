package sim

import (
	"testing"
	"time"

	"github.com/cinderlatch/holdfast/internal/clockx"
	"github.com/cinderlatch/holdfast/internal/pricing"
)

// testRoom builds a siege room with one seated player, ready to simulate.
func testRoom(t *testing.T) *Room {
	t.Helper()
	zone, err := clockx.LoadZone("America/Chicago")
	if err != nil {
		t.Fatalf("load zone: %v", err)
	}
	room := newRoom("TESTAA", "siege", nil, clockx.New(zone), pricing.NewCache(nil))
	room.hostID = "p1"
	room.seatPlayer(1, "p1", "Mara")
	room.seats[0].Ready = true
	if _, err := room.Start("p1"); err != nil {
		t.Fatalf("start: %v", err)
	}
	// Run the countdown out so the room sits in wave 1, holding the seat the way
	// an open snapshot stream does.
	for i := int64(0); i <= CountdownMS/tickMS; i++ {
		room.tickHolding("p1")
	}
	if room.phase != PhaseWave {
		t.Fatalf("phase = %q, want %q", room.phase, PhaseWave)
	}
	return room
}

// tickHolding ticks the room while the named seats keep their leases renewed.
func (r *Room) tickHolding(playerIDs ...string) {
	for _, id := range playerIDs {
		r.Touch(id)
	}
	r.Tick()
}

func (r *Room) explosionEvents() []Event {
	var out []Event
	for _, e := range r.events {
		if e.Type == "explosion" {
			out = append(out, e)
		}
	}
	return out
}

func TestBarrelChainResolvesInOrderAndOnlyOnce(t *testing.T) {
	room := testRoom(t)
	// Clear the wave's enemies so only the barrels take part.
	room.enemies = nil

	// A grenade on B1 destroys B1 outright and B2 1.5 m away.
	room.resolveExplosions([]blast{{
		source: "grenade:g1", owner: "p1", x: 6.5, z: 20.5,
		radius: GrenadeRadius, maxDamage: GrenadeMaxDamage,
	}})

	events := room.explosionEvents()
	if len(events) != 3 {
		t.Fatalf("explosion events = %d, want 3 (grenade, B1, B2)", len(events))
	}
	wantSources := []string{"grenade:g1", "barrel:B1", "barrel:B2"}
	for i, want := range wantSources {
		if got := events[i].Fields["source"]; got != want {
			t.Errorf("explosion %d source = %v, want %v", i, got, want)
		}
	}

	for _, barrel := range room.barrels {
		switch barrel.ID {
		case "B1", "B2":
			if !barrel.Destroyed || barrel.HP != 0 {
				t.Errorf("%s should be destroyed, got hp %d destroyed %v", barrel.ID, barrel.HP, barrel.Destroyed)
			}
		default:
			if barrel.Destroyed {
				t.Errorf("%s is out of range and stays intact", barrel.ID)
			}
		}
	}

	// The grenade's own hits cap at each barrel's remaining health.
	hits, ok := events[0].Fields["hits"].([]explosionHit)
	if !ok {
		t.Fatalf("hits field has type %T", events[0].Fields["hits"])
	}
	for _, hit := range hits {
		if hit.Damage != BarrelHP {
			t.Errorf("hit on %s applied %d, want the capped %d", hit.ID, hit.Damage, BarrelHP)
		}
	}
}

func TestExplosionDamageCapsAtRemainingHealth(t *testing.T) {
	room := testRoom(t)
	room.barrels = nil
	room.enemies = []*Enemy{{
		ID: "g1", Kind: KindGrunt, State: EnemyPatrol, HP: enemyHP(KindGrunt), X: 10, Z: 10,
	}}

	room.resolveExplosions([]blast{{
		source: "grenade:g9", owner: "p1", x: 10, z: 10,
		radius: GrenadeRadius, maxDamage: GrenadeMaxDamage,
	}})

	events := room.explosionEvents()
	hits := events[0].Fields["hits"].([]explosionHit)
	if len(hits) != 1 {
		t.Fatalf("hits = %d, want 1", len(hits))
	}
	// A 100-damage grenade on a 60-health grunt applies 60.
	if hits[0].Damage != 60 {
		t.Errorf("applied damage = %d, want 60", hits[0].Damage)
	}
	if room.enemies[0].HP != 0 || room.enemies[0].State != EnemyDead {
		t.Errorf("grunt = hp %d state %q, want 0 dead", room.enemies[0].HP, room.enemies[0].State)
	}
	// Score counts the applied damage, and the kill pays its reward.
	player := room.playerByID("p1")
	if player.Score != 60 {
		t.Errorf("score = %d, want 60", player.Score)
	}
	if player.Kills != 1 {
		t.Errorf("kills = %d, want 1", player.Kills)
	}
	if got := room.ledger.Balance("p1"); got != enemyKillReward(KindGrunt) {
		t.Errorf("credits = %d, want %d", got, enemyKillReward(KindGrunt))
	}
}

func TestLedgerPairsEveryMovementAndSumsToZero(t *testing.T) {
	room := testRoom(t)
	room.enemies = nil
	room.barrels = nil
	room.ledger.Post("p1", AccountRewards, 50, KindKillReward, "kill:TESTAA:w1-1", nil, nil, time.Now())
	room.ledger.Post("p1", AccountAmmoStation, -120, KindPurchase, "purchase:abc", nil, nil, time.Now())

	if got := room.ledger.Total(); got != 0 {
		t.Errorf("ledger total = %d, want 0", got)
	}
	if got := room.ledger.Balance("p1"); got != -70 {
		t.Errorf("player balance = %d, want -70", got)
	}
	if got := room.ledger.Balance(AccountRewards); got != -50 {
		t.Errorf("rewards balance = %d, want -50", got)
	}
	if got := room.ledger.Balance(AccountAmmoStation); got != 120 {
		t.Errorf("ammo station balance = %d, want 120", got)
	}
	if got := room.ledger.CreditsEarned("p1"); got != 50 {
		t.Errorf("credits earned = %d, want 50", got)
	}

	// Each balance equals the sum of its account's entries.
	sums := map[string]int{}
	for _, entry := range room.ledger.Entries() {
		sums[entry.Account] += entry.Amount
	}
	for account, balance := range room.ledger.Balances() {
		if sums[account] != balance {
			t.Errorf("%s balance %d does not equal its entries %d", account, balance, sums[account])
		}
	}
}

func TestShotRejectionsChangeNothing(t *testing.T) {
	room := testRoom(t)
	player := room.playerByID("p1")
	now := time.Now()

	accepted, _, _ := room.shot(player, 90, now)
	if !accepted {
		t.Fatal("the first shot is accepted")
	}
	if player.Mag != MagSize-1 {
		t.Fatalf("mag = %d, want %d", player.Mag, MagSize-1)
	}

	// Sooner than the fire interval is refused and changes no ammo.
	accepted, reason, _ := room.shot(player, 90, now.Add(99*time.Millisecond))
	if accepted || reason != ReasonFireInterval {
		t.Errorf("99 ms later = %v %q, want false fire_interval", accepted, reason)
	}
	if player.Mag != MagSize-1 {
		t.Errorf("a refused shot changed the magazine to %d", player.Mag)
	}

	// Exactly the fire interval is accepted.
	accepted, reason, _ = room.shot(player, 90, now.Add(100*time.Millisecond))
	if !accepted {
		t.Errorf("exactly 100 ms later = %v %q, want accepted", accepted, reason)
	}

	// A reload blocks shots, and an empty magazine reports empty.
	player.ReloadRemainingMS = ReloadMS
	if _, reason, _ = room.shot(player, 90, now.Add(time.Second)); reason != ReasonReloading {
		t.Errorf("during a reload = %q, want reloading", reason)
	}
	player.ReloadRemainingMS = 0
	player.Mag = 0
	if _, reason, _ = room.shot(player, 90, now.Add(2*time.Second)); reason != ReasonEmpty {
		t.Errorf("with an empty magazine = %q, want empty", reason)
	}
}

func TestReloadMovesRoundsAfterItsDuration(t *testing.T) {
	room := testRoom(t)
	player := room.playerByID("p1")
	player.Mag = 10

	accepted, _, outcome := room.reload(player)
	if !accepted || outcome.ReloadMS != ReloadMS {
		t.Fatalf("reload = %v %+v", accepted, outcome)
	}
	if _, reason, _ := room.reload(player); reason != ReasonReloading {
		t.Errorf("a second reload = %q, want reloading", reason)
	}

	for i := int64(0); i < ReloadMS/tickMS-1; i++ {
		room.advanceReloads()
	}
	if player.Mag != 10 {
		t.Errorf("the magazine filled early, at %d", player.Mag)
	}
	room.advanceReloads()
	if player.Mag != MagSize || player.Reserve != StartReserve-20 {
		t.Errorf("after the reload: mag %d reserve %d, want %d %d",
			player.Mag, player.Reserve, MagSize, StartReserve-20)
	}

	// A full magazine has nothing to reload.
	if _, reason, _ := room.reload(player); reason != ReasonNothingToReload {
		t.Errorf("a full magazine = %q, want nothing_to_reload", reason)
	}
}

func TestReviveWindowEndIsExclusive(t *testing.T) {
	room := testRoom(t)
	downed := room.seatPlayer(2, "p2", "Rell")
	downed.Status = StatusDowned
	downed.HP = 0
	downed.ReviveRemainingMS = tickMS
	reviver := room.playerByID("p1")
	downed.X, downed.Z = reviver.X, reviver.Z

	// Out of reach is refused.
	downed.X = reviver.X + ReviveRange + 0.1
	if _, reason, _ := room.revive(reviver, "p2"); reason != ReasonTooFar {
		t.Errorf("beyond 2 m = %q, want too_far", reason)
	}
	downed.X = reviver.X

	// Reviving yourself is refused.
	if _, reason, _ := room.revive(reviver, "p1"); reason != ReasonSelfRevive {
		t.Errorf("self revive = %q, want self_revive", reason)
	}

	// The window runs out, and the revive is then refused.
	room.advanceReviveWindows()
	if downed.Status != StatusOut {
		t.Fatalf("status = %q, want out", downed.Status)
	}
	if _, reason, _ := room.revive(reviver, "p2"); reason != ReasonNotDowned {
		t.Errorf("after the window = %q, want not_downed", reason)
	}

	// With time left the revive succeeds and brings them up at half health.
	downed.Status = StatusDowned
	downed.ReviveRemainingMS = ReviveWindowMS
	accepted, _, outcome := room.revive(reviver, "p2")
	if !accepted || outcome.Revived != "p2" {
		t.Fatalf("revive = %v %+v", accepted, outcome)
	}
	if downed.Status != StatusUp || downed.HP != ReviveHP {
		t.Errorf("revived player = %q hp %d, want up %d", downed.Status, downed.HP, ReviveHP)
	}
	// A second revive in the same tick finds nobody downed.
	if _, reason, _ := room.revive(reviver, "p2"); reason != ReasonNotDowned {
		t.Errorf("a second revive = %q, want not_downed", reason)
	}
}

func TestPlayerNeverEntersASolidBlock(t *testing.T) {
	room := testRoom(t)
	player := room.playerByID("p1")
	// Stand just south of the west seawall and push north into it.
	player.X, player.Z = 9.5, 13.5
	player.MoveX, player.MoveZ = 0, 1
	for i := 0; i < 40; i++ {
		room.movePlayers()
		if room.gmap.SolidAt(player.X, player.Z) {
			t.Fatalf("player entered a solid cell at %.2f, %.2f", player.X, player.Z)
		}
	}
	if player.Z >= 14 {
		t.Errorf("player passed the wall to z %.2f", player.Z)
	}
}

func TestWaveProgressionThroughIntermissionToBoss(t *testing.T) {
	room := testRoom(t)

	clearWave := func() {
		for _, e := range room.enemies {
			e.HP = 0
			e.State = EnemyDead
		}
		room.tickHolding("p1")
	}

	for wave := 1; wave <= 3; wave++ {
		if room.wave != wave {
			t.Fatalf("wave = %d, want %d", room.wave, wave)
		}
		clearWave()
		if room.phase != PhaseIntermission {
			t.Fatalf("after wave %d phase = %q, want intermission", wave, room.phase)
		}
		if room.phaseRemainingMS != IntermissionMS {
			t.Fatalf("intermission = %d ms, want %d", room.phaseRemainingMS, IntermissionMS)
		}
		// The wave keeps its last value through the intermission.
		if room.wave != wave {
			t.Fatalf("during the intermission wave = %d, want %d", room.wave, wave)
		}
		for i := int64(0); i < IntermissionMS/tickMS; i++ {
			room.tickHolding("p1")
		}
	}

	if room.phase != PhaseBossWave || room.wave != BossWave {
		t.Fatalf("phase %q wave %d, want boss_wave 4", room.phase, room.wave)
	}
	clearWave()
	if room.phase != PhaseOver || room.result != ResultVictory {
		t.Fatalf("phase %q result %q, want over victory", room.phase, room.result)
	}
	// A victory clears four waves and pays four wave bonuses.
	if room.wavesCleared != BossWave {
		t.Errorf("waves cleared = %d, want %d", room.wavesCleared, BossWave)
	}
	if got := room.ledger.CreditsEarned("p1"); got < BossWave*WaveBonus {
		t.Errorf("credits earned = %d, want at least %d", got, BossWave*WaveBonus)
	}
}

func TestDefeatWhenNoPlayerIsUp(t *testing.T) {
	room := testRoom(t)
	player := room.playerByID("p1")
	player.Status = StatusDowned
	player.HP = 0
	player.ReviveRemainingMS = tickMS

	room.tickHolding("p1")
	if room.phase != PhaseOver || room.result != ResultDefeat {
		t.Fatalf("phase %q result %q, want over defeat", room.phase, room.result)
	}
}

func TestSeatLeaseLapsesThenGraceReleases(t *testing.T) {
	room := testRoom(t)
	room.seatPlayer(2, "p2", "Rell")
	player := room.playerByID("p1")
	room.Touch("p1")
	room.Touch("p2")

	// Seat 1 goes quiet while seat 2 keeps its lease renewed.
	for i := int64(0); i < SeatLeaseMS/tickMS; i++ {
		room.tickHolding("p2")
	}
	if player.Connection != ConnDisconnected {
		t.Fatalf("connection = %q, want disconnected", player.Connection)
	}
	if player.GraceRemainingMS != ReconnectGraceMS {
		t.Fatalf("grace = %d, want %d", player.GraceRemainingMS, ReconnectGraceMS)
	}
	// Hosting passes to the connected player in the lowest seat.
	if room.hostID != "p2" {
		t.Errorf("host = %q, want p2", room.hostID)
	}

	// A request inside the grace keeps the seat.
	room.Touch("p1")
	if player.Connection != ConnConnected || player.GraceRemainingMS != 0 {
		t.Errorf("after touching: %q grace %d, want connected 0", player.Connection, player.GraceRemainingMS)
	}
	// A former host who returns does not take hosting back.
	if room.hostID != "p2" {
		t.Errorf("host = %q, want p2 to keep it", room.hostID)
	}
}

func TestDegradedRoomFreezesEveryTimer(t *testing.T) {
	room := testRoom(t)
	room.phase = PhaseIntermission
	room.phaseRemainingMS = IntermissionMS

	room.SetDegraded(DegradedRoomRegist)
	before := room.tick
	for i := 0; i < 10; i++ {
		room.tickHolding("p1")
	}
	if room.tick != before {
		t.Errorf("tick advanced to %d while degraded", room.tick)
	}
	if room.phaseRemainingMS != IntermissionMS {
		t.Errorf("phase timer moved to %d while degraded", room.phaseRemainingMS)
	}
	if _, err := room.ApplyReport("p1", ReportInput{
		ReportID: "x1", Type: "reload", Fingerprint: "reload",
	}); err != ErrRoomPaused {
		t.Errorf("reports while degraded = %v, want room paused", err)
	}

	room.SetDegraded("")
	room.tickHolding("p1")
	if room.phaseRemainingMS != IntermissionMS-tickMS {
		t.Errorf("after resuming the timer is %d, want %d", room.phaseRemainingMS, IntermissionMS-tickMS)
	}
}

func TestReportIdAppliesOnceAndReplaysItsResult(t *testing.T) {
	room := testRoom(t)
	in := ReportInput{ReportID: "shot-1", Type: "shot", Aim: 90, Fingerprint: "shot|aim=90.000000"}

	first, err := room.ApplyReport("p1", in)
	if err != nil {
		t.Fatalf("first report: %v", err)
	}
	magAfterFirst := room.playerByID("p1").Mag

	replay, err := room.ApplyReport("p1", in)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if replay.Tick != first.Tick || replay.Accepted != first.Accepted {
		t.Errorf("replay = %+v, want the stored %+v", replay, first)
	}
	if room.playerByID("p1").Mag != magAfterFirst {
		t.Error("a replay spent another round")
	}

	conflicting := in
	conflicting.Fingerprint = "shot|aim=12.000000"
	if _, err := room.ApplyReport("p1", conflicting); err != ErrReportConflict {
		t.Errorf("a reused id with another body = %v, want report conflict", err)
	}
}
