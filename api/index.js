import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ─── Validation des variables d'env critiques ──────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'DATABASE_AUTH_TOKEN'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ FATAL: Missing required env variable: ${key}`);
  }
}

const GROQ_MODELS = [
  'llama-3.1-8b-instant',
  'llama3-groq-8b-8192-tool-use-preview',
  'gemma2-9b-it',
  'llama-3.3-70b-versatile',
  'llama3-8b-8192'
];

const AVATARS = ['moon', 'sun', 'leaf', 'flower', 'butterfly', 'wave', 'sparkles', 'star'];

const LIMITS = {
  FREE_MAX_CONFIDENCES: 20,
  POST_PER_WEEK: 3,
  COMMENTS_PER_WEEK: 9,
  CONFIDENCE_EXPIRY_DAYS: 90,
  PREMIUM_EXPIRY_DAYS: 36500,
  SECRET_PHRASE_MIN: 6,
  SECRET_PHRASE_MAX: 200,
  CONTENT_MIN: 10,
  CONTENT_MAX: 5000,
};

const WEEKLY_PROMPTS = [
  { fr: "Qu'est-ce qui t'a surpris cette semaine, en bien ou en mal ?", en: "What surprised you this week, good or bad?" },
  { fr: "Y a-t-il quelque chose que tu portes seul·e depuis trop longtemps ?", en: "Is there something you've been carrying alone for too long?" },
  { fr: "Quel moment de cette semaine t'a demandé le plus de courage ?", en: "What moment this week required the most courage from you?" },
  { fr: "Si tu pouvais changer une chose dans ta vie aujourd'hui, ce serait quoi ?", en: "If you could change one thing in your life today, what would it be?" },
  { fr: "Qu'est-ce qui te pèse en ce moment que tu n'as jamais dit à voix haute ?", en: "What's weighing on you right now that you've never said out loud?" },
  { fr: "Comment tu vas, vraiment ?", en: "How are you, really?" },
  { fr: "Qu'est-ce que tu aurais voulu entendre de quelqu'un cette semaine ?", en: "What would you have wanted to hear from someone this week?" },
  { fr: "Y a-t-il une douleur ancienne qui refait surface en ce moment ?", en: "Is there an old pain resurfacing right now?" },
  { fr: "Qu'est-ce qui t'empêche de te sentir en paix aujourd'hui ?", en: "What's preventing you from feeling at peace today?" },
  { fr: "Si tu écrivais une lettre à toi-même dans 1 an, que dirais-tu ?", en: "If you wrote a letter to yourself in 1 year, what would you say?" },
  { fr: "Qu'est-ce que tu as appris sur toi-même récemment ?", en: "What have you learned about yourself recently?" },
  { fr: "Quelle est la chose dont tu es le plus fier·ère cette semaine, même petite ?", en: "What are you most proud of this week, even something small?" }
];

// ─── Rate limiting en mémoire (par fonction serverless) ───────────────────
const rateLimits = new Map();
function checkRateLimit(id, limit = 100, windowMs = 900000) {
  const now = Date.now();
  if (!rateLimits.has(id)) rateLimits.set(id, []);
  const reqs = rateLimits.get(id).filter(t => now - t < windowMs);
  if (reqs.length >= limit) return false;
  reqs.push(now);
  rateLimits.set(id, reqs);
  return true;
}
function detectSQLInjection(s) { return /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|EXEC|UNION)\b|--|#|\/\*)/i.test(s); }
function detectXSS(s) { return /<script|javascript:|on\w+\s*=|<iframe/gi.test(s); }

// ─── Instance DB (réutilisée entre invocations dans la même instance) ──────
let dbInstance = null;
function getDb() {
  if (!dbInstance) {
    dbInstance = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN
    });
  }
  return dbInstance;
}

