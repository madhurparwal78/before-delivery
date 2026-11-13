package main

import (
	"crypto/hmac"
	"crypto/sha256"
)

func hmacSHA256Std(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}
