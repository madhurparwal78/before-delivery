use postgres::{Client as PgClient, NoTls};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;


/// A connection to Postgres, kept alive and rebuilt on loss.
pub struct Pg {
    tx: mpsc::Sender<Task>,
}

struct Task {
    sql: String,
    params: Vec<PgValue>,
    reply: mpsc::Sender<Result<Rows, String>>,
}

#[derive(Clone)]
pub enum Param {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Json(serde_json::Value),
    Timestamp(chrono::DateTime<chrono::Utc>),
}

/// One concrete, typed parameter value. An enum keeps ToSql's static dispatch,
/// which serialisation needs for typed Postgres parameters.
#[derive(Clone, Debug)]
pub enum PgValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Json(serde_json::Value),
    Timestamp(chrono::DateTime<chrono::Utc>),
}

impl Param {
    pub fn to_value(&self) -> PgValue {
        match self {
            Param::Null => PgValue::Null,
            Param::Bool(b) => PgValue::Bool(*b),
            Param::Int(i) => PgValue::Int(*i),
            Param::Float(f) => PgValue::Float(*f),
            Param::Text(s) => PgValue::Text(s.clone()),
            Param::Json(j) => PgValue::Json(j.clone()),
            Param::Timestamp(t) => PgValue::Timestamp(*t),
        }
    }
}

impl postgres::types::ToSql for PgValue {
    fn to_sql(
        &self,
        ty: &postgres::types::Type,
        out: &mut postgres::types::private::BytesMut,
    ) -> Result<postgres::types::IsNull, Box<dyn std::error::Error + Sync + Send>> {
        match self {
            PgValue::Null => Option::<String>::None.to_sql(ty, out),
            PgValue::Bool(b) => b.to_sql(ty, out),
            PgValue::Int(i) => i.to_sql(ty, out),
            PgValue::Float(f) => f.to_sql(ty, out),
            PgValue::Text(s) => s.to_sql(ty, out),
            PgValue::Json(j) => j.to_sql(ty, out),
            PgValue::Timestamp(t) => t.to_sql(ty, out),
        }
    }
    fn accepts(_ty: &postgres::types::Type) -> bool { true }
    postgres::types::to_sql_checked!();
}

pub struct Rows {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

impl Rows {
    pub fn empty() -> Rows { Rows { columns: Vec::new(), rows: Vec::new() } }

    pub fn get(&self, row: usize, col: &str) -> serde_json::Value {
        let idx = self.columns.iter().position(|c| c == col).unwrap_or(0);
        self.rows.get(row).and_then(|r| r.get(idx)).cloned().unwrap_or(serde_json::Value::Null)
    }
    pub fn len(&self) -> usize { self.rows.len() }
    pub fn is_empty(&self) -> bool { self.rows.is_empty() }
    pub fn str_of(&self, row: usize, col: &str) -> String {
        match self.get(row, col) {
            serde_json::Value::String(s) => s,
            serde_json::Value::Number(n) => n.to_string(),
            _ => String::new(),
        }
    }
    pub fn num_of(&self, row: usize, col: &str) -> f64 {
        match self.get(row, col) {
            serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
            _ => 0.0,
        }
    }
    pub fn int_of(&self, row: usize, col: &str) -> i64 {
        match self.get(row, col) {
            serde_json::Value::Number(n) => n.as_i64().unwrap_or(0),
            _ => 0,
        }
    }
    pub fn text_opt(&self, row: usize, col: &str) -> Option<String> {
        match self.get(row, col) {
            serde_json::Value::String(s) => Some(s),
            _ => None,
        }
    }
}

impl Pg {
    pub fn connect(url: &str) -> Result<Arc<Pg>, String> {
        let (tx, rx) = mpsc::channel::<Task>();
        let url_owned = url.to_string();
        let handle = std::thread::Builder::new()
            .name("pensight-pg".into())
            .spawn(move || {
            let mut client: Option<PgClient> = None;
            loop {
                match rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(task) => {
                        if client.is_none() {
                            match PgClient::connect(&url_owned, NoTls) {
                                Ok(c) => client = Some(c),
                                Err(e) => {
                                    let _ = task.reply.send(Err(format!("postgres connect: {e}")));
                                    continue;
                                }
                            }
                        }
                        let result = match &mut client {
                            Some(c) => {
                                let owned: Vec<PgValue> = task.params.clone();
                                let refs: Vec<&(dyn postgres::types::ToSql + Sync)> =
                                    owned.iter().map(|v| v as &(dyn postgres::types::ToSql + Sync)).collect();
                                match run_query(c, &task.sql, &refs) {
                                    Ok(rows) => Ok(rows),
                                    Err(e) => {
                                        client = None;
                                        Err(e)
                                    }
                                }
                            }
                            None => Err("postgres connection unavailable".to_string()),
                        };
                        let _ = task.reply.send(result);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        // Drop the idle connection so the next task reconnects freshly.
                        client = None;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                }
            }
            });
        eprintln!("pensight: pg worker spawned");
        let _ = &handle;
        Ok(Arc::new(Pg { tx }))
    }


