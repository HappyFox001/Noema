use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use anyhow::Result;

/// Initialize database schema
pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        -- 对话历史（工作记忆）
        CREATE TABLE IF NOT EXISTS conversation_turns (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_conversation_timestamp
            ON conversation_turns(timestamp DESC);

        -- 用户画像 - 基本信息
        CREATE TABLE IF NOT EXISTS user_profile (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        -- 用户画像 - 重要记忆 (最多 20 条)
        CREATE TABLE IF NOT EXISTS important_memories (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            importance REAL DEFAULT 1.0,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        -- 对话摘要（每 10 轮生成）
        CREATE TABLE IF NOT EXISTS conversation_summaries (
            id TEXT PRIMARY KEY,
            start_turn INTEGER NOT NULL,
            end_turn INTEGER NOT NULL,
            summary TEXT NOT NULL,
            key_topics TEXT,
            timestamp INTEGER NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_summaries_timestamp
            ON conversation_summaries(timestamp DESC);

        -- 元数据
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        -- 初始化元数据
        INSERT OR IGNORE INTO metadata (key, value) VALUES ('db_version', '1.0.0');
        INSERT OR IGNORE INTO metadata (key, value)
            VALUES ('created_at', strftime('%s', 'now'));
        "#
    )?;

    Ok(())
}

// ========== 数据结构 ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurn {
    pub id: String,
    pub role: String,
    pub content: String,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationSummary {
    pub id: String,
    pub start_turn: i32,
    pub end_turn: i32,
    pub summary: String,
    pub key_topics: Vec<String>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfileEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportantMemory {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryStats {
    pub conversation_count: i32,
    pub summary_count: i32,
    pub memory_count: i32,
}

// ========== 对话历史操作 ==========

pub fn save_conversation_turn(conn: &Connection, turn: &ConversationTurn) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO conversation_turns (id, role, content, timestamp) VALUES (?1, ?2, ?3, ?4)",
        params![turn.id, turn.role, turn.content, turn.timestamp],
    )?;
    Ok(())
}

pub fn get_recent_conversations(conn: &Connection, limit: usize) -> Result<Vec<ConversationTurn>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, content, timestamp FROM conversation_turns
         ORDER BY timestamp DESC LIMIT ?1"
    )?;

    let turns = stmt.query_map([limit], |row| {
        Ok(ConversationTurn {
            id: row.get(0)?,
            role: row.get(1)?,
            content: row.get(2)?,
            timestamp: row.get(3)?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;

    // 按时间正序返回
    let mut turns = turns;
    turns.reverse();
    Ok(turns)
}

#[allow(dead_code)]
pub fn clear_conversations(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM conversation_turns", [])?;
    Ok(())
}

// ========== 用户画像操作 ==========

pub fn save_user_profile_entry(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO user_profile (key, value, updated_at)
         VALUES (?1, ?2, strftime('%s', 'now'))",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_user_profile(conn: &Connection) -> Result<Vec<UserProfileEntry>> {
    let mut stmt = conn.prepare("SELECT key, value FROM user_profile")?;

    let entries = stmt.query_map([], |row| {
        Ok(UserProfileEntry {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;

    Ok(entries)
}

// ========== 重要记忆操作 ==========

pub fn save_important_memory(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO important_memories (key, value, updated_at)
         VALUES (?1, ?2, strftime('%s', 'now'))",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_important_memories(conn: &Connection) -> Result<Vec<ImportantMemory>> {
    let mut stmt = conn.prepare(
        "SELECT key, value FROM important_memories
         ORDER BY created_at DESC LIMIT 20"
    )?;

    let memories = stmt.query_map([], |row| {
        Ok(ImportantMemory {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;

    Ok(memories)
}

#[allow(dead_code)]
pub fn clear_important_memories(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM important_memories", [])?;
    Ok(())
}

// ========== 对话摘要操作 ==========

pub fn save_conversation_summary(conn: &Connection, summary: &ConversationSummary) -> Result<()> {
    let key_topics_json = serde_json::to_string(&summary.key_topics)?;

    conn.execute(
        "INSERT OR REPLACE INTO conversation_summaries
         (id, start_turn, end_turn, summary, key_topics, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            summary.id,
            summary.start_turn,
            summary.end_turn,
            summary.summary,
            key_topics_json,
            summary.timestamp
        ],
    )?;
    Ok(())
}

pub fn get_conversation_summaries(conn: &Connection, limit: usize) -> Result<Vec<ConversationSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, start_turn, end_turn, summary, key_topics, timestamp
         FROM conversation_summaries
         ORDER BY timestamp DESC LIMIT ?1"
    )?;

    let summaries = stmt.query_map([limit], |row| {
        let key_topics_json: String = row.get(4)?;
        let key_topics: Vec<String> = serde_json::from_str(&key_topics_json)
            .unwrap_or_default();

        Ok(ConversationSummary {
            id: row.get(0)?,
            start_turn: row.get(1)?,
            end_turn: row.get(2)?,
            summary: row.get(3)?,
            key_topics,
            timestamp: row.get(5)?,
        })
    })?
    .collect::<Result<Vec<_>, _>>()?;

    Ok(summaries)
}

#[allow(dead_code)]
pub fn clear_summaries(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM conversation_summaries", [])?;
    Ok(())
}

// ========== 统计信息 ==========

pub fn get_stats(conn: &Connection) -> Result<MemoryStats> {
    let conversation_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM conversation_turns",
        [],
        |row| row.get(0)
    )?;

    let summary_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM conversation_summaries",
        [],
        |row| row.get(0)
    )?;

    let memory_count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM important_memories",
        [],
        |row| row.get(0)
    )?;

    Ok(MemoryStats {
        conversation_count,
        summary_count,
        memory_count,
    })
}

// ========== 清空所有数据 ==========

pub fn clear_all(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM conversation_turns", [])?;
    conn.execute("DELETE FROM user_profile", [])?;
    conn.execute("DELETE FROM important_memories", [])?;
    conn.execute("DELETE FROM conversation_summaries", [])?;
    tracing::info!("All memory data cleared");
    Ok(())
}
