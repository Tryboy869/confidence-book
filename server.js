// server.js - BACKEND SERVICE CONFIDENCE BOOK
// Logique métier + Modération IA + Database

import { createClient } from '@libsql/client';

export class ConfidenceBookService {
  constructor() {
    this.db = null;
    this.aiEndpoint = 'https://api.groq.com/openai/v1/chat/completions';
    this.aiApiKey = process.env.GROQ_API_KEY;
    
    // Fallback models (testés et validés via Colab)
    this.groqModels = [
      'llama-3.1-8b-instant',                              // ✅ Testé - Rapide
      'llama-3.3-70b-versatile',                           // ✅ Testé - Puissant
      'groq/compound',                                     // Groq propriétaire
      'moonshotai/kimi-k2-instruct',                       // Moonshot AI
      'qwen/qwen3-32b'                                     // Alibaba Qwen
    ];
  }

  async init() {
    console.log('✅ [BACKEND] Initializing Confidence Book Service...');
    
    // Connexion à Turso (LibSQL)
    this.db = createClient({
      url: process.env.DATABASE_URL || 'file:local.db',
      authToken: process.env.DATABASE_AUTH_TOKEN
    });

    // Créer tables si n'existent pas
    await this.createTables();
    
    console.log('✅ [BACKEND] Database connected');
  }

  async createTables() {
    // Table des utilisateurs anonymes
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);

    // Table des confidences
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

