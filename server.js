// server.js - BACKEND CONFIDENCE BOOK (Clean & Complete)

import { createClient } from '@libsql/client';

export class ConfidenceBookService {
  constructor() {
    this.db = null;
    this.aiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
    this.aiApiKey = process.env.GROQ_API_KEY;
    this.groqModels = [
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'groq/compound',
      'moonshotai/kimi-k2-instruct',
      'qwen/qwen3-32b'
    ];
  }

  async init() {
    console.log('✅ [BACKEND] Initializing...');
    
    this.db = createClient({
      url: process.env.DATABASE_URL || 'file:local.db',
      authToken: process.env.DATABASE_AUTH_TOKEN
    });

    // Reset tables si demandé (uniquement en DEV)
    if (process.env.RESET_DB === 'true') {
      await this.resetDatabase();
    }

    await this.createTables();
    console.log('✅ [BACKEND] Ready');
  }

  async resetDatabase() {
    console.log('🔄 [BACKEND] Resetting database...');
    
    const tables = ['response_reactions', 'responses', 'reactions', 'confidences', 'notifications', 'devices', 'users'];
    
    for (const table of tables) {
      try {
        await this.db.execute(`DROP TABLE IF EXISTS ${table}`);
        console.log(`   ✅ Dropped table: ${table}`);
      } catch (error) {
        console.log(`   ⚠️ Could not drop ${table}:`, error.message);
      }
    }
    
    console.log('✅ [BACKEND] Database reset complete');
  }

  async createTables() {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS confidences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT NOT NULL,
        moderation_score REAL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE,
        UNIQUE(confidence_id, user_id, type)
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        avatar TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS response_reactions (
        id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE,
        UNIQUE(response_id, user_id, type)
      )
    `);

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        confidence_id TEXT,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE
      )
    `);

