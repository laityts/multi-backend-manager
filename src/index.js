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
  
  formatTimeAgo: (timestamp) => {
    if (!timestamp) return '从未';
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    return `${days}天前`;
  },
  
  // 生成随机ID
  generateId: () => {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  },
  
  // 密码哈希
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
  }
};

// 数据库操作类
class DatabaseManager {
  constructor(db) {
    this.db = db;
  }
  
  // 初始化数据库表 - 修复版本：先删除所有表再重新创建
  async initTables() {
    try {
      console.log('开始初始化数据库...');
      
      // 第一步：删除所有现有表（如果存在）
      console.log('删除现有表...');
      const tables = ['backends', 'admin_config', 'sessions', 'request_history', 'last_request'];
      
      for (const table of tables) {
        try {
          await this.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
          console.log(`已删除表: ${table}`);
        } catch (error) {
          console.warn(`删除表 ${table} 失败:`, error.message);
        }
      }
      
      // 第二步：创建所有新表
      console.log('创建新表...');
      
      // 创建backends表，包含所有字段
      await this.db.prepare(`
        CREATE TABLE backends (
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
          disabled_at INTEGER,
          reset_count INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      console.log('backends表创建成功');
      
      // 创建admin_config表
      await this.db.prepare(`
        CREATE TABLE admin_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          password_hash TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      console.log('admin_config表创建成功');
      
      // 创建sessions表
      await this.db.prepare(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      console.log('sessions表创建成功');
      
      // 创建request_history表
      await this.db.prepare(`
        CREATE TABLE request_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          backend_id INTEGER NOT NULL,
          success BOOLEAN NOT NULL,
          response_time INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      console.log('request_history表创建成功');
      
      // 创建last_request表，包含attempts字段
      await this.db.prepare(`
        CREATE TABLE last_request (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          backend_id INTEGER,
          backend_url TEXT,
          success BOOLEAN NOT NULL,
          response_time INTEGER,
          request_time INTEGER NOT NULL,
          attempts TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
      
      console.log('last_request表创建成功');
      
      // 设置默认管理员密码
      console.log('设置默认管理员密码...');
      const defaultPassword = await utils.hashPassword('admin123');
      const result = await this.db.prepare(
        'INSERT INTO admin_config (id, password_hash) VALUES (1, ?)'
      ).bind(defaultPassword).run();
      
      if (result.success) {
        console.log('默认管理员密码设置成功');
      } else {
        console.warn('默认管理员密码设置失败');
      }
      
      // 添加默认后端地址
      console.log('添加默认后端地址...');
      const defaultBackends = [
        { name: '节点1', url: 'https://url.v1.mk', weight: 100 },
        { name: '节点2', url: 'https://sub.xeton.dev', weight: 100 },
        { name: '节点3', url: 'https://subapi.sosoorg.com', weight: 100 },
        { name: '节点4', url: 'https://subapi.cmliussss.net', weight: 100 },
        { name: '节点5', url: 'https://www.nameless13.com', weight: 100 },
        { name: '节点6', url: 'https://api.wcc.best', weight: 100 }
      ];
      
      for (const backend of defaultBackends) {
        try {
          await this.db.prepare(
            'INSERT INTO backends (name, url, weight) VALUES (?, ?, ?)'
          ).bind(backend.name, backend.url, backend.weight).run();
          console.log(`添加后端地址成功: ${backend.name} - ${backend.url}`);
        } catch (error) {
          console.error(`添加后端地址失败: ${backend.name} - ${backend.url}`, error);
        }
      }
      
      // 创建一条测试的last_request记录
      console.log('创建初始last_request记录...');
      try {
        await this.db.prepare(`
          INSERT INTO last_request (id, backend_id, backend_url, success, response_time, request_time, attempts) 
          VALUES (1, NULL, NULL, 0, 0, ?, ?)
        `).bind(Date.now(), JSON.stringify([])).run();
        console.log('初始last_request记录创建成功');
      } catch (error) {
        console.warn('创建初始last_request记录失败:', error.message);
      }
      
      return { 
        success: true, 
        message: '数据库初始化完成，默认管理员密码：admin123，已添加默认后端地址' 
      };
    } catch (error) {
      console.error('初始化数据库失败:', error);
      return { 
        success: false, 
        message: '数据库初始化失败: ' + (error.message || '未知错误') 
      };
    }
  }
  
  // 检查数据库表是否存在
  async checkTablesExist() {
    try {
      // 尝试查询backends表，如果不存在会抛出错误
      await this.db.prepare('SELECT 1 FROM backends LIMIT 1').run();
      return true;
    } catch (error) {
      return false;
    }
  }
  
  // 获取所有后端地址
  async getBackends() {
    try {
      const { results } = await this.db.prepare(
        'SELECT * FROM backends ORDER BY weight DESC, total_requests DESC'
      ).all();
      return results || [];
    } catch (error) {
      console.error('获取后端列表失败:', error);
      return [];
    }
  }
  
  // 获取启用的后端地址
  async getEnabledBackends() {
    try {
      const { results } = await this.db.prepare(
        'SELECT * FROM backends WHERE enabled = 1 ORDER BY weight DESC, total_requests DESC'
      ).all();
      return results || [];
    } catch (error) {
      console.error('获取启用的后端列表失败:', error);
      return [];
    }
  }
  
  // 根据ID获取后端地址
  async getBackendById(id) {
    try {
      return await this.db.prepare(
        'SELECT * FROM backends WHERE id = ?'
      ).bind(id).first();
    } catch (error) {
      console.error('获取后端信息失败:', error);
      return null;
    }
  }
  
  // 添加后端地址
  async addBackend(backend) {
    try {
      const { name, url, weight = 100, max_failures = 3 } = backend;
      const result = await this.db.prepare(
        `INSERT INTO backends (name, url, weight, max_failures) 
         VALUES (?, ?, ?, ?)`
      ).bind(name, url, weight, max_failures).run();
      return result.success;
    } catch (error) {
      console.error('添加后端失败:', error);
      return false;
    }
  }
  
  // 更新后端地址
  async updateBackend(id, updates) {
    try {
      const allowedFields = ['name', 'url', 'weight', 'enabled', 'max_failures'];
      const setClause = [];
      const values = [];
      
      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          setClause.push(`${key} = ?`);
          values.push(value);
        }
      }
      
      // 如果是禁用，记录禁用时间
      if (updates.enabled === 0) {
        setClause.push('disabled_at = ?');
        values.push(Date.now());
      } else if (updates.enabled === 1) {
        // 如果是启用，清除禁用时间
        setClause.push('disabled_at = NULL');
      }
      
      if (setClause.length === 0) return false;
      
      values.push(id);
      const query = `UPDATE backends SET ${setClause.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
      
      const result = await this.db.prepare(query).bind(...values).run();
      return result.success;
    } catch (error) {
      console.error('更新后端失败:', error);
      return false;
    }
  }
  
  // 删除后端地址
  async deleteBackend(id) {
    try {
      const result = await this.db.prepare(
        'DELETE FROM backends WHERE id = ?'
      ).bind(id).run();
      return result.success;
    } catch (error) {
      console.error('删除后端失败:', error);
      return false;
    }
  }
  
  // 更新后端统计数据
  async updateBackendStats(id, success, responseTime) {
    try {
      const backend = await this.getBackendById(id);
      if (!backend) return false;
      
      const updates = {
        total_requests: (backend.total_requests || 0) + 1,
        last_response_time: responseTime,
        updated_at: new Date().toISOString()
      };
      
      if (success) {
        updates.success_requests = (backend.success_requests || 0) + 1;
        updates.last_success_time = Date.now();
        updates.current_failures = 0;
        updates.total_response_time = (backend.total_response_time || 0) + responseTime;
      } else {
        updates.failed_requests = (backend.failed_requests || 0) + 1;
        updates.last_failure_time = Date.now();
        updates.current_failures = (backend.current_failures || 0) + 1;
        
        // 如果连续失败次数达到阈值，自动禁用
        if (updates.current_failures >= (backend.max_failures || 3)) {
          updates.enabled = 0;
          updates.disabled_at = Date.now(); // 记录禁用时间
        }
      }
      
      const setClause = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), id];
      
      const result = await this.db.prepare(
        `UPDATE backends SET ${setClause} WHERE id = ?`
      ).bind(...values).run();
      
      // 记录历史
      try {
        await this.db.prepare(
          'INSERT INTO request_history (backend_id, success, response_time) VALUES (?, ?, ?)'
        ).bind(id, success ? 1 : 0, responseTime).run();
      } catch (historyError) {
        console.warn('记录请求历史失败:', historyError);
      }
      
      return result.success;
    } catch (error) {
      console.error('更新后端统计失败:', error);
      return false;
    }
  }
  
  // 更新最后一次请求记录
  async updateLastRequest(backendId, backendUrl, success, responseTime, attempts = []) {
    try {
      // 将attempts数组转换为JSON字符串
      const attemptsJson = JSON.stringify(attempts || []);
      
      // 更新或插入记录
      await this.db.prepare(`
        INSERT OR REPLACE INTO last_request (id, backend_id, backend_url, success, response_time, request_time, attempts) 
        VALUES (1, ?, ?, ?, ?, ?, ?)
      `).bind(backendId, backendUrl, success ? 1 : 0, responseTime, Date.now(), attemptsJson).run();
      
      console.log('更新最后一次请求记录成功');
      return true;
    } catch (error) {
      console.error('更新最后一次请求记录失败:', error);
      // 如果失败，尝试重建表
      if (error.message.includes('no such column') || error.message.includes('no column named')) {
        console.log('检测到表结构问题，尝试重建last_request表...');
        try {
          await this.db.prepare('DROP TABLE IF EXISTS last_request').run();
          await this.db.prepare(`
            CREATE TABLE last_request (
              id INTEGER PRIMARY KEY CHECK (id = 1),
              backend_id INTEGER,
              backend_url TEXT,
              success BOOLEAN NOT NULL,
              response_time INTEGER,
              request_time INTEGER NOT NULL,
              attempts TEXT,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
          `).run();
          console.log('last_request表重建成功');
          
          // 重新插入记录
          return await this.updateLastRequest(backendId, backendUrl, success, responseTime, attempts);
        } catch (recreateError) {
          console.error('重建表失败:', recreateError);
        }
      }
      return false;
    }
  }
  
  // 获取最后一次请求记录
  async getLastRequest() {
    try {
      // 查询数据
      const lastRequest = await this.db.prepare(
        'SELECT * FROM last_request WHERE id = 1'
      ).first();
      
      return lastRequest;
    } catch (error) {
      console.error('获取最后一次请求记录失败:', error);
      return null;
    }
  }
  
  // 重置后端失败计数和统计数据
  async resetBackendStatistics(id) {
    try {
      const result = await this.db.prepare(`
        UPDATE backends SET 
          current_failures = 0,
          total_requests = 0,
          success_requests = 0,
          failed_requests = 0,
          total_response_time = 0,
          last_response_time = 0,
          last_success_time = NULL,
          last_failure_time = NULL,
          disabled_at = NULL,
          reset_count = reset_count + 1,
          enabled = 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(id).run();
      return result.success;
    } catch (error) {
      console.error('重置后端统计失败:', error);
      return false;
    }
  }
  
  // 重置所有后端地址数据
  async resetAllBackends() {
    try {
      console.log('开始重置所有后端地址数据...');
      const result = await this.db.prepare(`
        UPDATE backends SET 
          current_failures = 0,
          total_requests = 0,
          success_requests = 0,
          failed_requests = 0,
          total_response_time = 0,
          last_response_time = 0,
          last_success_time = NULL,
          last_failure_time = NULL,
          disabled_at = NULL,
          reset_count = reset_count + 1,
          enabled = 1,
          updated_at = CURRENT_TIMESTAMP
      `).run();
      
      console.log(`已重置所有后端地址数据，影响行数: ${result.changes}`);
      return result.success;
    } catch (error) {
      console.error('重置所有后端地址数据失败:', error);
      return false;
    }
  }
  
  // 检查是否有启用的后端
  async hasEnabledBackends() {
    try {
      const result = await this.db.prepare(
        'SELECT COUNT(*) as count FROM backends WHERE enabled = 1'
      ).first();
      return (result?.count || 0) > 0;
    } catch (error) {
      console.error('检查启用后端失败:', error);
      return false;
    }
  }
  
  // 获取所有后端数量
  async getTotalBackendsCount() {
    try {
      const result = await this.db.prepare(
        'SELECT COUNT(*) as count FROM backends'
      ).first();
      return result?.count || 0;
    } catch (error) {
      console.error('获取后端数量失败:', error);
      return 0;
    }
  }
  
  // 自动恢复禁用超过指定时间的后端
  async autoRecoverDisabledBackends(recoveryMinutes = 30) {
    try {
      const recoveryTime = Date.now() - (recoveryMinutes * 60 * 1000);
      
      const { results } = await this.db.prepare(
        'SELECT id FROM backends WHERE enabled = 0 AND disabled_at <= ?'
      ).bind(recoveryTime).all();
      
      if (results && results.length > 0) {
        console.log(`发现 ${results.length} 个禁用超过 ${recoveryMinutes} 分钟的后端，尝试自动恢复...`);
        
        for (const backend of results) {
          await this.resetBackendStatistics(backend.id);
          console.log(`已恢复后端 #${backend.id}`);
        }
        
        return results.length;
      }
      
      return 0;
    } catch (error) {
      console.error('自动恢复禁用后端失败:', error);
      // 如果失败，可能是disabled_at列不存在，尝试修复表结构
      if (error.message.includes('no such column') && error.message.includes('disabled_at')) {
        console.log('检测到disabled_at列不存在，尝试修复表结构...');
        try {
          // 检查列是否存在
          const columnExists = await this.db.prepare(
            "SELECT name FROM pragma_table_info('backends') WHERE name='disabled_at'"
          ).first();
          
          if (!columnExists) {
            console.log('添加disabled_at列到backends表...');
            await this.db.prepare('ALTER TABLE backends ADD COLUMN disabled_at INTEGER').run();
            console.log('disabled_at列添加成功');
          }
        } catch (alterError) {
          console.error('修复表结构失败:', alterError);
        }
      }
      return 0;
    }
  }
  
  // 验证管理员密码
  async verifyAdminPassword(password) {
    try {
      const config = await this.db.prepare(
        'SELECT password_hash FROM admin_config WHERE id = 1'
      ).first();
      
      if (!config || !config.password_hash) return false;
      return await utils.verifyPassword(password, config.password_hash);
    } catch (error) {
      console.error('验证管理员密码失败:', error);
      return false;
    }
  }
  
  // 更新管理员密码
  async updateAdminPassword(newPassword) {
    try {
      const hash = await utils.hashPassword(newPassword);
      const result = await this.db.prepare(
        'UPDATE admin_config SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
      ).bind(hash).run();
      return result.success;
    } catch (error) {
      console.error('更新管理员密码失败:', error);
      return false;
    }
  }
  
  // 创建会话
  async createSession() {
    try {
      const sessionId = utils.generateId();
      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24小时后过期
      const data = JSON.stringify({ loggedIn: true });
      
      await this.db.prepare(
        'INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)'
      ).bind(sessionId, data, expiresAt).run();
      
      return sessionId;
    } catch (error) {
      console.error('创建会话失败:', error);
      return null;
    }
  }
  
  // 验证会话
  async validateSession(sessionId) {
    try {
      if (!sessionId) return null;
      
      const session = await this.db.prepare(
        'SELECT data, expires_at FROM sessions WHERE id = ?'
      ).bind(sessionId).first();
      
      if (!session || session.expires_at < Date.now()) {
        // 删除过期会话
        await this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run().catch(() => {});
        return null;
      }
      
      return JSON.parse(session.data);
    } catch (error) {
      console.error('验证会话失败:', error);
      return null;
    }
  }
  
  // 删除会话
  async deleteSession(sessionId) {
    try {
      if (sessionId) {
        await this.db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
      }
    } catch (error) {
      console.error('删除会话失败:', error);
    }
  }
  
  // 清理过期会话
  async cleanupSessions() {
    try {
      await this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
    } catch (error) {
      console.error('清理会话失败:', error);
    }
  }
  
  // 清除所有数据（用于初始化）
  async clearAllData() {
    try {
      await this.db.prepare('DELETE FROM backends').run();
      await this.db.prepare('DELETE FROM request_history').run();
      await this.db.prepare('DELETE FROM sessions').run();
      await this.db.prepare('DELETE FROM last_request').run();
      return true;
    } catch (error) {
      console.error('清除数据失败:', error);
      return false;
    }
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
    
    // 基础权重（数据库中的静态权重）
    let weight = backend.weight || 100;
    
    // 成功率权重（0-100%）
    const totalRequests = backend.total_requests || 1;
    const successRequests = backend.success_requests || 0;
    const successRate = successRequests / totalRequests;
    weight *= successRate;
    
    // 响应时间权重（响应时间越短，权重越高）
    const totalResponseTime = backend.total_response_time || 0;
    const avgResponseTime = successRequests > 0 ? totalResponseTime / successRequests : 1000;
    if (avgResponseTime > 0) {
      // 假设100ms为基准，响应时间越长权重越低
      weight *= 1000 / Math.max(avgResponseTime, 100);
    }
    
    // 失败惩罚
    const currentFailures = backend.current_failures || 0;
    if (currentFailures > 0) {
      weight /= (currentFailures + 1);
    }
    
    return Math.max(1, Math.round(weight));
  }
  
  // 获取计算后的动态权重
  getCalculatedWeight(backend) {
    return this.calculateWeight(backend);
  }
  
  // 选择后端（加权轮询）
  async selectBackend() {
    try {
      const backends = await this.dbManager.getEnabledBackends();
      if (backends.length === 0) {
        // 检查是否有后端记录
        const totalBackends = await this.dbManager.getTotalBackendsCount();
        if (totalBackends === 0) {
          throw new Error('没有配置后端地址');
        } else {
          throw new Error('所有后端地址都被禁用');
        }
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
      return backends[0];
    } catch (error) {
      console.error('选择后端失败:', error);
      throw error;
    }
  }
  
  // 故障转移：尝试所有可用后端
  async tryAllBackends(request) {
    // 首先检查是否有启用的后端
    let backends = await this.dbManager.getEnabledBackends();
    
    // 如果没有启用的后端，但存在后端记录，则重置所有后端
    if (backends.length === 0) {
      const totalBackends = await this.dbManager.getTotalBackendsCount();
      
      if (totalBackends > 0) {
        console.log('所有后端地址都被禁用，开始自动重置所有后端地址...');
        
        // 重置所有后端地址
        const resetSuccess = await this.dbManager.resetAllBackends();
        
        if (resetSuccess) {
          console.log('所有后端地址已重置，重新获取启用的后端...');
          // 重新获取启用的后端
          backends = await this.dbManager.getEnabledBackends();
          
          if (backends.length > 0) {
            console.log(`已重置并启用 ${backends.length} 个后端地址`);
          } else {
            throw new Error('重置后端后仍然没有可用的后端地址');
          }
        } else {
          throw new Error('重置所有后端地址失败');
        }
      } else {
        throw new Error('没有配置后端地址');
      }
    }
    
    // 按权重排序
    const sortedBackends = [...backends].sort((a, b) => {
      return this.calculateWeight(b) - this.calculateWeight(a);
    });
    
    let lastError = null;
    const attempts = []; // 记录所有尝试的后端地址和结果
    
    for (const backend of sortedBackends) {
      let startTime;
      let success = false;
      let responseTime = 0;
      try {
        startTime = Date.now();
        const response = await this.forwardRequest(backend, request);
        responseTime = Date.now() - startTime;
        success = true;
        
        // 记录这次尝试
        attempts.push({
          backend_id: backend.id,
          backend_url: backend.url,
          backend_name: backend.name,
          success: true,
          response_time: responseTime
        });
        
        // 更新统计（成功）
        await this.dbManager.updateBackendStats(backend.id, true, responseTime);
        
        // 更新最后一次请求记录，包含所有尝试过的后端地址
        await this.dbManager.updateLastRequest(backend.id, backend.url, true, responseTime, attempts);
        
        return response;
      } catch (error) {
        responseTime = Date.now() - (startTime || Date.now());
        // 记录这次尝试
        attempts.push({
          backend_id: backend.id,
          backend_url: backend.url,
          backend_name: backend.name,
          success: false,
          response_time: responseTime,
          error: error.message
        });
        
        // 更新统计（失败）
        await this.dbManager.updateBackendStats(backend.id, false, responseTime);
        
        lastError = error;
        console.error(`后端 ${backend.url} 请求失败:`, error.message);
        // 继续尝试下一个
      }
    }
    
    // 如果所有尝试都失败，更新最后一次请求记录，包含所有尝试过的后端地址
    await this.dbManager.updateLastRequest(null, null, false, 0, attempts);
    
    throw lastError || new Error('所有后端地址都不可用');
  }
  
  // 转发请求
  async forwardRequest(backend, originalRequest) {
    try {
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
            cacheEverything: false,
            cacheTtl: 0
          }
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error) {
      console.error('转发请求失败:', error);
      throw error;
    }
  }
}

// HTML模板
const HTML = {
  // 状态页面 - 优化版本
  statusPage: (backends, loadBalancer, message = '', needsInit = false, lastRequest = null, recoveredCount = 0) => {
    const beijingTime = utils.formatBeijingTime(Date.now());
    
    // 解析尝试记录
    let attempts = [];
    if (lastRequest && lastRequest.attempts) {
      try {
        attempts = typeof lastRequest.attempts === 'string' ? JSON.parse(lastRequest.attempts) : lastRequest.attempts;
      } catch (e) {
        console.error('解析尝试记录失败:', e);
      }
    }
    
    // 检查是否有有效的lastRequest数据
    const hasValidLastRequest = lastRequest && lastRequest.request_time;
    
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>订阅后端状态监控</title>
  <style>
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      color: #333;
      line-height: 1.6;
      min-height: 100vh;
      padding: 15px;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.98);
      border-radius: 20px;
      padding: 25px;
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.1);
      backdrop-filter: blur(10px);
    }
    
    header {
      text-align: center;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid rgba(0, 0, 0, 0.08);
      position: relative;
    }
    
    header::after {
      content: '';
      position: absolute;
      bottom: -2px;
      left: 50%;
      transform: translateX(-50%);
      width: 60px;
      height: 4px;
      background: linear-gradient(90deg, #667eea, #764ba2);
      border-radius: 2px;
    }
    
    h1 {
      color: #2d3748;
      font-size: 2.2em;
      margin-bottom: 12px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    
    .subtitle {
      color: #718096;
      font-size: 1em;
      font-weight: 500;
    }
    
    /* 订阅请求状态卡片样式 */
    .subscription-status-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 16px;
      padding: 20px;
      margin: 25px 0;
      box-shadow: 0 10px 30px rgba(102, 126, 234, 0.2);
      position: relative;
      overflow: hidden;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    
    .subscription-status-card:hover {
      transform: translateY(-3px);
      box-shadow: 0 15px 35px rgba(102, 126, 234, 0.25);
    }
    
    .subscription-status-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: rgba(255, 255, 255, 0.3);
    }
    
    .subscription-status-header {
      display: flex;
      align-items: center;
      margin-bottom: 20px;
      gap: 8px;
      flex-wrap: wrap;
    }
    
    .subscription-status-icon {
      font-size: 1.4em;
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2));
    }
    
