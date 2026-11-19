use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;
use sha2::{Digest, Sha256};

use crate::config::Config;

pub struct S3 {
    client: Client<HttpConnector, Full<Bytes>>,
    cfg: Config,
    host: String,
    port: u16,
    path_prefix: String,
}

fn map_err<E: std::fmt::Display>(e: E) -> String { format!("minio: {e}") }

impl S3 {
    pub fn new(cfg: &Config) -> Result<Self, String> {
        let (host, _, port, _, _) = crate::config::parse_url_host(&cfg.s3_endpoint)?;
        let path_prefix = if cfg.s3_force_path_style { format!("/{}", cfg.s3_bucket) } else { String::new() };
        let connector = HttpConnector::new();
        let client = Client::builder(TokioExecutor::new()).build(connector);
        Ok(S3 { client, cfg: cfg.clone(), host, port, path_prefix })
    }

    fn base(&self) -> String {
        format!("http://{}:{}", self.host, self.port)
    }

    pub async fn put(&self, key: &str, bytes: &[u8], content_type: &str) -> Result<(), String> {
        let path = format!("{}/{}", self.path_prefix, key);
        let url = format!("{}{}", self.base(), path);
        let now = chrono::Utc::now();
        let sig = crate::http_client::SigV4 {
            access_key: &self.cfg.s3_access_key_id,
            secret_key: &self.cfg.s3_secret_access_key,
            region: &self.cfg.s3_region,
        };
        let headers = sig.sign("PUT", &format!("{}:{}", self.host, self.port), &path, &[], bytes, now, Some(content_type));
        let mut req = hyper::Request::builder().method("PUT").uri(&url).header("content-type", content_type);
        for (k, v) in &headers { req = req.header(*k, v); }
        let request = req.body(Full::new(Bytes::from(bytes.to_vec()))).map_err(map_err)?;
        let resp = self.client.request(request).await.map_err(map_err)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.into_body().collect().await.map_err(map_err)?.to_bytes().to_vec();
            return Err(format!("minio put {key}: {status} {}", String::from_utf8_lossy(&body)));
        }
        Ok(())
    }

    pub async fn get(&self, key: &str) -> Result<Vec<u8>, String> {
        let path = format!("{}/{}", self.path_prefix, key);
        let url = format!("{}{}", self.base(), path);
        let now = chrono::Utc::now();
        let sig = crate::http_client::SigV4 {
            access_key: &self.cfg.s3_access_key_id,
            secret_key: &self.cfg.s3_secret_access_key,
            region: &self.cfg.s3_region,
        };
        let headers = sig.sign("GET", &format!("{}:{}", self.host, self.port), &path, &[], &[], now, None);
        let mut req = hyper::Request::builder().method("GET").uri(&url);
        for (k, v) in &headers { req = req.header(*k, v); }
        let request = req.body(Full::new(Bytes::from(Vec::new()))).map_err(map_err)?;
        let resp = self.client.request(request).await.map_err(map_err)?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.into_body().collect().await.map_err(map_err)?.to_bytes().to_vec();
            let _ = body;
            return Err(format!("minio get {key}: {status}"));
        }
        let bytes = resp.into_body().collect().await.map_err(map_err)?.to_bytes().to_vec();
        Ok(bytes)
    }

    pub async fn delete(&self, key: &str) -> Result<(), String> {
        let path = format!("{}/{}", self.path_prefix, key);
        let url = format!("{}{}", self.base(), path);
        let now = chrono::Utc::now();
        let sig = crate::http_client::SigV4 {
            access_key: &self.cfg.s3_access_key_id,
            secret_key: &self.cfg.s3_secret_access_key,
            region: &self.cfg.s3_region,
        };
        let headers = sig.sign("DELETE", &format!("{}:{}", self.host, self.port), &path, &[], &[], now, None);
        let mut req = hyper::Request::builder().method("DELETE").uri(&url);
        for (k, v) in &headers { req = req.header(*k, v); }
        let request = req.body(Full::new(Bytes::from(Vec::new()))).map_err(map_err)?;
        let resp = self.client.request(request).await.map_err(map_err)?;
        let _ = resp.status();
        Ok(())
    }

    /// Delete every object under a prefix, by listing it first.
    pub async fn delete_prefix(&self, prefix: &str) -> Result<(), String> {
        // List-objects-v2 then delete in batches of 1000.
        let mut token: Option<String> = None;
        loop {
            let query: Vec<(&str, String)> = {
                let mut q = vec![("list-type", "2".to_string()), ("prefix", prefix.to_string())];
                if let Some(t) = &token { q.push(("continuation-token", t.clone())); }
                q
            };
            let path = format!("{}/", self.path_prefix);
            let now = chrono::Utc::now();
            let sig = crate::http_client::SigV4 {
                access_key: &self.cfg.s3_access_key_id,
                secret_key: &self.cfg.s3_secret_access_key,
                region: &self.cfg.s3_region,
            };
            let headers = sig.sign("GET", &format!("{}:{}", self.host, self.port), &path, &query, &[], now, None);
            let mut qs = query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>();
            qs.sort();
            let url = format!("{}{}?{}", self.base(), path, qs.join("&"));
            let mut req = hyper::Request::builder().method("GET").uri(&url);
            for (k, v) in &headers { req = req.header(*k, v); }
            let request = req.body(Full::new(Bytes::from(Vec::new()))).map_err(map_err)?;
            let resp = self.client.request(request).await.map_err(map_err)?;
            let body = resp.into_body().collect().await.map_err(map_err)?.to_bytes().to_vec();
            let text = String::from_utf8_lossy(&body);
            let keys: Vec<String> = text.match_prefix_keys();
            for k in &keys {
                self.delete(k).await?;
            }
            token = text.match_continuation_token();
            if token.is_none() { break; }
        }
        Ok(())
    }

    pub async fn ensure_bucket(&self) -> Result<(), String> {
        let path = format!("/{}", self.cfg.s3_bucket);
        let url = format!("{}{}", self.base(), path);
        let now = chrono::Utc::now();
        let sig = crate::http_client::SigV4 {
            access_key: &self.cfg.s3_access_key_id,
            secret_key: &self.cfg.s3_secret_access_key,
            region: &self.cfg.s3_region,
        };
        let headers = sig.sign("HEAD", &format!("{}:{}", self.host, self.port), &path, &[], &[], now, None);
        let mut req = hyper::Request::builder().method("HEAD").uri(&url);
        for (k, v) in &headers { req = req.header(*k, v); }
        let request = req.body(Full::new(Bytes::from(Vec::new()))).map_err(map_err)?;
        let resp = self.client.request(request).await.map_err(map_err_err)?;
        if resp.status().as_u16() == 404 {
            self.create_bucket().await?;
        }
        Ok(())
    }

    async fn create_bucket(&self) -> Result<(), String> {
        let path = format!("/{}", self.cfg.s3_bucket);
        let url = format!("{}{}", self.base(), path);
        let now = chrono::Utc::now();
        let sig = crate::http_client::SigV4 {
            access_key: &self.cfg.s3_access_key_id,
            secret_key: &self.cfg.s3_secret_access_key,
            region: &self.cfg.s3_region,
        };
        let body = format!("<CreateBucketConfiguration xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\"><LocationConstraint>{}</LocationConstraint></CreateBucketConfiguration>", self.cfg.s3_region);
        let headers = sig.sign("PUT", &format!("{}:{}", self.host, self.port), &path, &[], body.as_bytes(), now, Some("application/xml"));
        let mut req = hyper::Request::builder().method("PUT").uri(&url);
        for (k, v) in &headers { req = req.header(*k, v); }
        let request = req.body(Full::new(Bytes::from(body.into_bytes()))).map_err(map_err)?;
        let resp = self.client.request(request).await.map_err(map_err)?;
        if !resp.status().is_success() {
            return Err(format!("minio create bucket: {}", resp.status()));
        }
        Ok(())
    }

    pub async fn head_bucket(&self) -> Result<(), String> {
        let path = format!("/{}", self.cfg.s3_bucket);
        let url = format!("{}{}", self.base(), path);
        let now = chrono::Utc::now();
        let sig = crate::http_client::SigV4 {
            access_key: &self.cfg.s3_access_key_id,
            secret_key: &self.cfg.s3_secret_access_key,
            region: &self.cfg.s3_region,
        };
        let headers = sig.sign("HEAD", &format!("{}:{}", self.host, self.port), &path, &[], &[], now, None);
        let mut req = hyper::Request::builder().method("HEAD").uri(&url);
        for (k, v) in &headers { req = req.header(*k, v); }
        let request = req.body(Full::new(Bytes::from(Vec::new()))).map_err(map_err)?;
        let resp = self.client.request(request).await.map_err(map_err)?;
        if resp.status().is_success() { Ok(()) } else { Err(format!("minio head bucket: {}", resp.status())) }
    }
}

trait XmlKeys {
    fn match_prefix_keys(&self) -> Vec<String>;
    fn match_continuation_token(&self) -> Option<String>;
}

impl XmlKeys for str {
    fn match_prefix_keys(&self) -> Vec<String> {
        let mut keys = Vec::new();
        let mut rest = self;
        while let Some(start) = rest.find("<Key>") {
            if let Some(end_rel) = rest[start..].find("</Key>") {
                keys.push(rest[start + 5..start + end_rel].to_string());
                rest = &rest[start + end_rel + 6..];
            } else { break; }
        }
        keys
    }
    fn match_continuation_token(&self) -> Option<String> {
        let start = self.find("<NextContinuationToken>")?;
        let end = self[start..].find("</NextContinuationToken>")?;
        Some(self[start + 23..start + end].to_string())
    }
}

fn map_err_err<E: std::fmt::Display>(e: E) -> String { format!("minio: {e}") }

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
