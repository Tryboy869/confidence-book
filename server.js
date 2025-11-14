// server.js - BACKEND SERVICE REFACTORISÉ
// Expose toutes les fonctions via BackendService class
// NE DÉMARRE PLUS DE SERVEUR - Juste logique métier

import { createClient } from '@libsql/client';
import Groq from 'groq-sdk';

// ========== BACKEND SERVICE CLASS ==========
export class BackendService {
  constructor() {
    this.db = null;
    this.groq = null;
    this.rateLimits = new Map();
    this.aiModeration = null;
    this.notifications = null;
  }

  // ========== INITIALISATION ==========
  async init() {
    console.log('🔧 [BACKEND] Initializing services...');

    // Database (Turso)
    try {
      this.db = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
      });
      
      await this.initDatabase();
      console.log('✅ [BACKEND] Database connected');
    } catch (error) {
      console.error('❌ [BACKEND] Database connection failed:', error);
      throw error;
    }

    // Groq AI
    try {
      this.groq = new Groq({
        apiKey: process.env.GROQ_API_KEY
      });
      console.log('✅ [BACKEND] Groq AI connected');
    } catch (error) {
      console.warn('⚠️ [BACKEND] Groq AI offline, using fallback moderation');
    }

    // Services
    this.aiModeration = new AIModeration(this.groq);
    this.notifications = new NotificationService(this.db);

    // Cleanup job
    this.startCleanupJob();

    console.log('✅ [BACKEND] All services initialized');
  }

  async initDatabase() {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS confidences (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        chapter TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderation_score REAL DEFAULT 1.0,
        ai_flags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id)
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  startCleanupJob() {
    setInterval(async () => {
      try {
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

        const result = await this.db.execute({
          sql: 'DELETE FROM confidences WHERE created_at < ?',
          args: [threeMonthsAgo.toISOString()]
        });

        if (result.rowsAffected > 0) {
          console.log(`🗑️ [BACKEND] Cleaned up ${result.rowsAffected} old confidences`);
        }
      } catch (error) {
        console.error('❌ [BACKEND] Cleanup error:', error);
      }
    }, 24 * 60 * 60 * 1000);
  }

  // ========== RATE LIMITING ==========
  checkRateLimit(userId, maxRequests = 5, windowMs = 60000) {
    const now = Date.now();
    const userLimits = this.rateLimits.get(userId) || [];
    const recentRequests = userLimits.filter(time => now - time < windowMs);

    if (recentRequests.length >= maxRequests) {
      return false;
    }

    recentRequests.push(now);
    this.rateLimits.set(userId, recentRequests);
    return true;
  }

  // ========== EXPOSED API FUNCTIONS ==========

  async healthCheck() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: this.db ? 'connected' : 'offline',
        ai: this.groq ? 'connected' : 'offline'
      }
    };
  }

  async getConfidences(query) {
    const { chapter } = query;

    let sql = `
      SELECT id, text, chapter, created_at 
      FROM confidences 
      WHERE moderation_score >= 0.5
    `;

    if (chapter && chapter !== 'all') {
      sql += ` AND chapter = ?`;
    }

    sql += ` ORDER BY created_at DESC LIMIT 50`;

    const result = chapter && chapter !== 'all'
      ? await this.db.execute({ sql, args: [chapter] })
      : await this.db.execute(sql);

    return {
      success: true,
      data: result.rows
    };
  }

  async publishConfidence(body, headers) {
    const { text, chapter } = body;
    const userId = headers['x-user-id'] || 'anonymous';

    // Validation
    if (!text || text.trim().length < 10) {
      return {
        success: false,
        message: 'Ton message est trop court (minimum 10 caractères)'
      };
    }

    if (text.length > 5000) {
      return {
        success: false,
        message: 'Ton message est trop long (maximum 5000 caractères)'
      };
    }

    const validChapters = ['ruptures', 'isolement', 'trauma', 'espoir'];
    if (!validChapters.includes(chapter)) {
      return {
        success: false,
        message: 'Chapitre invalide'
      };
    }

    // Rate limiting
    if (!this.checkRateLimit(userId, 5, 60000)) {
      await this.notifications.create(userId, 'rate_limit');
      return {
        success: false,
        message: 'Tu publies trop vite. Prends une pause de quelques instants.'
      };
    }

    // Modération IA
    console.log('🤖 [BACKEND] AI moderation started...');
    const moderationResult = await this.aiModeration.analyze(text, chapter);
    console.log(`🤖 [BACKEND] Moderation score: ${moderationResult.score.toFixed(2)}`);

    if (!moderationResult.shouldPublish) {
      await this.notifications.create(userId, 'warning');
      return {
        success: false,
        message: 'Ton message ne respecte pas les règles de bienveillance. Reformule-le avec plus de douceur.'
      };
    }

    // Insertion en base
    const confidenceId = generateId();

    await this.db.execute({
      sql: `INSERT INTO confidences (id, text, chapter, user_id, moderation_score, ai_flags)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        confidenceId,
        text,
        chapter,
        userId,
        moderationResult.score,
        JSON.stringify(moderationResult.flags)
      ]
    });

    // Créer notification selon type
    let notificationCreated = null;

    if (moderationResult.notification.type === 'crisis') {
      notificationCreated = await this.notifications.create(userId, 'crisis', moderationResult.notification.message);
    } else if (moderationResult.notification.type === 'support') {
      notificationCreated = await this.notifications.create(userId, 'support', moderationResult.notification.message);
    }

    return {
      success: true,
      message: 'Confidence publiée avec succès',
      data: {
        id: confidenceId,
        moderationScore: moderationResult.score,
        notification: notificationCreated
      }
    };
  }

  async getNotifications(headers) {
    const userId = headers['x-user-id'] || 'anonymous';
    const unreadNotifications = await this.notifications.getUnread(userId);

    return {
      success: true,
      data: unreadNotifications
    };
  }

  async markNotificationRead(notificationId, headers) {
    const userId = headers['x-user-id'] || 'anonymous';
    const success = await this.notifications.markAsRead(notificationId, userId);

    return { success };
  }

  async addReaction(body, headers) {
    const { confidenceId, type } = body;
    const userId = headers['x-user-id'] || 'anonymous';

    const validTypes = ['reconforted', 'useful', 'thinking'];
    if (!validTypes.includes(type)) {
      return {
        success: false,
        message: 'Type de réaction invalide'
      };
    }

    const confidence = await this.db.execute({
      sql: 'SELECT id FROM confidences WHERE id = ?',
      args: [confidenceId]
    });

    if (confidence.rows.length === 0) {
      return {
        success: false,
        message: 'Confidence introuvable'
      };
    }

    const reactionId = generateId();

    await this.db.execute({
      sql: `INSERT INTO reactions (id, confidence_id, type, user_id) VALUES (?, ?, ?, ?)`,
      args: [reactionId, confidenceId, type, userId]
    });

    return {
      success: true,
      message: 'Réaction enregistrée'
    };
  }
}

// ========== AI MODERATION SERVICE ==========
class AIModeration {
  constructor(groq) {
    this.groq = groq;
    this.models = [
      'llama-3.3-70b-versatile',
      'llama-3.1-70b-versatile',
      'mixtral-8x7b-32768'
    ];
  }

  async analyze(text, chapter) {
    if (!this.groq) {
      return this.basicFallback(text);
    }

    try {
      const prompt = this.buildPrompt(text, chapter);

      for (const model of this.models) {
        try {
          const completion = await this.groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: model,
            temperature: 0.3,
            max_tokens: 500
          });

          const response = completion.choices[0]?.message?.content;
          return this.parseAIResponse(response);

        } catch (modelError) {
          console.warn(`⚠️ [BACKEND] Model ${model} failed, trying next...`);
          continue;
        }
      }

      return this.basicFallback(text);

    } catch (error) {
      console.error('❌ [BACKEND] AI Moderation error:', error);
      return this.basicFallback(text);
    }
  }

  buildPrompt(text, chapter) {
    const chapterContext = {
      ruptures: 'ruptures amoureuses et relations douloureuses',
      isolement: 'solitude et tristesse profonde',
      trauma: 'expériences traumatisantes',
      espoir: 'reconstruction et moments d\'espoir'
    }[chapter] || 'expression émotionnelle';

    return `Tu es modérateur bienveillant pour Confidence Book, plateforme d'expression émotionnelle anonyme.

CONTEXTE : ${chapterContext}
MESSAGE : "${text}"

ANALYSE selon 3 critères (réponds UNIQUEMENT en JSON) :

{
  "safety_score": 0-10,
  "toxicity": true/false,
  "suicidal_thoughts": true/false,
  "violence": true/false,
  "should_publish": true/false,
  "notification_type": "none" | "support" | "warning" | "crisis",
  "notification_message": "Message personnalisé pour l'utilisateur ou null"
}

RÈGLES :
- safety_score 8-10 = Message sain, publier
- safety_score 5-7 = Pensées sombres LÉGITIMES (accepter + notification support)
- safety_score 0-4 = Toxicité/violence (refuser)
- suicidal_thoughts = true → should_publish: true MAIS notification_type: "crisis"
- toxicity/violence = true → should_publish: false

Sois BIENVEILLANT. Les pensées suicidaires sont légitimes sur cette plateforme.`;
  }

  parseAIResponse(response) {
    try {
      let cleaned = response.trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);
      const normalizedScore = parsed.safety_score / 10;

      return {
        score: normalizedScore,
        shouldPublish: parsed.should_publish,
        flags: {
          toxicity: parsed.toxicity || false,
          suicidal: parsed.suicidal_thoughts || false,
          violence: parsed.violence || false
        },
        notification: {
          type: parsed.notification_type || 'none',
          message: parsed.notification_message
        }
      };

    } catch (error) {
      console.error('❌ [BACKEND] Parse AI response error:', error);
      return this.basicFallback('');
    }
  }

  basicFallback(text) {
    const lower = text.toLowerCase();

    const toxicWords = ['connard', 'salope', 'imbécile', 'con', 'pute'];
    const hasToxic = toxicWords.some(w => lower.includes(w));

    const suicidalWords = ['suicide', 'me tuer', 'en finir', 'plus envie de vivre'];
    const hasSuicidal = suicidalWords.some(w => lower.includes(w));

    const violenceWords = ['tuer', 'frapper', 'cogner'];
    const hasViolence = violenceWords.some(w => lower.includes(w));

    let score = 0.9;
    if (hasToxic) score = 0.2;
    else if (hasViolence) score = 0.3;
    else if (hasSuicidal) score = 0.6;

    return {
      score,
      shouldPublish: score >= 0.5,
      flags: {
        toxicity: hasToxic,
        suicidal: hasSuicidal,
        violence: hasViolence
      },
      notification: hasSuicidal ? {
        type: 'crisis',
        message: null
      } : { type: 'none', message: null }
    };
  }
}

// ========== NOTIFICATION SERVICE ==========
class NotificationService {
  constructor(db) {
    this.db = db;
  }

  async create(userId, type, customMessage = null) {
    const messages = {
      welcome: {
        message: '✨ Bienvenue sur Confidence Book ! Tu peux maintenant partager ton histoire en toute sécurité.',
        type: 'info'
      },
      support: {
        message: '💙 Ton message a été partagé. N\'oublie pas : tu n\'es pas seul(e). La communauté est là pour toi.',
        type: 'support'
      },
      crisis: {
        message: `🆘 Ton histoire mérite d'être entendue. Si tu ressens un danger immédiat :

🇫🇷 3114 (gratuit, 24h/24)
🇧🇪 0800 32 123  
🇨🇦 1-833-456-4566
🇨🇭 143

Tu n'es pas obligé(e) d'être en crise pour appeler. Juste être fatigué(e) de porter ça seul(e).`,
        type: 'crisis'
      },
      warning: {
        message: '⚠️ Ton message contient des éléments qui ne respectent pas notre charte de bienveillance. Reformule-le avec plus de douceur.',
        type: 'warning'
      },
      rate_limit: {
        message: '⏳ Tu publies trop vite. Prends une pause de quelques instants pour réfléchir à ce que tu veux vraiment partager.',
        type: 'warning'
      }
    };

    const notification = messages[type] || { message: customMessage, type: 'info' };

    try {
      const id = generateId();
      await this.db.execute({
        sql: `INSERT INTO notifications (id, user_id, message, type) VALUES (?, ?, ?, ?)`,
        args: [id, userId, notification.message, notification.type]
      });

      return notification;
    } catch (error) {
      console.error('❌ [BACKEND] Notification creation error:', error);
      return null;
    }
  }

  async getUnread(userId) {
    try {
      const result = await this.db.execute({
        sql: `SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 10`,
        args: [userId]
      });

      return result.rows;
    } catch (error) {
      console.error('❌ [BACKEND] Get notifications error:', error);
      return [];
    }
  }

  async markAsRead(notificationId, userId) {
    try {
      await this.db.execute({
        sql: `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
        args: [notificationId, userId]
      });
      return true;
    } catch (error) {
      console.error('❌ [BACKEND] Mark notification read error:', error);
      return false;
    }
  }
}

// ========== HELPERS ==========
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}