    .subscription-status-title {
      font-size: 1.2em;
      font-weight: 700;
    }
    
    .subscription-status-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-bottom: 15px;
    }
    
    .subscription-status-item {
      background: rgba(255, 255, 255, 0.15);
      padding: 15px;
      border-radius: 12px;
      backdrop-filter: blur(10px);
      transition: transform 0.2s ease;
    }
    
    .subscription-status-item:hover {
      transform: translateY(-2px);
    }
    
    .subscription-status-label {
      display: block;
      font-size: 0.85em;
      opacity: 0.9;
      margin-bottom: 6px;
      font-weight: 500;
    }
    
    .subscription-status-value {
      font-size: 1.1em;
      font-weight: 700;
      word-break: break-all;
    }
    
    .attempts-container {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .attempts-title {
      font-size: 1em;
      font-weight: 600;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .attempts-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 10px;
    }
    
    .attempt-item {
      background: rgba(255, 255, 255, 0.1);
      padding: 12px;
      border-radius: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
    }
    
    .attempt-url {
      font-size: 0.85em;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-right: 10px;
    }
    
    .attempt-status {
      font-size: 0.8em;
      padding: 3px 10px;
      border-radius: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }
    
    .attempt-success {
      background: rgba(72, 187, 120, 0.2);
      color: #48bb78;
      border: 1px solid rgba(72, 187, 120, 0.3);
    }
    
    .attempt-failure {
      background: rgba(245, 101, 101, 0.2);
      color: #f56565;
      border: 1px solid rgba(245, 101, 101, 0.3);
    }
    
    .attempt-details {
      font-size: 0.8em;
      color: rgba(255, 255, 255, 0.7);
      width: 100%;
      margin-top: 5px;
      display: flex;
      justify-content: space-between;
    }
    
    .status-success {
      color: #48bb78;
      background: rgba(72, 187, 120, 0.15);
      padding: 5px 12px;
      border-radius: 20px;
      display: inline-block;
      font-size: 0.9em;
    }
    
    .status-failure {
      color: #f56565;
      background: rgba(245, 101, 101, 0.15);
      padding: 5px 12px;
      border-radius: 20px;
      display: inline-block;
      font-size: 0.9em;
    }
    
    .actions {
      display: flex;
      gap: 15px;
      justify-content: center;
      margin: 30px 0;
      flex-wrap: wrap;
      order: 2;
    }
    
    .btn {
      padding: 14px 24px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 6px 15px rgba(0, 0, 0, 0.08);
      min-width: 140px;
      justify-content: center;
    }
    
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .btn-primary:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 25px rgba(102, 126, 234, 0.3);
    }
    
    .btn-secondary {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
    }
    
    .btn-secondary:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 25px rgba(72, 187, 120, 0.3);
    }
    
    .btn-danger {
      background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
      color: white;
    }
    
    .btn-danger:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 25px rgba(245, 101, 101, 0.3);
    }
    
    .message {
      padding: 18px;
      border-radius: 14px;
      margin: 18px 0;
      text-align: center;
      font-weight: 500;
      animation: slideIn 0.3s ease-out;
      border-left: 5px solid transparent;
      font-size: 0.95em;
    }
    
    .success {
      background: linear-gradient(135deg, rgba(198, 246, 213, 0.2) 0%, rgba(154, 230, 180, 0.2) 100%);
      color: #22543d;
      border-left-color: #48bb78;
    }
    
    .error {
      background: linear-gradient(135deg, rgba(254, 215, 215, 0.2) 0%, rgba(252, 129, 129, 0.2) 100%);
      color: #742a2a;
      border-left-color: #f56565;
    }
    
    .warning {
      background: linear-gradient(135deg, rgba(254, 235, 200, 0.2) 0%, rgba(251, 211, 141, 0.2) 100%);
      color: #744210;
      border-left-color: #ed8936;
    }
    
    .info {
      background: linear-gradient(135deg, rgba(190, 227, 248, 0.2) 0%, rgba(144, 205, 244, 0.2) 100%);
      color: #1a365d;
      border-left-color: #4299e1;
    }
    
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
      margin-bottom: 30px;
      order: 1;
    }
    
    .stat-card {
      background: white;
      border-radius: 16px;
      padding: 22px;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.06);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid rgba(226, 232, 240, 0.6);
      position: relative;
      overflow: hidden;
    }
    
    .stat-card:hover {
      transform: translateY(-8px);
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.12);
      border-color: #667eea;
    }
    
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #667eea, #764ba2);
    }
    
    .stat-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 18px;
      padding-bottom: 12px;
      border-bottom: 2px solid rgba(247, 250, 252, 0.8);
      flex-wrap: wrap;
    }
    
    .stat-name {
      font-size: 1.2em;
      font-weight: 700;
      color: #2d3748;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      margin-bottom: 8px;
      flex: 1;
      min-width: 0;
    }
    
    .stat-name-main {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      width: 100%;
    }
    
    .backend-name-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    
    .backend-name-text {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    
    .backend-name-text span {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
    }
    
    .backend-id {
      font-size: 0.7em;
      color: #718096;
      flex-shrink: 0;
    }
    
    .backend-status-mobile {
      display: none;
      padding: 4px 10px;
      border-radius: 50px;
      font-size: 0.7em;
      font-weight: 600;
      letter-spacing: 0.3px;
      flex-shrink: 0;
    }
    
    .status-active-mobile {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
    }
    
    .status-inactive-mobile {
      background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
      color: white;
    }
    
    .backend-url {
      font-size: 0.8em;
      color: #718096;
      word-break: break-all;
      max-width: 100%;
      overflow-wrap: break-word;
      background: linear-gradient(135deg, rgba(247, 250, 252, 0.8) 0%, rgba(237, 242, 247, 0.8) 100%);
      padding: 10px 14px;
      border-radius: 12px;
      border-left: 4px solid #667eea;
      line-height: 1.5;
      width: 100%;
      margin-top: 8px;
      font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
      box-shadow: inset 0 2px 6px rgba(0, 0, 0, 0.04);
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    
    .backend-url::before {
      content: '🔗';
      margin-right: 6px;
      opacity: 0.7;
    }
    
    .backend-url:hover {
      background: linear-gradient(135deg, rgba(247, 250, 252, 1) 0%, rgba(237, 242, 247, 1) 100%);
      box-shadow: inset 0 4px 12px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(102, 126, 234, 0.1);
      transform: translateY(-1px);
    }
    
    .status-badge {
      padding: 7px 16px;
      border-radius: 50px;
      font-size: 0.8em;
      font-weight: 700;
      letter-spacing: 0.5px;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
      white-space: nowrap;
      flex-shrink: 0;
    }
    
    .status-active {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
    }
    
    .status-inactive {
      background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
      color: white;
    }
    
    /* 修改这里：始终显示两列 */
    .stat-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }
    
    .stat-item {
      display: flex;
      flex-direction: column;
      padding: 10px;
      background: rgba(247, 250, 252, 0.6);
      border-radius: 8px;
      transition: background 0.2s ease;
    }
    
    .stat-item:hover {
      background: rgba(247, 250, 252, 1);
    }
    
    .stat-label {
      font-size: 0.75em;
      color: #718096;
      margin-bottom: 6px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .stat-value {
      font-size: 0.95em;
      font-weight: 700;
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
    
    .progress-container {
      margin-top: 8px;
      position: relative;
    }
    
    .progress-bar {
      height: 6px;
      background: rgba(226, 232, 240, 0.6);
      border-radius: 3px;
      overflow: hidden;
    }
    
    .progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
      overflow: hidden;
    }
    
    .progress-fill::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
      animation: shimmer 2s infinite;
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
    
    .no-data {
      text-align: center;
      padding: 50px 30px;
      color: #718096;
      order: 1;
      grid-column: 1 / -1;
    }
    
    .no-data-icon {
      font-size: 3.5em;
      margin-bottom: 20px;
      opacity: 0.5;
    }
    
    footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 25px;
      border-top: 2px solid rgba(226, 232, 240, 0.6);
      color: #718096;
      font-size: 0.9em;
    }
    
    .footer-stats {
      display: flex;
      justify-content: center;
      gap: 25px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    
    .footer-stat {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
      font-size: 0.9em;
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    @keyframes shimmer {
      0% {
        transform: translateX(-100%);
      }
      100% {
        transform: translateX(100%);
      }
    }
    
    /* 响应式设计 */
    @media (max-width: 1200px) {
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 18px;
      }
      
      .stat-card {
        padding: 20px;
      }
      
      .attempts-list {
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      }
    }
    
    @media (max-width: 992px) {
      .container {
        padding: 22px;
      }
      
      h1 {
        font-size: 2em;
      }
      
      .stats-grid {
        grid-template-columns: 1fr; /* 平板端变成一列 */
        gap: 16px;
      }
      
      /* 保持内部始终两列 */
      .stat-details {
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }
      
      .subscription-status-details {
        grid-template-columns: repeat(2, 1fr);
        gap: 14px;
      }
      
      .attempts-list {
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      }
    }
    
    @media (max-width: 768px) {
      body {
        padding: 12px;
      }
      
      .container {
        padding: 18px;
        border-radius: 16px;
      }
      
      h1 {
        font-size: 1.7em;
      }
      
      .subtitle {
        font-size: 0.95em;
      }
      
      .subscription-status-card {
        padding: 18px;
        margin: 20px 0;
      }
      
      .subscription-status-icon {
        font-size: 1.2em;
      }
      
      .subscription-status-title {
        font-size: 1.1em;
      }
      
      .subscription-status-details {
        grid-template-columns: 1fr; /* 移动端详情变成一列 */
        gap: 12px;
      }
      
      .subscription-status-item {
        padding: 12px;
      }
      
      .subscription-status-label {
        font-size: 0.8em;
      }
      
      .subscription-status-value {
        font-size: 1em;
      }
      
      .attempts-title {
        font-size: 0.95em;
      }
      
      .attempts-list {
        grid-template-columns: 1fr; /* 移动端尝试列表变成一列 */
      }
      
      .attempt-item {
        padding: 10px;
      }
      
      .attempt-url {
        font-size: 0.8em;
      }
      
      .actions {
        flex-direction: column;
        align-items: stretch;
        gap: 12px;
        margin: 25px 0;
      }
      
      .btn {
        width: 100%;
        padding: 16px;
        min-width: auto;
      }
      
      .stat-header {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
      }
      
      .backend-name-container {
        margin-bottom: 0;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }
      
      .backend-name-text {
        order: 1;
        flex: 1;
      }
      
      .backend-name-text span {
        max-width: 150px;
      }
      
      .backend-status-mobile {
        display: inline-block;
        order: 3;
        margin-left: auto;
      }
      
      .status-badge {
        display: none; /* 隐藏桌面端状态徽章 */
      }
      
      .stats-grid {
        grid-template-columns: 1fr;
        gap: 16px;
      }
      
      .stat-card {
        padding: 18px;
      }
      
      /* 移动端内部保持两列 */
      .stat-details {
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }
      
      .stat-item {
        padding: 10px 8px;
      }
      
      .stat-label {
        font-size: 0.7em;
      }
      
      .stat-value {
        font-size: 0.9em;
      }
      
      .backend-url {
        font-size: 0.75em;
        padding: 8px 12px;
        margin-top: 10px;
      }
      
      .footer-stats {
        flex-direction: column;
        gap: 12px;
      }
    }
    
    @media (max-width: 480px) {
      body {
        padding: 10px;
      }
      
      .container {
        padding: 16px;
        border-radius: 14px;
      }
      
      h1 {
        font-size: 1.5em;
        margin-bottom: 8px;
      }
      
      .subtitle {
        font-size: 0.9em;
      }
      
      .subscription-status-card {
        padding: 16px;
      }
      
      .subscription-status-header {
        align-items: center;
        gap: 8px;
      }
      
      .subscription-status-details {
        grid-template-columns: 1fr;
      }
      
      .attempts-list {
        grid-template-columns: 1fr;
      }
      
      .attempt-item {
        flex-direction: column;
        align-items: flex-start;
        gap: 5px;
      }
      
      .attempt-url {
        width: 100%;
        margin-right: 0;
        white-space: normal;
      }
      
      .attempt-status {
        align-self: flex-end;
      }
      
      .stat-name {
        font-size: 1.1em;
      }
      
      .backend-name-text span {
        max-width: 120px;
      }
      
      .backend-status-mobile {
        font-size: 0.65em;
        padding: 3px 8px;
      }
      
      /* 小屏幕手机端内部保持两列 */
      .stat-details {
        grid-template-columns: repeat(2, 1fr);
        gap: 8px;
      }
      
      .stat-item {
        padding: 8px 6px;
      }
      
      .stat-label {
        font-size: 0.65em;
      }
      
      .stat-value {
        font-size: 0.85em;
      }
      
      .backend-url {
        font-size: 0.7em;
        padding: 7px 10px;
      }
      
      .progress-bar {
        height: 5px;
      }
      
      .footer-stat {
        font-size: 0.85em;
      }
    }
    
    /* 小屏幕手机优化 */
    @media (max-width: 360px) {
      /* 超小屏幕手机端内部仍保持两列 */
      .stat-details {
        grid-template-columns: repeat(2, 1fr);
        gap: 6px;
      }
      
      .subscription-status-details {
        grid-template-columns: 1fr;
      }
      
      .backend-name-text span {
        max-width: 100px;
      }
      
      .backend-status-mobile {
        font-size: 0.6em;
        padding: 2px 6px;
      }
      
      .stat-item {
        padding: 7px 5px;
      }
      
      .stat-label {
        font-size: 0.6em;
      }
      
      .stat-value {
        font-size: 0.8em;
      }
    }
    
    /* 电脑端优化 */
    @media (min-width: 769px) {
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr); /* 电脑端显示两列 */
        gap: 25px;
      }
      
      /* 电脑端内部保持两列 */
      .stat-details {
        grid-template-columns: repeat(2, 1fr);
        gap: 15px;
      }
      
      .subscription-status-details {
        grid-template-columns: repeat(2, 1fr);
      }
      
      .attempts-list {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      }
      
      .backend-status-mobile {
        display: none; /* 电脑端隐藏移动端状态徽章 */
      }
      
      .status-badge {
        display: inline-block; /* 电脑端显示状态徽章 */
      }
      
      .backend-url {
        font-size: 0.85em;
      }
    }
    
    /* 大屏幕电脑端优化 */
    @media (min-width: 1400px) {
      .container {
        max-width: 1600px;
      }
      
      .stats-grid {
        grid-template-columns: repeat(2, 1fr);
        gap: 30px;
      }
      
      .stat-card {
        padding: 28px;
      }
      
      .subscription-status-details {
        grid-template-columns: repeat(4, 1fr); /* 大屏幕电脑端显示四列 */
      }
      
      .attempts-list {
        grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      }
      
      .backend-url {
        font-size: 0.9em;
        padding: 12px 16px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🚀 订阅后端状态监控</h1>
      <p class="subtitle">实时监控后端订阅服务状态 | 北京时间: ${beijingTime}</p>
    </header>
    
    ${message ? `<div class="message ${message.type === 'success' ? 'success' : message.type === 'warning' ? 'warning' : message.type === 'info' ? 'info' : 'error'}">${message.text}</div>` : ''}
    
    ${recoveredCount > 0 ? `<div class="message info">🔄 已自动恢复 ${recoveredCount} 个禁用超过30分钟的后端地址</div>` : ''}
    
    ${needsInit ? `
      <div class="message warning">
        <strong>数据库未初始化！</strong><br>
        这是您第一次使用本系统，或者数据库尚未初始化。<br>
        请点击下面的按钮初始化数据库以开始使用。
      </div>
    ` : ''}
    
    ${!needsInit ? `
      <div class="subscription-status-card">
        <div class="subscription-status-header">
          <div class="subscription-status-icon">📡</div>
          <div class="subscription-status-title">订阅请求状态：</div>
        </div>
        ${hasValidLastRequest ? `
          <div class="subscription-status-details">
            <div class="subscription-status-item">
              <span class="subscription-status-label">最终请求地址</span>
              <span class="subscription-status-value">${lastRequest.backend_url || '未知'}</span>
            </div>
            <div class="subscription-status-item">
              <span class="subscription-status-label">响应时间</span>
              <span class="subscription-status-value">${lastRequest.response_time || 0}ms</span>
            </div>
            <div class="subscription-status-item">
              <span class="subscription-status-label">请求状态</span>
              <span class="subscription-status-value ${lastRequest.success ? 'status-success' : 'status-failure'}">
                ${lastRequest.success ? '✅ 成功' : '❌ 失败'}
              </span>
            </div>
            <div class="subscription-status-item">
              <span class="subscription-status-label">请求时间</span>
              <span class="subscription-status-value">${utils.formatBeijingTime(lastRequest.request_time)}</span>
            </div>
          </div>
          ${attempts.length > 0 ? `
            <div class="attempts-container">
              <div class="attempts-title">
                <span>🔍</span>
                <span>本次轮询后端地址：</span>
              </div>
              <div class="attempts-list">
                ${attempts.map(attempt => `
                  <div class="attempt-item">
                    <div class="attempt-url" title="${attempt.backend_url}">${attempt.backend_url}</div>
                    <div class="attempt-status ${attempt.success ? 'attempt-success' : 'attempt-failure'}">
                      ${attempt.success ? '✅ 成功' : '❌ 失败'}
                    </div>
                    <div class="attempt-details">
                      <span>${attempt.backend_name || '未知'}</span>
                      <span>${attempt.response_time || 0}ms</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        ` : `
          <div class="subscription-status-details" style="text-align: center; padding: 30px;">
            <div style="font-size: 1.2em; color: #718096;">暂无请求记录</div>
            <div style="margin-top: 10px; font-size: 0.9em;">等待第一次订阅请求...</div>
          </div>
        `}
      </div>
    ` : ''}
    
    ${backends.length > 0 ? `
      <div class="stats-grid">
        ${backends.map(backend => {
          const successRate = backend.total_requests > 0 
            ? ((backend.success_requests / backend.total_requests) * 100).toFixed(2)
            : 0;
          const avgResponseTime = backend.success_requests > 0
            ? (backend.total_response_time / backend.success_requests).toFixed(0)
            : 0;
          
          // 计算动态权重
          const calculatedWeight = loadBalancer ? loadBalancer.getCalculatedWeight(backend) : backend.weight;
          
          let successRateClass = 'stat-success';
          if (successRate < 80) successRateClass = 'stat-warning';
          if (successRate < 50) successRateClass = 'stat-danger';
          
          let progressClass = 'progress-success';
          if (successRate < 80) progressClass = 'progress-warning';
          if (successRate < 50) progressClass = 'progress-danger';
          
          return `
          <div class="stat-card">
            <div class="stat-header">
              <div class="stat-name">
                <div class="backend-name-container">
                  <div class="backend-name-text">
                    ${backend.enabled ? '🟢' : '🔴'} <span>${backend.name || '未命名'}</span>
                    <span class="backend-id">#${backend.id}</span>
                    <span class="backend-status-mobile ${backend.enabled ? 'status-active-mobile' : 'status-inactive-mobile'}">
                      ${backend.enabled ? '启用' : '禁用'}
                    </span>
                  </div>
                  <span class="status-badge ${backend.enabled ? 'status-active' : 'status-inactive'}">
                    ${backend.enabled ? '✅ 启用' : '⛔ 禁用'}
                  </span>
                </div>
                <div class="backend-url">${backend.url || ''}</div>
              </div>
            </div>
            
            <div class="stat-details">
              <div class="stat-item">
                <span class="stat-label">总请求数</span>
                <span class="stat-value">${backend.total_requests || 0}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">成功率</span>
                <span class="stat-value ${successRateClass}">${successRate}%</span>
                <div class="progress-container">
                  <div class="progress-bar">
                    <div class="progress-fill ${progressClass}" style="width: ${Math.min(successRate, 100)}%"></div>
                  </div>
                </div>
              </div>
              <div class="stat-item">
                <span class="stat-label">成功请求</span>
                <span class="stat-value stat-success">${backend.success_requests || 0}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">失败请求</span>
                <span class="stat-value stat-danger">${backend.failed_requests || 0}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">平均响应</span>
                <span class="stat-value">${avgResponseTime}ms</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">最后响应</span>
                <span class="stat-value">${backend.last_response_time || 0}ms</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">连续失败</span>
                <span class="stat-value ${backend.current_failures > 0 ? 'stat-warning' : ''}">
                  ${backend.current_failures || 0}/${backend.max_failures || 3}
                </span>
              </div>
              <div class="stat-item">
                <span class="stat-label">重置次数</span>
                <span class="stat-value ${backend.reset_count > 0 ? 'stat-warning' : ''}">
                  ${backend.reset_count || 0}
                </span>
              </div>
              <div class="stat-item">
                <span class="stat-label">静态权重</span>
                <span class="stat-value">${backend.weight || 100}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">动态权重</span>
                <span class="stat-value ${calculatedWeight > backend.weight ? 'stat-success' : calculatedWeight < backend.weight ? 'stat-warning' : ''}">
                  ${calculatedWeight}
                </span>
              </div>
              <div class="stat-item">
                <span class="stat-label">最后成功</span>
                <span class="stat-value">${utils.formatTimeAgo(backend.last_success_time)}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">最后失败</span>
                <span class="stat-value">${utils.formatTimeAgo(backend.last_failure_time)}</span>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    ` : needsInit ? '' : `
      <div class="no-data">
        <div class="no-data-icon">📭</div>
        <h3 style="margin-bottom: 15px;">还没有添加后端地址</h3>
        <p style="margin-bottom: 10px;">请先初始化数据库，然后登录管理面板添加后端地址。</p>
        <p style="font-size: 0.9em; opacity: 0.7;">添加后可以享受负载均衡和自动故障转移功能</p>
      </div>
    `}
    
    <div class="actions">
      <a href="/" class="btn btn-primary">🔄 刷新状态</a>
      ${!needsInit ? '<a href="/admin" class="btn btn-secondary">⚙️ 管理面板</a>' : ''}
      <button onclick="initDatabase()" class="btn ${needsInit ? 'btn-secondary' : 'btn-danger'}">
        ${needsInit ? '🚀 初始化数据库' : '🗃️ 重新初始化数据库'}
      </button>
    </div>
    
    <footer>
      <p>© ${new Date().getFullYear()} 订阅后端管理器 | 基于 Cloudflare Workers 构建</p>
      ${recoveredCount > 0 ? `
        <div class="footer-stats">
          <span class="footer-stat">🔄 已恢复: ${recoveredCount}</span>
        </div>
      ` : ''}
    </footer>
  </div>
  
  <script>
    async function initDatabase() {
      const warningMessage = "确定要重新初始化数据库吗？\\n\\n" +
        "这会：\\n" +
        "1. 删除所有现有数据\\n" +
        "2. 重新创建所有数据库表\\n" +
        "3. 重置默认管理员密码 (admin123)\\n" +
        "4. 重新添加默认后端地址\\n\\n" +
        "⚠️ 注意：此操作不可逆！所有现有数据都将丢失！";
      
      if (confirm(warningMessage)) {
        try {
          // 显示加载状态
          const initBtn = document.querySelector('button[onclick*="initDatabase"]');
          const originalText = initBtn.innerHTML;
          initBtn.innerHTML = '🔄 初始化中...';
          initBtn.disabled = true;
          
          const response = await fetch('/initdb', { 
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            }
          });
          const result = await response.json();
          alert(result.message);
          if (result.success) {
            location.reload();
          } else {
            // 恢复按钮状态
            initBtn.innerHTML = originalText;
            initBtn.disabled = false;
          }
        } catch (error) {
          alert('初始化失败: ' + error.message);
          // 恢复按钮状态
          const initBtn = document.querySelector('button[onclick*="initDatabase"]');
          initBtn.innerHTML = needsInit ? '🚀 初始化数据库' : '🗃️ 重新初始化数据库';
          initBtn.disabled = false;
        }
      }
    }
    
    // 自动刷新页面（每30秒）
    setTimeout(() => {
      location.reload();
    }, 30000);
    
    // 添加卡片悬停效果增强
    document.addEventListener('DOMContentLoaded', function() {
      const cards = document.querySelectorAll('.stat-card, .subscription-status-card');
      cards.forEach(card => {
        card.addEventListener('mouseenter', function() {
          this.style.zIndex = '10';
        });
        card.addEventListener('mouseleave', function() {
          this.style.zIndex = '1';
        });
      });
      
      // 添加点击卡片展开效果
      const statCards = document.querySelectorAll('.stat-card');
      statCards.forEach(card => {
        card.addEventListener('click', function(e) {
          if (window.innerWidth <= 768) {
            this.classList.toggle('expanded');
          }
        });
      });
    });
  </script>
</body>
</html>`;
  },
  
  // 登录页面 - 移动端优化版本
  loginPage: (error = '') => {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理员登录</title>
  <style>
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow: hidden;
    }
    
    body::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle at 20% 80%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
                  radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.1) 0%, transparent 50%);
    }
    
    .login-container {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 20px;
      padding: 40px 30px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.25);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      position: relative;
      z-index: 1;
      animation: slideIn 0.5s cubic-bezier(0.4, 0, 0.2, 1);
    }
    
    .login-header {
      text-align: center;
      margin-bottom: 35px;
    }
    
    .login-icon {
      font-size: 3em;
      margin-bottom: 18px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.1));
    }
    
    h1 {
      color: #2d3748;
      font-size: 1.8em;
      margin-bottom: 8px;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    
    .login-subtitle {
      color: #718096;
      font-size: 0.95em;
      font-weight: 500;
    }
    
    .error-message {
      background: linear-gradient(135deg, rgba(254, 215, 215, 0.2) 0%, rgba(252, 129, 129, 0.2) 100%);
      color: #742a2a;
      padding: 14px;
      border-radius: 12px;
      margin-bottom: 22px;
      text-align: center;
      font-weight: 500;
      border-left: 4px solid #f56565;
      animation: shake 0.5s ease-in-out;
      font-size: 0.95em;
    }
    
    .form-group {
      margin-bottom: 22px;
    }
    
    label {
      display: block;
      margin-bottom: 8px;
      color: #4a5568;
      font-weight: 600;
      font-size: 0.9em;
    }
    
    .input-wrapper {
      position: relative;
    }
    
    .input-icon {
      position: absolute;
      left: 16px;
      top: 50%;
      transform: translateY(-50%);
      color: #a0aec0;
      font-size: 1.1em;
    }
    
    input {
      width: 100%;
      padding: 15px 15px 15px 45px;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      font-size: 15px;
      transition: all 0.3s ease;
      background: rgba(247, 250, 252, 0.8);
    }
    
    input:focus {
      outline: none;
      border-color: #667eea;
      background: white;
      box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
    }
    
    .password-hint {
      display: block;
      margin-top: 6px;
      color: #a0aec0;
      font-size: 0.8em;
      font-style: italic;
    }
    
    .btn {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      box-shadow: 0 8px 22px rgba(102, 126, 234, 0.25);
    }
    
    .btn:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 30px rgba(102, 126, 234, 0.35);
    }
    
    .btn:active {
      transform: translateY(0);
    }
    
    .login-footer {
      text-align: center;
      margin-top: 25px;
      padding-top: 18px;
      border-top: 1px solid rgba(226, 232, 240, 0.5);
    }
    
    .back-link {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: color 0.2s ease;
      font-size: 0.9em;
    }
    
    .back-link:hover {
      color: #764ba2;
      text-decoration: underline;
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-5px); }
      40%, 80% { transform: translateX(5px); }
    }
    
    @media (max-width: 480px) {
      body {
        padding: 15px;
      }
      
      .login-container {
        padding: 30px 22px;
        border-radius: 18px;
      }
      
      h1 {
        font-size: 1.6em;
      }
      
      .login-icon {
        font-size: 2.5em;
      }
      
      input {
        padding: 14px 14px 14px 42px;
      }
    }
    
    @media (max-width: 360px) {
      .login-container {
        padding: 25px 18px;
      }
      
      h1 {
        font-size: 1.5em;
      }
      
      .login-icon {
        font-size: 2.2em;
      }
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="login-header">
      <div class="login-icon">🔐</div>
      <h1>管理员登录</h1>
      <p class="login-subtitle">订阅后端管理系统</p>
    </div>
    
    ${error ? `<div class="error-message">${error}</div>` : ''}
    
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label for="password">管理员密码</label>
        <div class="input-wrapper">
          <div class="input-icon">🔑</div>
          <input type="password" id="password" name="password" required placeholder="请输入管理员密码">
        </div>
        <small class="password-hint">默认密码: admin123</small>
      </div>
      <button type="submit" class="btn">
        <span>登录系统</span>
        <span>→</span>
      </button>
    </form>
    
    <div class="login-footer">
      <a href="/" class="back-link">
        <span>←</span>
        返回状态页面
      </a>
    </div>
  </div>
  
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      const form = document.querySelector('form');
      const submitBtn = form.querySelector('.btn');
      
      form.addEventListener('submit', function() {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>登录中...</span><span>⏳</span>';
      });
      
      // 密码输入框回车提交
      document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
          form.submit();
        }
      });
    });
  </script>
