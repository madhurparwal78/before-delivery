package main

import (
	"fmt"
	"log"
	"net/url"
	"regexp"
	"strings"
)

// Every log line goes through logf or fatalf: driver and HTTP errors can quote a service address or a credential,
// so the configured values and anything shaped like a URL or host:port are replaced before the line is written.

var (
	logSecrets  []string
	addressLike = regexp.MustCompile(`[A-Za-z][A-Za-z0-9+.-]*://[^\s"'<>]+|\[[0-9A-Fa-f:]+\](:\d+)?|\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b|\b[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*:\d{2,5}\b`)
)

// redactLogs records the configured service values that must never appear in a log line.
func redactLogs(c config) {
	for _, raw := range []string{c.databaseURL, c.keycloakURL, c.issuerURL, c.publicURL} {
		if raw == "" {
			continue
		}
		logSecrets = append(logSecrets, raw)
		if u, err := url.Parse(raw); err == nil {
			logSecrets = append(logSecrets, u.Host, u.Hostname())
			if pw, ok := u.User.Password(); ok {
				logSecrets = append(logSecrets, pw)
			}
		}
	}
	logSecrets = append(logSecrets, c.clientSecret)
}

func redact(line string) string {
	for _, s := range logSecrets {
		if len(s) >= 3 {
			line = strings.ReplaceAll(line, s, "[redacted]")
		}
	}
	return addressLike.ReplaceAllString(line, "[address]")
}

func logf(format string, args ...any) {
	log.Print(redact(fmt.Sprintf(format, args...)))
}

func fatalf(format string, args ...any) {
	log.Fatal(redact(fmt.Sprintf(format, args...)))
}
