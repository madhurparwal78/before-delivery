package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// valkeyClient speaks RESP over plain TCP to the Valkey service.
type valkeyClient struct {
	addr string
	user string
	pass string
	db   int

	mu   sync.Mutex
	idle []*valkeyConn
}

type valkeyConn struct {
	conn net.Conn
	rd   *bufio.Reader
}

var errValkeyDown = errors.New("valkey unavailable")

const valkeyTimeout = 600 * time.Millisecond

func newValkeyClient(rawURL string) (*valkeyClient, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("VALKEY_URL: %w", err)
	}
	c := &valkeyClient{addr: u.Host, user: "default"}
	if u.User != nil {
		if name := u.User.Username(); name != "" {
			c.user = name
		}
		c.pass, _ = u.User.Password()
	}
	if p := u.Path; len(p) > 1 {
		if c.db, err = strconv.Atoi(p[1:]); err != nil {
			return nil, fmt.Errorf("VALKEY_URL database: %w", err)
		}
	}
	return c, nil
}

func (c *valkeyClient) dial() (*valkeyConn, error) {
	conn, err := net.DialTimeout("tcp", c.addr, valkeyTimeout)
	if err != nil {
		return nil, err
	}
	vc := &valkeyConn{conn: conn, rd: bufio.NewReader(conn)}
	if c.pass != "" {
		if _, err := vc.call("AUTH", c.user, c.pass); err != nil {
			conn.Close()
			return nil, err
		}
	}
	if c.db != 0 {
		if _, err := vc.call("SELECT", strconv.Itoa(c.db)); err != nil {
			conn.Close()
			return nil, err
		}
	}
	return vc, nil
}

func (vc *valkeyConn) call(args ...string) (any, error) {
	return vc.pipeline([][]string{args})
}

func (vc *valkeyConn) pipeline(commands [][]string) (any, error) {
	if err := vc.conn.SetDeadline(time.Now().Add(valkeyTimeout)); err != nil {
		return nil, err
	}
	var out []byte
	for _, args := range commands {
		out = append(out, fmt.Sprintf("*%d\r\n", len(args))...)
		for _, a := range args {
			out = append(out, fmt.Sprintf("$%d\r\n%s\r\n", len(a), a)...)
		}
	}
	if _, err := vc.conn.Write(out); err != nil {
		return nil, err
	}
	var last any
	for range commands {
		reply, err := readReply(vc.rd)
		if err != nil {
			return nil, err
		}
		last = reply
	}
	return last, nil
}

type valkeyReplyError string

func (e valkeyReplyError) Error() string { return "valkey: " + string(e) }

func readReply(rd *bufio.Reader) (any, error) {
	line, err := rd.ReadString('\n')
	if err != nil {
		return nil, err
	}
	if len(line) < 3 {
		return nil, io.ErrUnexpectedEOF
	}
	kind, rest := line[0], line[1:len(line)-2]
	switch kind {
	case '+':
		return rest, nil
	case '-':
		return nil, valkeyReplyError(rest)
	case ':':
		return strconv.ParseInt(rest, 10, 64)
	case '$':
		n, err := strconv.Atoi(rest)
		if err != nil || n < 0 {
			return nil, err
		}
		buf := make([]byte, n+2)
		if _, err := io.ReadFull(rd, buf); err != nil {
			return nil, err
		}
		return string(buf[:n]), nil
	case '*':
		n, err := strconv.Atoi(rest)
		if err != nil || n < 0 {
			return nil, err
		}
		items := make([]any, n)
		for i := range items {
			if items[i], err = readReply(rd); err != nil {
				return nil, err
			}
		}
		return items, nil
	default:
		return nil, fmt.Errorf("valkey: unexpected reply %q", line)
	}
}

// take returns an idle pooled connection (pooled=true) or a fresh one.
func (c *valkeyClient) take() (vc *valkeyConn, pooled bool, err error) {
	c.mu.Lock()
	if n := len(c.idle); n > 0 {
		vc = c.idle[n-1]
		c.idle = c.idle[:n-1]
		c.mu.Unlock()
		return vc, true, nil
	}
	c.mu.Unlock()
	vc, err = c.dial()
	return vc, false, err
}

func (c *valkeyClient) give(vc *valkeyConn) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.idle) < 8 {
		c.idle = append(c.idle, vc)
		return
	}
	vc.conn.Close()
}

// do runs one command; a transport failure is reported as errValkeyDown.
func (c *valkeyClient) do(args ...string) (any, error) {
	return c.pipe([][]string{args})
}

// pipe sends commands in one round trip. A pooled connection the server has since closed is
// replaced by a fresh one before Valkey is declared unreachable.
func (c *valkeyClient) pipe(commands [][]string) (any, error) {
	for {
		vc, pooled, err := c.take()
		if err != nil {
			return nil, fmt.Errorf("%w: %v", errValkeyDown, err)
		}
		reply, err := vc.pipeline(commands)
		var replyErr valkeyReplyError
		if err == nil || errors.As(err, &replyErr) {
			c.give(vc)
			return reply, err
		}
		vc.conn.Close()
		if !pooled {
			return nil, fmt.Errorf("%w: %v", errValkeyDown, err)
		}
	}
}

func (c *valkeyClient) ping(ctx context.Context) error {
	done := make(chan error, 1)
	go func() {
		_, err := c.do("PING")
		done <- err
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

// scan returns every key matching the pattern.
func (c *valkeyClient) scan(pattern string) ([]string, error) {
	cursor := "0"
	var keys []string
	for {
		reply, err := c.do("SCAN", cursor, "MATCH", pattern, "COUNT", "500")
		if err != nil {
			return nil, err
		}
		parts, ok := reply.([]any)
		if !ok || len(parts) != 2 {
			return nil, fmt.Errorf("valkey: unexpected SCAN reply")
		}
		cursor, _ = parts[0].(string)
		batch, _ := parts[1].([]any)
		for _, k := range batch {
			if s, ok := k.(string); ok {
				keys = append(keys, s)
			}
		}
		if cursor == "0" {
			return keys, nil
		}
	}
}