</body>
</html>`;
  },
  
  // 管理面板 - 移动端优化版本
  adminPage: (backends, message = '', beijingTime) => {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理面板</title>
  <style>
    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
      color: #2d3748;
      line-height: 1.6;
      min-height: 100vh;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 25px 20px;
    }
    
    /* 头部样式 */
    .admin-header {
      background: white;
      padding: 25px;
      border-radius: 18px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.06);
      margin-bottom: 25px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 18px;
      border: 1px solid rgba(226, 232, 240, 0.6);
      position: relative;
      overflow: hidden;
    }
    
    .admin-header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #667eea, #764ba2);
    }
    
    .header-title {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .header-icon {
      font-size: 2.2em;
      background: linear-gradient(135deg, #667eea, #764ba2);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.1));
    }
    
    h1 {
      color: #2d3748;
      font-size: 1.6em;
      font-weight: 800;
      letter-spacing: -0.5px;
    }
    
    .header-time {
      color: #718096;
      font-size: 0.85em;
      font-weight: 500;
      background: rgba(247, 250, 252, 0.8);
      padding: 7px 14px;
      border-radius: 50px;
      border: 1px solid rgba(226, 232, 240, 0.6);
    }
    
    .header-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    
    .btn {
      padding: 11px 20px;
      border: none;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 5px 15px rgba(0, 0, 0, 0.06);
    }
    
    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    
    .btn-primary:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 25px rgba(102, 126, 234, 0.25);
    }
    
    .btn-secondary {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
    }
    
    .btn-secondary:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 25px rgba(72, 187, 120, 0.25);
    }
    
    .btn-danger {
      background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
      color: white;
    }
    
    .btn-danger:hover {
      transform: translateY(-3px);
      box-shadow: 0 10px 25px rgba(245, 101, 101, 0.25);
    }
    
    .btn-logout {
      background: linear-gradient(135deg, #718096 0%, #4a5568 100%);
      color: white;
    }
    
    .btn-logout:hover {
      background: linear-gradient(135deg, #4a5568 0%, #2d3748 100%);
      transform: translateY(-3px);
      box-shadow: 0 10px 25px rgba(113, 128, 150, 0.25);
    }
    
    /* 消息样式 */
    .message {
      padding: 18px;
      border-radius: 14px;
      margin-bottom: 25px;
      font-weight: 500;
      animation: slideIn 0.3s ease-out;
      border-left: 5px solid transparent;
      font-size: 0.95em;
    }
    
    .success {
      background: linear-gradient(135deg, rgba(198, 246, 213, 0.2) 0%, rgba(154, 230, 180, 0.2) 100%);
      color: #22543d;
      border-left-color: #48bb78;
    }
    
    .error {
      background: linear-gradient(135deg, rgba(254, 215, 215, 0.2) 0%, rgba(252, 129, 129, 0.2) 100%);
      color: #742a2a;
      border-left-color: #f56565;
    }
    
    .warning {
      background: linear-gradient(135deg, rgba(254, 235, 200, 0.2) 0%, rgba(251, 211, 141, 0.2) 100%);
      color: #744210;
      border-left-color: #ed8936;
    }
    
    /* 标签页样式 */
    .tabs-container {
      background: white;
      border-radius: 18px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.06);
      margin-bottom: 25px;
      overflow: hidden;
      border: 1px solid rgba(226, 232, 240, 0.6);
    }
    
    .tabs {
      display: flex;
      gap: 1px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 1px;
      overflow-x: auto;
    }
    
    .tab {
      padding: 16px 22px;
      border: none;
      background: white;
      color: #718096;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      white-space: nowrap;
      flex: 1;
      min-width: 130px;
      text-align: center;
      position: relative;
      font-size: 0.95em;
    }
    
    .tab.active {
      background: white;
      color: #667eea;
      font-weight: 700;
    }
    
    .tab.active::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(90deg, #667eea, #764ba2);
    }
    
    .tab:hover:not(.active) {
      background: rgba(247, 250, 252, 0.8);
      color: #4a5568;
    }
    
    .tab-content {
      display: none;
      padding: 30px;
      animation: fadeIn 0.3s ease;
    }
    
    .tab-content.active {
      display: block;
    }
    
    /* 内容卡片样式 */
    .content-card {
      background: white;
      padding: 30px;
      border-radius: 18px;
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.06);
      margin-bottom: 25px;
      border: 1px solid rgba(226, 232, 240, 0.6);
      position: relative;
      overflow: hidden;
    }
    
    .content-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: linear-gradient(90deg, #667eea, #764ba2);
    }
    
    .content-card h2 {
      color: #2d3748;
      font-size: 1.5em;
      margin-bottom: 25px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .content-card h2::before {
      content: '';
      width: 6px;
      height: 25px;
      background: linear-gradient(135deg, #667eea, #764ba2);
      border-radius: 4px;
    }
    
    /* 表单样式 */
    .form-group {
      margin-bottom: 22px;
    }
    
    label {
      display: block;
      margin-bottom: 8px;
      color: #4a5568;
      font-weight: 600;
      font-size: 0.9em;
    }
    
    input, select {
      width: 100%;
      padding: 13px 16px;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      font-size: 15px;
      transition: all 0.3s ease;
      background: rgba(247, 250, 252, 0.8);
    }
    
    input:focus, select:focus {
      outline: none;
      border-color: #667eea;
      background: white;
      box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.1);
    }
    
    .form-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 22px;
    }
    
    .form-actions {
      display: flex;
      gap: 12px;
      margin-top: 35px;
      padding-top: 25px;
      border-top: 2px solid rgba(226, 232, 240, 0.6);
    }
    
    /* 表格样式 */
    .table-container {
      overflow-x: auto;
      border-radius: 14px;
      border: 1px solid rgba(226, 232, 240, 0.6);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.04);
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 750px;
    }
    
    thead {
      background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
    }
    
    th, td {
      padding: 16px 18px;
      text-align: left;
      border-bottom: 1px solid rgba(226, 232, 240, 0.6);
    }
    
    th {
      font-weight: 700;
      color: #4a5568;
      font-size: 0.85em;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    tbody tr {
      transition: background 0.2s ease;
    }
    
    tbody tr:hover {
      background: rgba(247, 250, 252, 0.8);
    }
    
    .status-badge {
      padding: 7px 14px;
      border-radius: 50px;
      font-size: 0.8em;
      font-weight: 600;
      display: inline-block;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
    }
    
    .status-active {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
    }
    
    .status-inactive {
      background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
      color: white;
    }
    
    .actions-cell {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    
    .action-btn {
      padding: 7px 14px;
      border: none;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.08);
    }
    
    .action-edit {
      background: linear-gradient(135deg, #4299e1 0%, #3182ce 100%);
      color: white;
    }
    
    .action-edit:hover {
      background: linear-gradient(135deg, #3182ce 0%, #2c5282 100%);
      transform: translateY(-2px);
      box-shadow: 0 5px 12px rgba(49, 130, 206, 0.25);
    }
    
    .action-delete {
      background: linear-gradient(135deg, #f56565 0%, #e53e3e 100%);
      color: white;
    }
    
    .action-delete:hover {
      background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);
      transform: translateY(-2px);
      box-shadow: 0 5px 12px rgba(229, 62, 62, 0.25);
    }
    
    .action-toggle {
      background: linear-gradient(135deg, #48bb78 0%, #38a169 100%);
      color: white;
    }
    
    .action-toggle:hover {
      background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
      transform: translateY(-2px);
      box-shadow: 0 5px 12px rgba(56, 161, 105, 0.25);
    }
    
    .action-reset {
      background: linear-gradient(135deg, #ed8936 0%, #dd6b20 100%);
      color: white;
    }
    
    .action-reset:hover {
      background: linear-gradient(135deg, #dd6b20 0%, #c05621 100%);
      transform: translateY(-2px);
      box-shadow: 0 5px 12px rgba(221, 107, 32, 0.25);
    }
    
    /* 空状态样式 */
    .empty-state {
      text-align: center;
      padding: 50px 30px;
      color: #718096;
    }
    
    .empty-icon {
      font-size: 3.5em;
      margin-bottom: 22px;
      opacity: 0.5;
      filter: drop-shadow(0 8px 20px rgba(0, 0, 0, 0.1));
    }
    
    /* 页脚样式 */
    footer {
      text-align: center;
      margin-top: 45px;
      padding-top: 25px;
      border-top: 2px solid rgba(226, 232, 240, 0.6);
      color: #718096;
      font-size: 0.85em;
    }
    
    .footer-info {
      display: flex;
      justify-content: center;
      gap: 25px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    
    /* 动画 */
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    /* 响应式设计 - 移动端优化 */
    @media (max-width: 1200px) {
      .container {
        padding: 22px 18px;
      }
      
      .tab {
        min-width: 110px;
        padding: 14px 18px;
      }
      
      .content-card {
        padding: 25px;
      }
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 18px 15px;
      }
      
      .admin-header {
        flex-direction: column;
        text-align: center;
        padding: 22px;
        gap: 15px;
      }
      
      .header-title {
        flex-direction: column;
        gap: 8px;
      }
      
      .header-actions {
        justify-content: center;
        width: 100%;
      }
      
      .tabs {
        flex-direction: column;
      }
      
      .tab {
        min-width: 100%;
        padding: 14px;
      }
      
      .form-row {
        grid-template-columns: 1fr;
        gap: 18px;
      }
      
      .form-actions {
        flex-direction: column;
        gap: 10px;
      }
      
      .btn {
        width: 100%;
        justify-content: center;
        padding: 13px 18px;
        font-size: 14px;
      }
      
      .actions-cell {
        flex-direction: column;
        gap: 8px;
      }
      
      .action-btn {
        width: 100%;
        justify-content: center;
        padding: 10px;
        font-size: 12px;
      }
      
      .table-container {
        border-radius: 12px;
        margin: 0 -10px;
        width: calc(100% + 20px);
      }
      
      table {
        min-width: 700px;
      }
      
      th, td {
        padding: 14px 16px;
        font-size: 0.9em;
      }
      
      .tab-content {
        padding: 22px;
      }
      
      .content-card {
        padding: 22px;
      }
      
      .content-card h2 {
        font-size: 1.4em;
        margin-bottom: 20px;
      }
      
      .footer-info {
        flex-direction: column;
        gap: 12px;
      }
    }
    
    @media (max-width: 480px) {
      .container {
        padding: 15px 12px;
      }
      
      .admin-header {
        padding: 20px;
      }
      
      h1 {
        font-size: 1.4em;
      }
      
      .header-icon {
        font-size: 1.8em;
      }
      
      .header-time {
        font-size: 0.8em;
        padding: 6px 12px;
      }
      
      .content-card {
        padding: 20px;
      }
      
      .content-card h2 {
        font-size: 1.3em;
      }
      
      .tab-content {
        padding: 20px;
      }
      
      .form-actions {
        margin-top: 30px;
        padding-top: 20px;
      }
      
      .message {
        padding: 16px;
        font-size: 0.9em;
      }
      
      th, td {
        padding: 12px 14px;
        font-size: 0.85em;
      }
      
      .status-badge {
        padding: 6px 12px;
        font-size: 0.75em;
      }
    }
    
    @media (max-width: 360px) {
      .admin-header {
        padding: 18px;
      }
      
      h1 {
        font-size: 1.3em;
      }
      
      .btn {
        font-size: 13px;
        padding: 12px 16px;
      }
      
      .tab-content {
        padding: 18px;
      }
      
      .content-card {
        padding: 18px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header class="admin-header">
      <div class="header-title">
        <div class="header-icon">⚙️</div>
        <div>
          <h1>订阅后端管理面板</h1>
          <div class="header-time">北京时间: ${beijingTime}</div>
        </div>
      </div>
      <div class="header-actions">
        <a href="/" class="btn btn-primary">📊 状态页面</a>
        <button onclick="showTab('password')" class="btn btn-secondary">🔑 修改密码</button>
        <a href="/admin/logout" class="btn btn-logout">🚪 退出登录</a>
      </div>
    </header>
    
    ${message ? '<div class="message ' + (message.type === 'success' ? 'success' : message.type === 'warning' ? 'warning' : 'error') + '">' + message.text + '</div>' : ''}
    
    <div class="tabs-container">
      <div class="tabs">
        <button class="tab active" onclick="showTab('backends')">📋 后端管理</button>
        <button class="tab" onclick="showTab('add')">➕ 添加后端</button>
        <button class="tab" onclick="showTab('password')">🔐 密码设置</button>
      </div>
      
      <!-- 后端列表 -->
      <div id="tab-backends" class="tab-content active">
        <div class="content-card">
          <h2>后端地址列表</h2>
          ${backends.length > 0 ? `
            <div class="table-container">
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
                    <th>重置次数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  ${backends.map(backend => {
                    const successRate = backend.total_requests > 0 
                      ? ((backend.success_requests / backend.total_requests) * 100).toFixed(1)
                      : 0;
                    return '<tr>' +
                      '<td><strong>#' + backend.id + '</strong></td>' +
                      '<td><strong>' + backend.name + '</strong></td>' +
                      '<td style="max-width: 180px; word-break: break-all; font-size: 0.85em;">' + backend.url + '</td>' +
                      '<td><span class="status-badge ' + (backend.enabled ? 'status-active' : 'status-inactive') + '">' + (backend.enabled ? '启用' : '禁用') + '</span></td>' +
                      '<td>' + backend.weight + '</td>' +
                      '<td>' + backend.total_requests + '</td>' +
                      '<td><span style="font-weight: 600; color: ' + (successRate >= 90 ? '#38a169' : successRate >= 70 ? '#d69e2e' : '#e53e3e') + '">' + successRate + '%</span></td>' +
                      '<td><span style="font-weight: 600; color: ' + (backend.reset_count > 0 ? '#ed8936' : '#718096') + '">' + (backend.reset_count || 0) + '</span></td>' +
                      '<td class="actions-cell">' +
                      '<button onclick="editBackend(' + backend.id + ')" class="action-btn action-edit">✏️ 编辑</button>' +
                      '<button onclick="toggleBackend(' + backend.id + ', ' + (backend.enabled ? 0 : 1) + ')" class="action-btn action-toggle">' +
                      (backend.enabled ? '⛔ 禁用' : '✅ 启用') +
                      '</button>' +
                      '<button onclick="resetBackend(' + backend.id + ')" class="action-btn action-reset">🔄 重置</button>' +
                      '<button onclick="deleteBackend(' + backend.id + ')" class="action-btn action-delete">🗑️ 删除</button>' +
                      '</td>' +
                    '</tr>';
                  }).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="empty-state">
              <div class="empty-icon">📭</div>
              <h3 style="margin-bottom: 15px; color: #4a5568;">还没有后端地址</h3>
              <p style="margin-bottom: 10px;">点击上方的"添加后端"标签来添加第一个后端地址。</p>
              <p style="font-size: 0.9em; opacity: 0.7;">添加后端的名称、URL地址、权重和最大失败次数</p>
            </div>
          `}
        </div>
      </div>
      
      <!-- 添加后端 -->
      <div id="tab-add" class="tab-content">
        <div class="content-card">
          <h2>添加后端地址</h2>
          <form method="POST" action="/admin/action" onsubmit="return validateBackendForm()">
            <input type="hidden" name="action" value="add">
            <div class="form-row">
              <div class="form-group">
                <label for="name">名称 *</label>
                <input type="text" id="name" name="name" required placeholder="例如: 美国节点1">
                <small style="color: #718096; display: block; margin-top: 5px;">后端的显示名称</small>
              </div>
              <div class="form-group">
                <label for="url">订阅地址 *</label>
                <input type="url" id="url" name="url" required placeholder="https://example.com/subscribe">
                <small style="color: #718096; display: block; margin-top: 5px;">后端订阅服务的完整URL</small>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="weight">权重 (1-1000)</label>
                <input type="number" id="weight" name="weight" value="100" min="1" max="1000">
                <small style="color: #718096; display: block; margin-top: 5px;">权重越高，被选中的概率越大</small>
              </div>
              <div class="form-group">
                <label for="max_failures">最大失败次数</label>
                <input type="number" id="max_failures" name="max_failures" value="3" min="1" max="10">
                <small style="color: #718096; display: block; margin-top: 5px;">连续失败达到此次数后自动禁用</small>
              </div>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">✅ 添加后端</button>
              <button type="reset" class="btn btn-logout">🔄 重置</button>
            </div>
          </form>
        </div>
      </div>
      
      <!-- 编辑后端 -->
      <div id="tab-edit" class="tab-content">
        <div class="content-card">
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
              <button type="submit" class="btn btn-primary">💾 保存修改</button>
              <button type="button" onclick="showTab('backends')" class="btn btn-logout">↩️ 取消</button>
            </div>
          </form>
        </div>
      </div>
      
      <!-- 修改密码 -->
      <div id="tab-password" class="tab-content">
        <div class="content-card">
          <h2>修改管理员密码</h2>
          <form method="POST" action="/admin/action" onsubmit="return validatePasswordForm()">
            <input type="hidden" name="action" value="change-password">
            <div class="form-group">
              <label for="current-password">当前密码</label>
              <input type="password" id="current-password" name="current_password" required>
              <small style="color: #718096; display: block; margin-top: 5px;">请输入当前的管理员密码</small>
            </div>
            <div class="form-group">
              <label for="new-password">新密码</label>
              <input type="password" id="new-password" name="new_password" required minlength="6">
              <small style="color: #718096; display: block; margin-top: 5px;">密码长度至少6位</small>
            </div>
            <div class="form-group">
              <label for="confirm-password">确认新密码</label>
              <input type="password" id="confirm-password" name="confirm_password" required minlength="6">
              <small style="color: #718096; display: block; margin-top: 5px;">再次输入新密码以确认</small>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-primary">🔐 修改密码</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    
    <footer>
      <p>© ${new Date().getFullYear()} 订阅后端管理器 | 管理面板 | 版本 2.0.0</p>
      <div class="footer-info">
        <span>后端总数: ${backends.length}</span>
        <span>启用后端: ${backends.filter(b => b.enabled).length}</span>
        <span>系统时间: ${beijingTime}</span>
      </div>
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
      const tabContent = document.getElementById('tab-' + tabName);
      if (tabContent) {
        tabContent.classList.add('active');
      }
      
      // 激活对应的标签按钮
      const tabButtons = document.querySelectorAll('.tab');
      tabButtons.forEach(tab => {
        if (tab.textContent.includes(tabName === 'backends' ? '后端管理' : 
                                     tabName === 'add' ? '添加后端' : 
                                     tabName === 'password' ? '密码设置' : '')) {
          tab.classList.add('active');
        }
      });
    }
    
    async function editBackend(id) {
      try {
        const response = await fetch('/admin/backend?id=' + id);
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
      } catch (error) {
        alert('获取后端信息失败: ' + error.message);
      }
    }
    
    async function toggleBackend(id, enabled) {
      if (confirm('确定要' + (enabled ? '启用' : '禁用') + '这个后端吗？')) {
        const formData = new FormData();
        formData.append('action', 'toggle');
        formData.append('id', id);
        formData.append('enabled', enabled);
        
        try {
          const response = await fetch('/admin/api/action', {
            method: 'POST',
            body: formData
          });
          
          const result = await response.json();
          if (result.success) {
            alert(result.message);
            location.reload();
          } else {
            alert('操作失败: ' + result.message);
          }
        } catch (error) {
          alert('操作失败: ' + error.message);
        }
      }
    }
    
    async function resetBackend(id) {
      if (confirm('确定要重置这个后端的统计数据吗？\\n\\n这将重置请求计数、成功率和响应时间统计。')) {
        const formData = new FormData();
        formData.append('action', 'reset-statistics');
        formData.append('id', id);
        
        try {
          const response = await fetch('/admin/api/action', {
            method: 'POST',
            body: formData
          });
          
          const result = await response.json();
          if (result.success) {
            alert(result.message);
            location.reload();
          } else {
            alert('操作失败: ' + result.message);
          }
        } catch (error) {
          alert('操作失败: ' + error.message);
        }
      }
    }
    
    async function deleteBackend(id) {
      if (confirm('确定要删除这个后端吗？\\n\\n⚠️ 此操作不可撤销！\\n删除后将无法恢复此后端的所有统计数据。')) {
        const formData = new FormData();
        formData.append('action', 'delete');
        formData.append('id', id);
        
        try {
          const response = await fetch('/admin/api/action', {
            method: 'POST',
            body: formData
          });
          
          const result = await response.json();
          if (result.success) {
            alert(result.message);
            location.reload();
          } else {
            alert('操作失败: ' + result.message);
          }
        } catch (error) {
          alert('操作失败: ' + error.message);
        }
      }
    }
    
    function validateBackendForm() {
      const name = document.getElementById('name').value.trim();
      const url = document.getElementById('url').value.trim();
      
      if (!name) {
        alert('请输入后端名称！');
        return false;
      }
      
      if (!url) {
        alert('请输入订阅地址！');
        return false;
      }
      
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
    document.addEventListener('DOMContentLoaded', function() {
      const urlParams = new URLSearchParams(window.location.search);
      const message = urlParams.get('message');
      const messageType = urlParams.get('type');
      
      if (message) {
        // 显示消息提示
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ' + (messageType || 'success');
        messageDiv.textContent = decodeURIComponent(message);
        
        const container = document.querySelector('.container');
        const header = document.querySelector('.admin-header');
        container.insertBefore(messageDiv, header.nextSibling);
        
        // 清除URL参数
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
      }
      
      // 添加表单验证提示
      const forms = document.querySelectorAll('form');
      forms.forEach(form => {
        form.addEventListener('submit', function(e) {
          const requiredInputs = this.querySelectorAll('input[required]');
          let isValid = true;
          
          requiredInputs.forEach(input => {
            if (!input.value.trim()) {
              isValid = false;
              input.style.borderColor = '#f56565';
              input.style.boxShadow = '0 0 0 4px rgba(245, 101, 101, 0.1)';
              
              setTimeout(() => {
                input.style.borderColor = '';
                input.style.boxShadow = '';
              }, 3000);
            }
          });
          
          if (!isValid) {
            e.preventDefault();
            alert('请填写所有必填字段！');
          }
        });
      });
    });
  </script>
</body>
</html>`;
  }
};

