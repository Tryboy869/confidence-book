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
    if (level === 'ERROR' || level === 'SECURITY') console.error(`[${level}] [${type}]`, JSON.stringify(data));
  }
  info(t, d) { this.log('INFO', t, d); }
  warn(t, d) { this.log('WARN', t, d); }
  error(t, d) { this.log('ERROR', t, d); }
  security(t, d) { this.log('SECURITY', t, d); }
  checkRateLimit(id, limit = 100, windowMs = 900000) {
    const now = Date.now();
    if (!this.rateLimits.has(id)) this.rateLimits.set(id, []);
    const reqs = this.rateLimits.get(id).filter(t => now - t < windowMs);
    if (reqs.length >= limit) return false;
    reqs.push(now); this.rateLimits.set(id, reqs); return true;
  }
  detectSQLInjection(s) { return /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|EXEC|UNION)\b|--|#|\/\*)/i.test(s); }
  detectXSS(s) { return /<script|javascript:|on\w+\s*=|<iframe/gi.test(s); }
  validateRequest(req) {
    const ip = req.ip || req.connection.remoteAddress;
    if (this.blockedIPs.has(ip)) return { valid: false, reason: 'IP blocked' };
    if (!this.checkRateLimit(ip)) return { valid: false, reason: 'Rate limit exceeded' };
    if (req.body) {
      const check = (obj) => {
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') {
            if (this.detectSQLInjection(v)) { this.security('SQL_INJECTION', { ip, k }); return false; }
            if (this.detectXSS(v)) { this.security('XSS', { ip, k }); return false; }
          } else if (typeof v === 'object' && v !== null && !check(v)) return false;
        }
        return true;
      };
      if (!check(req.body)) return { valid: false, reason: 'Malicious content' };
    }
    return { valid: true };
  }
  blockIP(ip, reason) {
    this.blockedIPs.add(ip); this.security('IP_BLOCKED', { ip, reason });
    setTimeout(() => this.blockedIPs.delete(ip), 86400000);
  }
  getRecentLogs(limit = 200) { return this.logs.slice(-limit).reverse(); }
  getStats() {
    const r = this.logs.filter(l => new Date(l.timestamp) > Date.now() - 86400000);
    return { total: r.length, errors: r.filter(l => l.level === 'ERROR').length, security: r.filter(l => l.level === 'SECURITY').length, blockedIPs: Array.from(this.blockedIPs) };
  }
}

const logger = new SecurityLogger();

app.use((req, res, next) => {
  const v = logger.validateRequest(req);
  if (!v.valid) return res.status(403).json({ success: false, message: 'Request blocked' });
  next();
});

let backend;
async function initBackend() {
  backend = new BackendService();
  await backend.init();
  console.log('✅ Backend ready');
  setInterval(() => backend.cleanExpiredConfidences(), 86400000);
}

const h = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

function adminAuth(req, res, next) {
  if (req.headers['x-admin-key'] !== process.env.ADMIN_KEY) {
    logger.security('UNAUTHORIZED_ADMIN', { ip: req.ip });
    return res.status(403).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

// Static
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'welcome.html')));

// Auth
app.post('/api/auth/create', h(req => backend.createUser(req.body.secretPhrase)));
app.post('/api/auth/verify', h(req => backend.verifyUser(req.body.input)));

// Weekly prompt
app.get('/api/prompt', (req, res) => res.json(backend.getWeeklyPromptPublic()));

// Subscriptions
app.get('/api/subscriptions', h(req => backend.getSubscriptions(req.headers)));
app.post('/api/subscriptions/toggle', h(req => backend.toggleSubscription(req.body, req.headers)));

// Notifications
app.get('/api/notifications', h(req => backend.getNotifications(req.headers)));
app.post('/api/notifications/read', h(req => backend.markNotificationsRead(req.headers)));

// Confidences
app.get('/api/confidences', h(req => backend.getConfidences(req.query.chapter, req.headers['x-user-id'], parseInt(req.query.page) || 1, parseInt(req.query.pageSize) || 20)));
app.get('/api/confidences/:id', h(req => backend.getConfidence(req.params.id, req.headers['x-user-id'])));
app.post('/api/confidences', h(req => backend.createConfidence(req.body, req.headers)));
app.put('/api/confidences/:id', h(req => backend.updateConfidence(req.params.id, req.body, req.headers)));
app.delete('/api/confidences/:id', h(req => backend.deleteConfidence(req.params.id, req.headers)));

// Reactions & Responses
app.post('/api/reactions', h(req => backend.toggleReaction(req.body, req.headers)));
app.post('/api/response-reactions', h(req => backend.toggleResponseReaction(req.body, req.headers)));
app.post('/api/responses', h(req => backend.createResponse(req.body, req.headers)));

// Profile & Settings
app.get('/api/profile', h(req => backend.getProfile(req.headers)));
app.put('/api/settings', h(req => backend.updateSettings(req.body, req.headers)));
app.delete('/api/account', h(req => backend.deleteAccount(req.headers)));

// Journal (Premium)
app.get('/api/journal', h(req => backend.getJournalEntries(req.headers)));
app.post('/api/journal', h(req => backend.createJournalEntry(req.body, req.headers)));

// Admin
app.get('/api/admin/stats', adminAuth, h(req => backend.getAdminStats()));
app.get('/api/admin/users', adminAuth, h(req => backend.getPremiumRequests()));
app.post('/api/admin/premium/activate', adminAuth, h(req => backend.activatePremium(req.body.userId, req.body.type, req.headers)));
app.post('/api/admin/premium/deactivate', adminAuth, h(req => backend.deactivatePremium(req.body.userId, req.headers)));
app.get('/api/admin/logs', adminAuth, (req, res) => res.json({ success: true, logs: logger.getRecentLogs() }));
app.post('/api/admin/block-ip', adminAuth, (req, res) => { logger.blockIP(req.body.ip, req.body.reason); res.json({ success: true }); });

// Health
app.get('/api/health', h(req => backend.healthCheck()));

// Errors
app.use((err, req, res, next) => { logger.error('UNHANDLED', { error: err.message }); res.status(500).json({ success: false, message: 'Internal server error' }); });
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

initBackend().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
=============================================================
  CONFIDENCE BOOK API — port ${PORT}
  Routes: auth, confidences, reactions, responses,
          subscriptions, notifications, journal, admin
=============================================================`);
  });
}).catch(err => { console.error('Fatal:', err); process.exit(1); });

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
