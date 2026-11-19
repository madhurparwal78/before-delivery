//! Plain-HTTP JSON-over-HTTP client for the two WireMock providers,
//! plus AWS SigV4 signing for MinIO. No TLS anywhere.

use crate::infra::ApiError;
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;
use sha2::{Digest, Sha256};
use std::time::Duration;

pub struct Http {
    client: Client<HttpConnector, Full<Bytes>>,
}

impl Http {
    pub fn new() -> Self {
        let connector = HttpConnector::new();
        let client = Client::builder(TokioExecutor::new()).build(connector);
        Http { client }
    }

    pub async fn request_raw(
        &self,
        method: &str,
        url: &str,
        body: Option<String>,
        content_type: &str,
        extra_headers: &[(&str, &str)],
        timeout: Duration,
    ) -> Result<(u16, hyper::HeaderMap, Vec<u8>), ApiError> {
        let uri: hyper::Uri = url.parse().map_err(|_| ApiError::new(502, "forecast_unavailable", "bad provider url"))?;
        let mut req = hyper::Request::builder().method(method).uri(uri);
        req = req.header("content-type", content_type);
        for (k, v) in extra_headers {
            req = req.header(*k, *v);
        }
        let full = match &body {
            Some(b) => Full::new(Bytes::from(b.as_bytes().to_vec())),
            None => Full::new(Bytes::from(Vec::new())),
        };
        let request = req.body(full).map_err(|_| ApiError::new(502, "forecast_unavailable", "bad provider request"))?;
        let resp = tokio::time::timeout(timeout, self.client.request(request)).await
            .map_err(|_| ApiError::new(504, "copilot_unavailable", "provider timeout"))?
            .map_err(|_| ApiError::new(502, "copilot_unavailable", "provider unreachable"))?;
        let status = resp.status().as_u16();
        let headers = resp.headers().clone();
        let bytes = resp.into_body().collect().await
            .map_err(|_| ApiError::new(502, "copilot_unavailable", "provider body"))?
            .to_bytes().to_vec();
        Ok((status, headers, bytes))
    }
}

/// AWS Signature V4 for plain HTTP MinIO.
pub struct SigV4<'a> {
    pub access_key: &'a str,
    pub secret_key: &'a str,
    pub region: &'a str,
}

impl SigV4<'_> {
    pub fn sign(
        &self,
        method: &str,
        host: &str,
        path: &str,
        query: &[(&str, String)],
        payload: &[u8],
        now: chrono::DateTime<chrono::Utc>,
        content_type: Option<&str>,
    ) -> Vec<(&'static str, String)> {
        let date = now.format("%Y%m%d").to_string();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let payload_hash = hex::encode(Sha256::digest(payload));
        let mut canonical_qs: Vec<String> = query
            .iter()
            .map(|(k, v)| format!("{}={}", uri_encode(k, true), uri_encode(v, true)))
            .collect();
        canonical_qs.sort();
        let canonical_qs = canonical_qs.join("&");
        let mut canonical_headers = format!("host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n");
        if let Some(ct) = content_type {
            canonical_headers = format!("content-type:{ct}\n{canonical_headers}");
        }
        let signed_headers = if content_type.is_some() { "content-type;host;x-amz-content-sha256;x-amz-date" } else { "host;x-amz-content-sha256;x-amz-date" };
        let canonical_request = format!("{method}\n{path}\n{canonical_qs}\n{canonical_headers}\n{signed_headers}\n{payload_hash}");
        let credential_scope = format!("{date}/{}/s3/aws4_request", self.region);
        let string_to_sign = format!("AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}", hex::encode(Sha256::digest(canonical_request.as_bytes())));
        let k_date = hmac_sha256(format!("AWS4{}", self.secret_key).as_bytes(), date.as_bytes());
        let k_region = hmac_sha256(&k_date, self.region.as_bytes());
        let k_service = hmac_sha256(&k_region, b"s3");
        let k_signing = hmac_sha256(&k_service, b"aws4_request");
        let signature = hex::encode(hmac_sha256(&k_signing, string_to_sign.as_bytes()));
        let auth = format!("AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}", self.access_key, credential_scope, signed_headers, signature);
        vec![
            ("authorization", auth),
            ("x-amz-content-sha256", payload_hash),
            ("x-amz-date", amz_date),
        ]
    }
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    use sha2::Digest;
    const BLOCK: usize = 64;
    let mut key_block = [0u8; BLOCK];
    if key.len() > BLOCK {
        key_block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut inner_key = [0x36u8; BLOCK];
    let mut outer_key = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        inner_key[i] ^= key_block[i];
        outer_key[i] ^= key_block[i];
    }
    let mut inner = Sha256::new();
    inner.update(inner_key);
    inner.update(data);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_key);
    outer.update(inner_hash);
    outer.finalize().to_vec()
}

fn uri_encode(s: &str, encode_slash: bool) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => out.push(b as char),
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
