// server.js - BACKEND CONFIDENCE BOOK V2.0
// 5 IA en fallback + Règles strictes

import { createClient } from '@libsql/client';

export class ConfidenceBookService {
  constructor() {
    this.db = null;
    this.aiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
    this.aiApiKey = process.env.GROQ_API_KEY;
    
    // 5 modèles en fallback (ordre de préférence)
    this.groqModels = [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'gemma2-9b-it',
      'mixtral-8x7b-32768',
      'llama3-groq-70b-8192-tool-use-preview'
    ];
  }

  async init() {
    console.log('✅ [BACKEND] Initializing Confidence Book Service...');
    
    this.db = createClient({
      url: process.env.DATABASE_URL || 'file:local.db',
      authToken: process.env.DATABASE_AUTH_TOKEN
    });

    await this.createTables();
    console.log('✅ [BACKEND] Database connected');
  }

  async createTables() {
    // Users
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_active INTEGER,
        settings TEXT DEFAULT '{}'
      )
    `);

    // Confidences
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS confidences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT NOT NULL,
        moderation_score REAL,
        moderation_message TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Reactions (6 types)
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id),
        UNIQUE(confidence_id, user_id)
      )
    `);

    // Responses
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        avatar TEXT NOT NULL,
        moderation_score REAL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id)
      )
    `);

    // Response Reactions
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS response_reactions (
        id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (response_id) REFERENCES responses(id),
        UNIQUE(response_id, user_id)
      )
    `);

    console.log('✅ [BACKEND] Tables created/verified');
  }

  // ========== AUTHENTIFICATION ==========
  
  async createAnonymousUser() {
    const userId = this.generateAnonymousID();
    const now = Date.now();
    
    await this.db.execute({
      sql: 'INSERT INTO users (id, created_at, last_active) VALUES (?, ?, ?)',
      args: [userId, now, now]
    });
    
    console.log('[BACKEND] Created anonymous user:', userId);
    
    return {
      success: true,
      userId
    };
  }

  generateAnonymousID() {
    const prefix = 'CB_';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    
    for (let i = 0; i < 8; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    
    return prefix + id;
  }

  async verifyUserID(userId) {
    const result = await this.db.execute({
      sql: 'SELECT id FROM users WHERE id = ?',
      args: [userId]
    });
    
    if (result.rows.length > 0) {
      // Update last active
      await this.db.execute({
        sql: 'UPDATE users SET last_active = ? WHERE id = ?',
        args: [Date.now(), userId]
      });
      
      return { success: true, exists: true };
    }
    
    return { success: false, exists: false, message: 'ID introuvable' };
  }

  // ========== PROFIL ==========
  
  async getProfile(headers) {
    const userId = headers['x-user-id'];
    
    if (!userId) {
      return { success: false, message: 'User ID required' };
    }

    // Stats utilisateur
    const confidencesResult = await this.db.execute({
      sql: 'SELECT COUNT(*) as count FROM confidences WHERE user_id = ?',
      args: [userId]
    });

    const reactionsResult = await this.db.execute({
      sql: `SELECT COUNT(*) as count FROM reactions 
            WHERE confidence_id IN (SELECT id FROM confidences WHERE user_id = ?)`,
      args: [userId]
    });

    const responsesResult = await this.db.execute({
      sql: `SELECT COUNT(*) as count FROM responses 
            WHERE confidence_id IN (SELECT id FROM confidences WHERE user_id = ?)`,
      args: [userId]
    });

    const userResult = await this.db.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [userId]
    });

    const settings = userResult.rows[0]?.settings ? JSON.parse(userResult.rows[0].settings) : {};

    return {
      success: true,
      profile: {
        userId,
        confidences: Number(confidencesResult.rows[0].count),
        reactions: Number(reactionsResult.rows[0].count),
        responses: Number(responsesResult.rows[0].count),
        joinedAt: userResult.rows[0]?.created_at,
        settings
      }
    };
  }

  async updateSettings(body, headers) {
    const userId = headers['x-user-id'];
    const { settings } = body;

    await this.db.execute({
      sql: 'UPDATE users SET settings = ? WHERE id = ?',
      args: [JSON.stringify(settings), userId]
    });

    return { success: true };
  }

  // ========== CONFIDENCES ==========
  
  async getConfidences(query) {
    const chapter = query.chapter || 'all';
    const now = Date.now();
    
    let sql = `
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'soutiens') as reactions_soutiens,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'espoir') as reactions_espoir,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'compatis') as reactions_compatis,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'pas_seul') as reactions_pas_seul,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'courage') as reactions_courage,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'triste') as reactions_triste
      FROM confidences c
      WHERE c.expires_at > ?
    `;
    
    const args = [now];
    
    if (chapter !== 'all') {
      sql += ' AND c.emotion = ?';
      args.push(chapter);
    }
    
    sql += ' ORDER BY c.created_at DESC LIMIT 50';
    
    const result = await this.db.execute({ sql, args });
    
    const confidences = await Promise.all(result.rows.map(async (row) => {
      const responsesResult = await this.db.execute({
        sql: 'SELECT * FROM responses WHERE confidence_id = ? ORDER BY created_at ASC',
        args: [row.id]
      });
      
      return {
        id: row.id,
        user_id: row.user_id,
        content: row.content,
        emotion: row.emotion,
        created_at: row.created_at,
        reactions: {
          soutiens: Number(row.reactions_soutiens),
          espoir: Number(row.reactions_espoir),
          compatis: Number(row.reactions_compatis),
          pas_seul: Number(row.reactions_pas_seul),
          courage: Number(row.reactions_courage),
          triste: Number(row.reactions_triste)
        },
        responses: responsesResult.rows.map(r => ({
          id: r.id,
          user_id: r.user_id,
          content: r.content,
          avatar: r.avatar,
          created_at: r.created_at
        }))
      };
    }));
    
    console.log(`[BACKEND] Retrieved ${confidences.length} confidences`);
    
    return {
      success: true,
      data: confidences
    };
  }

  async getConfidence(confidenceId) {
    const result = await this.db.execute({
      sql: `SELECT c.*,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'soutiens') as reactions_soutiens,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'espoir') as reactions_espoir,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'compatis') as reactions_compatis,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'pas_seul') as reactions_pas_seul,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'courage') as reactions_courage,
            (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'triste') as reactions_triste
            FROM confidences c WHERE c.id = ?`,
      args: [confidenceId]
    });

    if (result.rows.length === 0) {
      return { success: false, message: 'Confidence not found' };
    }

    const row = result.rows[0];

    const responsesResult = await this.db.execute({
      sql: 'SELECT * FROM responses WHERE confidence_id = ? ORDER BY created_at ASC',
      args: [confidenceId]
    });

    const confidence = {
      id: row.id,
      user_id: row.user_id,
      content: row.content,
      emotion: row.emotion,
      created_at: row.created_at,
      reactions: {
        soutiens: Number(row.reactions_soutiens),
        espoir: Number(row.reactions_espoir),
        compatis: Number(row.reactions_compatis),
        pas_seul: Number(row.reactions_pas_seul),
        courage: Number(row.reactions_courage),
        triste: Number(row.reactions_triste)
      },
      responses: responsesResult.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        content: r.content,
        avatar: r.avatar,
        created_at: r.created_at
      }))
    };

    return {
      success: true,
      data: confidence
    };
  }

  async createConfidence(body, headers) {
    const userId = headers['x-user-id'];
    const { content, emotion } = body;
    
    if (!userId) {
      return { success: false, message: 'User ID required' };
    }
    
    if (!content || content.trim().length < 10) {
      return { success: false, message: 'La confidence doit contenir au moins 10 caractères' };
    }
    
    if (!emotion) {
      return { success: false, message: 'Tonalité émotionnelle requise' };
    }
    
    console.log('[BACKEND] Moderating confidence with AI...');
    
    const moderationResult = await this.moderateContent(content, 'confidence');
    
    if (!moderationResult.approved) {
      console.log('[BACKEND] Confidence rejected by moderation');
      return {
        success: false,
        moderated: true,
        published: false,
        moderationMessage: moderationResult.message
      };
    }
    
    const confidenceId = 'conf_' + Math.random().toString(36).substr(2, 9);
    const now = Date.now();
    const expiresAt = now + (90 * 24 * 60 * 60 * 1000);
    
    await this.db.execute({
      sql: `INSERT INTO confidences 
            (id, user_id, content, emotion, moderation_score, moderation_message, created_at, expires_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [confidenceId, userId, content, emotion, moderationResult.score, moderationResult.message, now, expiresAt]
    });
    
    console.log('[BACKEND] Confidence created:', confidenceId);
    
    return {
      success: true,
      moderated: moderationResult.warning,
      published: true,
      moderationMessage: moderationResult.message,
      confidenceId
    };
  }

  async deleteConfidence(confidenceId, headers) {
    const userId = headers['x-user-id'];
    
    if (!userId || !confidenceId) {
      return { success: false, message: 'Missing required fields' };
    }
    
    const confidence = await this.db.execute({
      sql: 'SELECT user_id FROM confidences WHERE id = ?',
      args: [confidenceId]
    });
    
    if (confidence.rows.length === 0) {
      return { success: false, message: 'Confidence not found' };
    }
    
    if (confidence.rows[0].user_id !== userId) {
      return { success: false, message: 'Unauthorized' };
    }
    
    await this.db.execute({
      sql: 'DELETE FROM reactions WHERE confidence_id = ?',
      args: [confidenceId]
    });
    
    await this.db.execute({
      sql: 'DELETE FROM responses WHERE confidence_id = ?',
      args: [confidenceId]
    });
    
    await this.db.execute({
      sql: 'DELETE FROM confidences WHERE id = ?',
      args: [confidenceId]
    });
    
    console.log('[BACKEND] Confidence deleted:', confidenceId);
    
    return { success: true };
  }

  async updateConfidence(confidenceId, body, headers) {
    const userId = headers['x-user-id'];
    const { content } = body;
    
    if (!userId || !confidenceId || !content) {
      return { success: false, message: 'Missing required fields' };
    }
    
    const confidence = await this.db.execute({
      sql: 'SELECT user_id FROM confidences WHERE id = ?',
      args: [confidenceId]
    });
    
    if (confidence.rows.length === 0) {
      return { success: false, message: 'Confidence not found' };
    }
    
    if (confidence.rows[0].user_id !== userId) {
      return { success: false, message: 'Unauthorized' };
    }
    
    console.log('[BACKEND] Moderating updated confidence...');
    const moderationResult = await this.moderateContent(content, 'confidence');
    
    if (!moderationResult.approved) {
      return {
        success: false,
        message: moderationResult.message
      };
    }
    
    await this.db.execute({
      sql: 'UPDATE confidences SET content = ?, moderation_score = ?, moderation_message = ? WHERE id = ?',
      args: [content, moderationResult.score, moderationResult.message, confidenceId]
    });
    
    console.log('[BACKEND] Confidence updated:', confidenceId);
    
    return { success: true };
  }

  // ========== RÉACTIONS ==========
  
  async addReaction(body, headers) {
    const userId = headers['x-user-id'];
    const { confidenceId, reactionType } = body;
    
    if (!userId || !confidenceId || !reactionType) {
      return { success: false, message: 'Missing required fields' };
    }
    
    try {
      const existing = await this.db.execute({
        sql: 'SELECT * FROM reactions WHERE confidence_id = ? AND user_id = ?',
        args: [confidenceId, userId]
      });
      
      if (existing.rows.length > 0 && existing.rows[0].type === reactionType) {
        await this.db.execute({
          sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ?',
          args: [confidenceId, userId]
        });
        
        console.log('[BACKEND] Reaction removed (toggle):', reactionType);
        return { success: true, action: 'removed' };
      }
      
      await this.db.execute({
        sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ?',
        args: [confidenceId, userId]
      });
      
      const reactionId = 'react_' + Math.random().toString(36).substr(2, 9);
      const now = Date.now();
      
      await this.db.execute({
        sql: 'INSERT INTO reactions (id, confidence_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [reactionId, confidenceId, userId, reactionType, now]
      });
      
      console.log('[BACKEND] Reaction added:', reactionType);
      
      return { success: true, action: 'added' };
      
    } catch (error) {
      console.error('[BACKEND] Reaction error:', error);
      return { success: false, message: 'Database error' };
    }
  }

  // ========== RÉPONSES ==========
  
  async addResponse(body, headers) {
    const userId = headers['x-user-id'];
    const { confidenceId, content } = body;
    
    if (!userId || !confidenceId || !content) {
      return { success: false, message: 'Missing required fields' };
    }
    
    if (content.trim().length < 5) {
      return { success: false, message: 'La réponse doit contenir au moins 5 caractères' };
    }
    
    console.log('[BACKEND] Moderating response with AI...');
    
    const moderationResult = await this.moderateContent(content, 'response');
    
    if (!moderationResult.approved) {
      console.log('[BACKEND] Response rejected by moderation');
      return {
        success: false,
        message: moderationResult.message
      };
    }
    
    const avatars = ['🌙', '☀️', '🌿', '🧘', '🌸', '🦋', '🌊', '🍃', '⭐', '💫'];
    const avatar = avatars[Math.floor(Math.random() * avatars.length)];
    
    const responseId = 'resp_' + Math.random().toString(36).substr(2, 9);
    const now = Date.now();
    
    await this.db.execute({
      sql: `INSERT INTO responses 
            (id, confidence_id, user_id, content, avatar, moderation_score, created_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [responseId, confidenceId, userId, content, avatar, moderationResult.score, now]
    });
    
    console.log('[BACKEND] Response created:', responseId);
    
    return {
      success: true,
      responseId
    };
  }

  async addResponseReaction(body, headers) {
    const userId = headers['x-user-id'];
    const { responseId, reactionType } = body;
    
    if (!userId || !responseId || !reactionType) {
      return { success: false, message: 'Missing required fields' };
    }
    
    try {
      const existing = await this.db.execute({
        sql: 'SELECT * FROM response_reactions WHERE response_id = ? AND user_id = ?',
        args: [responseId, userId]
      });
      
      if (existing.rows.length > 0 && existing.rows[0].type === reactionType) {
        await this.db.execute({
          sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ?',
          args: [responseId, userId]
        });
        
        return { success: true, action: 'removed' };
      }
      
      await this.db.execute({
        sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ?',
        args: [responseId, userId]
      });
      
      const reactionId = 'rreact_' + Math.random().toString(36).substr(2, 9);
      const now = Date.now();
      
      await this.db.execute({
        sql: 'INSERT INTO response_reactions (id, response_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [reactionId, responseId, userId, reactionType, now]
      });
      
      return { success: true, action: 'added' };
      
    } catch (error) {
      console.error('[BACKEND] Response reaction error:', error);
      return { success: false, message: 'Database error' };
    }
  }

  // ========== MODÉRATION IA (5 MODÈLES) ==========
  
  async moderateContent(content, type) {
    if (!this.aiApiKey) {
      console.log('[BACKEND] No AI key, skipping moderation (dev mode)');
      return {
        approved: true,
        score: 0.9,
        warning: false,
        message: 'Moderation skipped (dev mode)'
      };
    }
    
    const prompt = type === 'confidence' 
      ? this.getModerationPromptConfidence(content)
      : this.getModerationPromptResponse(content);
    
    for (let i = 0; i < this.groqModels.length; i++) {
      const model = this.groqModels[i];
      
      try {
        console.log(`[BACKEND] Calling Groq API (model: ${model})...`);
        
        const response = await fetch(this.aiEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.aiApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { 
                role: 'system', 
                content: 'Tu es un modérateur bienveillant pour Confidence Book. Réponds UNIQUEMENT par APPROVED ou REJECTED: raison ou APPROVED WARNING: message.' 
              },
              { 
                role: 'user', 
                content: prompt 
              }
            ],
            temperature: 0.2,
            max_tokens: 200,
            top_p: 1,
            stream: false
          })
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[BACKEND] Model ${model} failed:`, response.status, errorText);
          
          if (i === this.groqModels.length - 1) {
            console.log('[BACKEND] All models failed, approving by default (fail-open)');
            return {
              approved: true,
              score: 0.7,
              warning: false,
              message: 'Moderation service unavailable'
            };
          }
          
          continue;
        }
        
        const data = await response.json();
        const aiResponse = data.choices[0].message.content.trim();
        
        console.log(`[BACKEND] AI Response (${model}):`, aiResponse);
        
        if (aiResponse.startsWith('APPROVED WARNING')) {
          const warningText = aiResponse.replace('APPROVED WARNING:', '').trim();
          return {
            approved: true,
            score: 0.8,
            warning: true,
            message: warningText
          };
        } else if (aiResponse.startsWith('APPROVED')) {
          return {
            approved: true,
            score: 0.9,
            warning: false,
            message: 'Contenu validé'
          };
        } else if (aiResponse.startsWith('REJECTED')) {
          const reason = aiResponse.replace('REJECTED:', '').trim();
          return {
            approved: false,
            score: 0.2,
            warning: false,
            message: reason || 'Contenu non conforme aux règles de bienveillance'
          };
        }
        
        return {
          approved: true,
          score: 0.7,
          warning: false,
          message: 'Moderation completed'
        };
        
      } catch (error) {
        console.error(`[BACKEND] Model ${model} error:`, error.message);
        
        if (i === this.groqModels.length - 1) {
          console.log('[BACKEND] All models failed, approving by default (fail-open)');
          return {
            approved: true,
            score: 0.7,
            warning: false,
            message: 'Moderation error, content approved by default'
          };
        }
        
        continue;
      }
    }
    
    return {
      approved: true,
      score: 0.7,
      warning: false,
      message: 'Moderation completed with fallback'
    };
  }

  getModerationPromptConfidence(content) {
    return `Tu es un modérateur bienveillant pour Confidence Book, une plateforme de soutien émotionnel anonyme.

MISSION: Déterminer si ce message respecte nos règles.

✅ TOUJOURS ACCEPTER:
- Tristesse, colère, peur, solitude, désespoir
- Pensées suicidaires (c'est un appel à l'aide légitime)
- Récits de trauma, abus, deuil, rupture
- Remise en question identitaire, spirituelle
- Langage cru mais émotionnel ("ma vie est de la merde")

⚠️ ACCEPTER AVEC WARNING:
- Mentions explicites de suicide → Répondre: "APPROVED WARNING: Contenu sensible. Ajoutez ressources d'aide (3114 en France, 1-833-456-4566 au Canada, 0800 32 123 en Belgique)"
- Colère intense mais non violente → "APPROVED WARNING: Rappel de bienveillance"

❌ REJETER:
- Violence explicite: "Je vais le tuer", plans pour blesser
- Haine/discrimination: racisme, homophobie, sexisme
- Spam/publicité
- Contenu sexuel explicite (sauf mention de trauma)
- Hors-sujet total (météo, recettes, etc.)
- Infos personnelles: adresse, nom complet, téléphone

ZONE GRISE (Accepter avec nuance):
- Insultes ex: "Mon ex est un(e) con(ne)" → APPROVED (contexte émotionnel)
- Fantasmes vengeance: "J'aimerais qu'il souffre" → APPROVED (pas de plan concret)
- Critique religion: "Dieu n'existe pas" → APPROVED (questionnement légitime)

MESSAGE À ANALYSER:
"${content}"

RÉPONDS UNIQUEMENT PAR:
- "APPROVED" si le message respecte les règles
- "APPROVED WARNING: [message d'aide]" si sensible mais acceptable
- "REJECTED: [raison courte et bienveillante]" si viole les règles

Réponse:`;
  }

  getModerationPromptResponse(content) {
    return `Tu es un modérateur pour Confidence Book. Analyse cette RÉPONSE à une confidence.

✅ ACCEPTER:
- Empathie: "Je comprends ce que tu ressens"
- Soutien: "Tu n'es pas seul(e)"
- Conseils bienveillants: "As-tu pensé à..."
- Partage d'expérience: "J'ai vécu quelque chose de similaire"

❌ REJETER:
- Jugement: "C'est de ta faute"
- Minimisation: "C'est pas si grave"
- Conseils dangereux: "Ne va pas voir de médecin"
- Prosélytisme: "Seul Dieu peut t'aider"
- Spam/publicité

RÉPONSE À ANALYSER:
"${content}"

RÉPONDS PAR:
- "APPROVED" si bienveillant
- "REJECTED: [raison]" si inapproprié

Réponse:`;
  }

  // ========== HEALTH CHECK ==========
  
  async healthCheck() {
    const checks = {
      timestamp: new Date().toISOString(),
      status: 'ok',
      services: {}
    };
    
    try {
      await this.db.execute('SELECT 1');
      checks.services.database = 'connected';
    } catch (error) {
      checks.services.database = 'offline';
      checks.status = 'degraded';
    }
    
    checks.services.ai = this.aiApiKey ? 'configured' : 'dev-mode';
    checks.services.models = this.groqModels.length + ' models in fallback';
    
    return checks;
  }
}