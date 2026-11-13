// Package config reads every service URL, credential and time rule from the
// environment at start.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Port int

	DatabaseURL string

	S3Endpoint    string
	S3Region      string
	S3Bucket      string
	S3PathStyle   bool
	S3AccessKeyID string
	S3SecretKey   string

	SvixURL    string
	SvixAPIKey string

	GitHostURL  string
	AIEngineURL string

	AssignmentTTL  time.Duration
	ConflictHold   time.Duration
	AuditRetention time.Duration
	WebhookRetry   time.Duration
}

func Load() (*Config, error) {
	c := &Config{
		Port:          intEnv("APP_PUBLIC_PORT", 4173),
		DatabaseURL:   os.Getenv("DATABASE_URL"),
		S3Endpoint:    strings.TrimRight(os.Getenv("S3_ENDPOINT"), "/"),
		S3Region:      os.Getenv("S3_REGION"),
		S3Bucket:      os.Getenv("S3_BUCKET"),
		S3PathStyle:   os.Getenv("S3_FORCE_PATH_STYLE") != "false",
		S3AccessKeyID: os.Getenv("S3_ACCESS_KEY_ID"),
		S3SecretKey:   os.Getenv("S3_SECRET_ACCESS_KEY"),
		SvixURL:       strings.TrimRight(os.Getenv("SVIX_URL"), "/"),
		SvixAPIKey:    os.Getenv("SVIX_API_KEY"),

		AssignmentTTL:  secondsEnv("ASSIGNMENT_TTL_SECONDS", 172800),
		ConflictHold:   secondsEnv("CONFLICT_HOLD_SECONDS", 300),
		AuditRetention: secondsEnv("AUDIT_RETENTION_SECONDS", 15811200),
		WebhookRetry:   secondsEnv("WEBHOOK_RETRY_SECONDS", 10),
	}

	wiremock := strings.TrimRight(os.Getenv("WIREMOCK_URL"), "/")
	c.GitHostURL = strings.TrimRight(firstSet(os.Getenv("GIT_HOST_URL"), wiremock), "/")
	c.AIEngineURL = strings.TrimRight(firstSet(os.Getenv("AI_ENGINE_URL"), wiremock), "/")

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}
	if c.S3Endpoint == "" || c.S3Bucket == "" {
		return nil, fmt.Errorf("S3_ENDPOINT and S3_BUCKET must be set")
	}
	return c, nil
}

func firstSet(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func intEnv(name string, fallback int) int {
	if raw := os.Getenv(name); raw != "" {
		if n, err := strconv.Atoi(raw); err == nil {
			return n
		}
	}
	return fallback
}

func secondsEnv(name string, fallback int) time.Duration {
	return time.Duration(intEnv(name, fallback)) * time.Second
}
