use std::env::{var, VarError};

#[derive(Clone)]
pub struct S3Config {
    pub endpoint: String,
    pub region: String,
    pub bucket: String,
    pub force_path_style: bool,
    pub access_key_id: String,
    pub secret_access_key: String,
}

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub valkey_url: String,
    pub wiremock_url: String,
    pub port: u16,
    pub public_url: Option<String>,
    pub s3: S3Config,
}

fn required(key: &str) -> Result<String, String> {
    match var(key) {
        Ok(v) if !v.is_empty() => Ok(v),
        Ok(_) | Err(VarError::NotPresent) => Err(format!("{key} is not set")),
        Err(VarError::NotUnicode(_)) => Err(format!("{key} is not valid unicode")),
    }
}

fn optional(key: &str) -> Option<String> {
    match var(key) {
        Ok(v) if !v.is_empty() => Some(v),
        _ => None,
    }
}

impl Config {
    pub fn from_env() -> Result<Config, String> {
        let port = match optional("APP_PUBLIC_PORT") {
            Some(raw) => raw
                .parse::<u16>()
                .map_err(|_| "APP_PUBLIC_PORT is not a port number".to_string())?,
            None => 4173,
        };
        Ok(Config {
            database_url: required("DATABASE_URL")?,
            valkey_url: required("VALKEY_URL")?,
            wiremock_url: required("WIREMOCK_URL")?.trim_end_matches('/').to_string(),
            port,
            public_url: optional("APP_PUBLIC_URL").map(|u| u.trim_end_matches('/').to_string()),
            s3: S3Config {
                endpoint: required("S3_ENDPOINT")?.trim_end_matches('/').to_string(),
                region: required("S3_REGION")?,
                bucket: required("S3_BUCKET")?,
                force_path_style: optional("S3_FORCE_PATH_STYLE")
                    .map(|v| v == "true" || v == "1")
                    .unwrap_or(false),
                access_key_id: required("S3_ACCESS_KEY_ID")?,
                secret_access_key: required("S3_SECRET_ACCESS_KEY")?,
            },
        })
    }

    /// The app's own origin, used for the cross-site write check and for
    /// absolute report link URLs.
    pub fn configured_origin(&self) -> Option<String> {
        let url = self.public_url.as_ref()?;
        let (scheme, rest) = url.split_once("://")?;
        let host = rest.split('/').next().unwrap_or(rest);
        Some(format!("{scheme}://{host}"))
    }
}
