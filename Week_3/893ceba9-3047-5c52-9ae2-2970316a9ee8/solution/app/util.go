package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

const timeLayout = "2006-01-02T15:04:05Z"

// newID returns a random (version 4) UUID. crypto/rand.Read never returns an error: it ends the program
// instead, so there is no error to handle here.
func newID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// now is the server clock, cut to whole seconds so every stored and shown time agrees.
func now() time.Time { return time.Now().UTC().Truncate(time.Second) }

func fmtTime(t time.Time) string { return t.UTC().Format(timeLayout) }

func fmtTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := fmtTime(*t)
	return &s
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// randomString returns n random letters and digits, drawn from crypto/rand.Text's base32 alphabet.
func randomString(n int) string {
	var sb strings.Builder
	for sb.Len() < n {
		sb.WriteString(rand.Text())
	}
	return sb.String()[:n]
}

func derefOr(s *string, fallback string) string {
	if s == nil {
		return fallback
	}
	return *s
}

// detached returns a context that outlives the request but still carries its own deadline,
// for cleanup that must finish after the client is gone.
func detached(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
}

// bareErr drops the request URL from a transport error, so logs and wrapped errors never carry a service address.
func bareErr(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return ue.Err
	}
	return err
}
