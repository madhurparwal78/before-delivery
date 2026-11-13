package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

// minio.go — plain HTTP to S3-compatible storage. The browser never talks to
// MinIO; downloads go through the app.

type MinioClient struct {
	endpoint  string
	region    string
	bucket    string
	forcePath bool
	accessKey string
	secretKey string
	http      *http.Client
}

func NewMinioClient(cfg *Config) *MinioClient {
	return &MinioClient{
		endpoint:  cfg.S3Endpoint,
		region:    cfg.S3Region,
		bucket:    cfg.S3Bucket,
		forcePath: cfg.S3ForcePath,
		accessKey: cfg.S3AccessKeyID,
		secretKey: cfg.S3SecretKey,
		http:      &http.Client{Timeout: 30 * time.Second},
	}
}

// objectURL gives the request URL for a key.
func (m *MinioClient) objectURL(key string) string {
	u, err := url.Parse(m.endpoint)
	if err != nil {
		return ""
	}
	if m.forcePath {
		u.Path = path.Join("/", m.bucket, key)
	} else {
		u.Host = m.bucket + "." + u.Host
		u.Path = path.Join("/", key)
	}
	return u.String()
}

// signRequest adds AWS SigV4 headers to the request.
func (m *MinioClient) signRequest(r *http.Request, payload []byte) {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	r.Header.Set("x-amz-date", amzDate)
	payloadHash := hex.EncodeToString(sha256Sum(payload))
	r.Header.Set("x-amz-content-sha256", payloadHash)

	// the signed headers are exactly host, x-amz-content-sha256, x-amz-date
	canonicalHeaders := "host:" + r.Host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{
		r.Method, r.URL.EscapedPath(), r.URL.RawQuery,
		canonicalHeaders, signedHeaders, payloadHash,
	}, "\n")
	scope := dateStamp + "/" + m.region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, scope,
		hex.EncodeToString(sha256Sum([]byte(canonicalRequest))),
	}, "\n")
	kDate := hmacBytes([]byte("AWS4"+m.secretKey), dateStamp)
	kRegion := hmacBytes(kDate, m.region)
	kService := hmacBytes(kRegion, "s3")
	kSigning := hmacBytes(kService, "aws4_request")
	signature := hex.EncodeToString(hmacBytes(kSigning, stringToSign))
	r.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		m.accessKey, scope, signedHeaders, signature))
}

func sha256Sum(b []byte) []byte {
	h := sha256.Sum256(b)
	return h[:]
}

func hmacBytes(key []byte, data string) []byte {
	// hmac with sha256 using the standard library
	return hmacSHA256Std(key, []byte(data))
}

// Put stores an object and confirms by reading its size back.
func (m *MinioClient) Put(ctx context.Context, key string, contentType string, data []byte) (int64, error) {
	u := m.objectURL(key)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, bytes.NewReader(data))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Host = req.URL.Host
	m.signRequest(req, data)
	res, err := m.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return 0, fmt.Errorf("storage answered %d", res.StatusCode)
	}
	// confirm by reading the object back
	size, err := m.Size(ctx, key)
	if err != nil {
		return 0, err
	}
	return size, nil
}

// Size reads the object's size back; it confirms the object exists.
func (m *MinioClient) Size(ctx context.Context, key string) (int64, error) {
	u := m.objectURL(key)
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, u, nil)
	if err != nil {
		return 0, err
	}
	req.Host = req.URL.Host
	m.signRequest(req, nil)
	res, err := m.http.Do(req)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	if res.StatusCode == 404 {
		return 0, fmt.Errorf("storage answered 404")
	}
	if res.StatusCode >= 300 {
		return 0, fmt.Errorf("storage answered %d", res.StatusCode)
	}
	return res.ContentLength, nil
}

// Get downloads an object.
func (m *MinioClient) Get(ctx context.Context, key string) ([]byte, error) {
	u := m.objectURL(key)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Host = req.URL.Host
	m.signRequest(req, nil)
	res, err := m.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return nil, fmt.Errorf("storage answered %d", res.StatusCode)
	}
	return io.ReadAll(res.Body)
}
