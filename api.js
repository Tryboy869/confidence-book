import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { BackendService } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ─── Security Logger (in-memory, Render compatible) ──────────────────────────
class SecurityLogger {
  constructor() {
    this.logs = [];
    this.maxLogs = 1000;
    this.rateLimits = new Map();
    this.blockedIPs = new Set();
  }

  log(level, type, data) {
    const entry = { timestamp: new Date().toISOString(), level, type, ...data };
    this.logs.push(entry);
    if (this.logs.length > this.maxLogs) this.logs.shift();
    if (level === 'ERROR' || level === 'SECURITY') {
      console.error(`[${level}] [${type}]`, JSON.stringify(data));
    } else if (level !== 'INFO') {
      console.log(`[${level}] [${type}]`, JSON.stringify(data));
    }
  }

  info(type, data) { this.log('INFO', type, data); }
  warn(type, data) { this.log('WARN', type, data); }
  error(type, data) { this.log('ERROR', type, data); }
  security(type, data) { this.log('SECURITY', type, data); }

  checkRateLimit(identifier, limit = 100, windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    if (!this.rateLimits.has(identifier)) this.rateLimits.set(identifier, []);
    const requests = this.rateLimits.get(identifier).filter(t => now - t < windowMs);
    if (requests.length >= limit) {
      this.security('RATE_LIMIT', { identifier, requests: requests.length, limit });
      return false;
    }
    requests.push(now);
    this.rateLimits.set(identifier, requests);
    return true;
  }

  detectSQLInjection(input) {
    return /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|EXEC|UNION)\b|--|#|\/\*)/i.test(input);
  }

  detectXSS(input) {
    return /<script|javascript:|on\w+\s*=|<iframe/gi.test(input);
  }

  validateRequest(req) {
    const ip = req.ip || req.connection.remoteAddress;
    if (this.blockedIPs.has(ip)) return { valid: false, reason: 'IP blocked' };
    if (!this.checkRateLimit(ip)) return { valid: false, reason: 'Rate limit exceeded' };

    if (req.body) {
      const body = JSON.stringify(req.body);
      if (body.length > 10 * 1024 * 1024) return { valid: false, reason: 'Payload too large' };
      const check = (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') {
            if (this.detectSQLInjection(v)) { this.security('SQL_INJECTION', { ip, field: k }); return false; }
            if (this.detectXSS(v)) { this.security('XSS_ATTEMPT', { ip, field: k }); return false; }
          } else if (typeof v === 'object' && v !== null) {
            if (!check(v)) return false;
          }
        }
        return true;
      };
      if (!check(req.body)) return { valid: false, reason: 'Malicious content' };
    }
    return { valid: true };
  }

  blockIP(ip, reason) {
    this.blockedIPs.add(ip);
    this.security('IP_BLOCKED', { ip, reason });
    setTimeout(() => this.blockedIPs.delete(ip), 24 * 60 * 60 * 1000);
  }

  getStats() {
    const last24h = Date.now() - 86400000;
    const recent = this.logs.filter(l => new Date(l.timestamp) > last24h);
    return {
      total: recent.length,
      byLevel: { INFO: recent.filter(l => l.level === 'INFO').length, WARN: recent.filter(l => l.level === 'WARN').length, ERROR: recent.filter(l => l.level === 'ERROR').length, SECURITY: recent.filter(l => l.level === 'SECURITY').length },
      blockedIPs: Array.from(this.blockedIPs)
    };
  }

  getRecentLogs(limit = 200) { return this.logs.slice(-limit).reverse(); }
}

const logger = new SecurityLogger();

// Middleware sécurité
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userId = req.headers['x-user-id'] || 'anonymous';
  const validation = logger.validateRequest(req);

  if (!validation.valid) {
    logger.security('REQUEST_BLOCKED', { ip, userId, method: req.method, path: req.path, reason: validation.reason });
    return res.status(403).json({ success: false, message: 'Request blocked' });
  }
  next();
});

let backend;

async function initBackend() {
  try {
    backend = new BackendService();
    await backend.init();
    console.log('✅ Backend ready');
    setInterval(() => backend.cleanExpiredConfidences(), 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('❌ Backend init failed:', err);
    throw err;
  }
}

// ─── Routes statiques ────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'welcome.html')));

// ─── Auth ────────────────────────────────────────────────────────────────────
app.post('/api/auth/create', async (req, res) => {
  try { res.json(await backend.createUser(req.body.secretPhrase)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/auth/verify', async (req, res) => {
  try { res.json(await backend.verifyUser(req.body.input)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── Confidences ─────────────────────────────────────────────────────────────
app.get('/api/confidences', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    res.json(await backend.getConfidences(req.query.chapter, req.headers['x-user-id'], page, pageSize));
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/confidences/:id', async (req, res) => {
  try { res.json(await backend.getConfidence(req.params.id, req.headers['x-user-id'])); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/confidences', async (req, res) => {
  try { res.json(await backend.createConfidence(req.body, req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/confidences/:id', async (req, res) => {
  try { res.json(await backend.updateConfidence(req.params.id, req.body, req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/confidences/:id', async (req, res) => {
  try { res.json(await backend.deleteConfidence(req.params.id, req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── Reactions & Responses ───────────────────────────────────────────────────
app.post('/api/reactions', async (req, res) => {
  try { res.json(await backend.toggleReaction(req.body, req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/response-reactions', async (req, res) => {
  try { res.json(await backend.toggleResponseReaction(req.body, req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/responses', async (req, res) => {
  try { res.json(await backend.createResponse(req.body, req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── Profile & Settings ──────────────────────────────────────────────────────
app.get('/api/profile', async (req, res) => {
  try { res.json(await backend.getProfile(req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.put('/api/settings', async (req, res) => {
  try { res.json(await backend.updateSettings(req.body, req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/account', async (req, res) => {
  try { res.json(await backend.deleteAccount(req.headers)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ─── Admin ───────────────────────────────────────────────────────────────────
function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    logger.security('UNAUTHORIZED_ADMIN', { ip: req.ip, path: req.path });
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try { res.json(await backend.getAdminStats()); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/users', adminAuth, async (req, res) => {
  try { res.json(await backend.getPremiumRequests()); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Activer le premium manuellement depuis le dashboard admin
app.post('/api/admin/premium/activate', adminAuth, async (req, res) => {
  try {
    const { userId, type } = req.body; // type: 'monthly' | 'yearly'
    if (!userId || !type) return res.status(400).json({ success: false, message: 'userId and type required' });
    res.json(await backend.activatePremium(userId, type, req.headers));
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/admin/premium/deactivate', adminAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId required' });
    res.json(await backend.deactivatePremium(userId, req.headers));
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/admin/logs', adminAuth, (req, res) => {
  res.json({ success: true, logs: logger.getRecentLogs(200) });
});

app.post('/api/admin/block-ip', adminAuth, (req, res) => {
  const { ip, reason } = req.body;
  logger.blockIP(ip, reason);
  res.json({ success: true, message: `IP ${ip} blocked` });
});

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try { res.json(await backend.healthCheck()); }
  catch (e) { res.status(500).json({ success: false, status: 'unhealthy' }); }
});

// ─── Error handlers ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('UNHANDLED_ERROR', { error: err.message, path: req.path });
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

async function startServer() {
  await initBackend();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
=============================================================
  CONFIDENCE BOOK API — port ${PORT}
  Logs : console (Render compatible)
  Admin : POST /api/admin/premium/activate
=============================================================`);
  });
}

process.on('SIGTERM', () => { console.log('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { console.log('SIGINT received'); process.exit(0); });

startServer();