    // Table des réactions
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id),
        UNIQUE(confidence_id, user_id, type)
      )
    `);

    // Table des réponses
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

    // Table des réactions sur les réponses
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS response_reactions (
        id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (response_id) REFERENCES responses(id),
        UNIQUE(response_id, user_id, type)
      )
    `);

    console.log('✅ [BACKEND] Tables created/verified');
  }

  // ========== AUTHENTIFICATION ==========
  
  async createAnonymousUser() {
    const userId = 'user_' + Math.random().toString(36).substr(2, 9);
    const now = Date.now();
    
    await this.db.execute({
      sql: 'INSERT INTO users (id, created_at) VALUES (?, ?)',
      args: [userId, now]
    });
    
    console.log('[BACKEND] Created anonymous user:', userId);
    
    return {
      success: true,
      userId
    };
  }

  // ========== CONFIDENCES ==========
  
  async getConfidences(query) {
    const chapter = query.chapter || 'all';
    const now = Date.now();
    
    let sql = `
      SELECT 
        c.*,
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id AND type = 'soutien') as reactions_soutien,
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
    
    const result = await this.db.execute({
      sql,
      args
    });
    
    // Récupérer les réponses pour chaque confidence
    const confidences = await Promise.all(result.rows.map(async (row) => {
      const responsesResult = await this.db.execute({
        sql: 'SELECT * FROM responses WHERE confidence_id = ? ORDER BY created_at ASC',
        args: [row.id]
      });
      
      // Pour chaque réponse, récupérer les réactions
      const responsesWithReactions = await Promise.all(responsesResult.rows.map(async (resp) => {
        const reactionsResult = await this.db.execute({
          sql: `
            SELECT 
              (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'soutien') as soutien,
              (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'espoir') as espoir,
              (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'compatis') as compatis,
              (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'pas_seul') as pas_seul,
              (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'courage') as courage,
              (SELECT COUNT(*) FROM response_reactions WHERE response_id = ? AND type = 'triste') as triste
          `,
          args: [resp.id, resp.id, resp.id, resp.id, resp.id, resp.id]
        });
        
        const reactionCounts = reactionsResult.rows[0];
        
        return {
          id: resp.id,
          content: resp.content,
          avatar: resp.avatar,
          created_at: resp.created_at,
          reactions: {
            soutien: Number(reactionCounts.soutien),
            espoir: Number(reactionCounts.espoir),
            compatis: Number(reactionCounts.compatis),
            pas_seul: Number(reactionCounts.pas_seul),
            courage: Number(reactionCounts.courage),
            triste: Number(reactionCounts.triste)
          }
        };
      }));
      
      return {
        id: row.id,
        user_id: row.user_id,
        content: row.content,
        emotion: row.emotion,
        created_at: row.created_at,
        reactions: {
          soutien: Number(row.reactions_soutien),
          espoir: Number(row.reactions_espoir),
          compatis: Number(row.reactions_compatis),
          pas_seul: Number(row.reactions_pas_seul),
          courage: Number(row.reactions_courage),
          triste: Number(row.reactions_triste)
        },
        responses: responsesWithReactions
      };
    }));
    
    console.log(`[BACKEND] Retrieved ${confidences.length} confidences`);
    
    return {
      success: true,
      data: confidences
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
    
    // Modération par IA
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
    
    // Créer la confidence
    const confidenceId = 'conf_' + Math.random().toString(36).substr(2, 9);
    const now = Date.now();
    const expiresAt = now + (90 * 24 * 60 * 60 * 1000); // 3 mois
    
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
    
    // Vérifier que l'utilisateur est bien l'auteur
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
    
    // Supprimer les réactions et réponses associées
    await this.db.execute({
      sql: 'DELETE FROM reactions WHERE confidence_id = ?',
      args: [confidenceId]
    });
    
    await this.db.execute({
      sql: 'DELETE FROM responses WHERE confidence_id = ?',
      args: [confidenceId]
    });
    
    // Supprimer la confidence
    await this.db.execute({
      sql: 'DELETE FROM confidences WHERE id = ?',
      args: [confidenceId]
    });
    
    console.log('[BACKEND] Confidence deleted:', confidenceId);
    
    return { success: true };
  }

  // ========== RÉACTIONS SUR RÉPONSES ==========
  
  async addResponseReaction(body, headers) {
    const userId = headers['x-user-id'];
    const { responseId, reactionType } = body;
    
    if (!userId || !responseId || !reactionType) {
      return { success: false, message: 'Missing required fields' };
    }
    
    try {
      // Vérifier si l'utilisateur a déjà cette réaction exacte
      const existing = await this.db.execute({
        sql: 'SELECT * FROM response_reactions WHERE response_id = ? AND user_id = ? AND type = ?',
        args: [responseId, userId, reactionType]
      });
      
      if (existing.rows.length > 0) {
        // Toggle OFF : supprimer la réaction
        await this.db.execute({
          sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ? AND type = ?',
          args: [responseId, userId, reactionType]
        });
        
        console.log('[BACKEND] Response reaction removed (toggle):', reactionType);
        return { success: true, action: 'removed' };
      }
      
      // Supprimer toutes les autres réactions de cet utilisateur sur cette réponse
      await this.db.execute({
        sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ?',
        args: [responseId, userId]
      });
      
      // Ajouter la nouvelle réaction
      const reactionId = 'resp_react_' + Math.random().toString(36).substr(2, 9);
      const now = Date.now();
      
      await this.db.execute({
        sql: 'INSERT INTO response_reactions (id, response_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
        args: [reactionId, responseId, userId, reactionType, now]
      });
      
      console.log('[BACKEND] Response reaction added:', reactionType);
      
      return { success: true, action: 'added' };
      
    } catch (error) {
      console.error('[BACKEND] Response reaction error:', error);
      return { success: false, message: 'Database error' };
    }
  }

  async updateConfidence(confidenceId, body, headers) {
    const userId = headers['x-user-id'];
    const { content } = body;
    
    if (!userId || !confidenceId || !content) {
      return { success: false, message: 'Missing required fields' };
    }
    
    // Vérifier que l'utilisateur est bien l'auteur
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
    
    // Re-modérer le nouveau contenu
    console.log('[BACKEND] Moderating updated confidence...');
    const moderationResult = await this.moderateContent(content, 'confidence');
    
    if (!moderationResult.approved) {
      return {
        success: false,
        message: moderationResult.message
      };
    }
    
    // Mettre à jour
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
      // Vérifier si l'utilisateur a déjà cette réaction exacte
      const existing = await this.db.execute({
        sql: 'SELECT * FROM reactions WHERE confidence_id = ? AND user_id = ? AND type = ?',
        args: [confidenceId, userId, reactionType]
      });
      
      if (existing.rows.length > 0) {
        // Toggle OFF : supprimer la réaction
        await this.db.execute({
          sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ? AND type = ?',
          args: [confidenceId, userId, reactionType]
        });
        
        console.log('[BACKEND] Reaction removed (toggle):', reactionType);
        return { success: true, action: 'removed' };
      }
      
      // Supprimer toutes les autres réactions de cet utilisateur sur cette confidence
      await this.db.execute({
        sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ?',
        args: [confidenceId, userId]
      });
      
      // Ajouter la nouvelle réaction
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
    
    // Modération par IA
    const moderationResult = await this.moderateContent(content, 'response');
    
    if (!moderationResult.approved) {
      console.log('[BACKEND] Response rejected by moderation');
      return {
        success: false,
        message: moderationResult.message
      };
    }
    
    // Générer avatar aléatoire
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

  // ========== MODÉRATION IA ==========
  
  async moderateContent(content, type) {
    // Si pas de clé API, approuver par défaut (mode dev)
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
    
    // Essayer chaque modèle dans l'ordre jusqu'à ce qu'un fonctionne
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
                content: 'Tu es un modérateur bienveillant pour Confidence Book. Réponds UNIQUEMENT par APPROVED ou REJECTED: raison.' 
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
          
          // Si c'est le dernier modèle, fail-open
          if (i === this.groqModels.length - 1) {
            console.log('[BACKEND] All models failed, approving by default (fail-open)');
            return {
              approved: true,
              score: 0.7,
              warning: false,
              message: 'Moderation service unavailable'
            };
          }
          
          // Sinon essayer le prochain modèle
          continue;
        }
        
        const data = await response.json();
        const aiResponse = data.choices[0].message.content.trim();
        
        console.log(`[BACKEND] AI Response (${model}):`, aiResponse);
        
        // Parser la réponse IA
        if (aiResponse.startsWith('APPROVED')) {
          const warningMatch = aiResponse.match(/WARNING: (.+)/);
          return {
            approved: true,
            score: 0.8,
            warning: !!warningMatch,
            message: warningMatch ? warningMatch[1] : 'Contenu validé'
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
        
        // Si format inattendu mais modèle fonctionne, approuver
        return {
          approved: true,
          score: 0.7,
          warning: false,
          message: 'Moderation completed'
        };
        
      } catch (error) {
        console.error(`[BACKEND] Model ${model} error:`, error.message);
        
        // Si c'est le dernier modèle, fail-open
        if (i === this.groqModels.length - 1) {
          console.log('[BACKEND] All models failed, approving by default (fail-open)');
          return {
            approved: true,
            score: 0.7,
            warning: false,
            message: 'Moderation error, content approved by default'
          };
        }
        
        // Sinon essayer le prochain
        continue;
      }
    }
    
    // Fallback final (ne devrait jamais arriver ici)
    return {
      approved: true,
      score: 0.7,
      warning: false,
      message: 'Moderation completed with fallback'
    };
  }

  getModerationPromptConfidence(content) {
    return `Analyse cette confidence et détermine si elle respecte les règles de Confidence Book:

RÈGLES:
- ✅ ACCEPTER: Expressions de tristesse, peur, colère, espoir, vulnérabilité, trauma personnel
- ✅ ACCEPTER: Mentions de pensées suicidaires (c'est un appel à l'aide légitime)
- ❌ REJETER: Incitations à la violence envers autrui
- ❌ REJETER: Discours de haine, racisme, homophobie, sexisme
- ❌ REJETER: Spam, publicité, arnaque
- ❌ REJETER: Contenu sexuel explicite

CONFIDENCE:
"${content}"

Réponds UNIQUEMENT par:
- "APPROVED" si le contenu respecte les règles
- "APPROVED WARNING: [message]" si le contenu est acceptable mais sensible
- "REJECTED: [raison courte]" si le contenu viole les règles

Réponse:`;
  }

  getModerationPromptResponse(content) {
    return `Analyse cette réponse à une confidence et détermine si elle est bienveillante:

RÈGLES:
- ✅ ACCEPTER: Empathie, soutien, conseils constructifs, partage d'expérience
- ❌ REJETER: Jugement, critique dure, minimisation de la douleur
- ❌ REJETER: Conseils dangereux
- ❌ REJETER: Spam, publicité, prosélytisme

RÉPONSE:
"${content}"

Réponds UNIQUEMENT par:
- "APPROVED" si la réponse est bienveillante
- "REJECTED: [raison]" si la réponse n'est pas appropriée

Réponse:`;
  }

  // ========== HEALTH CHECK ==========
  
  async healthCheck() {
    const checks = {
      timestamp: new Date().toISOString(),
      status: 'ok',
      services: {}
    };
    
    // Check database
    try {
      await this.db.execute('SELECT 1');
      checks.services.database = 'connected';
    } catch (error) {
      checks.services.database = 'offline';
      checks.status = 'degraded';
    }
    
    // Check AI
    checks.services.ai = this.aiApiKey ? 'configured' : 'dev-mode';
    
    return checks;
  }
}