// ─── Migration (idempotente) ───────────────────────────────────────────────
let migrated = false;
async function ensureMigrated() {
  if (migrated) return;
  const db = getDb();
  await db.execute(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    secret_phrase_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_active INTEGER,
    premium INTEGER DEFAULT 0,
    premium_type TEXT,
    premium_start INTEGER,
    premium_end INTEGER,
    premium_payment_id TEXT,
    settings TEXT DEFAULT '{"theme":"dark","avatar":"moon","language":"en"}'
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS confidences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    emotion TEXT NOT NULL,
    moderation_score REAL,
    moderation_message TEXT,
    needs_review INTEGER DEFAULT 0,
    edit_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  try { await db.execute(`ALTER TABLE confidences ADD COLUMN edit_count INTEGER DEFAULT 0`); } catch {}
  await db.execute(`CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    confidence_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(confidence_id, user_id),
    FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS responses (
    id TEXT PRIMARY KEY,
    confidence_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    avatar TEXT NOT NULL,
    moderation_score REAL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS response_reactions (
    id TEXT PRIMARY KEY,
    response_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(response_id, user_id),
    FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    mood TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    emotion TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, emotion),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await db.execute(`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    related_id TEXT,
    read INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  migrated = true;
  console.log('✅ DB migration OK');
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function generateId(prefix) { return `${prefix}_${crypto.randomBytes(4).toString('hex')}`; }
async function hashPhrase(phrase) { return await bcrypt.hash(phrase, 12); }
async function verifyPhrase(phrase, hash) { return await bcrypt.compare(phrase, hash); }

function verifyAdminKey(provided) {
  const expected = process.env.ADMIN_KEY || '';
  if (!provided || provided.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8')); }
  catch { return false; }
}

function validateSecretPhrase(phrase) {
  if (typeof phrase !== 'string') return { valid: false, message: 'Invalid input type' };
  const trimmed = phrase.trim();
  if (trimmed.length < LIMITS.SECRET_PHRASE_MIN) return { valid: false, message: `Secret phrase must be at least ${LIMITS.SECRET_PHRASE_MIN} characters` };
  if (trimmed.length > LIMITS.SECRET_PHRASE_MAX) return { valid: false, message: `Secret phrase must be under ${LIMITS.SECRET_PHRASE_MAX} characters` };
  return { valid: true, value: trimmed };
}

function validateContent(content) {
  if (typeof content !== 'string') return { valid: false, message: 'Invalid content type' };
  const trimmed = content.trim();
  if (trimmed.length < LIMITS.CONTENT_MIN) return { valid: false, message: `Content must be at least ${LIMITS.CONTENT_MIN} characters` };
  if (trimmed.length > LIMITS.CONTENT_MAX) return { valid: false, message: `Content must be under ${LIMITS.CONTENT_MAX} characters` };
  return { valid: true, value: trimmed };
}

function getNextWeekReset() {
  return new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
}

function getWeeklyPrompt() {
  const weekNumber = Math.floor(Date.now() / (7 * 86400000));
  return WEEKLY_PROMPTS[weekNumber % WEEKLY_PROMPTS.length];
}

async function moderateContent(content) {
  const prompt = `You are a moderation system for an anonymous emotional support platform.\n\nRULES:\nACCEPT: sadness, anger, fear, loneliness, despair, suicidal thoughts (cry for help), trauma, past abuse, raw but non-hateful language, grief, mental health struggles.\nWARNING (approve but flag): explicit mentions of suicide method, self-harm intent, immediate danger.\nREJECT: explicit violence toward others, hate speech / discrimination, spam / nonsense, explicit sexual content (EXCEPTION: accept \"I was sexually assaulted\" and similar trauma disclosures), personal identifying info (full name + address combo).\n\nIf you REJECT, you MUST:\n1. Identify the exact rule violated (be specific)\n2. Quote or paraphrase the exact passage that triggered rejection (max 30 words)\n3. Explain clearly why it violates the rule\n4. Suggest how the user could rephrase to be accepted\n\nContent to moderate: """${content.replace(/"/g, '\\"').substring(0, 800)}"""\n\nRespond ONLY with valid JSON (no markdown, no explanation outside JSON):\n{\n  "approved": true/false,\n  "warning": true/false,\n  "rule_violated": "exact rule name or null",\n  "offending_passage": "the exact excerpt that caused rejection, or null",\n  "reason": "short explanation for approved content, or detailed rejection reason",\n  "suggestion": "how to rephrase/fix, or null if approved"\n}`;

  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 300 })
      });
      if (!res.ok) continue;
      const data = await res.json();
      const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
      return {
        approved: result.approved,
        reason: result.reason,
        warning: result.warning || false,
        rule_violated: result.rule_violated || null,
        offending_passage: result.offending_passage || null,
        suggestion: result.suggestion || null,
        model
      };
    } catch (e) { continue; }
  }
  return { approved: true, reason: 'fail-open', warning: false, rule_violated: null, offending_passage: null, suggestion: null, model: 'none' };
}

