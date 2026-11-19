//! The one place the process environment is read.

use std::env;

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub public_url: Option<String>,
    pub database_url: String,
    pub s3_endpoint: String,
    pub s3_region: String,
    pub s3_bucket: String,
    pub s3_access_key_id: String,
    pub s3_secret_access_key: String,
    pub valkey_url: String,
    pub wiremock_url: String,
}

fn required(name: &str) -> Result<String, String> {
    env::var(name).map_err(|_| format!("environment variable {name} is not set"))
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let port = match env::var("APP_PUBLIC_PORT") {
            Ok(text) => text.parse().map_err(|_| "APP_PUBLIC_PORT is not a port".to_string())?,
            Err(_) => 4173,
        };
        Ok(Config {
            port,
            public_url: env::var("APP_PUBLIC_URL").ok().filter(|u| !u.trim().is_empty()),
            database_url: required("DATABASE_URL")?,
            s3_endpoint: required("S3_ENDPOINT")?.trim_end_matches('/').to_string(),
            s3_region: required("S3_REGION")?,
            s3_bucket: required("S3_BUCKET")?,
            s3_access_key_id: required("S3_ACCESS_KEY_ID")?,
            s3_secret_access_key: required("S3_SECRET_ACCESS_KEY")?,
            valkey_url: required("VALKEY_URL")?,
            wiremock_url: required("WIREMOCK_URL")?.trim_end_matches('/').to_string(),
        })
    }

    /// The app's own origin when APP_PUBLIC_URL names it.
    pub fn public_origin(&self) -> Option<String> {
        let url = self.public_url.as_ref()?;
        let (scheme, rest) = url.split_once("://")?;
        Some(format!("{}://{}", scheme.to_lowercase(), rest.split('/').next()?.to_lowercase()))
    }
}
