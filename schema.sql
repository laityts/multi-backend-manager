-- 后端地址表
CREATE TABLE IF NOT EXISTS backends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    weight INTEGER DEFAULT 100,
    enabled BOOLEAN DEFAULT 1,
    max_failures INTEGER DEFAULT 3,
    current_failures INTEGER DEFAULT 0,
    total_requests INTEGER DEFAULT 0,
    success_requests INTEGER DEFAULT 0,
    failed_requests INTEGER DEFAULT 0,
    total_response_time INTEGER DEFAULT 0,
    last_response_time INTEGER DEFAULT 0,
    last_success_time INTEGER,
    last_failure_time INTEGER,
    disabled_at INTEGER, -- 新增：禁用时间戳，用于自动恢复
    reset_count INTEGER DEFAULT 0, -- 新增：重置次数
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 管理员配置表
CREATE TABLE IF NOT EXISTS admin_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 会话表（用于登录）
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 历史记录表（用于更详细的统计）
CREATE TABLE IF NOT EXISTS request_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    backend_id INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    response_time INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (backend_id) REFERENCES backends(id)
);

-- 最后一次请求记录表
CREATE TABLE IF NOT EXISTS last_request (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    backend_id INTEGER,
    backend_url TEXT,
    success BOOLEAN NOT NULL,
    response_time INTEGER,
    request_time INTEGER NOT NULL,
    attempts TEXT, -- 新增：存储所有尝试过的后端地址和结果的JSON数组
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);