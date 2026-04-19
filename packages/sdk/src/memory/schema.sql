-- Her-Text Memory Database Schema
-- SQLite database for local memory persistence

-- 对话历史（工作记忆）
CREATE TABLE IF NOT EXISTS conversation_turns (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_conversation_timestamp ON conversation_turns(timestamp DESC);

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
  key_topics TEXT, -- JSON array
  timestamp INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_summaries_timestamp ON conversation_summaries(timestamp DESC);

-- 短期 KV 存储（可选持久化，重启后可清空）
CREATE TABLE IF NOT EXISTS short_term_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  last_mentioned INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 元数据
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 初始化元数据
INSERT OR IGNORE INTO metadata (key, value) VALUES ('db_version', '1.0.0');
INSERT OR IGNORE INTO metadata (key, value) VALUES ('created_at', strftime('%s', 'now'));
