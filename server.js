// server.js - Backend Node.js Confidence Book avec IA Groq

import express from 'express';
import { createClient } from '@libsql/client';
import Groq from 'groq-sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.static(__dirname));

// ========== DATABASE (Turso) ==========
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// ========== GROQ AI ==========
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

const AI_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile', 
  'mixtral-8x7b-32768'
];

// ========== INIT DB ==========
async function initDatabase() {
  try {
    await db.execute(`
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
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        type TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id)
      )
    `);
    
    await db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database init error:', error);
  }
}

// ========== MODERATION IA SERVICE ==========
class AIModeration {
  async analyze(text, chapter) {
    try {
      const prompt = this.buildPrompt(text, chapter);
      
      // Essayer les modèles dans l'ordre
      for (const model of AI_MODELS) {
        try {
          const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: model,
            temperature: 0.3,
            max_tokens: 500
          });
          
          const response = completion.choices[0]?.message?.content;
          return this.parseAIResponse(response);
          
        } catch (modelError) {
          console.warn(`⚠️ Model ${model} failed, trying next...`);
          continue;
        }
      }
      
      // Si tous les modèles échouent, fallback basique
      return this.basicFallback(text);
      
    } catch (error) {
      console.error('❌ AI Moderation error:', error);
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
      // Nettoyer la réponse (enlever markdown, etc.)
      let cleaned = response.trim();
      
      // Chercher le JSON
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Normaliser le score entre 0 et 1
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
      console.error('❌ Parse AI response error:', error);
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

const aiModeration = new AIModeration();

// ========== NOTIFICATION SERVICE ==========
class NotificationService {
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
      await db.execute({
        sql: `INSERT INTO notifications (id, user_id, message, type) VALUES (?, ?, ?, ?)`,
        args: [id, userId, notification.message, notification.type]
      });
      
      return notification;
    } catch (error) {
      console.error('❌ Notification creation error:', error);
      return null;
    }
  }
  
  async getUnread(userId) {
    try {
      const result = await db.execute({
        sql: `SELECT * FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY created_at DESC LIMIT 10`,
        args: [userId]
      });
      
      return result.rows;
    } catch (error) {
      console.error('❌ Get notifications error:', error);
      return [];
    }
  }
  
  async markAsRead(notificationId, userId) {
    try {
      await db.execute({
        sql: `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
        args: [notificationId, userId]
      });
      return true;
    } catch (error) {
      console.error('❌ Mark notification read error:', error);
      return false;
    }
  }
}

const notifications = new NotificationService();

// ========== RATE LIMITING ==========
const rateLimits = new Map();

function checkRateLimit(userId, maxRequests = 5, windowMs = 60000) {
  const now = Date.now();
  const userLimits = rateLimits.get(userId) || [];
  const recentRequests = userLimits.filter(time => now - time < windowMs);
  
  if (recentRequests.length >= maxRequests) return false;
  
  recentRequests.push(now);
  rateLimits.set(userId, recentRequests);
  return true;
}

// ========== HELPERS ==========
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// ========== ROUTES ==========

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      ai: groq ? 'connected' : 'offline'
    }
  });
});

// GET confidences
app.get('/api/confidences', async (req, res) => {
  try {
    const { chapter } = req.query;
    
    let query = `
      SELECT id, text, chapter, created_at 
      FROM confidences 
      WHERE moderation_score >= 0.5
    `;
    
    if (chapter && chapter !== 'all') {
      query += ` AND chapter = ?`;
    }
    
    query += ` ORDER BY created_at DESC LIMIT 50`;
    
    const result = chapter && chapter !== 'all' 
      ? await db.execute({ sql: query, args: [chapter] })
      : await db.execute(query);
    
    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('❌ GET confidences error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement'
    });
  }
});

// POST confidence
app.post('/api/confidences', async (req, res) => {
  try {
    const { text, chapter } = req.body;
    const userId = req.headers['x-user-id'] || 'anonymous';
    
    // Validation
    if (!text || text.trim().length < 10) {
      return res.json({
        success: false,
        message: 'Ton message est trop court (minimum 10 caractères)'
      });
    }
    
    if (text.length > 5000) {
      return res.json({
        success: false,
        message: 'Ton message est trop long (maximum 5000 caractères)'
      });
    }
    
    const validChapters = ['ruptures', 'isolement', 'trauma', 'espoir'];
    if (!validChapters.includes(chapter)) {
      return res.json({
        success: false,
        message: 'Chapitre invalide'
      });
    }
    
    // Rate limiting
    if (!checkRateLimit(userId, 5, 60000)) {
      await notifications.create(userId, 'rate_limit');
      return res.json({
        success: false,
        message: 'Tu publies trop vite. Prends une pause de quelques instants.'
      });
    }
    
    // Modération IA
    console.log('🤖 Analysing with AI...');
    const moderationResult = await aiModeration.analyze(text, chapter);
    
    if (!moderationResult.shouldPublish) {
      await notifications.create(userId, 'warning');
      return res.json({
        success: false,
        message: 'Ton message ne respecte pas les règles de bienveillance. Reformule-le avec plus de douceur.'
      });
    }
    
    // Insertion en base
    const confidenceId = generateId();
    
    await db.execute({
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
      notificationCreated = await notifications.create(userId, 'crisis', moderationResult.notification.message);
    } else if (moderationResult.notification.type === 'support') {
      notificationCreated = await notifications.create(userId, 'support', moderationResult.notification.message);
    }
    
    res.json({
      success: true,
      message: 'Confidence publiée avec succès',
      data: {
        id: confidenceId,
        moderationScore: moderationResult.score,
        notification: notificationCreated
      }
    });
    
  } catch (error) {
    console.error('❌ POST confidence error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la publication'
    });
  }
});

// GET notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'] || 'anonymous';
    const unreadNotifications = await notifications.getUnread(userId);
    
    res.json({
      success: true,
      data: unreadNotifications
    });
  } catch (error) {
    console.error('❌ GET notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des notifications'
    });
  }
});

// POST mark notification as read
app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.headers['x-user-id'] || 'anonymous';
    
    const success = await notifications.markAsRead(id, userId);
    
    res.json({ success });
  } catch (error) {
    console.error('❌ Mark notification read error:', error);
    res.status(500).json({ success: false });
  }
});

// POST reaction
app.post('/api/reactions', async (req, res) => {
  try {
    const { confidenceId, type } = req.body;
    const userId = req.headers['x-user-id'] || 'anonymous';
    
    const validTypes = ['reconforted', 'useful', 'thinking'];
    if (!validTypes.includes(type)) {
      return res.json({
        success: false,
        message: 'Type de réaction invalide'
      });
    }
    
    const confidence = await db.execute({
      sql: 'SELECT id FROM confidences WHERE id = ?',
      args: [confidenceId]
    });
    
    if (confidence.rows.length === 0) {
      return res.json({
        success: false,
        message: 'Confidence introuvable'
      });
    }
    
    const reactionId = generateId();
    
    await db.execute({
      sql: `INSERT INTO reactions (id, confidence_id, type, user_id) VALUES (?, ?, ?, ?)`,
      args: [reactionId, confidenceId, type, userId]
    });
    
    res.json({
      success: true,
      message: 'Réaction enregistrée'
    });
    
  } catch (error) {
    console.error('❌ POST reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'enregistrement'
    });
  }
});

// ========== CLEANUP JOB ==========
async function cleanupOldConfidences() {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    
    const result = await db.execute({
      sql: 'DELETE FROM confidences WHERE created_at < ?',
      args: [threeMonthsAgo.toISOString()]
    });
    
    console.log(`🗑️ Cleaned up ${result.rowsAffected} old confidences`);
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
}

setInterval(cleanupOldConfidences, 24 * 60 * 60 * 1000);

// ========== START SERVER ==========
async function startServer() {
  await initDatabase();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    ✅ Confidence Book server running
    🌍 Port: ${PORT}
    🗄️ Database: Turso
    🤖 AI: Groq (${AI_MODELS[0]})
    🛡️ Moderation: Active
    🔔 Notifications: Enabled
    📅 Auto-cleanup: 3 months
    `);
  });
}

startServer();