async function checkPostLimit(db, userId) {
  const r = await db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE user_id = ? AND created_at > ?', args: [userId, Date.now() - 7 * 86400000] });
  return r.rows[0].c;
}
async function checkCommentLimit(db, userId) {
  const r = await db.execute({ sql: 'SELECT COUNT(*) as c FROM responses WHERE user_id = ? AND created_at > ?', args: [userId, Date.now() - 7 * 86400000] });
  return r.rows[0].c;
}

async function notifySubscribers(db, confidenceId, emotion, authorId) {
  try {
    const subscribers = await db.execute({ sql: 'SELECT user_id FROM subscriptions WHERE emotion = ? AND user_id != ?', args: [emotion, authorId] });
    const EMOTION_LABELS = { ruptures: 'Ruptures', isolement: 'Isolation', traumas: 'Traumas', stress: 'Stress & Mental Health', spiritualite: 'Spirituality', espoir: 'Hope' };
    for (const sub of subscribers.rows) {
      await db.execute({ sql: 'INSERT INTO notifications (id, user_id, type, message, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', args: [generateId('notif'), sub.user_id, 'new_confidence', `New confidence in ${EMOTION_LABELS[emotion] || emotion}`, confidenceId, Date.now()] });
    }
  } catch {}
}

async function notifyConfidenceAuthor(db, confidenceId, responderId) {
  try {
    const conf = await db.execute({ sql: 'SELECT user_id FROM confidences WHERE id = ?', args: [confidenceId] });
    if (conf.rows.length === 0) return;
    const authorId = conf.rows[0].user_id;
    if (authorId === responderId) return;
    await db.execute({ sql: 'INSERT INTO notifications (id, user_id, type, message, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', args: [generateId('notif'), authorId, 'new_response', 'Someone responded to your confidence with kindness', confidenceId, Date.now()] });
  } catch {}
}

