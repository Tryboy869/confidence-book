import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

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
  POST_PER_WEEK: 1,
  COMMENTS_PER_DAY: 3,
  CONFIDENCE_EXPIRY_DAYS: 90,
  PREMIUM_EXPIRY_DAYS: 36500
};

export class BackendService {
  constructor() { this.db = null; }

  async init() {
    this.db = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN
    });
    await this.migrate();
    if (process.env.RESET_DB === 'true') await this.resetDatabase();
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
        settings TEXT DEFAULT '{"theme":"dark","avatar":"moon","language":"fr"}'
      )`);

      await this.db.execute(`CREATE TABLE IF NOT EXISTS confidences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT NOT NULL,
        moderation_score REAL,
        moderation_message TEXT,
        needs_review INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);

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

      console.log('✅ DB migration OK');
    } catch (err) {
      console.error('❌ Migration failed:', err);
      throw err;
    }
  }

  async resetDatabase() {
    console.log('🔄 Resetting database...');
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

  hashPhrase(phrase) {
    const salt = process.env.HASH_SALT || 'confidence-book-salt-v1';
    return crypto.createHash('sha256').update(salt + phrase).digest('hex');
  }

  async moderateContent(content) {
    const prompt = `Tu es un système de modération pour une plateforme de soutien émotionnel anonyme.
ACCEPTER : tristesse, colère, peur, détresse, pensées suicidaires (appel aide), trauma, langage cru non haineux.
WARNING : mentions de mort/suicide → approuver mais flaguer.
REJETER : violence envers autrui, haine/discrimination, spam, contenu sexuel explicite, infos personnelles identifiables.
Contenu : "${content.replace(/"/g, '\\"').substring(0, 800)}"
JSON uniquement : {"approved":true/false,"reason":"court","warning":true/false}`;

    for (const model of GROQ_MODELS) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 150 })
        });
        if (!res.ok) continue;
        const data = await res.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
        console.log(`✅ Moderation (${model}): ${result.approved ? 'APPROVED' : 'REJECTED'}`);
        return { approved: result.approved, reason: result.reason, warning: result.warning || false, model };
      } catch (e) {
        console.warn(`⚠️ Model ${model} failed: ${e.message}`);
        continue;
      }
    }
    console.warn('⚠️ All models failed - fail-open');
    return { approved: true, reason: 'fail-open', warning: false, model: 'none' };
  }

  async checkPostLimit(userId) {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const r = await this.db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE user_id = ? AND created_at > ?', args: [userId, oneWeekAgo] });
    return r.rows[0].c;
  }

  async checkCommentLimit(userId) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const r = await this.db.execute({ sql: 'SELECT COUNT(*) as c FROM responses WHERE user_id = ? AND created_at > ?', args: [userId, oneDayAgo] });
    return r.rows[0].c;
  }

  getNextWeekReset() {
    const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  }

  getNextDayReset() {
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ─── Auth ────────────────────────────────────────────────────────────────────

  async createUser(secretPhrase) {
    const userId = this.generateId('CB');
    const phraseHash = this.hashPhrase(secretPhrase);
    const now = Date.now();
    await this.db.execute({
      sql: 'INSERT INTO users (id, secret_phrase_hash, created_at, last_active) VALUES (?, ?, ?, ?)',
      args: [userId, phraseHash, now, now]
    });
    return { success: true, userId };
  }

  async verifyUser(input) {
    let userId = null;
    if (input.startsWith('CB_')) {
      const r = await this.db.execute({ sql: 'SELECT id FROM users WHERE id = ?', args: [input] });
      if (r.rows.length > 0) userId = input;
    } else {
      const r = await this.db.execute({ sql: 'SELECT id FROM users WHERE secret_phrase_hash = ?', args: [this.hashPhrase(input)] });
      if (r.rows.length > 0) userId = r.rows[0].id;
    }
    if (userId) {
      await this.db.execute({ sql: 'UPDATE users SET last_active = ? WHERE id = ?', args: [Date.now(), userId] });
      return { success: true, userId };
    }
    return { success: false, message: 'ID ou phrase secrète invalide' };
  }

  // ─── Confidences ─────────────────────────────────────────────────────────────

  async createConfidence(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const user = await this.db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0) return { success: false, message: 'User not found' };

    const isPremium = user.rows[0].premium === 1;

    if (!isPremium) {
      const postsThisWeek = await this.checkPostLimit(userId);
      if (postsThisWeek >= LIMITS.POST_PER_WEEK) {
        return { success: false, limitType: 'weekly_post', message: `Tu as déjà publié ta confidence de la semaine. Prochain reset le ${this.getNextWeekReset()}.` };
      }
      const count = await this.db.execute({ sql: 'SELECT COUNT(*) as c FROM confidences WHERE user_id = ? AND expires_at > ?', args: [userId, Date.now()] });
      if (count.rows[0].c >= LIMITS.FREE_MAX_CONFIDENCES) {
        return { success: false, limitType: 'max_confidences', message: `Limite de ${LIMITS.FREE_MAX_CONFIDENCES} confidences actives atteinte.` };
      }
    }

    const moderation = await this.moderateContent(data.content);
    if (!moderation.approved) return { success: false, limitType: 'moderation', message: 'Contenu rejeté', reason: moderation.reason };

    const confId = this.generateId('conf');
    const now = Date.now();
    const expiresAt = isPremium
      ? now + LIMITS.PREMIUM_EXPIRY_DAYS * 86400000
      : now + LIMITS.CONFIDENCE_EXPIRY_DAYS * 86400000;

    await this.db.execute({
      sql: 'INSERT INTO confidences (id, user_id, content, emotion, moderation_score, moderation_message, needs_review, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      args: [confId, userId, data.content, data.emotion, 1.0, moderation.reason, moderation.warning ? 1 : 0, now, expiresAt]
    });

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
      sql: `SELECT r.*,
          (SELECT COUNT(*) FROM response_reactions WHERE response_id = r.id) as reaction_count,
          (SELECT type FROM response_reactions WHERE response_id = r.id AND user_id = ?) as user_reaction
        FROM responses r WHERE r.confidence_id = ? ORDER BY r.created_at ASC`,
      args: [userId || '', id]
    });
    return { success: true, confidence: result.rows[0], responses: responses.rows };
  }

  async updateConfidence(id, data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };
    const conf = await this.db.execute({ sql: 'SELECT user_id FROM confidences WHERE id = ?', args: [id] });
    if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) return { success: false, message: 'Not authorized' };
    const moderation = await this.moderateContent(data.content);
    if (!moderation.approved) return { success: false, message: 'Content rejected', reason: moderation.reason };
    await this.db.execute({
      sql: 'UPDATE confidences SET content = ?, emotion = ?, moderation_message = ? WHERE id = ?',
      args: [data.content, data.emotion, moderation.reason, id]
    });
    return { success: true, warning: moderation.warning };
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

    const user = await this.db.execute({ sql: 'SELECT premium FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0) return { success: false, message: 'User not found' };
    const isPremium = user.rows[0].premium === 1;

    if (!isPremium) {
      const commentsToday = await this.checkCommentLimit(userId);
      if (commentsToday >= LIMITS.COMMENTS_PER_DAY) {
        return { success: false, limitType: 'daily_comment', message: `Limite de ${LIMITS.COMMENTS_PER_DAY} commentaires atteinte aujourd'hui. Reset à ${this.getNextDayReset()}.` };
      }
    }

    const moderation = await this.moderateContent(data.content);
    if (!moderation.approved) return { success: false, limitType: 'moderation', message: 'Content rejected', reason: moderation.reason };

    const responseId = this.generateId('resp');
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    await this.db.execute({
      sql: 'INSERT INTO responses (id, confidence_id, user_id, content, avatar, moderation_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [responseId, data.confidenceId, userId, data.content, avatar, 1.0, Date.now()]
    });

    const commentsLeft = isPremium ? 999 : Math.max(0, LIMITS.COMMENTS_PER_DAY - (await this.checkCommentLimit(userId)));
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

  // ─── Profile & Settings ──────────────────────────────────────────────────────

  async getProfile(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const user = await this.db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [userId] });
    if (user.rows.length === 0) return { success: false, message: 'User not found' };

    const [confidences, totalReactions, totalResponses, helpedCount] = await Promise.all([
      this.db.execute({
        sql: `SELECT c.id, c.content, c.emotion, c.created_at, c.expires_at,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count,
            (SELECT COUNT(*) FROM responses WHERE confidence_id = c.id) as response_count
          FROM confidences c WHERE c.user_id = ? ORDER BY c.created_at DESC`,
        args: [userId]
      }),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM reactions r JOIN confidences cf ON r.confidence_id = cf.id WHERE cf.user_id = ?', args: [userId] }),
      this.db.execute({ sql: 'SELECT COUNT(*) as c FROM responses r JOIN confidences cf ON r.confidence_id = cf.id WHERE cf.user_id = ?', args: [userId] }),
      this.db.execute({ sql: `SELECT COUNT(*) as c FROM (SELECT DISTINCT confidence_id FROM reactions WHERE user_id = ? UNION SELECT DISTINCT confidence_id FROM responses WHERE user_id = ?)`, args: [userId, userId] })
    ]);

    const isPremium = user.rows[0].premium === 1;
    const [postsThisWeek, commentsToday] = await Promise.all([this.checkPostLimit(userId), this.checkCommentLimit(userId)]);

    let settings = {};
    try { settings = JSON.parse(user.rows[0].settings || '{}'); } catch { settings = { theme: 'dark', avatar: 'moon', language: 'fr' }; }

    return {
      success: true,
      profile: {
        ...user.rows[0],
        settings,
        stats: {
          confidencesCount: confidences.rows.length,
          reactionsReceived: totalReactions.rows[0].c,
          responsesReceived: totalResponses.rows[0].c,
          peopleHelped: helpedCount.rows[0].c
        },
        limits: {
          postsThisWeek,
          postLimitPerWeek: LIMITS.POST_PER_WEEK,
          canPost: isPremium || postsThisWeek < LIMITS.POST_PER_WEEK,
          commentsToday,
          commentLimitPerDay: LIMITS.COMMENTS_PER_DAY,
          canComment: isPremium || commentsToday < LIMITS.COMMENTS_PER_DAY,
          commentsLeft: isPremium ? 999 : Math.max(0, LIMITS.COMMENTS_PER_DAY - commentsToday),
          nextPostReset: this.getNextWeekReset(),
          nextCommentReset: this.getNextDayReset()
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

  // ─── Admin ───────────────────────────────────────────────────────────────────

  async getAdminStats() {
    const now = Date.now();
    const oneDayAgo = now - 86400000;
    const oneWeekAgo = now - 7 * 86400000;

    const [totalUsers, newUsersToday, newUsersWeek, premiumUsers,
           totalConf, activeConf, newConfToday, newConfWeek,
           totalResp, newRespToday, totalReact] = await Promise.all([
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
      this.db.execute('SELECT COUNT(*) as c FROM reactions')
    ]);

    const topEmotions = await this.db.execute({
      sql: `SELECT emotion, COUNT(*) as count FROM confidences WHERE expires_at > ? GROUP BY emotion ORDER BY count DESC`,
      args: [now]
    });

    const dailyActivity = await this.db.execute({
      sql: `SELECT date(created_at/1000, 'unixepoch') as day, COUNT(*) as confidences
        FROM confidences WHERE created_at > ? GROUP BY day ORDER BY day`,
      args: [oneWeekAgo]
    });

    return {
      success: true,
      stats: {
        users: { total: totalUsers.rows[0].c, newToday: newUsersToday.rows[0].c, newThisWeek: newUsersWeek.rows[0].c, premium: premiumUsers.rows[0].c },
        confidences: { total: totalConf.rows[0].c, active: activeConf.rows[0].c, newToday: newConfToday.rows[0].c, newThisWeek: newConfWeek.rows[0].c },
        responses: { total: totalResp.rows[0].c, newToday: newRespToday.rows[0].c },
        reactions: { total: totalReact.rows[0].c },
        topEmotions: topEmotions.rows,
        dailyActivity: dailyActivity.rows
      }
    };
  }

  async activatePremium(userId, type, headers) {
    const adminKey = headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) return { success: false, message: 'Unauthorized' };
    const now = Date.now();
    const durationMs = type === 'yearly' ? 365 * 86400000 : 30 * 86400000;
    await this.db.execute({
      sql: 'UPDATE users SET premium = 1, premium_type = ?, premium_start = ?, premium_end = ? WHERE id = ?',
      args: [type, now, now + durationMs, userId]
    });
    return { success: true, message: `Premium ${type} activé pour ${userId}` };
  }

  async deactivatePremium(userId, headers) {
    const adminKey = headers['x-admin-key'];
    if (adminKey !== process.env.ADMIN_KEY) return { success: false, message: 'Unauthorized' };
    await this.db.execute({ sql: 'UPDATE users SET premium = 0, premium_type = NULL, premium_end = NULL WHERE id = ?', args: [userId] });
    return { success: true };
  }

  async getPremiumRequests() {
    // Pour le dashboard admin - liste les users récents non-premium pour gestion manuelle
    const result = await this.db.execute({
      sql: 'SELECT id, created_at, last_active, premium, premium_type, premium_end FROM users ORDER BY created_at DESC LIMIT 100',
      args: []
    });
    return { success: true, users: result.rows };
  }

  // ─── Maintenance ─────────────────────────────────────────────────────────────

  async cleanExpiredConfidences() {
    await this.db.execute({ sql: 'DELETE FROM confidences WHERE expires_at < ?', args: [Date.now()] });
    console.log('🧹 Expired confidences cleaned');
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
