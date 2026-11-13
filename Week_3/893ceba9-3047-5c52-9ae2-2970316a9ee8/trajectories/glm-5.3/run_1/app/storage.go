package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Storage talks to MinIO with path-style addressing, signing every request.
type Storage struct {
	Endpoint  string
	Region    string
	Bucket    string
	AccessKey string
	Secret    string
	Client    *http.Client
}

func NewStorage(cfg Config) *Storage {
	return &Storage{
		Endpoint:  cfg.S3Endpoint,
		Region:    cfg.S3Region,
		Bucket:    cfg.S3Bucket,
		AccessKey: cfg.S3AccessKeyID,
		Secret:    cfg.S3SecretAccessKey,
		Client:    &http.Client{Timeout: 10 * time.Second},
	}
}

func (s *Storage) objectURL(key string) string {
	host := s.Endpoint
	host = strings.TrimPrefix(host, "http://")
	host = strings.TrimPrefix(host, "https://")
	return s.Endpoint + "/" + s.Bucket + "/" + key
}

// Put stores bytes under the key with the given content type.
func (s *Storage) Put(ctx context.Context, key string, body []byte, contentType string) error {
	u, err := url.Parse(s.objectURL(key))
	if err != nil {
		return fmt.Errorf("storage url: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	req.Header.Set("Content-Type", contentType)
	s.sign(req, key, body)
	resp, err := s.Client.Do(req)
	if err != nil {
		return fmt.Errorf("storage put: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 400))
		log.Printf("storage put failed status=%d url=%s body=%s", resp.StatusCode, u.String(), string(b))
		return fmt.Errorf("storage put status %d: %s", resp.StatusCode, string(b))
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

// Get returns the stored bytes, or an error when the object is missing.
func (s *Storage) Get(ctx context.Context, key string) ([]byte, error) {
	u, err := url.Parse(s.objectURL(key))
	if err != nil {
		return nil, fmt.Errorf("storage url: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	s.sign(req, key, nil)
	resp, err := s.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("storage get: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == 404 {
		return nil, errObjectMissing
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("storage get status %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

var errObjectMissing = fmt.Errorf("object missing")

// DeletePrefix removes every object under the prefix (recursive listing).
func (s *Storage) DeletePrefix(ctx context.Context, prefix string) error {
	// list then delete in batches
	var keys []string
	marker := ""
	for {
		q := url.Values{}
		q.Set("list-type", "2")
		q.Set("prefix", prefix)
		q.Set("max-keys", "1000")
		if marker != "" {
			q.Set("start-after", marker)
		}
		u, err := url.Parse(s.Endpoint + "/" + s.Bucket + "? " + "")
		_ = u
		listURL := s.Endpoint + "/" + s.Bucket + "?" + q.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, listURL, nil)
		if err != nil {
			return err
		}
		s.signQuery(req, q.Encode())
		resp, err := s.Client.Do(req)
		if err != nil {
			return fmt.Errorf("storage list: %w", err)
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode >= 300 {
			return fmt.Errorf("storage list status %d", resp.StatusCode)
		}
		found, next, truncated := parseListXML(body)
		keys = append(keys, found...)
		if !truncated || len(found) == 0 {
			break
		}
		marker = next
	}
	for _, k := range keys {
		if err := s.Delete(ctx, k); err != nil {
			return err
		}
	}
	return nil
}

func (s *Storage) Delete(ctx context.Context, key string) error {
	u, err := url.Parse(s.objectURL(key))
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, u.String(), nil)
	if err != nil {
		return err
	}
	s.sign(req, key, nil)
	resp, err := s.Client.Do(req)
	if err != nil {
		return fmt.Errorf("storage delete: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)
	return nil
}

func (s *Storage) sign(req *http.Request, key string, body []byte) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(body)
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("Host", req.URL.Host)

	service := "s3"
	target := "/" + s.Bucket + "/" + key
	req.URL.RawPath = ""

	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", req.URL.Host, payloadHash, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{
		req.Method, target, "", canonicalHeaders, signedHeaders, payloadHash,
	}, "\n")
	scope := dateStamp + "/" + s.Region + "/" + service + "/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signingKey := hmacChain(s.Secret, dateStamp, s.Region, service)
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.AccessKey, scope, signedHeaders, signature))
}

func (s *Storage) signQuery(req *http.Request, query string) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(nil)
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	service := "s3"
	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", req.URL.Host, payloadHash, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{
		"GET", "/" + s.Bucket, query, canonicalHeaders, signedHeaders, payloadHash,
	}, "\n")
	scope := dateStamp + "/" + s.Region + "/" + service + "/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signingKey := hmacChain(s.Secret, dateStamp, s.Region, service)
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.AccessKey, scope, signedHeaders, signature))
}

func hmacChain(secret, date, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), date)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, "aws4_request")
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte(data))
	return mac.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// parseListXML pulls keys and the continuation token from a ListObjectsV2 reply.
func parseListXML(body []byte) (keys []string, nextMarker string, truncated bool) {
	text := string(body)
	keys = []string{}
	for {
		start := strings.Index(text, "<Key>")
		if start == -1 {
			break
		}
		end := strings.Index(text, "</Key>")
		if end == -1 {
			break
		}
		keys = append(keys, text[start+5:end])
		text = text[end+6:]
	}
	if i := strings.Index(string(body), "<NextContinuationToken>"); i >= 0 {
		rest := string(body)[i+len("<NextContinuationToken>"):]
		if j := strings.Index(rest, "</NextContinuationToken>"); j >= 0 {
			nextMarker = rest[:j]
		}
	}
	truncated = strings.Contains(string(body), "<IsTruncated>true</IsTruncated>")
	return keys, nextMarker, truncated
}