// ─── Gestionnaire principal Vercel ────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-user-id,x-admin-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Rate limiting
  const ip = req.headers['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ success: false, message: 'Rate limit exceeded' });

  // Validation sécurité basique
  if (req.body) {
    const check = (obj) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          if (detectSQLInjection(v) || detectXSS(v)) return false;
        } else if (typeof v === 'object' && v !== null && !check(v)) return false;
      }
      return true;
    };
    if (!check(req.body)) return res.status(403).json({ success: false, message: 'Request blocked' });
  }

  try {
    await ensureMigrated();
    const db = getDb();
    const url = req.url.replace(/\?.*$/, '');
    const method = req.method;
    const body = req.body || {};
    const headers = req.headers;
    const query = req.query || {};

    const json = (data) => res.json(data);
    const err = (msg, code = 500) => res.status(code).json({ success: false, message: msg });

    // ── Health ──────────────────────────────────────────────────────────────
    if (url === '/api/health' && method === 'GET') {
      try { await db.execute('SELECT 1'); return json({ success: true, status: 'healthy', timestamp: Date.now() }); }
      catch (e) { return json({ success: false, status: 'unhealthy', error: e.message }); }
    }

    // ── Weekly Prompt ───────────────────────────────────────────────────────
    if (url === '/api/prompt' && method === 'GET') {
      return json({ success: true, prompt: getWeeklyPrompt() });
    }

    // ── Auth ────────────────────────────────────────────────────────────────
    if (url === '/api/auth/create' && method === 'POST') {
      const validation = validateSecretPhrase(body.secretPhrase);
      if (!validation.valid) return json({ success: false, message: validation.message });
      const userId = generateId('CB');
      const now = Date.now();
      const hash = await hashPhrase(validation.value);
      await db.execute({ sql: 'INSERT INTO users (id, secret_phrase_hash, created_at, last_active) VALUES (?, ?, ?, ?)', args: [userId, hash, now, now] });
      return json({ success: true, userId });
    }

    if (url === '/api/auth/verify' && method === 'POST') {
      const input = body.input;
      if (!input || typeof input !== 'string') return json({ success: false, message: 'Invalid input' });
      const trimmed = input.trim();
      let userId = null;
      if (trimmed.startsWith('CB_')) {
        const r = await db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [trimmed] });
        if (r.rows.length > 0) userId = trimmed;
      } else {
        const validation = validateSecretPhrase(trimmed);
        if (!validation.valid) return json({ success: false, message: 'Invalid ID or secret phrase' });
        const r = await db.execute({ sql: 'SELECT id, secret_phrase_hash FROM users', args: [] });
        for (const row of r.rows) {
          const match = await verifyPhrase(validation.value, row.secret_phrase_hash);
          if (match) { userId = row.id; break; }
        }
      }
      if (userId) {
        await db.execute({ sql: 'UPDATE users SET last_active = ? WHERE id = ?', args: [Date.now(), userId] });
        return json({ success: true, userId });
      }
      return json({ success: false, message: 'Invalid ID or secret phrase' });
    }

    // ── Subscriptions ───────────────────────────────────────────────────────
    if (url === '/api/subscriptions' && method === 'GET') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const r = await db.execute({ sql: 'SELECT emotion FROM subscriptions WHERE user_id = ?', args: [userId] });
      return json({ success: true, subscriptions: r.rows.map(row => row.emotion) });
    }

    if (url === '/api/subscriptions/toggle' && method === 'POST') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const { emotion } = body;
      if (!emotion) return json({ success: false, message: 'Missing emotion' });
      const existing = await db.execute({ sql: 'SELECT id FROM subscriptions WHERE user_id = ? AND emotion = ?', args: [userId, emotion] });
      if (existing.rows.length > 0) {
        await db.execute({ sql: 'DELETE FROM subscriptions WHERE user_id = ? AND emotion = ?', args: [userId, emotion] });
        return json({ success: true, action: 'unsubscribed', emotion });
      }
      await db.execute({ sql: 'INSERT INTO subscriptions (id, user_id, emotion, created_at) VALUES (?, ?, ?, ?)', args: [generateId('sub'), userId, emotion, Date.now()] });
      return json({ success: true, action: 'subscribed', emotion });
    }

    // ── Notifications ───────────────────────────────────────────────────────
    if (url === '/api/notifications' && method === 'GET') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const notifs = await db.execute({ sql: 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30', args: [userId] });
      const unreadCount = notifs.rows.filter(n => n.read === 0).length;
      return json({ success: true, notifications: notifs.rows, unreadCount });
    }

    if (url === '/api/notifications/read' && method === 'POST') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      await db.execute({ sql: 'UPDATE notifications SET read = 1 WHERE user_id = ?', args: [userId] });
      return json({ success: true });
    }

    // ── Confidences ─────────────────────────────────────────────────────────
    if (url === '/api/confidences' && method === 'GET') {
      const chapter = query.chapter;
      const userId = headers['x-user-id'];
      const page = parseInt(query.page) || 1;
      const pageSize = parseInt(query.pageSize) || 20;
      const offset = (page - 1) * pageSize;

      let sql = `SELECT c.*,
          (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count,
          (SELECT COUNT(*) FROM responses WHERE confidence_id = c.id) as response_count,
          (SELECT type FROM reactions WHERE confidence_id = c.id AND user_id = ?) as user_reaction
        FROM confidences c WHERE c.expires_at > ?`;
      const args = [userId || '', Date.now()];
      if (chapter && chapter !== 'all') { sql += ' AND c.emotion = ?'; args.push(chapter); }
      sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?';
      args.push(pageSize, offset);
      const result = await db.execute({ sql, args });

      let countSql = 'SELECT COUNT(*) as total FROM confidences WHERE expires_at > ?';
      const countArgs = [Date.now()];
      if (chapter && chapter !== 'all') { countSql += ' AND emotion = ?'; countArgs.push(chapter); }
      const countResult = await db.execute({ sql: countSql, args: countArgs });
      const total = countResult.rows[0].total;

      return json({ success: true, confidences: result.rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), hasMore: page * pageSize < total } });
    }

    if (url === '/api/confidences' && method === 'POST') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const contentValidation = validateContent(body.content);
      if (!contentValidation.valid) return json({ success: false, message: contentValidation.message });
      const user = await db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
      if (user.rows.length === 0) return json({ success: false, message: 'User not found' });
      const isPremium = user.rows[0].premium === 1;
      if (!isPremium) {
        const postsThisWeek = await checkPostLimit(db, userId);
        if (postsThisWeek >= LIMITS.POST_PER_WEEK) return json({ success: false, limitType: 'weekly_post', message: `You've reached ${LIMITS.POST_PER_WEEK} posts this week. Next reset: ${getNextWeekReset()}.` });
        const count = await db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE user_id = ? AND expires_at > ?', args: [userId, Date.now()] });
        if (count.rows[0].c >= LIMITS.FREE_MAX_CONFIDENCES) return json({ success: false, limitType: 'max_confidences', message: `You've reached the ${LIMITS.FREE_MAX_CONFIDENCES} active confidences limit.` });
      }
      const moderation = await moderateContent(contentValidation.value);
      if (!moderation.approved) return json({ success: false, limitType: 'moderation', message: 'Your content was not published.', rule_violated: moderation.rule_violated, offending_passage: moderation.offending_passage, reason: moderation.reason, suggestion: moderation.suggestion });
      const confId = generateId('conf');
      const now = Date.now();
      const expiresAt = isPremium ? now + LIMITS.PREMIUM_EXPIRY_DAYS * 86400000 : now + LIMITS.CONFIDENCE_EXPIRY_DAYS * 86400000;
      await db.execute({ sql: 'INSERT INTO confidences (id, user_id, content, emotion, moderation_score, moderation_message, needs_review, edit_count, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', args: [confId, userId, contentValidation.value, body.emotion, 1.0, moderation.reason, moderation.warning ? 1 : 0, 0, now, expiresAt] });
      notifySubscribers(db, confId, body.emotion, userId);
      return json({ success: true, confidenceId: confId, warning: moderation.warning });
    }

    // Confidence by ID
    const confIdMatch = url.match(/^\/api\/confidences\/([^/]+)$/);
    if (confIdMatch) {
      const id = confIdMatch[1];
      if (method === 'GET') {
        const userId = headers['x-user-id'];
        const result = await db.execute({ sql: `SELECT c.*, (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count, (SELECT type FROM reactions WHERE confidence_id = c.id AND user_id = ?) as user_reaction FROM confidences c WHERE c.id = ?`, args: [userId || '', id] });
        if (result.rows.length === 0) return err('Not found', 404);
        const responses = await db.execute({ sql: `SELECT r.*, (SELECT COUNT(*) FROM response_reactions WHERE response_id = r.id) as reaction_count, (SELECT type FROM response_reactions WHERE response_id = r.id AND user_id = ?) as user_reaction FROM responses r WHERE r.confidence_id = ? ORDER BY r.created_at ASC`, args: [userId || '', id] });
        const touchedCount = await db.execute({ sql: 'SELECT COUNT(DISTINCT user_id) as c FROM reactions WHERE confidence_id = ?', args: [id] });
        return json({ success: true, confidence: result.rows[0], responses: responses.rows, touchedCount: touchedCount.rows[0].c });
      }
      if (method === 'PUT') {
        const userId = headers['x-user-id'];
        if (!userId) return json({ success: false, message: 'Unauthorized' });
        const contentValidation = validateContent(body.content);
        if (!contentValidation.valid) return json({ success: false, message: contentValidation.message });
        const conf = await db.execute({ sql: 'SELECT user_id, edit_count FROM confidences WHERE id = ?', args: [id] });
        if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) return json({ success: false, message: 'Not authorized' });
        const currentEditCount = conf.rows[0].edit_count || 0;
        if (currentEditCount >= 3) return json({ success: false, limitType: 'edit_limit', message: 'You have reached the maximum of 3 edits for this post.' });
        const moderation = await moderateContent(contentValidation.value);
        if (!moderation.approved) return json({ success: false, limitType: 'moderation', message: 'Your edit was not saved.', rule_violated: moderation.rule_violated, offending_passage: moderation.offending_passage, reason: moderation.reason, suggestion: moderation.suggestion });
        await db.execute({ sql: 'UPDATE confidences SET content = ?, emotion = ?, moderation_message = ?, edit_count = edit_count + 1 WHERE id = ?', args: [contentValidation.value, body.emotion, moderation.reason, id] });
        return json({ success: true, warning: moderation.warning, editsRemaining: 3 - (currentEditCount + 1) });
      }
      if (method === 'DELETE') {
        const userId = headers['x-user-id'];
        if (!userId) return json({ success: false, message: 'Unauthorized' });
        const conf = await db.execute({ sql: 'SELECT user_id FROM confidences WHERE id = ?', args: [id] });
        if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) return json({ success: false, message: 'Not authorized' });
        await db.execute({ sql: 'DELETE FROM confidences WHERE id = ?', args: [id] });
        return json({ success: true });
      }
    }

    // ── Reactions ───────────────────────────────────────────────────────────
    if (url === '/api/reactions' && method === 'POST') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const type = body.type || body.reactionType;
      if (!type) return json({ success: false, message: 'Missing type' });
      const existing = await db.execute({ sql: 'SELECT * FROM reactions WHERE confidence_id = ? AND user_id = ?', args: [body.confidenceId, userId] });
      if (existing.rows.length > 0) {
        if (existing.rows[0].type === type) { await db.execute({ sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ?', args: [body.confidenceId, userId] }); return json({ success: true, action: 'removed' }); }
        await db.execute({ sql: 'UPDATE reactions SET type = ? WHERE confidence_id = ? AND user_id = ?', args: [type, body.confidenceId, userId] });
        return json({ success: true, action: 'updated' });
      }
      await db.execute({ sql: 'INSERT INTO reactions (id, confidence_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)', args: [generateId('react'), body.confidenceId, userId, type, Date.now()] });
      return json({ success: true, action: 'added' });
    }

    if (url === '/api/response-reactions' && method === 'POST') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const type = body.type || body.reactionType;
      if (!type) return json({ success: false, message: 'Missing type' });
      const existing = await db.execute({ sql: 'SELECT * FROM response_reactions WHERE response_id = ? AND user_id = ?', args: [body.responseId, userId] });
      if (existing.rows.length > 0) {
        if (existing.rows[0].type === type) { await db.execute({ sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ?', args: [body.responseId, userId] }); return json({ success: true, action: 'removed' }); }
        await db.execute({ sql: 'UPDATE response_reactions SET type = ? WHERE response_id = ? AND user_id = ?', args: [type, body.responseId, userId] });
        return json({ success: true, action: 'updated' });
      }
      await db.execute({ sql: 'INSERT INTO response_reactions (id, response_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)', args: [generateId('rreact'), body.responseId, userId, type, Date.now()] });
      return json({ success: true, action: 'added' });
    }

    // ── Responses ───────────────────────────────────────────────────────────
    if (url === '/api/responses' && method === 'POST') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const contentValidation = validateContent(body.content);
      if (!contentValidation.valid) return json({ success: false, message: contentValidation.message });
      const user = await db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
      if (user.rows.length === 0) return json({ success: false, message: 'User not found' });
      const isPremium = user.rows[0].premium === 1;
      if (!isPremium) {
        const commentsThisWeek = await checkCommentLimit(db, userId);
        if (commentsThisWeek >= LIMITS.COMMENTS_PER_WEEK) return json({ success: false, limitType: 'weekly_comment', message: `You've reached your ${LIMITS.COMMENTS_PER_WEEK} comments limit for this week. Resets on ${getNextWeekReset()}.` });
      }
      const moderation = await moderateContent(contentValidation.value);
      if (!moderation.approved) return json({ success: false, limitType: 'moderation', message: 'Your reply was not sent.', rule_violated: moderation.rule_violated, offending_passage: moderation.offending_passage, reason: moderation.reason, suggestion: moderation.suggestion });
      const responseId = generateId('resp');
      const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
      await db.execute({ sql: 'INSERT INTO responses (id, confidence_id, user_id, content, avatar, moderation_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', args: [responseId, body.confidenceId, userId, contentValidation.value, avatar, 1.0, Date.now()] });
      notifyConfidenceAuthor(db, body.confidenceId, userId);
      const commentsLeft = isPremium ? 999 : Math.max(0, LIMITS.COMMENTS_PER_WEEK - (await checkCommentLimit(db, userId)));
      return json({ success: true, responseId, commentsLeft });
    }

    // ── Profile ─────────────────────────────────────────────────────────────
    if (url === '/api/profile' && method === 'GET') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const user = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] });
      if (user.rows.length === 0) return json({ success: false, message: 'User not found' });
      const [confidences, totalReactions, totalResponses, helpedCount, emotionStats, subscriptions] = await Promise.all([
        db.execute({ sql: `SELECT c.id, c.content, c.emotion, c.created_at, c.expires_at, c.edit_count, (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count, (SELECT COUNT(*) FROM responses WHERE confidence_id = c.id) as response_count FROM confidences c WHERE c.user_id = ? ORDER BY c.created_at DESC`, args: [userId] }),
        db.execute({ sql: 'SELECT COUNT(*) as c FROM reactions r JOIN confidences cf ON r.confidence_id = cf.id WHERE cf.user_id = ?', args: [userId] }),
        db.execute({ sql: 'SELECT COUNT(*) as c FROM responses r JOIN confidences cf ON r.confidence_id = cf.id WHERE cf.user_id = ?', args: [userId] }),
        db.execute({ sql: `SELECT COUNT(*) as c FROM (SELECT DISTINCT confidence_id FROM reactions WHERE user_id = ? UNION SELECT DISTINCT confidence_id FROM responses WHERE user_id = ?)`, args: [userId, userId] }),
        db.execute({ sql: 'SELECT emotion, COUNT(*) as count FROM confidences WHERE user_id = ? GROUP BY emotion ORDER BY count DESC', args: [userId] }),
        db.execute({ sql: 'SELECT emotion FROM subscriptions WHERE user_id = ?', args: [userId] })
      ]);
      const activityDays = await db.execute({ sql: `SELECT DISTINCT date(created_at/1000, 'unixepoch') as day FROM confidences WHERE user_id = ? UNION SELECT DISTINCT date(created_at/1000, 'unixepoch') as day FROM responses WHERE user_id = ? ORDER BY day DESC LIMIT 30`, args: [userId, userId] });
      let streak = 0;
      let checkDate = new Date().toISOString().split('T')[0];
      for (const row of activityDays.rows) {
        if (row.day === checkDate) { streak++; const d = new Date(checkDate); d.setDate(d.getDate() - 1); checkDate = d.toISOString().split('T')[0]; } else break;
      }
      const isPremium = user.rows[0].premium === 1;
      const [postsThisWeek, commentsThisWeek] = await Promise.all([checkPostLimit(db, userId), checkCommentLimit(db, userId)]);
      let settings = {};
      try { settings = JSON.parse(user.rows[0].settings || '{}'); } catch { settings = { theme: 'dark', avatar: 'moon', language: 'en' }; }
      return json({ success: true, profile: { ...user.rows[0], settings, stats: { confidencesCount: confidences.rows.length, reactionsReceived: totalReactions.rows[0].c, responsesReceived: totalResponses.rows[0].c, peopleHelped: helpedCount.rows[0].c, streak, emotionDistribution: emotionStats.rows }, subscriptions: subscriptions.rows.map(r => r.emotion), limits: { postsThisWeek, postLimitPerWeek: LIMITS.POST_PER_WEEK, canPost: isPremium || postsThisWeek < LIMITS.POST_PER_WEEK, commentsThisWeek, commentLimitPerWeek: LIMITS.COMMENTS_PER_WEEK, canComment: isPremium || commentsThisWeek < LIMITS.COMMENTS_PER_WEEK, commentsLeft: isPremium ? 999 : Math.max(0, LIMITS.COMMENTS_PER_WEEK - commentsThisWeek), nextPostReset: getNextWeekReset(), nextCommentReset: getNextWeekReset() }, confidences: confidences.rows } });
    }

    if (url === '/api/settings' && method === 'PUT') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      await db.execute({ sql: 'UPDATE users SET settings = ? WHERE id = ?', args: [JSON.stringify(body), userId] });
      return json({ success: true });
    }

    if (url === '/api/account' && method === 'DELETE') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [userId] });
      return json({ success: true });
    }

    // ── Journal ─────────────────────────────────────────────────────────────
    if (url === '/api/journal' && method === 'GET') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const user = await db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
      if (user.rows.length === 0 || user.rows[0].premium !== 1) return json({ success: false, message: 'Premium required', limitType: 'premium' });
      const entries = await db.execute({ sql: 'SELECT * FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC', args: [userId] });
      return json({ success: true, entries: entries.rows });
    }

    if (url === '/api/journal' && method === 'POST') {
      const userId = headers['x-user-id'];
      if (!userId) return json({ success: false, message: 'Unauthorized' });
      const user = await db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
      if (user.rows.length === 0 || user.rows[0].premium !== 1) return json({ success: false, message: 'Premium required', limitType: 'premium' });
      const contentValidation = validateContent(body.content);
      if (!contentValidation.valid) return json({ success: false, message: contentValidation.message });
      const entryId = generateId('jrn');
      await db.execute({ sql: 'INSERT INTO journal_entries (id, user_id, content, mood, created_at) VALUES (?, ?, ?, ?, ?)', args: [entryId, userId, contentValidation.value, body.mood || null, Date.now()] });
      return json({ success: true, entryId });
    }

    // ── Admin ───────────────────────────────────────────────────────────────
    if (url.startsWith('/api/admin')) {
      if (!verifyAdminKey(headers['x-admin-key'])) return res.status(403).json({ success: false, message: 'Unauthorized' });

      if (url === '/api/admin/stats' && method === 'GET') {
        const now = Date.now();
        const oneDayAgo = now - 86400000;
        const oneWeekAgo = now - 7 * 86400000;
        const [totalUsers, newUsersToday, newUsersWeek, premiumUsers, totalConf, activeConf, newConfToday, newConfWeek, totalResp, newRespToday, totalReact, totalNotifs] = await Promise.all([
          db.execute('SELECT COUNT(*) as c FROM users'),
          db.execute({ sql: 'SELECT COUNT(*) as c FROM users WHERE created_at > ?', args: [oneDayAgo] }),
          db.execute({ sql: 'SELECT COUNT(*) as c FROM users WHERE created_at > ?', args: [oneWeekAgo] }),
          db.execute('SELECT COUNT(*) as c FROM users WHERE premium = 1'),
          db.execute('SELECT COUNT(*) as c FROM confidences'),
          db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE expires_at > ?', args: [now] }),
          db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE created_at > ?', args: [oneDayAgo] }),
          db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE created_at > ?', args: [oneWeekAgo] }),
          db.execute('SELECT COUNT(*) as c FROM responses'),
          db.execute({ sql: 'SELECT COUNT(*) as c FROM responses WHERE created_at > ?', args: [oneDayAgo] }),
          db.execute('SELECT COUNT(*) as c FROM reactions'),
          db.execute('SELECT COUNT(*) as c FROM notifications WHERE read = 0')
        ]);
        const [topEmotions, dailyActivity, topSubscriptions] = await Promise.all([
          db.execute({ sql: `SELECT emotion, COUNT(*) as count FROM confidences WHERE expires_at > ? GROUP BY emotion ORDER BY count DESC`, args: [now] }),
          db.execute({ sql: `SELECT date(created_at/1000, 'unixepoch') as day, COUNT(*) as confidences FROM confidences WHERE created_at > ? GROUP BY day ORDER BY day`, args: [oneWeekAgo] }),
          db.execute('SELECT emotion, COUNT(*) as count FROM subscriptions GROUP BY emotion ORDER BY count DESC')
        ]);
        return json({ success: true, stats: { users: { total: totalUsers.rows[0].c, newToday: newUsersToday.rows[0].c, newThisWeek: newUsersWeek.rows[0].c, premium: premiumUsers.rows[0].c }, confidences: { total: totalConf.rows[0].c, active: activeConf.rows[0].c, newToday: newConfToday.rows[0].c, newThisWeek: newConfWeek.rows[0].c }, responses: { total: totalResp.rows[0].c, newToday: newRespToday.rows[0].c }, reactions: { total: totalReact.rows[0].c }, notifications: { unread: totalNotifs.rows[0].c }, topEmotions: topEmotions.rows, dailyActivity: dailyActivity.rows, topSubscriptions: topSubscriptions.rows } });
      }

      if (url === '/api/admin/users' && method === 'GET') {
        const r = await db.execute({ sql: 'SELECT id, created_at, last_active, premium, premium_type, premium_end FROM users ORDER BY created_at DESC LIMIT 100', args: [] });
        return json({ success: true, users: r.rows });
      }

      if (url === '/api/admin/premium/activate' && method === 'POST') {
        const now = Date.now();
        const durationMs = body.type === 'yearly' ? 365 * 86400000 : 30 * 86400000;
        await db.execute({ sql: 'UPDATE users SET premium = 1, premium_type = ?, premium_start = ?, premium_end = ? WHERE id = ?', args: [body.type, now, now + durationMs, body.userId] });
        await db.execute({ sql: 'INSERT INTO notifications (id, user_id, type, message, created_at) VALUES (?, ?, ?, ?, ?)', args: [generateId('notif'), body.userId, 'premium_activated', `🎉 Your Premium ${body.type} subscription is now active!`, now] });
        return json({ success: true, message: `Premium ${body.type} activated for ${body.userId}` });
      }

      if (url === '/api/admin/premium/deactivate' && method === 'POST') {
        await db.execute({ sql: 'UPDATE users SET premium = 0, premium_type = NULL, premium_end = NULL WHERE id = ?', args: [body.userId] });
        return json({ success: true });
      }
    }

    return res.status(404).json({ success: false, message: 'Route not found' });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
}
