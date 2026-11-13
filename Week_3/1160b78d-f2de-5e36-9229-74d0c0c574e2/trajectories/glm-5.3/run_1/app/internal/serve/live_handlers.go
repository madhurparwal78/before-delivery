package serve

import (
	"context"
	"bufio"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"switchlamp/internal/domain"
)

// handleLive serves the one socket per page. A page sends nothing on it until
// it is open, and its first frame is then {"type":"hello"}.
func (s *Server) handleLive(w http.ResponseWriter, r *http.Request) {
	u, err := s.auth(r)
	if err != nil {
		apiError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	if u.Role == "stakeholder" {
		// A stakeholder may not open the socket.
		apiError(w, http.StatusForbidden, "forbidden")
		return
	}
	if r.Header.Get("Upgrade") != "websocket" {
		apiError(w, http.StatusBadRequest, "invalid")
		return
	}
	// A socket upgrade is a state-changing request under the origin rule.
	if origin := r.Header.Get("Origin"); origin != "" && !s.cfg.OriginAllowed(origin) {
		apiError(w, http.StatusForbidden, "cross_origin")
		return
	}
	hijacker, ok := w.(http.Hijacker)
	if !ok {
		apiError(w, http.StatusInternalServerError, "internal")
		return
	}
	conn, rw, err := hijacker.Hijack()
	if err != nil {
		return
	}
	defer conn.Close()

	// Minimal RFC 6455 handshake over the raw connection.
	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		return
	}
	accept := websocketAccept(key)
	fmt.Fprintf(rw, "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n", accept)
	rw.Flush()

	client := &liveClient{userID: u.ID, role: u.Role, send: make(chan []byte, 64)}
	s.live.Register(client)
	defer s.live.Deregister(client)

	// Send the hello frame, then anything the page missed after ?after=<seq>,
	// in order.
	after := int64(0)
	if v := r.URL.Query().Get("after"); v != "" {
		after, _ = strconv.ParseInt(v, 10, 64)
	}
	writeFrame(rw, []byte(`{"type":"hello"}`))
	s.live.After(r.Context(), after, func(b []byte) { writeFrame(rw, b) })

	// Read loop: the server never needs client frames, but it must notice
	// close and ping.
	buf := make([]byte, 4096)
	for {
		conn.SetReadDeadline(time.Now().Add(24 * time.Hour))
		n, err := rw.Read(buf)
		if err != nil || n == 0 {
			return
		}
		// Frames from the client are ignored apart from close.
		if n >= 2 && buf[0]&0x0f == 0x8 {
			return
		}
	}
}

