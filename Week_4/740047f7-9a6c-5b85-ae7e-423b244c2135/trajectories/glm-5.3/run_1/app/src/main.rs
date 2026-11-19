//! main: read configuration, wait for the services, seed, then serve.

#[path = "config.rs"] mod config;
#[path = "domain.rs"] mod domain;
#[path = "infra.rs"] mod infra;
#[path = "http_client.rs"] mod http_client;
#[path = "pg.rs"] mod pg;
#[path = "s3.rs"] mod s3;
#[path = "store.rs"] mod store;
#[path = "seed.rs"] mod seed;
#[path = "api.rs"] mod api;
#[path = "validate.rs"] mod validate;
#[path = "defects.rs"] mod defects;
#[path = "dives.rs"] mod dives;
#[path = "copilot.rs"] mod copilot;
#[path = "imports.rs"] mod imports;
#[path = "reports.rs"] mod reports;
#[path = "server.rs"] mod server;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn main() {
    let cfg = config::Config::from_env().unwrap_or_else(|e| {
        eprintln!("pensight: {e}");
        std::process::exit(1);
    });
    let runtime = tokio::runtime::Builder::new_multi_thread().enable_all().build();
    let rt = match runtime { Ok(r) => r, Err(e) => { eprintln!("pensight: {e}"); std::process::exit(1); } };
    rt.block_on(async move {
        let ready = Arc::new(AtomicBool::new(false));
        let assets = match server::Assets::load() {
            Ok(a) => Arc::new(a),
            Err(_) => Arc::new(server::Assets { index: include_bytes!("fallback_index.html").to_vec(), files: Default::default() }),
        };
        let ready_task = Arc::clone(&ready);
        let cfg_boot = cfg.clone();
        let assets_boot = assets.clone();
        let handle = tokio::spawn(async move {
            server::serve(cfg_boot, ready_task, assets_boot).await
        });
        // Wait for readiness: retry Postgres, MinIO and Valkey for up to 60 seconds.
        let mut waited = 0u64;
        while waited < 60 {
            let pg_ok = match pg::Pg::connect(&cfg.database_url) {
                Ok(p) => match p.exec("SELECT 1 AS ok", vec![]) {
                    Ok(_) => true,
                    Err(e) => { eprintln!("pensight: pg probe: {e}"); false }
                },
                Err(e) => { eprintln!("pensight: pg connect: {e}"); false }
            };
            let valkey_ok = match infra::Valkey::new(&cfg.valkey_url) {
                Ok(v) => match v.ping().await {
                    Ok(true) => true,
                    Ok(false) => { eprintln!("pensight: valkey ping returned false"); false }
                    Err(e) => { eprintln!("pensight: valkey ping error: {e}"); false }
                },
                Err(e) => { eprintln!("pensight: valkey connect: {e}"); false }
            };
            let s3 = s3::S3::new(&cfg);
            let s3_ok = match &s3 {
                Ok(s) => match s.head_bucket().await {
                    Ok(()) => true,
                    Err(e) => { eprintln!("pensight: s3 head bucket: {e}"); false }
                },
                Err(e) => { eprintln!("pensight: s3 init: {e}"); false }
            };
            if pg_ok && valkey_ok && s3_ok {
                if let Ok(s) = s3 { let _ = s.ensure_bucket().await; }
                ready.store(true, Ordering::SeqCst);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            waited += 1;
        }
        match handle.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => { eprintln!("pensight: {e}"); std::process::exit(1); }
            Err(e) => { eprintln!("pensight: {e}"); std::process::exit(1); }
        }
    });
}