    /// Runs a multi-statement script (the schema).
    pub fn exec_script(&self, sql: &str) -> Result<(), String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        let task = Task { sql: sql.to_string(), params: vec![], reply: reply_tx };
        self.tx.send(task).map_err(|_| "postgres worker gone".to_string())?;
        reply_rx.recv_timeout(Duration::from_secs(60)).map_err(|_| "postgres script timed out".to_string())?
            .map(|_| ())
    }

    pub fn exec(&self, sql: &str, params: Vec<Param>) -> Result<Rows, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        let task = Task { sql: sql.to_string(), params: params.iter().map(|p| p.to_value()).collect(), reply: reply_tx };
        self.tx.send(task).map_err(|_| "postgres worker gone".to_string())?;
        reply_rx.recv_timeout(Duration::from_secs(30)).map_err(|_| "postgres query timed out".to_string())?
    }
}

fn first_line(sql: &str) -> String {
    sql.lines().find(|l| !l.trim().is_empty()).unwrap_or("").chars().take(90).collect()
}

fn run_query(c: &mut PgClient, sql: &str, params: &[&(dyn postgres::types::ToSql + Sync)]) -> Result<Rows, String> {
    // A script (the schema) holds several statements and must run as a batch;
    // c.query would refuse it. A batch returns no rows.
    let multi = sql.trim_end().ends_with(';') && sql.matches(';').count() > 1;
    if multi && params.is_empty() {
        return c.batch_execute(sql).map(|_| Rows::empty()).map_err(|e| format!("pg script: {e}"));
    }
    let rows = c.query(sql, params).map_err(|e| format!("pg: {e:?} [{}]", first_line(sql)))?;
    let columns: Vec<String> = rows.first()
        .map(|r| r.columns().iter().map(|col| col.name().to_string()).collect())
        .unwrap_or_default();
    let mut out = Vec::with_capacity(rows.len());
    for r in &rows {
        let mut vals = Vec::with_capacity(columns.len());
        for i in 0..columns.len() {
            vals.push(pg_to_json(r, i));
        }
        out.push(vals);
    }
    Ok(Rows { columns, rows: out })
}

fn pg_to_json(row: &postgres::Row, i: usize) -> serde_json::Value {
    use postgres::types::Type;
    let ty = row.columns()[i].type_();
    if ty == &Type::BOOL {
        let v: Option<bool> = row.get(i);
        return v.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null);
    }
    if ty == &Type::INT4 || ty == &Type::INT8 {
        let v: Option<i64> = row.try_get(i).ok();
        return v.map(|n| serde_json::json!(n)).unwrap_or(serde_json::Value::Null);
    }
    if ty == &Type::FLOAT4 || ty == &Type::FLOAT8 {
        let v: Option<f64> = row.get(i);
        return v.map(|n| serde_json::json!(n)).unwrap_or(serde_json::Value::Null);
    }
    if ty == &Type::TEXT || ty == &Type::VARCHAR {
        let v: Option<String> = row.get(i);
        return v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null);
    }
    if ty == &Type::JSON || ty == &Type::JSONB {
        let v: Option<serde_json::Value> = row.get(i);
        return v.unwrap_or(serde_json::Value::Null);
    }
    if ty == &Type::TIMESTAMPTZ {
        let v: Option<chrono::DateTime<chrono::Utc>> = row.get(i);
        return v.map(|t| serde_json::json!(t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)))
            .unwrap_or(serde_json::Value::Null);
    }
    if ty == &Type::TIMESTAMP {
        let v: Option<chrono::NaiveDateTime> = row.get(i);
        return v.map(|t| serde_json::json!(format!("{}Z", t.format("%Y-%m-%dT%H:%M:%S"))))
            .unwrap_or(serde_json::Value::Null);
    }
    let v: Option<String> = row.get(i);
    v.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
}