func websocketAccept(key string) string {
	h := sha256.New()
	h.Write([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// writeFrame writes one text frame to the client.
func writeFrame(rw *bufio.ReadWriter, payload []byte) {
header := make([]byte, 0, 10)
header = append(header, 0x81)
n := len(payload)
switch {
case n < 126:
header = append(header, byte(n))
case n < 65536:
header = append(header, 126, byte(n>>8), byte(n))
default:
header = append(header, 127)
for i := 7; i >= 0; i-- {
header = append(header, byte(n>>(8*i)))
}
}
rw.Write(append(header, payload...))
rw.Flush()
}

// handleCalendarFeed serves a person's shift feed by token. It can never
// change anything.
func (s *Server) handleCalendarFeed(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		apiError(w, http.StatusMethodNotAllowed, "not_allowed")
		return
	}
	ctx := r.Context()
	// The path is /calendar/<token>.ics; the token is everything between the
	// prefix and the .ics suffix.
	token := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/calendar/"), ".ics")
	var userID string
	var expires time.Time
	err := s.store.Pool().QueryRow(ctx, `SELECT user_id, expires_at FROM calendar_tokens WHERE token = $1`, token).
		Scan(&userID, &expires)
	if err == nil && s.clock.Now().After(expires) {
		apiError(w, http.StatusGone, "expired")
		return
	}
	if err != nil {
		apiError(w, http.StatusNotFound, "not_found")
		return
	}
	// The feed holds one event per final-schedule shift of its owner from 14
	// days before now to 60 days after, in UTC.
	now := s.engine.Now()
	schedules, _ := s.store.Schedules(ctx)
	names, _ := s.store.UserNames(ctx)
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Tarecross//Switchlamp//EN\r\n")
	for _, sc := range schedules {
		layers, _ := s.store.Layers(ctx, sc.ID)
		for _, l := range layers {
			l.SetScheduleZone(sc.Zone)
			l.RecordFormat = sc.RecordFormat
		}
		overrides, _ := s.store.Overrides(ctx, sc.ID)
		blocks := domain.FinalSchedule(layers, overrides, now.Add(-14*24*time.Hour), now.Add(60*24*time.Hour), names)
		for _, blk := range blocks {
			if blk.Person == nil || blk.Person.ID != userID {
				continue
			}
			b.WriteString("BEGIN:VEVENT\r\n")
			b.WriteString("UID:" + blk.Start.UTC().Format("20060102T150405Z") + "-" + sc.ID + "\r\n")
			b.WriteString("DTSTART:" + blk.Start.UTC().Format("20060102T150405Z") + "\r\n")
			b.WriteString("DTEND:" + blk.End.UTC().Format("20060102T150405Z") + "\r\n")
			b.WriteString("SUMMARY:On call: " + sc.Name + "\r\n")
			b.WriteString("END:VEVENT\r\n")
		}
	}
	b.WriteString("END:VCALENDAR\r\n")
	w.Header().Set("Content-Type", "text/calendar")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(b.String()))
}

// ackPages renders the five published acknowledge-link pages.
func (s *Server) handleAckPage(w http.ResponseWriter, r *http.Request) {
	s.ackLink(w, r, false)
}

func (s *Server) handleAckPost(w http.ResponseWriter, r *http.Request) {
	s.ackLink(w, r, true)
}

func (s *Server) ackLink(w http.ResponseWriter, r *http.Request, post bool) {
	ctx := r.Context()
	token := r.PathValue("token")
	// The token is signed for one person, one incident and one assignment.
	personID, incidentID, _, ok := s.verifyAckToken(ctx, token)
	now := s.engine.Now()
	if !ok {
		renderAckPage(w, "This link is not valid.", "Ask your lead for help if you expected it to work.", "")
		return
	}
	inc, err := s.store.Incident(ctx, incidentID)
	if err != nil {
		renderAckPage(w, "This link is not valid.", "Ask your lead for help if you expected it to work.", "")
		return
	}
	var used bool
	var stepID string
	s.store.Pool().QueryRow(ctx, `SELECT used, id FROM steps WHERE token = $1`, token).Scan(&used, &stepID)
	if used {
		renderAckPage(w, "Acknowledged.", fmt.Sprintf("Incident #%d is with you now.", inc.Number), "")
		return
	}
	if inc.Status == domain.StatusResolved {
		renderAckPage(w, "This link is out of date.", fmt.Sprintf("Incident #%d has moved on. Sign in to see where it stands.", inc.Number), "")
		return
	}
	if inc.Status == domain.StatusAcknowledged || inc.Status == domain.StatusSnoozed {
		actor := "someone"
		for i := len(inc.Timeline) - 1; i >= 0; i-- {
			if inc.Timeline[i].Kind == domain.KindAcknowledged {
				actor = inc.Timeline[i].Actor
				break
			}
		}
		renderAckPage(w, "This link has already been used.", fmt.Sprintf("Incident #%d was acknowledged by %s.", inc.Number, actor), "")
		return
	}
	var expires time.Time
	var holderNow bool
	s.store.Pool().QueryRow(ctx, `SELECT token_expires FROM steps WHERE token = $1`, token).Scan(&expires)
	for _, h := range inc.Holders {
		if h.ID == personID {
			holderNow = true
		}
	}
	if !expires.IsZero() && !now.Before(expires) || !holderNow {
		renderAckPage(w, "This link is out of date.", fmt.Sprintf("Incident #%d has moved on. Sign in to see where it stands.", inc.Number), "")
		return
	}
	if !post {
		// GET never changes anything: it shows the valid page.
		renderAckPage(w, fmt.Sprintf("Acknowledge incident #%d", inc.Number), inc.Title,
			fmt.Sprintf("Acknowledge incident #%d", inc.Number))
		return
	}
	// The one POST that acknowledges shows the done page; a repeated or
	// simultaneous second POST gets the used page.
	tag, err := s.store.Pool().Exec(ctx, `UPDATE steps SET used = true WHERE token = $1 AND used = false`, token)
	if err != nil || tag.RowsAffected() == 0 {
		renderAckPage(w, "This link has already been used.", fmt.Sprintf("Incident #%d was acknowledged by someone.", inc.Number), "")
		return
	}
	if _, err := s.engine.Acknowledge(ctx, incidentID, personID, inc.Holders[0].Name); err != nil {
		renderAckPage(w, "Acknowledged.", fmt.Sprintf("Incident #%d is with you now.", inc.Number), "")
		return
	}
	renderAckPage(w, "Acknowledged.", fmt.Sprintf("Incident #%d is with you now.", inc.Number), "")
}

// verifyAckToken checks the signature and returns the person and incident.
func (s *Server) verifyAckToken(ctx context.Context, token string) (personID, incidentID string, assignment string, ok bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 4 {
		return "", "", "", false
	}
	sig := s.signValue(ctx, parts[0], parts[1], parts[2])
	if !hmac.Equal([]byte(sig), []byte(parts[3])) {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func (s *Server) makeAckToken(ctx context.Context, personID, incidentID, assignment string) string {
	sig := s.signValue(ctx, personID, incidentID, assignment)
	return personID + "." + incidentID + "." + assignment + "." + sig
}
