// 工具函数
const utils = {
  // 获取北京时间
  getBeijingTime: () => {
    const now = new Date();
    // UTC+8
    return new Date(now.getTime() + 8 * 60 * 60 * 1000);
  },
  
  formatBeijingTime: (timestamp) => {
    if (!timestamp) return '从未';
    const date = new Date(timestamp);
    const beijingTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return beijingTime.toISOString().replace('T', ' ').substring(0, 19);
  },
  
  // 生成随机ID
  generateId: () => {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
  
  // 密码哈希（简单示例，生产环境应使用更安全的方法）
  hashPassword: async (password) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
  
  // 验证密码
  verifyPassword: async (password, hash) => {
    const hashed = await utils.hashPassword(password);
    return hashed === hash;
  },
  
  // 解析URL参数
  parseQuery: (url) => {
    const params = new URL(url).searchParams;
    const result = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    return result;
  }
};

// 数据库操作类
class DatabaseManager {
  constructor(db) {
    this.db = db;
  }
  
  // 初始化数据库表
  async initTables() {
    await this.db.exec(`
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS admin_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        password_hash TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS request_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        backend_id INTEGER NOT NULL,
        success BOOLEAN NOT NULL,
        response_time INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // 设置默认管理员密码
    const config = await this.db.prepare('SELECT * FROM admin_config WHERE id = 1').first();
    if (!config) {
      const defaultPassword = await utils.hashPassword('admin123');
      await this.db.prepare(
        'INSERT INTO admin_config (id, password_hash) VALUES (1, ?)'
      ).bind(defaultPassword).run();
    }
    
    return { success: true, message: '数据库初始化完成' };
  }
  
  // 获取所有后端地址
  async getBackends() {
    const { results } = await this.db.prepare(
      'SELECT * FROM backends ORDER BY id'
    ).all();
    return results;
  }
  
  // 获取启用的后端地址
  async getEnabledBackends() {
    const { results } = await this.db.prepare(
      'SELECT * FROM backends WHERE enabled = 1 ORDER BY id'
    ).all();
    return results;
  }
  
  // 根据ID获取后端地址
  async getBackendById(id) {
    return await this.db.prepare(
      'SELECT * FROM backends WHERE id = ?'
    ).bind(id).first();
  }
  
  // 添加后端地址
  async addBackend(backend) {
    const { name, url, weight = 100, max_failures = 3 } = backend;
    const result = await this.db.prepare(
      `INSERT INTO backends (name, url, weight, max_failures) 
       VALUES (?, ?, ?, ?)`
    ).bind(name, url, weight, max_failures).run();
    return result.success;
  }
  
  // 更新后端地址
  async updateBackend(id, updates) {
    const allowedFields = ['name', 'url', 'weight', 'enabled', 'max_failures'];
    const setClause = [];
    const values = [];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        setClause.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (setClause.length === 0) return false;
    
    values.push(id);
    const query = `UPDATE backends SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
    
    const result = await this.db.prepare(query).bind(...values).run();
    return result.success;
  }
  
  // 删除后端地址
  async deleteBackend(id) {
    const result = await this.db.prepare(
      'DELETE FROM backends WHERE id = ?'
    ).bind(id).run();
    return result.success;
  }
  
  // 更新后端统计数据
  async updateBackendStats(id, success, responseTime) {
    const backend = await this.getBackendById(id);
    if (!backend) return false;
    
    const updates = {
      total_requests: backend.total_requests + 1,
      last_response_time: responseTime,
      updated_at: new Date().toISOString()
    };
    
    if (success) {
      updates.success_requests = backend.success_requests + 1;
      updates.last_success_time = Date.now();
      updates.current_failures = 0;
      updates.total_response_time = backend.total_response_time + responseTime;
    } else {
      updates.failed_requests = backend.failed_requests + 1;
      updates.last_failure_time = Date.now();
      updates.current_failures = backend.current_failures + 1;
      
      // 如果连续失败次数达到阈值，自动禁用
      if (updates.current_failures >= backend.max_failures) {
        updates.enabled = 0;
      }
    }
    
    const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), id];
    
    const result = await this.db.prepare(
      `UPDATE backends SET ${setClause} WHERE id = ?`
    ).bind(...values).run();
    
    // 记录历史
    await this.db.prepare(
      'INSERT INTO request_history (backend_id, success, response_time) VALUES (?, ?, ?)'
    ).bind(id, success ? 1 : 0, responseTime).run();
    
    return result.success;
  }
  
  // 重置后端失败计数
  async resetBackendFailures(id) {
    const result = await this.db.prepare(
      'UPDATE backends SET current_failures = 0, enabled = 1 WHERE id = ?'
    ).bind(id).run();
    return result.success;
  }
  
  // 验证管理员密码
  async verifyAdminPassword(password) {
    const config = await this.db.prepare(
      'SELECT password_hash FROM admin_config WHERE id = 1'
    ).first();
    
    if (!config) return false;
    return await utils.verifyPassword(password, config.password_hash);
  }
  
  // 更新管理员密码
  async updateAdminPassword(newPassword) {
    const hash = await utils.hashPassword(newPassword);
    const result = await this.db.prepare(
      'UPDATE admin_config SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).bind(hash).run();
    return result.success;
  }
  
  // 创建会话
  async createSession() {
    const sessionId = utils.generateId();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24小时后过期
    const data = JSON.stringify({ loggedIn: true });
    
    await this.db.prepare(
      'INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)'
    ).bind(sessionId, data, expiresAt).run();
    
    return sessionId;
  }
  
  // 验证会话
  async validateSession(sessionId) {
    const session = await this.db.prepare(
      'SELECT data, expires_at FROM sessions WHERE id = ?'
    ).bind(sessionId).first();
    
    if (!session || session.expires_at < Date.now()) {
      // 删除过期会话
      await this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
      return null;
    }
    
    return JSON.parse(session.data);
  }
  
  // 删除会话
  async deleteSession(sessionId) {
    await this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
  }
  
  // 清理过期会话
  async cleanupSessions() {
    await this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
  }
}

// 负载均衡器类
class LoadBalancer {
  constructor(dbManager) {
    this.dbManager = dbManager;
  }
  
  // 计算后端权重
  calculateWeight(backend) {
    if (!backend.enabled) return 0;
    
    // 基础权重
    let weight = backend.weight || 100;
    
    // 成功率权重（0-100%）
    const total = backend.total_requests || 1;
    const successRate = backend.success_requests / total;
    weight *= successRate;
    
    // 响应时间权重（响应时间越短，权重越高）
    const avgResponseTime = backend.total_response_time / (backend.success_requests || 1);
    if (avgResponseTime > 0) {
      weight *= 1000 / Math.max(avgResponseTime, 100); // 假设100ms为基准
    }
    
    // 失败惩罚
    if (backend.current_failures > 0) {
      weight /= (backend.current_failures + 1);
    }
    
    return Math.max(1, Math.round(weight));
  }
  
  // 选择后端（加权轮询）
  async selectBackend() {
    const backends = await this.dbManager.getEnabledBackends();
    if (backends.length === 0) {
      throw new Error('没有可用的后端地址');
    }
    
    // 计算总权重
    let totalWeight = 0;
    const weightedBackends = [];
    
    for (const backend of backends) {
      const weight = this.calculateWeight(backend);
      totalWeight += weight;
      weightedBackends.push({
        backend,
        weight,
        accumulated: totalWeight
      });
    }
    
    // 随机选择
    const random = Math.random() * totalWeight;
    
    for (const item of weightedBackends) {
      if (random <= item.accumulated) {
        return item.backend;
      }
    }
    
    // 默认返回第一个
    return weightedBackends[0].backend;
  }
  
  // 故障转移：尝试所有可用后端
  async tryAllBackends(request) {
    const backends = await this.dbManager.getEnabledBackends();
    const sortedBackends = [...backends].sort((a, b) => {
      return this.calculateWeight(b) - this.calculateWeight(a);
    });
    
    for (const backend of sortedBackends) {
      try {
        const startTime = Date.now();
        const response = await this.forwardRequest(backend, request);
        const responseTime = Date.now() - startTime;
        
        // 更新统计（成功）
        await this.dbManager.updateBackendStats(backend.id, true, responseTime);
        
        return response;
      } catch (error) {
        // 更新统计（失败）
        const responseTime = Date.now() - startTime;
        await this.dbManager.updateBackendStats(backend.id, false, responseTime);
        
        console.error(`后端 ${backend.url} 请求失败:`, error.message);
        // 继续尝试下一个
      }
    }
    
    throw new Error('所有后端地址都不可用');
  }
  
  // 转发请求
  async forwardRequest(backend, originalRequest) {
    const url = new URL(backend.url);
    const requestUrl = new URL(originalRequest.url);
    
    // 构建新请求
    const newUrl = new URL(url.origin + requestUrl.pathname + requestUrl.search);
    
    const headers = new Headers(originalRequest.headers);
    headers.set('Host', url.host);
    
    const newRequest = new Request(newUrl, {
      method: originalRequest.method,
      headers: headers,
      body: originalRequest.body,
      redirect: 'follow'
    });
    
    // 设置超时
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    
    try {
      const response = await fetch(newRequest, {
        signal: controller.signal,
        cf: {
          // Cloudflare特定配置
          cacheEverything: false,
          cacheTtl: 0
        }
      });
      
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}

// HTML模板
const HTML = {
  // 状态页面
  statusPage: (backends, message = '') => `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>订阅后端状态监控</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #333;
          line-height: 1.6;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          padding: 30px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        header {
          text-align: center;
          margin-bottom: 40px;
          padding-bottom: 20px;
          border-bottom: 2px solid #eee;
        }
        h1 {
          color: #2d3748;
          font-size: 2.5em;
          margin-bottom: 10px;
          background: linear-gradient(90deg, #667eea, #764ba2);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .subtitle {
          color: #718096;
          font-size: 1.1em;
        }
        .actions {
          display: flex;
          gap: 15px;
          justify-content: center;
          margin: 30px 0;
          flex-wrap: wrap;
        }
        .btn {
          padding: 12px 24px;
          border: none;
          border-radius: 50px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .btn-primary {
          background: linear-gradient(90deg, #667eea, #764ba2);
          color: white;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
        }
        .btn-secondary {
          background: #48bb78;
          color: white;
        }
        .btn-secondary:hover {
          background: #38a169;
          transform: translateY(-2px);
        }
        .btn-danger {
          background: #f56565;
          color: white;
        }
        .btn-danger:hover {
          background: #e53e3e;
          transform: translateY(-2px);
        }
        .message {
          padding: 15px;
          border-radius: 10px;
          margin: 20px 0;
          text-align: center;
          font-weight: 500;
        }
        .success {
          background: #c6f6d5;
          color: #22543d;
          border: 1px solid #9ae6b4;
        }
        .error {
          background: #fed7d7;
          color: #742a2a;
          border: 1px solid #fc8181;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 25px;
          margin-top: 30px;
        }
        .stat-card {
          background: white;
          border-radius: 15px;
          padding: 25px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.08);
          transition: transform 0.3s ease;
          border: 1px solid #e2e8f0;
        }
        .stat-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 15px 40px rgba(0, 0, 0, 0.12);
        }
        .stat-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid #f7fafc;
        }
        .stat-name {
          font-size: 1.3em;
          font-weight: 700;
          color: #2d3748;
        }
        .status-badge {
          padding: 6px 15px;
          border-radius: 20px;
          font-size: 0.85em;
          font-weight: 600;
        }
        .status-active {
          background: #c6f6d5;
          color: #22543d;
        }
        .status-inactive {
          background: #fed7d7;
          color: #742a2a;
        }
        .stat-details {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
        }
        .stat-item {
          display: flex;
          flex-direction: column;
        }
        .stat-label {
          font-size: 0.9em;
          color: #718096;
          margin-bottom: 5px;
        }
        .stat-value {
          font-size: 1.1em;
          font-weight: 600;
          color: #2d3748;
        }
        .stat-success {
          color: #38a169;
        }
        .stat-danger {
          color: #e53e3e;
        }
        .stat-warning {
          color: #d69e2e;
        }
        .progress-bar {
          height: 8px;
          background: #e2e8f0;
          border-radius: 4px;
          margin-top: 10px;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        .progress-success {
          background: linear-gradient(90deg, #48bb78, #38a169);
        }
        .progress-warning {
          background: linear-gradient(90deg, #ed8936, #dd6b20);
        }
        .progress-danger {
          background: linear-gradient(90deg, #f56565, #e53e3e);
        }
        footer {
          text-align: center;
          margin-top: 50px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
          color: #718096;
          font-size: 0.9em;
        }
        @media (max-width: 768px) {
          .container { padding: 20px; }
          h1 { font-size: 2em; }
          .stats-grid { grid-template-columns: 1fr; }
        }
      </style>
      <script>
        // 自动刷新页面（每30秒）
        setTimeout(() => {
          location.reload();
        }, 30000);
      </script>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>📊 订阅后端状态监控</h1>
          <p class="subtitle">实时监控后端订阅服务状态 | 北京时间: ${utils.formatBeijingTime(Date.now())}</p>
        </header>
        
        ${message ? `
          <div class="message ${message.type === 'success' ? 'success' : 'error'}">
            ${message.text}
          </div>
        ` : ''}
        
        <div class="actions">
          <a href="/" class="btn btn-primary">
            🔄 刷新状态
          </a>
          <a href="/admin" class="btn btn-secondary">
            ⚙️ 管理面板
          </a>
          <button onclick="initDatabase()" class="btn btn-danger">
            🗃️ 初始化数据库
          </button>
        </div>
        
        <div class="stats-grid">
          ${backends.map(backend => {
            const successRate = backend.total_requests > 0 
              ? ((backend.success_requests / backend.total_requests) * 100).toFixed(2)
              : 0;
            const avgResponseTime = backend.success_requests > 0
              ? (backend.total_response_time / backend.success_requests).toFixed(0)
              : 0;
            
            let successRateClass = 'stat-success';
            if (successRate < 80) successRateClass = 'stat-warning';
            if (successRate < 50) successRateClass = 'stat-danger';
            
            let progressClass = 'progress-success';
            if (successRate < 80) progressClass = 'progress-warning';
            if (successRate < 50) progressClass = 'progress-danger';
            
            return `
            <div class="stat-card">
              <div class="stat-header">
                <span class="stat-name">${backend.name}</span>
                <span class="status-badge ${backend.enabled ? 'status-active' : 'status-inactive'}">
                  ${backend.enabled ? '✅ 启用中' : '⛔ 已禁用'}
                </span>
              </div>
              
              <div class="stat-details">
                <div class="stat-item">
                  <span class="stat-label">总请求数</span>
                  <span class="stat-value">${backend.total_requests}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">成功请求</span>
                  <span class="stat-value stat-success">${backend.success_requests}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">失败请求</span>
                  <span class="stat-value stat-danger">${backend.failed_requests}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">连续失败</span>
                  <span class="stat-value ${backend.current_failures > 0 ? 'stat-warning' : ''}">
                    ${backend.current_failures}/${backend.max_failures}
                  </span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">成功率</span>
                  <span class="stat-value ${successRateClass}">${successRate}%</span>
                  <div class="progress-bar">
                    <div class="progress-fill ${progressClass}" style="width: ${Math.min(successRate, 100)}%"></div>
                  </div>
                </div>
                <div class="stat-item">
                  <span class="stat-label">平均响应时间</span>
                  <span class="stat-value">${avgResponseTime}ms</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">最后响应时间</span>
                  <span class="stat-value">${backend.last_response_time || 0}ms</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">最后成功时间</span>
                  <span class="stat-value">${utils.formatBeijingTime(backend.last_success_time)}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">最后失败时间</span>
                  <span class="stat-value">${utils.formatBeijingTime(backend.last_failure_time)}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">权重</span>
                  <span class="stat-value">${backend.weight}</span>
                </div>
                <div class="stat-item">
                  <span class="stat-label">后端地址</span>
                  <span class="stat-value" style="font-size: 0.9em; word-break: break-all;">${backend.url}</span>
                </div>
              </div>
            </div>
            `;
          }).join('')}
        </div>
        
        <footer>
          <p>© ${new Date().getFullYear()} 订阅后端管理器 | 基于 Cloudflare Workers 构建</p>
          <p>最后更新: ${utils.formatBeijingTime(Date.now())} | 后端数量: ${backends.length}</p>
        </footer>
      </div>
      
      <script>
        async function initDatabase() {
          if (confirm('确定要初始化数据库吗？这将重置所有统计数据和配置！')) {
            const response = await fetch('/initdb', { method: 'POST' });
            const result = await response.json();
            alert(result.message);
            if (result.success) {
              location.reload();
            }
          }
        }
      </script>
    </body>
    </html>
  `,
  
  // 登录页面
  loginPage: (error = '') => `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>管理员登录</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .login-container {
          background: rgba(255, 255, 255, 0.95);
          border-radius: 20px;
          padding: 40px;
          width: 100%;
          max-width: 400px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        h1 {
          text-align: center;
          color: #2d3748;
          margin-bottom: 30px;
          font-size: 1.8em;
          background: linear-gradient(90deg, #667eea, #764ba2);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          color: #4a5568;
          font-weight: 500;
        }
        input {
          width: 100%;
          padding: 12px 16px;
          border: 2px solid #e2e8f0;
          border-radius: 10px;
          font-size: 16px;
          transition: border-color 0.3s ease;
        }
        input:focus {
          outline: none;
          border-color: #667eea;
        }
        .error {
          color: #e53e3e;
          font-size: 14px;
          margin-top: 5px;
          display: block;
        }
        .btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(90deg, #667eea, #764ba2);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
        }
        .btn:active {
          transform: translateY(0);
        }
        .back-link {
          text-align: center;
          margin-top: 20px;
        }
        .back-link a {
          color: #667eea;
          text-decoration: none;
          font-size: 14px;
        }
        .back-link a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h1>🔐 管理员登录</h1>
        ${error ? `<div class="error" style="text-align: center; margin-bottom: 20px; padding: 10px; background: #fed7d7; color: #742a2a; border-radius: 8px;">${error}</div>` : ''}
        <form method="POST" action="/admin/login">
          <div class="form-group">
            <label for="password">管理员密码</label>
            <input type="password" id="password" name="password" required placeholder="请输入密码">
          </div>
          <button type="submit" class="btn">登录</button>
        </form>
        <div class="back-link">
          <a href="/">← 返回状态页面</a>
        </div>
      </div>
    </body>
    </html>
  `,
  
  // 管理面板
  adminPage: (backends, message = '') => `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>管理面板</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: #f7fafc;
          color: #2d3748;
          line-height: 1.6;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        header {
          background: white;
          padding: 20px;
          border-radius: 15px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          margin-bottom: 30px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 20px;
        }
        h1 {
          color: #2d3748;
          font-size: 1.8em;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .header-actions {
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
        }
        .btn {
          padding: 10px 20px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .btn-primary {
          background: #667eea;
          color: white;
        }
        .btn-primary:hover {
          background: #5a67d8;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(102, 126, 234, 0.3);
        }
        .btn-secondary {
          background: #48bb78;
          color: white;
        }
        .btn-secondary:hover {
          background: #38a169;
          transform: translateY(-2px);
        }
        .btn-danger {
          background: #f56565;
          color: white;
        }
        .btn-danger:hover {
          background: #e53e3e;
          transform: translateY(-2px);
        }
        .btn-logout {
          background: #718096;
          color: white;
        }
        .btn-logout:hover {
          background: #4a5568;
        }
        .message {
          padding: 15px;
          border-radius: 10px;
          margin-bottom: 20px;
          font-weight: 500;
        }
        .success {
          background: #c6f6d5;
          color: #22543d;
          border: 1px solid #9ae6b4;
        }
        .error {
          background: #fed7d7;
          color: #742a2a;
          border: 1px solid #fc8181;
        }
        .tabs {
          display: flex;
          gap: 5px;
          background: white;
          padding: 10px;
          border-radius: 10px;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.05);
          margin-bottom: 30px;
        }
        .tab {
          padding: 12px 24px;
          border: none;
          background: none;
          color: #718096;
          font-weight: 600;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.3s ease;
        }
        .tab.active {
          background: #667eea;
          color: white;
        }
        .tab:hover:not(.active) {
          background: #edf2f7;
        }
        .tab-content {
          display: none;
          animation: fadeIn 0.3s ease;
        }
        .tab-content.active {
          display: block;
        }
        .form-container, .table-container {
          background: white;
          padding: 30px;
          border-radius: 15px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          margin-bottom: 30px;
        }
        .form-group {
          margin-bottom: 20px;
        }
        label {
          display: block;
          margin-bottom: 8px;
          color: #4a5568;
          font-weight: 500;
        }
        input, select {
          width: 100%;
          padding: 12px 16px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 16px;
          transition: border-color 0.3s ease;
        }
        input:focus, select:focus {
          outline: none;
          border-color: #667eea;
        }
        .form-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
        }
        .form-actions {
          display: flex;
          gap: 15px;
          margin-top: 30px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th, td {
          padding: 15px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        th {
          background: #f7fafc;
          font-weight: 600;
          color: #4a5568;
        }
        tr:hover {
          background: #f7fafc;
        }
        .status-badge {
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
        }
        .status-active {
          background: #c6f6d5;
          color: #22543d;
        }
        .status-inactive {
          background: #fed7d7;
          color: #742a2a;
        }
        .actions-cell {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .action-btn {
          padding: 6px 12px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .action-edit {
          background: #4299e1;
          color: white;
        }
        .action-edit:hover {
          background: #3182ce;
        }
        .action-delete {
          background: #f56565;
          color: white;
        }
        .action-delete:hover {
          background: #e53e3e;
        }
        .action-toggle {
          background: #48bb78;
          color: white;
        }
        .action-toggle:hover {
          background: #38a169;
        }
        .action-reset {
          background: #ed8936;
          color: white;
        }
        .action-reset:hover {
          background: #dd6b20;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 768px) {
          .container { padding: 10px; }
          header { flex-direction: column; text-align: center; }
          .form-row { grid-template-columns: 1fr; }
          table { display: block; overflow-x: auto; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <header>
          <h1>⚙️ 订阅后端管理面板</h1>
          <div class="header-actions">
            <a href="/" class="btn btn-primary">📊 状态页面</a>
            <button onclick="showTab('password')" class="btn btn-secondary">🔑 修改密码</button>
            <a href="/admin/logout" class="btn btn-logout">🚪 退出登录</a>
          </div>
        </header>
        
        ${message ? `
          <div class="message ${message.type === 'success' ? 'success' : 'error'}">
            ${message.text}
          </div>
        ` : ''}
        
        <div class="tabs">
          <button class="tab active" onclick="showTab('backends')">后端管理</button>
          <button class="tab" onclick="showTab('add')">添加后端</button>
          <button class="tab" onclick="showTab('password')">密码设置</button>
        </div>
        
        <!-- 后端列表 -->
        <div id="tab-backends" class="tab-content active">
          <div class="table-container">
            <h2>后端地址列表</h2>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>名称</th>
                  <th>地址</th>
                  <th>状态</th>
                  <th>权重</th>
                  <th>请求数</th>
                  <th>成功率</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${backends.map(backend => {
                  const successRate = backend.total_requests > 0 
                    ? ((backend.success_requests / backend.total_requests) * 100).toFixed(1)
                    : 0;
                  return `
                  <tr>
                    <td>${backend.id}</td>
                    <td>${backend.name}</td>
                    <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${backend.url}</td>
                    <td><span class="status-badge ${backend.enabled ? 'status-active' : 'status-inactive'}">${backend.enabled ? '启用' : '禁用'}</span></td>
                    <td>${backend.weight}</td>
                    <td>${backend.total_requests}</td>
                    <td>${successRate}%</td>
                    <td class="actions-cell">
                      <button onclick="editBackend(${backend.id})" class="action-btn action-edit">编辑</button>
                      <button onclick="toggleBackend(${backend.id}, ${backend.enabled ? 0 : 1})" class="action-btn action-toggle">
                        ${backend.enabled ? '禁用' : '启用'}
                      </button>
                      <button onclick="resetBackend(${backend.id})" class="action-btn action-reset">重置统计</button>
                      <button onclick="deleteBackend(${backend.id})" class="action-btn action-delete">删除</button>
                    </td>
                  </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
        
        <!-- 添加后端 -->
        <div id="tab-add" class="tab-content">
          <div class="form-container">
            <h2>添加后端地址</h2>
            <form method="POST" action="/admin/action" onsubmit="return validateBackendForm()">
              <input type="hidden" name="action" value="add">
              <div class="form-row">
                <div class="form-group">
                  <label for="name">名称 *</label>
                  <input type="text" id="name" name="name" required placeholder="例如: 美国节点1">
                </div>
                <div class="form-group">
                  <label for="url">订阅地址 *</label>
                  <input type="url" id="url" name="url" required placeholder="https://example.com/subscribe">
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="weight">权重 (1-1000)</label>
                  <input type="number" id="weight" name="weight" value="100" min="1" max="1000">
                </div>
                <div class="form-group">
                  <label for="max_failures">最大失败次数</label>
                  <input type="number" id="max_failures" name="max_failures" value="3" min="1" max="10">
                </div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary">添加后端</button>
                <button type="reset" class="btn btn-logout">重置</button>
              </div>
            </form>
          </div>
        </div>
        
        <!-- 编辑后端 -->
        <div id="tab-edit" class="tab-content">
          <div class="form-container">
            <h2>编辑后端地址</h2>
            <form method="POST" action="/admin/action" id="edit-form">
              <input type="hidden" name="action" value="update">
              <input type="hidden" name="id" id="edit-id">
              <div class="form-row">
                <div class="form-group">
                  <label for="edit-name">名称 *</label>
                  <input type="text" id="edit-name" name="name" required>
                </div>
                <div class="form-group">
                  <label for="edit-url">订阅地址 *</label>
                  <input type="url" id="edit-url" name="url" required>
                </div>
              </div>
              <div class="form-row">
                <div class="form-group">
                  <label for="edit-weight">权重 (1-1000)</label>
                  <input type="number" id="edit-weight" name="weight" min="1" max="1000">
                </div>
                <div class="form-group">
                  <label for="edit-enabled">状态</label>
                  <select id="edit-enabled" name="enabled">
                    <option value="1">启用</option>
                    <option value="0">禁用</option>
                  </select>
                </div>
                <div class="form-group">
                  <label for="edit-max_failures">最大失败次数</label>
                  <input type="number" id="edit-max_failures" name="max_failures" min="1" max="10">
                </div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary">保存修改</button>
                <button type="button" onclick="showTab('backends')" class="btn btn-logout">取消</button>
              </div>
            </form>
          </div>
        </div>
        
        <!-- 修改密码 -->
        <div id="tab-password" class="tab-content">
          <div class="form-container">
            <h2>修改管理员密码</h2>
            <form method="POST" action="/admin/action" onsubmit="return validatePasswordForm()">
              <input type="hidden" name="action" value="change-password">
              <div class="form-group">
                <label for="current-password">当前密码</label>
                <input type="password" id="current-password" name="current_password" required>
              </div>
              <div class="form-group">
                <label for="new-password">新密码</label>
                <input type="password" id="new-password" name="new_password" required minlength="6">
              </div>
              <div class="form-group">
                <label for="confirm-password">确认新密码</label>
                <input type="password" id="confirm-password" name="confirm_password" required minlength="6">
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary">修改密码</button>
              </div>
            </form>
          </div>
        </div>
        
        <footer style="text-align: center; margin-top: 40px; color: #718096; font-size: 0.9em;">
          <p>© ${new Date().getFullYear()} 订阅后端管理器 | 管理面板 | 北京时间: ${utils.formatBeijingTime(Date.now())}</p>
        </footer>
      </div>
      
      <script>
        function showTab(tabName) {
          // 隐藏所有标签内容
          document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
          });
          
          // 移除所有标签的active类
          document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active');
          });
          
          // 显示选中的标签内容
          document.getElementById('tab-' + tabName).classList.add('active');
          
          // 激活对应的标签按钮
          document.querySelectorAll('.tab').forEach(tab => {
            if (tab.textContent.includes(tabName === 'backends' ? '后端管理' : 
                                        tabName === 'add' ? '添加后端' : 
                                        tabName === 'password' ? '密码设置' : '')) {
              tab.classList.add('active');
            }
          });
        }
        
        async function editBackend(id) {
          const response = await fetch(\`/admin/backend/\${id}\`);
          const backend = await response.json();
          
          if (backend) {
            document.getElementById('edit-id').value = backend.id;
            document.getElementById('edit-name').value = backend.name;
            document.getElementById('edit-url').value = backend.url;
            document.getElementById('edit-weight').value = backend.weight;
            document.getElementById('edit-enabled').value = backend.enabled ? '1' : '0';
            document.getElementById('edit-max_failures').value = backend.max_failures;
            
            showTab('edit');
          }
        }
        
        async function toggleBackend(id, enabled) {
          if (confirm(\`确定要\${enabled ? '启用' : '禁用'}这个后端吗？\`)) {
            const formData = new FormData();
            formData.append('action', 'toggle');
            formData.append('id', id);
            formData.append('enabled', enabled);
            
            const response = await fetch('/admin/action', {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            alert(result.message);
            if (result.success) {
              location.reload();
            }
          }
        }
        
        async function resetBackend(id) {
          if (confirm('确定要重置这个后端的统计数据吗？')) {
            const formData = new FormData();
            formData.append('action', 'reset');
            formData.append('id', id);
            
            const response = await fetch('/admin/action', {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            alert(result.message);
            if (result.success) {
              location.reload();
            }
          }
        }
        
        async function deleteBackend(id) {
          if (confirm('确定要删除这个后端吗？此操作不可撤销！')) {
            const formData = new FormData();
            formData.append('action', 'delete');
            formData.append('id', id);
            
            const response = await fetch('/admin/action', {
              method: 'POST',
              body: formData
            });
            
            const result = await response.json();
            alert(result.message);
            if (result.success) {
              location.reload();
            }
          }
        }
        
        function validateBackendForm() {
          const url = document.getElementById('url').value;
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            alert('请输入有效的URL地址（以http://或https://开头）');
            return false;
          }
          return true;
        }
        
        function validatePasswordForm() {
          const newPassword = document.getElementById('new-password').value;
          const confirmPassword = document.getElementById('confirm-password').value;
          
          if (newPassword !== confirmPassword) {
            alert('两次输入的密码不一致！');
            return false;
          }
          
          if (newPassword.length < 6) {
            alert('密码长度至少为6位！');
            return false;
          }
          
          return true;
        }
        
        // 处理URL中的消息参数
        const urlParams = new URLSearchParams(window.location.search);
        const message = urlParams.get('message');
        const messageType = urlParams.get('type');
        
        if (message) {
          alert(message);
          // 清除URL参数
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      </script>
    </body>
    </html>
  `
};

// 主Worker类
class SubscriptionManager {
  constructor() {
    this.dbManager = null;
    this.loadBalancer = null;
  }
  
  async handleRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 初始化数据库管理器
    if (!this.dbManager) {
      this.dbManager = new DatabaseManager(env.DB);
      this.loadBalancer = new LoadBalancer(this.dbManager);
      
      // 定期清理过期会话
      await this.dbManager.cleanupSessions();
    }
    
    // 路由处理
    switch (path) {
      case '/':
        return await this.handleStatusPage(request, env);
      case '/initdb':
        return await this.handleInitDatabase(request, env);
      case '/admin':
        return await this.handleAdminPage(request, env);
      case '/admin/login':
        return await this.handleAdminLogin(request, env);
      case '/admin/logout':
        return await this.handleAdminLogout(request, env);
      case '/admin/action':
        return await this.handleAdminAction(request, env);
      case '/admin/backend':
        return await this.handleGetBackend(request, env);
      default:
        // 其他路径作为订阅请求处理
        return await this.handleSubscriptionRequest(request, env);
    }
  }
  
  async handleStatusPage(request, env) {
    const backends = await this.dbManager.getBackends();
    return new Response(HTML.statusPage(backends), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
  
  async handleInitDatabase(request, env) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, message: '方法不允许' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    try {
      const result = await this.dbManager.initTables();
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '数据库初始化失败: ' + error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  async handleAdminPage(request, env) {
    // 检查登录状态
    const sessionId = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
    const session = sessionId ? await this.dbManager.validateSession(sessionId) : null;
    
    if (!session?.loggedIn) {
      return Response.redirect(new URL('/admin/login', request.url));
    }
    
    const backends = await this.dbManager.getBackends();
    
    // 检查URL参数中的消息
    const url = new URL(request.url);
    const message = url.searchParams.get('message');
    const type = url.searchParams.get('type');
    
    const messageObj = message ? { text: message, type: type || 'success' } : null;
    
    return new Response(HTML.adminPage(backends, messageObj), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
  
  async handleAdminLogin(request, env) {
    if (request.method === 'GET') {
      return new Response(HTML.loginPage(), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }
    
    if (request.method === 'POST') {
      const formData = await request.formData();
      const password = formData.get('password');
      
      if (await this.dbManager.verifyAdminPassword(password)) {
        const sessionId = await this.dbManager.createSession();
        
        const headers = new Headers({
          'Location': '/admin',
          'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
        });
        
        return new Response(null, {
          status: 302,
          headers
        });
      } else {
        return new Response(HTML.loginPage('密码错误'), {
          headers: { 'Content-Type': 'text/html;charset=UTF-8' }
        });
      }
    }
    
    return new Response('方法不允许', { status: 405 });
  }
  
  async handleAdminLogout(request, env) {
    const sessionId = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
    if (sessionId) {
      await this.dbManager.deleteSession(sessionId);
    }
    
    const headers = new Headers({
      'Location': '/admin/login',
      'Set-Cookie': 'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
    });
    
    return new Response(null, {
      status: 302,
      headers
    });
  }
  
  async handleGetBackend(request, env) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    
    if (!id) {
      return new Response(JSON.stringify({ error: '缺少ID参数' }), { status: 400 });
    }
    
    const backend = await this.dbManager.getBackendById(parseInt(id));
    
    return new Response(JSON.stringify(backend || {}), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  async handleAdminAction(request, env) {
    // 检查登录状态
    const sessionId = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
    const session = sessionId ? await this.dbManager.validateSession(sessionId) : null;
    
    if (!session?.loggedIn) {
      return Response.redirect(new URL('/admin/login', request.url));
    }
    
    if (request.method !== 'POST') {
      return Response.redirect(new URL('/admin?message=方法不允许&type=error', request.url));
    }
    
    const formData = await request.formData();
    const action = formData.get('action');
    
    try {
      let result;
      let redirectUrl = '/admin';
      
      switch (action) {
        case 'add':
          const newBackend = {
            name: formData.get('name'),
            url: formData.get('url'),
            weight: parseInt(formData.get('weight')) || 100,
            max_failures: parseInt(formData.get('max_failures')) || 3
          };
          
          result = await this.dbManager.addBackend(newBackend);
          redirectUrl += result ? '?message=添加成功' : '?message=添加失败&type=error';
          break;
          
        case 'update':
          const id = parseInt(formData.get('id'));
          const updates = {};
          
          if (formData.has('name')) updates.name = formData.get('name');
          if (formData.has('url')) updates.url = formData.get('url');
          if (formData.has('weight')) updates.weight = parseInt(formData.get('weight'));
          if (formData.has('enabled')) updates.enabled = parseInt(formData.get('enabled'));
          if (formData.has('max_failures')) updates.max_failures = parseInt(formData.get('max_failures'));
          
          result = await this.dbManager.updateBackend(id, updates);
          redirectUrl += result ? '?message=更新成功' : '?message=更新失败&type=error';
          break;
          
        case 'delete':
          const deleteId = parseInt(formData.get('id'));
          result = await this.dbManager.deleteBackend(deleteId);
          redirectUrl += result ? '?message=删除成功' : '?message=删除失败&type=error';
          break;
          
        case 'toggle':
          const toggleId = parseInt(formData.get('id'));
          const enabled = parseInt(formData.get('enabled'));
          result = await this.dbManager.updateBackend(toggleId, { enabled });
          redirectUrl += result ? '?message=状态更新成功' : '?message=状态更新失败&type=error';
          break;
          
        case 'reset':
          const resetId = parseInt(formData.get('id'));
          result = await this.dbManager.resetBackendFailures(resetId);
          redirectUrl += result ? '?message=重置成功' : '?message=重置失败&type=error';
          break;
          
        case 'change-password':
          const currentPassword = formData.get('current_password');
          const newPassword = formData.get('new_password');
          const confirmPassword = formData.get('confirm_password');
          
          if (newPassword !== confirmPassword) {
            redirectUrl += '?message=两次输入的密码不一致&type=error';
            break;
          }
          
          if (!await this.dbManager.verifyAdminPassword(currentPassword)) {
            redirectUrl += '?message=当前密码错误&type=error';
            break;
          }
          
          result = await this.dbManager.updateAdminPassword(newPassword);
          redirectUrl += result ? '?message=密码修改成功' : '?message=密码修改失败&type=error';
          break;
          
        default:
          redirectUrl += '?message=未知操作&type=error';
      }
      
      return Response.redirect(new URL(redirectUrl, request.url));
      
    } catch (error) {
      console.error('管理操作错误:', error);
      return Response.redirect(new URL('/admin?message=操作失败: ' + error.message + '&type=error', request.url));
    }
  }
  
  async handleSubscriptionRequest(request, env) {
    try {
      // 使用负载均衡器选择后端并转发请求
      const response = await this.loadBalancer.tryAllBackends(request);
      
      // 克隆响应以添加自定义头部
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('X-Backend-Manager', 'Cloudflare-Worker');
      newResponse.headers.set('X-Load-Balancer', 'Weighted-Round-Robin');
      
      return newResponse;
      
    } catch (error) {
      console.error('订阅请求处理失败:', error);
      
      // 返回错误响应
      return new Response(JSON.stringify({
        error: '所有后端地址都不可用',
        message: error.message,
        timestamp: utils.formatBeijingTime(Date.now())
      }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'X-Backend-Error': 'All backends unavailable'
        }
      });
    }
  }
}

// Worker入口点
export default {
  async fetch(request, env, ctx) {
    const manager = new SubscriptionManager();
    return await manager.handleRequest(request, env);
  }
};