// 主Worker类
class SubscriptionManager {
  constructor() {
    this.dbManager = null;
    this.loadBalancer = null;
  }
  
  async handleRequest(request, env) {
    try {
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
          // 处理表单提交（重定向）
          return await this.handleAdminFormAction(request, env);
        case '/admin/api/action':
          // 处理AJAX请求（返回JSON）
          return await this.handleAdminApiAction(request, env);
        case '/admin/backend':
          return await this.handleGetBackend(request, env);
        default:
          // 其他路径作为订阅请求处理
          return await this.handleSubscriptionRequest(request, env);
      }
    } catch (error) {
      console.error('请求处理失败:', error);
      return new Response(`服务器错误: ${error.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' }
      });
    }
  }
  
  async handleStatusPage(request, env) {
    try {
      // 检查数据库是否已初始化
      const needsInit = !(await this.dbManager.checkTablesExist());
      
      // 如果不是初始化状态，检查并恢复禁用超过30分钟的后端
      let recoveredCount = 0;
      if (!needsInit) {
        recoveredCount = await this.dbManager.autoRecoverDisabledBackends(30);
      }
      
      const backends = needsInit ? [] : await this.dbManager.getBackends();
      const lastRequest = needsInit ? null : await this.dbManager.getLastRequest();
      
      // 检查URL参数中的消息
      const url = new URL(request.url);
      const message = url.searchParams.get('message');
      const type = url.searchParams.get('type');
      
      const messageObj = message ? { text: decodeURIComponent(message), type: type || 'success' } : null;
      
      return new Response(HTML.statusPage(backends, this.loadBalancer, messageObj, needsInit, lastRequest, recoveredCount), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    } catch (error) {
      console.error('状态页面错误:', error);
      return new Response(HTML.statusPage([], this.loadBalancer, { text: '加载失败: ' + error.message, type: 'error' }, true, null, 0), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' }
      });
    }
  }
  
  async handleInitDatabase(request, env) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ success: false, message: '方法不允许' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    try {
      // 清除现有数据
      await this.dbManager.clearAllData();
      
      // 初始化数据库表
      const result = await this.dbManager.initTables();
      
      return new Response(JSON.stringify(result), {
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (error) {
      console.error('初始化数据库失败:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        message: '数据库初始化失败: ' + (error.message || '未知错误') 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
  
  async handleAdminPage(request, env) {
    // 检查数据库是否已初始化
    const needsInit = !(await this.dbManager.checkTablesExist());
    if (needsInit) {
      return Response.redirect(new URL('/?message=请先初始化数据库&type=warning', request.url));
    }
    
    // 检查登录状态
    const sessionId = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
    const session = sessionId ? await this.dbManager.validateSession(sessionId) : null;
    
    if (!session?.loggedIn) {
      return Response.redirect(new URL('/admin/login', request.url));
    }
    
    const backends = await this.dbManager.getBackends();
    const beijingTime = utils.formatBeijingTime(Date.now());
    
    // 检查URL参数中的消息
    const url = new URL(request.url);
    const message = url.searchParams.get('message');
    const type = url.searchParams.get('type');
    
    const messageObj = message ? { text: decodeURIComponent(message), type: type || 'success' } : null;
    
    return new Response(HTML.adminPage(backends, messageObj, beijingTime), {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' }
    });
  }
  
  async handleAdminLogin(request, env) {
    // 检查数据库是否已初始化
    const needsInit = !(await this.dbManager.checkTablesExist());
    if (needsInit) {
      return Response.redirect(new URL('/?message=请先初始化数据库&type=warning', request.url));
    }
    
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
        
        if (!sessionId) {
          return new Response(HTML.loginPage('登录失败，请重试'), {
            headers: { 'Content-Type': 'text/html;charset=UTF-8' }
          });
        }
        
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
  
  async handleAdminFormAction(request, env) {
    // 检查数据库是否已初始化
    const needsInit = !(await this.dbManager.checkTablesExist());
    if (needsInit) {
      return Response.redirect(new URL('/?message=请先初始化数据库&type=warning', request.url));
    }
    
    // 检查登录状态
    const sessionId = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
    const session = sessionId ? await this.dbManager.validateSession(sessionId) : null;
    
    if (!session?.loggedIn) {
      return Response.redirect(new URL('/admin/login', request.url));
    }
    
    if (request.method !== 'POST') {
      return Response.redirect(new URL('/admin?message=方法不允许&type=error', request.url));
    }
    
    try {
      const formData = await request.formData();
      const action = formData.get('action');
      
      let success = false;
      let message = '';
      
      switch (action) {
        case 'add': {
          const newBackend = {
            name: formData.get('name'),
            url: formData.get('url'),
            weight: parseInt(formData.get('weight')) || 100,
            max_failures: parseInt(formData.get('max_failures')) || 3
          };
          
          success = await this.dbManager.addBackend(newBackend);
          message = success ? '添加成功' : '添加失败';
          break;
        }
          
        case 'update': {
          const id = parseInt(formData.get('id'));
          const updates = {};
          
          if (formData.has('name')) updates.name = formData.get('name');
          if (formData.has('url')) updates.url = formData.get('url');
          if (formData.has('weight')) updates.weight = parseInt(formData.get('weight'));
          if (formData.has('enabled')) updates.enabled = parseInt(formData.get('enabled'));
          if (formData.has('max_failures')) updates.max_failures = parseInt(formData.get('max_failures'));
          
          success = await this.dbManager.updateBackend(id, updates);
          message = success ? '更新成功' : '更新失败';
          break;
        }
          
        case 'change-password': {
          const currentPassword = formData.get('current_password');
          const newPassword = formData.get('new_password');
          const confirmPassword = formData.get('confirm_password');
          
          if (newPassword !== confirmPassword) {
            return Response.redirect(new URL('/admin?message=' + encodeURIComponent('两次输入的密码不一致') + '&type=error', request.url));
          }
          
          if (!await this.dbManager.verifyAdminPassword(currentPassword)) {
            return Response.redirect(new URL('/admin?message=' + encodeURIComponent('当前密码错误') + '&type=error', request.url));
          }
          
          success = await this.dbManager.updateAdminPassword(newPassword);
          message = success ? '密码修改成功' : '密码修改失败';
          break;
        }
          
        default:
          message = '未知操作';
      }
      
      const type = success ? 'success' : 'error';
      return Response.redirect(new URL(`/admin?message=${encodeURIComponent(message)}&type=${type}`, request.url));
      
    } catch (error) {
      console.error('管理操作错误:', error);
      return Response.redirect(new URL(`/admin?message=${encodeURIComponent('操作失败: ' + error.message)}&type=error`, request.url));
    }
  }
  
  async handleAdminApiAction(request, env) {
    // 检查数据库是否已初始化
    const needsInit = !(await this.dbManager.checkTablesExist());
    if (needsInit) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '数据库未初始化，请先初始化数据库' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // 检查登录状态
    const sessionId = request.headers.get('Cookie')?.match(/session=([^;]+)/)?.[1];
    const session = sessionId ? await this.dbManager.validateSession(sessionId) : null;
    
    if (!session?.loggedIn) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '未登录或会话已过期' 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ 
        success: false, 
        message: '方法不允许' 
      }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    try {
      const formData = await request.formData();
      const action = formData.get('action');
      
      let success = false;
      let message = '';
      
      switch (action) {
        case 'toggle': {
          const toggleId = parseInt(formData.get('id'));
          const enabled = parseInt(formData.get('enabled'));
          success = await this.dbManager.updateBackend(toggleId, { enabled });
          message = success ? '状态更新成功' : '状态更新失败';
          break;
        }
          
        case 'reset-statistics': {
          const resetId = parseInt(formData.get('id'));
          success = await this.dbManager.resetBackendStatistics(resetId);
          message = success ? '统计重置成功' : '统计重置失败';
          break;
        }
          
        case 'delete': {
          const deleteId = parseInt(formData.get('id'));
          success = await this.dbManager.deleteBackend(deleteId);
          message = success ? '删除成功' : '删除失败';
          break;
        }
          
        default:
          message = '未知操作';
      }
      
      return new Response(JSON.stringify({ 
        success, 
        message 
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('管理API操作错误:', error);
      return new Response(JSON.stringify({ 
        success: false, 
        message: '操作失败: ' + error.message 
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
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
  
  async handleSubscriptionRequest(request, env) {
    try {
      // 检查数据库是否已初始化
      const needsInit = !(await this.dbManager.checkTablesExist());
      if (needsInit) {
        return new Response(JSON.stringify({
          error: '系统未初始化',
          message: '请访问首页初始化数据库',
          timestamp: utils.formatBeijingTime(Date.now())
        }), {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'X-Backend-Error': 'System not initialized'
          }
        });
      }
      
      // 自动恢复禁用超过30分钟的后端
      await this.dbManager.autoRecoverDisabledBackends(30);
      
      // 使用负载均衡器选择后端并转发请求
      const response = await this.loadBalancer.tryAllBackends(request);
      
      // 克隆响应以添加自定义头部
      const newResponse = new Response(response.body, response);
      newResponse.headers.set('X-Backend-Manager', 'Cloudflare-Worker');
      newResponse.headers.set('X-Load-Balancer', 'Weighted-Round-Robin');
      newResponse.headers.set('X-Server-Time', utils.formatBeijingTime(Date.now()));
      
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