    console.log('✅ [BACKEND] Tables ready');
  }

  // ========== AUTH ==========
  
  async authenticateDevice(deviceId) {
    const now = Date.now();
    
    const device = await this.db.execute({
      sql: 'SELECT user_id FROM devices WHERE device_id = ?',
      args: [deviceId]
    });
    
    if (device.rows.length > 0) {
      const userId = device.rows[0].user_id;
      await this.db.execute({
        sql: 'UPDATE devices SET last_seen = ? WHERE device_id = ?',
        args: [now, deviceId]
      });
      console.log('[BACKEND] Existing device:', deviceId);
      return { success: true, userId };
    }
    
    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    
    await this.db.execute({
      sql: 'INSERT INTO users (id, created_at) VALUES (?, ?)',
      args: [userId, now]
    });
    
    await this.db.execute({
      sql: 'INSERT INTO devices (device_id, user_id, last_seen) VALUES (?, ?, ?)',
      args: [deviceId, userId, now]
    });
    
    console.log('[BACKEND] New device:', deviceId, '→', userId);
    return { success: true, userId };
  }

  // ========== CONFIDENCES ==========
  
  async getConfidences(query) {
    const chapter = query.chapter || 'all';
    const userId = query.userId;
    const now = Date.now();
    
    let sql = `
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'soutien') as r_soutien,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'espoir') as r_espoir,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'compatis') as r_compatis,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'pas_seul') as r_pas_seul,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'courage') as r_courage,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'triste') as r_triste
      FROM confidences c
      WHERE c.expires_at > ?
    `;
    
    const args = [now];
    
    if (userId) {
      sql += ' AND c.user_id = ?';
      args.push(userId);
    } else if (chapter !== 'all') {
      sql += ' AND c.emotion = ?';
      args.push(chapter);
    }
    
    sql += ' ORDER BY c.created_at DESC LIMIT 50';
    
    const result = await this.db.execute({ sql, args });
    
    const confidences = await Promise.all(result.rows.map(async (row) => {
      const responses = await this.db.execute({
        sql: 'SELECT * FROM responses WHERE confidence_id = ? ORDER BY created_at ASC',
        args: [row.id]
      });
      
      const responsesWithReactions = await Promise.all(responses.rows.map(async (resp) => {
        const rr = await this.db.execute({
          sql: `SELECT 
            (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'soutien') as r_soutien,
            (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'espoir') as r_espoir,
            (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'compatis') as r_compatis`,
          args: [resp.id, resp.id, resp.id]
        });
        
        return {
          id: resp.id,
          content: resp.content,
          avatar: resp.avatar,
          reactions: {
            soutien: Number(rr.rows[0].r_soutien),
            espoir: Number(rr.rows[0].r_espoir),
            compatis: Number(rr.rows[0].r_compatis)
          }
        };
      }));
      
      return {
        id: row.id,
        user_id: row.user_id,
        content: row.content,
        emotion: row.emotion,
        reactions: {
          soutien: Number(row.r_soutien),
          espoir: Number(row.r_espoir),
          compatis: Number(row.r_compatis),
          pas_seul: Number(row.r_pas_seul),
          courage: Number(row.r_courage),
          triste: Number(row.r_triste)
        },
        responses: responsesWithReactions
      };
    }));
    
    return { success: true, data: confidences };
  }

  async createConfidence(body, headers) {
    const userId = headers['x-user-id'];
    const { content, emotion } = body;
    
    if (!userId || !content || !emotion) {
      return { success: false, message: 'Champs manquants' };
    }
    
    const moderationResult = await this.moderateContent(content);
    
    if (!moderationResult.approved) {
      return {
        success: false,
        message: moderationResult.message
      };
    }
    
    const id = 'conf_' + Math.random().toString(36).substr(2, 9);
    const now = Date.now();
    const expires = now + (90 * 24 * 60 * 60 * 1000);
    
    await this.db.execute({
      sql: 'INSERT INTO confidences (id, user_id, content, emotion, moderation_score, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [id, userId, content, emotion, moderationResult.score, now, expires]
    });
    
    console.log('[BACKEND] Confidence created:', id);
    return { success: true, confidenceId: id };
  }

  async deleteConfidence(id, headers) {
    const userId = headers['x-user-id'];
    
    const conf = await this.db.execute({
      sql: 'SELECT user_id FROM confidences WHERE id = ?',
      args: [id]
    });
    
    if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) {
      return { success: false, message: 'Non autorisé' };
    }
    
    await this.db.execute({
      sql: 'DELETE FROM confidences WHERE id = ?',
      args: [id]
    });
    
    return { success: true };
  }

  async updateConfidence(id, body, headers) {
    const userId = headers['x-user-id'];
    const { content } = body;
    
    const conf = await this.db.execute({
      sql: 'SELECT user_id FROM confidences WHERE id = ?',
      args: [id]
    });
    
    if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) {
      return { success: false, message: 'Non autorisé' };
    }
    
    const moderationResult = await this.moderateContent(content);
    
    if (!moderationResult.approved) {
      return { success: false, message: moderationResult.message };
    }
    
    await this.db.execute({
      sql: 'UPDATE confidences SET content = ?, moderation_score = ? WHERE id = ?',
      args: [content, moderationResult.score, id]
    });
    
    return { success: true };
  }

  // ========== REACTIONS ==========
  
  async addReaction(body, headers) {
    const userId = headers['x-user-id'];
    const { confidenceId, reactionType } = body;
    
    const existing = await this.db.execute({
      sql: 'SELECT * FROM reactions WHERE confidence_id = ? AND user_id = ? AND type = ?',
      args: [confidenceId, userId, reactionType]
    });
    
    if (existing.rows.length > 0) {
      await this.db.execute({
        sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ? AND type = ?',
        args: [confidenceId, userId, reactionType]
      });
      return { success: true, action: 'removed' };
    }
    
    await this.db.execute({
      sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ?',
      args: [confidenceId, userId]
    });
    
    const id = 'react_' + Math.random().toString(36).substr(2, 9);
    await this.db.execute({
      sql: 'INSERT INTO reactions (id, confidence_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [id, confidenceId, userId, reactionType, Date.now()]
    });
    
    return { success: true, action: 'added' };
  }

  // ========== RESPONSES ==========
  
  async addResponse(body, headers) {
    const userId = headers['x-user-id'];
    const { confidenceId, content } = body;
    
    if (!content || content.trim().length < 3) {
      return { success: false, message: 'Réponse trop courte' };
    }
    
    const moderationResult = await this.moderateContent(content);
    if (!moderationResult.approved) {
      return { success: false, message: moderationResult.message };
    }
    
    const avatars = ['🌙', '☀️', '🌿', '🧘', '🌸', '🦋', '🌊', '🍃', '⭐', '💫'];
    const avatar = avatars[Math.floor(Math.random() * avatars.length)];
    
    const id = 'resp_' + Math.random().toString(36).substr(2, 9);
    await this.db.execute({
      sql: 'INSERT INTO responses (id, confidence_id, user_id, content, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, confidenceId, userId, content, avatar, Date.now()]
    });
    
    const conf = await this.db.execute({
      sql: 'SELECT user_id FROM confidences WHERE id = ?',
      args: [confidenceId]
    });
    
    if (conf.rows.length > 0 && conf.rows[0].user_id !== userId) {
      await this.createNotification(conf.rows[0].user_id, confidenceId, 'new_response', 'Nouvelle réponse à votre confidence 💙');
    }
    
    return { success: true };
  }

  async addResponseReaction(body, headers) {
    const userId = headers['x-user-id'];
    const { responseId, reactionType } = body;
    
    const existing = await this.db.execute({
      sql: 'SELECT * FROM response_reactions WHERE response_id = ? AND user_id = ? AND type = ?',
      args: [responseId, userId, reactionType]
    });
    
    if (existing.rows.length > 0) {
      await this.db.execute({
        sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ? AND type = ?',
        args: [responseId, userId, reactionType]
      });
      return { success: true, action: 'removed' };
    }
    
    await this.db.execute({
      sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ?',
      args: [responseId, userId]
    });
    
    const id = 'rr_' + Math.random().toString(36).substr(2, 9);
    await this.db.execute({
      sql: 'INSERT INTO response_reactions (id, response_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [id, responseId, userId, reactionType, Date.now()]
    });
    
    return { success: true, action: 'added' };
  }

  // ========== NOTIFICATIONS ==========
  
  async createNotification(userId, confidenceId, type, message) {
    const id = 'notif_' + Math.random().toString(36).substr(2, 9);
    await this.db.execute({
      sql: 'INSERT INTO notifications (id, user_id, confidence_id, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, userId, confidenceId, type, message, Date.now()]
    });
  }

  async getNotifications(userId) {
    const result = await this.db.execute({
      sql: 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      args: [userId]
    });
    
    return {
      success: true,
      data: result.rows.map(r => ({
        id: r.id,
        confidence_id: r.confidence_id,
        type: r.type,
        message: r.message,
        read: r.is_read === 1,
        created_at: r.created_at
      }))
    };
  }

  async markAsRead(id) {
    await this.db.execute({
      sql: 'UPDATE notifications SET is_read = 1 WHERE id = ?',
      args: [id]
    });
    return { success: true };
  }

  async getUnreadCount(userId) {
    const result = await this.db.execute({
      sql: 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
      args: [userId]
    });
    return { success: true, count: result.rows[0].count };
  }

  // ========== MODERATION ==========
  
  async moderateContent(content) {
    if (!this.aiApiKey) {
      return { approved: true, score: 0.9, message: 'Dev mode' };
    }
    
    // Règles de détection d'infos personnelles
    const personalInfoPatterns = [
      /\b\d{10,}\b/g, // Numéros de téléphone
      /\b[\w\.-]+@[\w\.-]+\.\w+\b/g, // Emails
      /\b\d{1,5}\s+[\w\s]+(?:rue|avenue|boulevard|place)\b/gi, // Adresses
      /\b(?:né|née|habite|réside|vit)\s+à\s+[\w\s]+\b/gi // Localisation précise
    ];
    
    for (const pattern of personalInfoPatterns) {
      if (pattern.test(content)) {
        return {
          approved: false,
          score: 0.1,
          message: 'Votre message contient des informations personnelles (email, numéro, adresse). Pour votre sécurité, veuillez les retirer.'
        };
      }
    }
    
    for (const model of this.groqModels) {
      try {
        const response = await fetch(this.aiEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.aiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [
              { 
                role: 'system', 
                content: `Modérateur bienveillant. Règles:
- REJETER: violence, haine, spam, infos personnelles (noms, adresses, numéros)
- ACCEPTER: tristesse, peur, vulnérabilité, traumas
Réponds: APPROVED ou REJECTED: raison` 
              },
              { role: 'user', content: `Analyse: "${content}"` }
            ],
            temperature: 0.2,
            max_tokens: 100
          })
        });
        
        if (!response.ok) continue;
        
        const data = await response.json();
        const result = data.choices[0].message.content.trim();
        
        if (result.startsWith('APPROVED')) {
          return { approved: true, score: 0.8, message: 'Validé' };
        } else if (result.startsWith('REJECTED')) {
          return { approved: false, score: 0.2, message: result.replace('REJECTED:', '').trim() };
        }
        
        return { approved: true, score: 0.7, message: 'Validé' };
      } catch (error) {
        continue;
      }
    }
    
    return { approved: true, score: 0.7, message: 'Approved (fallback)' };
  }

  async healthCheck() {
    return {
      timestamp: new Date().toISOString(),
      status: 'ok',
      ai: this.aiApiKey ? 'configured' : 'dev-mode'
    };
  }
}