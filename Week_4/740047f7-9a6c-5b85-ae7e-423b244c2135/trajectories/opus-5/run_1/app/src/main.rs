mod api;
mod config;
mod db;
mod domain;
mod error;
mod history;
mod model;
mod providers;
mod report;
mod seed;
mod store;
mod valkey;

use api::AppState;
use config::Config;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use store::s3::ObjectStore;
use valkey::Live;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let port = config.port;
    let http = reqwest::Client::builder()
        .pool_idle_timeout(Duration::from_secs(30))
        .build()?;
    let pool = db::pool(&config.database_url)?;
    let store = ObjectStore::new(config.s3.clone(), http.clone());
    let live = Live::connect(&config.valkey_url)?;
    live.spawn_relay();

    let state = AppState {
        config,
        pool,
        store,
        live,
        http,
        ready: Arc::new(AtomicBool::new(false)),
    };

    tokio::spawn(boot(state.clone()));

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    axum::serve(listener, api::router(state)).await?;
    Ok(())
}

/// At boot the server retries Postgres, MinIO and Valkey for up to 60 seconds.
/// The providers are never contacted at boot.
async fn boot(state: AppState) {
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match prepare(&state).await {
            Ok(()) => {
                state.ready.store(true, Ordering::SeqCst);
                return;
            }
            Err(message) => {
                if Instant::now() >= deadline {
                    eprintln!("pensight could not start: {message}");
                    return;
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }
    }
}

async fn prepare(state: &AppState) -> Result<(), String> {
    drop(
        state
            .pool
            .get()
            .await
            .map_err(|error| format!("postgres: {error}"))?,
    );
    db::apply_schema(&state.pool)
        .await
        .map_err(|error| format!("schema: {}", error.message))?;
    state
        .store
        .ensure_bucket()
        .await
        .map_err(|error| format!("minio: {}", error.message))?;
    state
        .live
        .ping()
        .await
        .map_err(|error| format!("valkey: {}", error.message))?;
    seed::apply(&state.pool, &state.store)
        .await
        .map_err(|error| format!("seed: {}", error.message))?;
    Ok(())
}
