pub mod database;

use rusqlite::Connection;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Memory database state
pub struct MemoryDB {
    conn: Arc<Mutex<Connection>>,
}

impl MemoryDB {
    /// Create new memory database
    pub fn new(db_path: &str) -> anyhow::Result<Self> {
        let conn = Connection::open(db_path)?;

        // Initialize schema
        database::init_schema(&conn)?;

        tracing::info!("Memory database initialized at: {}", db_path);

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    /// Get database connection
    pub fn conn(&self) -> Arc<Mutex<Connection>> {
        self.conn.clone()
    }
}
