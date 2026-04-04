import { createClient } from '@libsql/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

// ─── Validation des variables d'env critiques au démarrage ──────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'DATABASE_AUTH_TOKEN'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ FATAL: Missing required env variable: ${key}`);
    process.exit(1);
  }
}
if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY.length < 16) {
  console.warn('⚠️  ADMIN_KEY is missing or too short (< 16 chars). Admin routes are insecure.');
}
if (!process.env.GROQ_API_KEY) {
  console.warn('⚠️  GROQ_API_KEY is missing. Moderation will fail-open.');
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
  // Validation inputs
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

export class BackendService {
  constructor() { this.db = null; }

  async init() {
    this.db = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN
    });

    // ⚠️ RESET_DB ne doit jamais tourner en production automatiquement.
    // Utiliser scripts/reset-db.js manuellement si besoin.
    const shouldReset = process.env.RESET_DB === 'true'
      && process.env.NODE_ENV !== 'production';

    if (shouldReset) {
      console.warn('⚠️ RESET_DB=true détecté — reset de la base (NODE_ENV !== production)');
      await this.resetDatabase(); // inclut migrate()
    } else {
      await this.migrate(); // safe : CREATE TABLE IF NOT EXISTS
    }
  }

  async migrate() {
    try {
      await this.db.execute(`CREATE TABLE IF NOT EXISTS users (
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

      await this.db.execute(`CREATE TABLE IF NOT EXISTS confidences (
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

      // Migration : ajouter edit_count si la colonne n'existe pas encore (upgrade safe)
      try {
        await this.db.execute(`ALTER TABLE confidences ADD COLUMN edit_count INTEGER DEFAULT 0`);
        console.log('✅ Migration: added edit_count to confidences');
      } catch (e) {
        // Colonne déjà présente — c'est OK
      }

      await this.db.execute(`CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(confidence_id, user_id),
        FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

      await this.db.execute(`CREATE TABLE IF NOT EXISTS responses (
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

      await this.db.execute(`CREATE TABLE IF NOT EXISTS response_reactions (
        id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(response_id, user_id),
        FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

      await this.db.execute(`CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        mood TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

      await this.db.execute(`CREATE TABLE IF NOT EXISTS subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        emotion TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, emotion),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

      await this.db.execute(`CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        related_id TEXT,
        read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

      console.log('✅ DB migration OK');
    } catch (err) {
      console.error('❌ Migration failed:', err);
      throw err;
    }
  }

  async resetDatabase() {
    console.log('🔄 Resetting database...');
    await this.db.execute('DROP TABLE IF EXISTS notifications');
    await this.db.execute('DROP TABLE IF EXISTS subscriptions');
    await this.db.execute('DROP TABLE IF EXISTS journal_entries');
    await this.db.execute('DROP TABLE IF EXISTS response_reactions');
    await this.db.execute('DROP TABLE IF EXISTS responses');
    await this.db.execute('DROP TABLE IF EXISTS reactions');
    await this.db.execute('DROP TABLE IF EXISTS confidences');
    await this.db.execute('DROP TABLE IF EXISTS users');
    await this.migrate();
    console.log('✅ DB reset complete');
  }

  generateId(prefix) {
    return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  }

  // ─── Hachage bcrypt (sécurisé contre brute-force) ─────────────────────────
  async hashPhrase(phrase) {
    const saltRounds = 12;
    return await bcrypt.hash(phrase, saltRounds);
  }

  async verifyPhrase(phrase, hash) {
    return await bcrypt.compare(phrase, hash);
  }

  // ─── Admin key comparison sécurisée (timing-safe) ─────────────────────────
  verifyAdminKey(provided) {
    const expected = process.env.ADMIN_KEY || '';
    if (!provided || provided.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(provided, 'utf8'),
        Buffer.from(expected, 'utf8')
      );
    } catch {
      return false;
    }
  }

  // ─── Validation des inputs ────────────────────────────────────────────────
  validateSecretPhrase(phrase) {
    if (typeof phrase !== 'string') return { valid: false, message: 'Invalid input type' };
    const trimmed = phrase.trim();
    if (trimmed.length < LIMITS.SECRET_PHRASE_MIN)
      return { valid: false, message: `Secret phrase must be at least ${LIMITS.SECRET_PHRASE_MIN} characters` };
    if (trimmed.length > LIMITS.SECRET_PHRASE_MAX)
      return { valid: false, message: `Secret phrase must be under ${LIMITS.SECRET_PHRASE_MAX} characters` };
    return { valid: true, value: trimmed };
  }

  validateContent(content) {
    if (typeof content !== 'string') return { valid: false, message: 'Invalid content type' };
    const trimmed = content.trim();
    if (trimmed.length < LIMITS.CONTENT_MIN)
      return { valid: false, message: `Content must be at least ${LIMITS.CONTENT_MIN} characters` };
    if (trimmed.length > LIMITS.CONTENT_MAX)
      return { valid: false, message: `Content must be under ${LIMITS.CONTENT_MAX} characters` };
    return { valid: true, value: trimmed };
  }

  // ─── Modération IA avec explication détaillée ────────────────────────────
  async moderateContent(content) {
    const prompt = `You are a moderation system for an anonymous emotional support platform.

RULES:
ACCEPT: sadness, anger, fear, loneliness, despair, suicidal thoughts (cry for help), trauma, past abuse, raw but non-hateful language, grief, mental health struggles.
WARNING (approve but flag): explicit mentions of suicide method, self-harm intent, immediate danger.
REJECT: explicit violence toward others, hate speech / discrimination, spam / nonsense, explicit sexual content (EXCEPTION: accept "I was sexually assaulted" and similar trauma disclosures), personal identifying info (full name + address combo).

If you REJECT, you MUST:
1. Identify the exact rule violated (be specific)
2. Quote or paraphrase the exact passage that triggered rejection (max 30 words)
3. Explain clearly why it violates the rule
4. Suggest how the user could rephrase to be accepted

Content to moderate: """${content.replace(/"/g, '\\"').substring(0, 800)}"""

Respond ONLY with valid JSON (no markdown, no explanation outside JSON):
{
  "approved": true/false,
  "warning": true/false,
  "rule_violated": "exact rule name or null",
  "offending_passage": "the exact excerpt that caused rejection, or null",
  "reason": "short explanation for approved content, or detailed rejection reason",
  "suggestion": "how to rephrase/fix, or null if approved"
}`;

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
        console.log(`✅ Moderation (${model}): ${result.approved ? 'APPROVED' : 'REJECTED'}`);
        if (!result.approved) {
          console.warn(`⚠️ Rejected — rule: ${result.rule_violated} | passage: ${result.offending_passage}`);
        }
        return {
          approved: result.approved,
          reason: result.reason,
          warning: result.warning || false,
          rule_violated: result.rule_violated || null,
          offending_passage: result.offending_passage || null,
          suggestion: result.suggestion || null,
          model
        };
      } catch (e) {
        console.warn(`⚠️ Model ${model} failed: ${e.message}`);
        continue;
      }
    }
    // fail-open mais on log l'incident
    console.error('🚨 ALL moderation models failed — failing open');
    return { approved: true, reason: 'fail-open', warning: false, rule_violated: null, offending_passage: null, suggestion: null, model: 'none' };
  }

  async checkPostLimit(userId) {
    const r = await this.db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE user_id = ? AND created_at > ?', args: [userId, Date.now() - 7 * 86400000] });
    return r.rows[0].c;
  }

  async checkCommentLimit(userId) {
    const r = await this.db.execute({ sql: 'SELECT COUNT(*) as c FROM responses WHERE user_id = ? AND created_at > ?', args: [userId, Date.now() - 7 * 86400000] });
    return r.rows[0].c;
  }

  getNextWeekReset() {
    return new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
  }

  getWeeklyPrompt() {
    const weekNumber = Math.floor(Date.now() / (7 * 86400000));
    return WEEKLY_PROMPTS[weekNumber % WEEKLY_PROMPTS.length];
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  async createUser(secretPhrase) {
    const validation = this.validateSecretPhrase(secretPhrase);
    if (!validation.valid) return { success: false, message: validation.message };

    const userId = this.generateId('CB');
    const now = Date.now();
    const hash = await this.hashPhrase(validation.value);
    await this.db.execute({
      sql: 'INSERT INTO users (id, secret_phrase_hash, created_at, last_active) VALUES (?, ?, ?, ?)',
      args: [userId, hash, now, now]
    });
    return { success: true, userId };
  }

  async verifyUser(input) {
    if (!input || typeof input !== 'string') return { success: false, message: 'Invalid input' };
    const trimmed = input.trim();

    let userId = null;

    if (trimmed.startsWith('CB_')) {
      // Login par userId direct
      const r = await this.db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [trimmed] });
      if (r.rows.length > 0) userId = trimmed;
    } else {
      // Login par secret phrase — on doit comparer avec bcrypt
      // On récupère tous les users et on compare (pour une app avec peu d'users, c'est ok)
      // Pour scaler : ajouter un index sur un hash rapide servant de pré-filtre
      const validation = this.validateSecretPhrase(trimmed);
      if (!validation.valid) return { success: false, message: 'Invalid ID or secret phrase' };

      const r = await this.db.execute({ sql: 'SELECT id, secret_phrase_hash FROM users', args: [] });
      for (const row of r.rows) {
        const match = await this.verifyPhrase(validation.value, row.secret_phrase_hash);
        if (match) { userId = row.id; break; }
      }
    }

    if (userId) {
      await this.db.execute({ sql: 'UPDATE users SET last_active = ? WHERE id = ?', args: [Date.now(), userId] });
      return { success: true, userId };
    }
    return { success: false, message: 'Invalid ID or secret phrase' };
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  async getSubscriptions(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const r = await this.db.execute({ sql: 'SELECT emotion FROM subscriptions WHERE user_id = ?', args: [userId] });
    return { success: true, subscriptions: r.rows.map(row => row.emotion) };
  }

  async toggleSubscription(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const { emotion } = data;
    if (!emotion) return { success: false, message: 'Missing emotion' };

    const existing = await this.db.execute({ sql: 'SELECT id FROM subscriptions WHERE user_id = ? AND emotion = ?', args: [userId, emotion] });
    if (existing.rows.length > 0) {
      await this.db.execute({ sql: 'DELETE FROM subscriptions WHERE user_id = ? AND emotion = ?', args: [userId, emotion] });
      return { success: true, action: 'unsubscribed', emotion };
    }
    await this.db.execute({
      sql: 'INSERT INTO subscriptions (id, user_id, emotion, created_at) VALUES (?, ?, ?, ?)',
      args: [this.generateId('sub'), userId, emotion, Date.now()]
    });
    return { success: true, action: 'subscribed', emotion };
  }

  async notifySubscribers(confidenceId, emotion, authorId) {
    try {
      const subscribers = await this.db.execute({
        sql: 'SELECT user_id FROM subscriptions WHERE emotion = ? AND user_id != ?',
        args: [emotion, authorId]
      });

      const EMOTION_LABELS = {
        ruptures: 'Ruptures', isolement: 'Isolation', traumas: 'Traumas',
        stress: 'Stress & Mental Health', spiritualite: 'Spirituality', espoir: 'Hope'
      };

      for (const sub of subscribers.rows) {
        await this.db.execute({
          sql: 'INSERT INTO notifications (id, user_id, type, message, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          args: [
            this.generateId('notif'),
            sub.user_id,
            'new_confidence',
            `New confidence in ${EMOTION_LABELS[emotion] || emotion}`,
            confidenceId,
            Date.now()
          ]
        });
      }
    } catch (e) {
      console.warn('⚠️ Notification dispatch failed:', e.message);
    }
  }

  async notifyConfidenceAuthor(confidenceId, responderId) {
    try {
      const conf = await this.db.execute({ sql: 'SELECT user_id FROM confidences WHERE id = ?', args: [confidenceId] });
      if (conf.rows.length === 0) return;
      const authorId = conf.rows[0].user_id;
      if (authorId === responderId) return;

      await this.db.execute({
        sql: 'INSERT INTO notifications (id, user_id, type, message, related_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [this.generateId('notif'), authorId, 'new_response', 'Someone responded to your confidence with kindness', confidenceId, Date.now()]
      });
    } catch (e) {
      console.warn('⚠️ Author notification failed:', e.message);
    }
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  async getNotifications(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const notifs = await this.db.execute({
      sql: 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
      args: [userId]
    });
    const unreadCount = notifs.rows.filter(n => n.read === 0).length;
    return { success: true, notifications: notifs.rows, unreadCount };
  }

  async markNotificationsRead(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    await this.db.execute({ sql: 'UPDATE notifications SET read = 1 WHERE user_id = ?', args: [userId] });
    return { success: true };
  }

  // ─── Confidences ─────────────────────────────────────────────────────────────

  async createConfidence(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    // Validation du contenu
    const contentValidation = this.validateContent(data.content);
    if (!contentValidation.valid) return { success: false, message: contentValidation.message };

    const user = await this.db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0) return { success: false, message: 'User not found' };
    const isPremium = user.rows[0].premium === 1;

    if (!isPremium) {
      const postsThisWeek = await this.checkPostLimit(userId);
      if (postsThisWeek >= LIMITS.POST_PER_WEEK) {
        return { success: false, limitType: 'weekly_post', message: `You've reached ${LIMITS.POST_PER_WEEK} posts this week. Next reset: ${this.getNextWeekReset()}.` };
      }
      const count = await this.db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE user_id = ? AND expires_at > ?', args: [userId, Date.now()] });
      if (count.rows[0].c >= LIMITS.FREE_MAX_CONFIDENCES) {
        return { success: false, limitType: 'max_confidences', message: `You've reached the ${LIMITS.FREE_MAX_CONFIDENCES} active confidences limit.` };
      }
    }

    const moderation = await this.moderateContent(contentValidation.value);
    if (!moderation.approved) {
      return {
        success: false,
        limitType: 'moderation',
        message: 'Your content was not published.',
        rule_violated: moderation.rule_violated,
        offending_passage: moderation.offending_passage,
        reason: moderation.reason,
        suggestion: moderation.suggestion
      };
    }

    const confId = this.generateId('conf');
    const now = Date.now();
    const expiresAt = isPremium ? now + LIMITS.PREMIUM_EXPIRY_DAYS * 86400000 : now + LIMITS.CONFIDENCE_EXPIRY_DAYS * 86400000;

    await this.db.execute({
      sql: 'INSERT INTO confidences (id, user_id, content, emotion, moderation_score, moderation_message, needs_review, edit_count, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [confId, userId, contentValidation.value, data.emotion, 1.0, moderation.reason, moderation.warning ? 1 : 0, 0, now, expiresAt]
    });

    this.notifySubscribers(confId, data.emotion, userId);
    return { success: true, confidenceId: confId, warning: moderation.warning };
  }

  async getConfidences(chapter, userId, page = 1, pageSize = 20) {
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
    const result = await this.db.execute({ sql, args });

    let countSql = 'SELECT COUNT(*) as total FROM confidences WHERE expires_at > ?';
    const countArgs = [Date.now()];
    if (chapter && chapter !== 'all') { countSql += ' AND emotion = ?'; countArgs.push(chapter); }
    const countResult = await this.db.execute({ sql: countSql, args: countArgs });
    const total = countResult.rows[0].total;

    return {
      success: true,
      confidences: result.rows,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), hasMore: page * pageSize < total }
    };
  }

  async getConfidence(id, userId) {
    const result = await this.db.execute({
      sql: `SELECT c.*, (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count,
          (SELECT type FROM reactions WHERE confidence_id = c.id AND user_id = ?) as user_reaction
        FROM confidences c WHERE c.id = ?`,
      args: [userId || '', id]
    });
    if (result.rows.length === 0) return { success: false, message: 'Not found' };

    const responses = await this.db.execute({
      sql: `SELECT r.*, (SELECT COUNT(*) FROM response_reactions WHERE response_id = r.id) as reaction_count,
          (SELECT type FROM response_reactions WHERE response_id = r.id AND user_id = ?) as user_reaction
        FROM responses r WHERE r.confidence_id = ? ORDER BY r.created_at ASC`,
      args: [userId || '', id]
    });

    const touchedCount = await this.db.execute({
      sql: 'SELECT COUNT(DISTINCT user_id) as c FROM reactions WHERE confidence_id = ?',
      args: [id]
    });

    return { success: true, confidence: result.rows[0], responses: responses.rows, touchedCount: touchedCount.rows[0].c };
  }

  async updateConfidence(id, data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    // Validation du contenu
    const contentValidation = this.validateContent(data.content);
    if (!contentValidation.valid) return { success: false, message: contentValidation.message };

    const conf = await this.db.execute({ sql: 'SELECT user_id, edit_count FROM confidences WHERE id = ?', args: [id] });
    if (conf.rows.length === 0 || conf.rows[0].user_id !== userId)
      return { success: false, message: 'Not authorized' };

    const currentEditCount = conf.rows[0].edit_count || 0;
    if (currentEditCount >= 3) {
      return { success: false, limitType: 'edit_limit', message: 'You have reached the maximum of 3 edits for this post.' };
    }

    const moderation = await this.moderateContent(contentValidation.value);
    if (!moderation.approved) {
      return {
        success: false,
        limitType: 'moderation',
        message: 'Your edit was not saved.',
        rule_violated: moderation.rule_violated,
        offending_passage: moderation.offending_passage,
        reason: moderation.reason,
        suggestion: moderation.suggestion
      };
    }

    await this.db.execute({
      sql: 'UPDATE confidences SET content = ?, emotion = ?, moderation_message = ?, edit_count = edit_count + 1 WHERE id = ?',
      args: [contentValidation.value, data.emotion, moderation.reason, id]
    });

    const newEditCount = currentEditCount + 1;
    return {
      success: true,
      warning: moderation.warning,
      editsRemaining: 3 - newEditCount
    };
  }

  async deleteConfidence(id, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const conf = await this.db.execute({ sql: 'SELECT user_id FROM confidences WHERE id = ?', args: [id] });
    if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) return { success: false, message: 'Not authorized' };
    await this.db.execute({ sql: 'DELETE FROM confidences WHERE id = ?', args: [id] });
    return { success: true };
  }

  // ─── Reactions ───────────────────────────────────────────────────────────────

  async toggleReaction(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const type = data.type || data.reactionType;
    if (!type) return { success: false, message: 'Missing type' };

    const existing = await this.db.execute({ sql: 'SELECT * FROM reactions WHERE confidence_id = ? AND user_id = ?', args: [data.confidenceId, userId] });
    if (existing.rows.length > 0) {
      if (existing.rows[0].type === type) {
        await this.db.execute({ sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ?', args: [data.confidenceId, userId] });
        return { success: true, action: 'removed' };
      }
      await this.db.execute({ sql: 'UPDATE reactions SET type = ? WHERE confidence_id = ? AND user_id = ?', args: [type, data.confidenceId, userId] });
      return { success: true, action: 'updated' };
    }
    await this.db.execute({
      sql: 'INSERT INTO reactions (id, confidence_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [this.generateId('react'), data.confidenceId, userId, type, Date.now()]
    });
    return { success: true, action: 'added' };
  }

  // ─── Responses ───────────────────────────────────────────────────────────────

  async createResponse(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    // Validation du contenu
    const contentValidation = this.validateContent(data.content);
    if (!contentValidation.valid) return { success: false, message: contentValidation.message };

    const user = await this.db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0) return { success: false, message: 'User not found' };
    const isPremium = user.rows[0].premium === 1;

    if (!isPremium) {
      const commentsThisWeek = await this.checkCommentLimit(userId);
      if (commentsThisWeek >= LIMITS.COMMENTS_PER_WEEK) {
        return { success: false, limitType: 'weekly_comment', message: `You've reached your ${LIMITS.COMMENTS_PER_WEEK} comments limit for this week. Resets on ${this.getNextWeekReset()}.` };
      }
    }

    const moderation = await this.moderateContent(contentValidation.value);
    if (!moderation.approved) {
      return {
        success: false,
        limitType: 'moderation',
        message: 'Your reply was not sent.',
        rule_violated: moderation.rule_violated,
        offending_passage: moderation.offending_passage,
        reason: moderation.reason,
        suggestion: moderation.suggestion
      };
    }

    const responseId = this.generateId('resp');
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    await this.db.execute({
      sql: 'INSERT INTO responses (id, confidence_id, user_id, content, avatar, moderation_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [responseId, data.confidenceId, userId, contentValidation.value, avatar, 1.0, Date.now()]
    });

    this.notifyConfidenceAuthor(data.confidenceId, userId);

    const commentsLeft = isPremium ? 999 : Math.max(0, LIMITS.COMMENTS_PER_WEEK - (await this.checkCommentLimit(userId)));
    return { success: true, responseId, commentsLeft };
  }

  async toggleResponseReaction(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const type = data.type || data.reactionType;
    if (!type) return { success: false, message: 'Missing type' };

    const existing = await this.db.execute({ sql: 'SELECT * FROM response_reactions WHERE response_id = ? AND user_id = ?', args: [data.responseId, userId] });
    if (existing.rows.length > 0) {
      if (existing.rows[0].type === type) {
        await this.db.execute({ sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ?', args: [data.responseId, userId] });
        return { success: true, action: 'removed' };
      }
      await this.db.execute({ sql: 'UPDATE response_reactions SET type = ? WHERE response_id = ? AND user_id = ?', args: [type, data.responseId, userId] });
      return { success: true, action: 'updated' };
    }
    await this.db.execute({
      sql: 'INSERT INTO response_reactions (id, response_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [this.generateId('rreact'), data.responseId, userId, type, Date.now()]
    });
    return { success: true, action: 'added' };
  }

  // ─── Profile + Stats ──────────────────────────────────────────────────────

  async getProfile(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const user = await this.db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0) return { success: false, message: 'User not found' };

    const [confidences, totalReactions, totalResponses, helpedCount, emotionStats, subscriptions] = await Promise.all([
      this.db.execute({
        sql: `SELECT c.id, c.content, c.emotion, c.created_at, c.expires_at, c.edit_count,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count,
            (SELECT COUNT(*) FROM responses WHERE confidence_id = c.id) as response_count
          FROM confidences c WHERE c.user_id = ? ORDER BY c.created_at DESC`,
        args: [userId]
      }),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM reactions r JOIN confidences cf ON r.confidence_id = cf.id WHERE cf.user_id = ?', args: [userId] }),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM responses r JOIN confidences cf ON r.confidence_id = cf.id WHERE cf.user_id = ?', args: [userId] }),
      this.db.execute({ sql: `SELECT COUNT(*) as c FROM (SELECT DISTINCT confidence_id FROM reactions WHERE user_id = ? UNION SELECT DISTINCT confidence_id FROM responses WHERE user_id = ?)`, args: [userId, userId] }),
      this.db.execute({ sql: 'SELECT emotion, COUNT(*) as count FROM confidences WHERE user_id = ? GROUP BY emotion ORDER BY count DESC', args: [userId] }),
      this.db.execute({ sql: 'SELECT emotion FROM subscriptions WHERE user_id = ?', args: [userId] })
    ]);

    // Streak
    const activityDays = await this.db.execute({
      sql: `SELECT DISTINCT date(created_at/1000, 'unixepoch') as day FROM confidences WHERE user_id = ?
            UNION SELECT DISTINCT date(created_at/1000, 'unixepoch') as day FROM responses WHERE user_id = ?
            ORDER BY day DESC LIMIT 30`,
      args: [userId, userId]
    });
    let streak = 0;
    let checkDate = new Date().toISOString().split('T')[0];
    for (const row of activityDays.rows) {
      if (row.day === checkDate) {
        streak++;
        const d = new Date(checkDate);
        d.setDate(d.getDate() - 1);
        checkDate = d.toISOString().split('T')[0];
      } else break;
    }

    const isPremium = user.rows[0].premium === 1;
    const [postsThisWeek, commentsThisWeek] = await Promise.all([this.checkPostLimit(userId), this.checkCommentLimit(userId)]);

    let settings = {};
    try { settings = JSON.parse(user.rows[0].settings || '{}'); } catch { settings = { theme: 'dark', avatar: 'moon', language: 'en' }; }

    return {
      success: true,
      profile: {
        ...user.rows[0],
        settings,
        stats: {
          confidencesCount: confidences.rows.length,
          reactionsReceived: totalReactions.rows[0].c,
          responsesReceived: totalResponses.rows[0].c,
          peopleHelped: helpedCount.rows[0].c,
          streak,
          emotionDistribution: emotionStats.rows
        },
        subscriptions: subscriptions.rows.map(r => r.emotion),
        limits: {
          postsThisWeek,
          postLimitPerWeek: LIMITS.POST_PER_WEEK,
          canPost: isPremium || postsThisWeek < LIMITS.POST_PER_WEEK,
          commentsThisWeek,
          commentLimitPerWeek: LIMITS.COMMENTS_PER_WEEK,
          canComment: isPremium || commentsThisWeek < LIMITS.COMMENTS_PER_WEEK,
          commentsLeft: isPremium ? 999 : Math.max(0, LIMITS.COMMENTS_PER_WEEK - commentsThisWeek),
          nextPostReset: this.getNextWeekReset(),
          nextCommentReset: this.getNextWeekReset()
        },
        confidences: confidences.rows
      }
    };
  }

  async updateSettings(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    await this.db.execute({ sql: 'UPDATE users SET settings = ? WHERE id = ?', args: [JSON.stringify(data), userId] });
    return { success: true };
  }

  async deleteAccount(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    await this.db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [userId] });
    return { success: true };
  }

  // ─── Journal (Premium) ───────────────────────────────────────────────────────

  async createJournalEntry(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const user = await this.db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0 || user.rows[0].premium !== 1) return { success: false, message: 'Premium required', limitType: 'premium' };

    const contentValidation = this.validateContent(data.content);
    if (!contentValidation.valid) return { success: false, message: contentValidation.message };

    const entryId = this.generateId('jrn');
    await this.db.execute({
      sql: 'INSERT INTO journal_entries (id, user_id, content, mood, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [entryId, userId, contentValidation.value, data.mood || null, Date.now()]
    });
    return { success: true, entryId };
  }

  async getJournalEntries(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const user = await this.db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0 || user.rows[0].premium !== 1) return { success: false, message: 'Premium required', limitType: 'premium' };
    const entries = await this.db.execute({ sql: 'SELECT * FROM journal_entries WHERE user_id = ? ORDER BY created_at DESC', args: [userId] });
    return { success: true, entries: entries.rows };
  }

  // ─── Weekly Prompt ────────────────────────────────────────────────────────

  getWeeklyPromptPublic() {
    return { success: true, prompt: this.getWeeklyPrompt() };
  }

  // ─── Admin ───────────────────────────────────────────────────────────────────

  async getAdminStats() {
    const now = Date.now();
    const oneDayAgo = now - 86400000;
    const oneWeekAgo = now - 7 * 86400000;

    const [totalUsers, newUsersToday, newUsersWeek, premiumUsers,
           totalConf, activeConf, newConfToday, newConfWeek,
           totalResp, newRespToday, totalReact, totalNotifs] = await Promise.all([
      this.db.execute('SELECT COUNT(*) as c FROM users'),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM users WHERE created_at > ?', args: [oneDayAgo] }),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM users WHERE created_at > ?', args: [oneWeekAgo] }),
      this.db.execute('SELECT COUNT(*) as c FROM users WHERE premium = 1'),
      this.db.execute('SELECT COUNT(*) as c FROM confidences'),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE expires_at > ?', args: [now] }),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE created_at > ?', args: [oneDayAgo] }),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE created_at > ?', args: [oneWeekAgo] }),
      this.db.execute('SELECT COUNT(*) as c FROM responses'),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM responses WHERE created_at > ?', args: [oneDayAgo] }),
      this.db.execute('SELECT COUNT(*) as c FROM reactions'),
      this.db.execute('SELECT COUNT(*) as c FROM notifications WHERE read = 0')
    ]);

    const [topEmotions, dailyActivity, topSubscriptions] = await Promise.all([
      this.db.execute({ sql: `SELECT emotion, COUNT(*) as count FROM confidences WHERE expires_at > ? GROUP BY emotion ORDER BY count DESC`, args: [now] }),
      this.db.execute({ sql: `SELECT date(created_at/1000, 'unixepoch') as day, COUNT(*) as confidences FROM confidences WHERE created_at > ? GROUP BY day ORDER BY day`, args: [oneWeekAgo] }),
      this.db.execute('SELECT emotion, COUNT(*) as count FROM subscriptions GROUP BY emotion ORDER BY count DESC')
    ]);

    return {
      success: true,
      stats: {
        users: { total: totalUsers.rows[0].c, newToday: newUsersToday.rows[0].c, newThisWeek: newUsersWeek.rows[0].c, premium: premiumUsers.rows[0].c },
        confidences: { total: totalConf.rows[0].c, active: activeConf.rows[0].c, newToday: newConfToday.rows[0].c, newThisWeek: newConfWeek.rows[0].c },
        responses: { total: totalResp.rows[0].c, newToday: newRespToday.rows[0].c },
        reactions: { total: totalReact.rows[0].c },
        notifications: { unread: totalNotifs.rows[0].c },
        topEmotions: topEmotions.rows,
        dailyActivity: dailyActivity.rows,
        topSubscriptions: topSubscriptions.rows
      }
    };
  }

  async activatePremium(userId, type, headers) {
    if (!this.verifyAdminKey(headers['x-admin-key'])) return { success: false, message: 'Unauthorized' };
    const now = Date.now();
    const durationMs = type === 'yearly' ? 365 * 86400000 : 30 * 86400000;
    await this.db.execute({
      sql: 'UPDATE users SET premium = 1, premium_type = ?, premium_start = ?, premium_end = ? WHERE id = ?',
      args: [type, now, now + durationMs, userId]
    });
    await this.db.execute({
      sql: 'INSERT INTO notifications (id, user_id, type, message, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [this.generateId('notif'), userId, 'premium_activated', `🎉 Your Premium ${type} subscription is now active!`, now]
    });
    return { success: true, message: `Premium ${type} activated for ${userId}` };
  }

  async deactivatePremium(userId, headers) {
    if (!this.verifyAdminKey(headers['x-admin-key'])) return { success: false, message: 'Unauthorized' };
    await this.db.execute({ sql: 'UPDATE users SET premium = 0, premium_type = NULL, premium_end = NULL WHERE id = ?', args: [userId] });
    return { success: true };
  }

  async getPremiumRequests() {
    const r = await this.db.execute({ sql: 'SELECT id, created_at, last_active, premium, premium_type, premium_end FROM users ORDER BY created_at DESC LIMIT 100', args: [] });
    return { success: true, users: r.rows };
  }

  // ─── Maintenance ──────────────────────────────────────────────────────────

  async cleanExpiredConfidences() {
    const result = await this.db.execute({ sql: 'DELETE FROM confidences WHERE expires_at < ?', args: [Date.now()] });
    await this.db.execute({ sql: 'DELETE FROM notifications WHERE read = 1 AND created_at < ?', args: [Date.now() - 30 * 86400000] });
    console.log(`🧹 Cleanup done — removed expired confidences`);
    return result;
  }

  async healthCheck() {
    try {
      await this.db.execute('SELECT 1');
      return { success: true, status: 'healthy', timestamp: Date.now() };
    } catch (e) {
      return { success: false, status: 'unhealthy', error: e.message, timestamp: Date.now() };
    }
  }
}
