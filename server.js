import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import crypto from 'crypto';
const service = new BackendService();
service.init();
dotenv.config();

const GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
  'mixtral-8x7b-32768',
  'llama3-70b-8192'
];

const AVATARS = ['moon', 'sun', 'leaf', 'flower', 'butterfly', 'wave', 'sparkles', 'star'];

export class BackendService {
  constructor() {
    this.db = null;
  }

  async init() {
    this.db = createClient({
      url: process.env.DATABASE_URL,
      authToken: process.env.DATABASE_AUTH_TOKEN
    });

    if (process.env.RESET_DB === 'true') {
      await this.resetDatabase();
    }
  }

  async resetDatabase() {
    console.log('🔄 RESET_DB enabled - Resetting database...');
    
    try {
      await this.db.execute('DROP TABLE IF EXISTS response_reactions');
      await this.db.execute('DROP TABLE IF EXISTS responses');
      await this.db.execute('DROP TABLE IF EXISTS reactions');
      await this.db.execute('DROP TABLE IF EXISTS confidences');
      await this.db.execute('DROP TABLE IF EXISTS users');
      
      await this.db.execute(`
        CREATE TABLE users (
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
        )
      `);
      
      await this.db.execute(`
        CREATE TABLE confidences (
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
        )
      `);
      
      await this.db.execute(`
        CREATE TABLE reactions (
          id TEXT PRIMARY KEY,
          confidence_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(confidence_id, user_id),
          FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      
      await this.db.execute(`
        CREATE TABLE responses (
          id TEXT PRIMARY KEY,
          confidence_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          content TEXT NOT NULL,
          avatar TEXT NOT NULL,
          moderation_score REAL,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (confidence_id) REFERENCES confidences(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      
      await this.db.execute(`
        CREATE TABLE response_reactions (
          id TEXT PRIMARY KEY,
          response_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(response_id, user_id),
          FOREIGN KEY (response_id) REFERENCES responses(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
      
      console.log('✅ Database reset complete');
    } catch (error) {
      console.error('❌ Database reset failed:', error);
      throw error;
    }
  }

  generateId(prefix) {
    return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
  }

  hashPhrase(phrase) {
    return crypto.createHash('sha256').update(phrase).digest('hex');
  }

  async moderateContent(content) {
    const prompt = `Tu es un système de modération pour une plateforme de soutien émotionnel anonyme.

RÈGLES DE MODÉRATION :

✅ TOUJOURS ACCEPTER :
- Émotions brutes (tristesse, colère, peur, solitude, désespoir)
- Appels à l'aide (pensées suicidaires, détresse mentale, anxiété)
- Récits de trauma (abus passés, deuil, rupture douloureuse)
- Remise en question (identité, croyances, choix de vie)
- Langage cru non haineux ("ma vie est de la merde")

⚠️ ACCEPTER AVEC WARNING (retourner "warning"):
- Mentions de mort/suicide (publier + afficher ressources d'aide)

❌ REJETER :
- Violence explicite envers autrui ("je vais le tuer")
- Haine/Discrimination (racisme, homophobie, sexisme)
- Spam/Publicité
- Contenu sexuel explicite (MAIS accepter "j'ai été victime d'agression sexuelle")
- Hors-sujet total
- Informations personnelles identifiables (adresse, nom complet, téléphone)

Contenu à modérer : "${content}"

Réponds UNIQUEMENT avec un JSON :
{
  "approved": true/false,
  "reason": "explication courte",
  "warning": true/false
}`;

    for (const model of GROQ_MODELS) {
      try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 200
          })
        });

        if (!response.ok) continue;

        const data = await response.json();
        const result = JSON.parse(data.choices[0].message.content.replace(/```json|```/g, '').trim());
        
        return {
          approved: result.approved,
          reason: result.reason,
          warning: result.warning || false,
          model
        };
      } catch (error) {
        continue;
      }
    }

    return {
      approved: true,
      reason: 'All AI models failed - fail-open',
      warning: false,
      model: 'none'
    };
  }

  async createUser(secretPhrase) {
    const userId = this.generateId('CB');
    const phraseHash = this.hashPhrase(secretPhrase);
    const now = Date.now();

    await this.db.execute({
      sql: 'INSERT INTO users (id, secret_phrase_hash, created_at) VALUES (?, ?, ?)',
      args: [userId, phraseHash, now]
    });

    return { success: true, userId };
  }

  async verifyUser(input) {
    if (input.startsWith('CB_')) {
      const result = await this.db.execute({
        sql: 'SELECT * FROM users WHERE id = ?',
        args: [input]
      });
      
      if (result.rows.length > 0) {
        return { success: true, userId: input };
      }
    } else {
      const phraseHash = this.hashPhrase(input);
      const result = await this.db.execute({
        sql: 'SELECT id FROM users WHERE secret_phrase_hash = ?',
        args: [phraseHash]
      });
      
      if (result.rows.length > 0) {
        return { success: true, userId: result.rows[0].id };
      }
    }

    return { success: false, message: 'Invalid ID or secret phrase' };
  }

  async createConfidence(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const user = await this.db.execute({
      sql: 'SELECT premium FROM users WHERE id = ?',
      args: [userId]
    });

    if (user.rows.length === 0) {
      return { success: false, message: 'User not found' };
    }

    const isPremium = user.rows[0].premium === 1;

    if (!isPremium) {
      const count = await this.db.execute({
        sql: 'SELECT COUNT(*) as total FROM confidences WHERE user_id = ?',
        args: [userId]
      });

      if (count.rows[0].total >= 20) {
        return { success: false, message: 'Confidence limit reached. Upgrade to Premium for unlimited confidences.' };
      }
    }

    const moderation = await this.moderateContent(data.content);

    if (!moderation.approved) {
      return {
        success: false,
        message: 'Content rejected by moderation',
        reason: moderation.reason
      };
    }

   app.post('/api/users/create', async (req, res) => {
    try {
        const { secretPhrase } = req.body;
        if (!secretPhrase) {
            return res.status(400).json({ success: false, message: "Phrase secrète manquante" });
        }

        const result = await service.createUser(secretPhrase);
        res.json(result); // Renvoie l'ID généré (ex: CB_a1b2c3d4)
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Erreur lors de la création" });
    }
});

app.post('/api/users/verify', async (req, res) => {
    try {
        const { input } = req.body; // L'ID ou la phrase secrète tapée par l'utilisateur
        if (!input) {
            return res.status(400).json({ success: false, message: "Entrée manquante" });
        }

        const result = await service.verifyUser(input);
        if (result.success) {
            res.json(result);
        } else {
            res.status(401).json(result);
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Erreur de vérification" });
    }
});

  async getConfidences(chapter, userId) {
    let sql = `
      SELECT c.*, 
        (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count,
        (SELECT COUNT(*) FROM responses WHERE confidence_id = c.id) as response_count,
        (SELECT type FROM reactions WHERE confidence_id = c.id AND user_id = ?) as user_reaction
      FROM confidences c
      WHERE c.expires_at > ?
    `;
    const args = [userId || '', Date.now()];

    if (chapter && chapter !== 'all') {
      sql += ' AND c.emotion = ?';
      args.push(chapter);
    }

    sql += ' ORDER BY c.created_at DESC LIMIT 50';

    const result = await this.db.execute({ sql, args });

    return {
      success: true,
      confidences: result.rows.map(row => ({
        ...row,
        settings: JSON.parse(row.settings || '{}')
      }))
    };
  }

  async getConfidence(id, userId) {
    const result = await this.db.execute({
      sql: `
        SELECT c.*, 
          (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count,
          (SELECT type FROM reactions WHERE confidence_id = c.id AND user_id = ?) as user_reaction
        FROM confidences c
        WHERE c.id = ?
      `,
      args: [userId || '', id]
    });

    if (result.rows.length === 0) {
      return { success: false, message: 'Confidence not found' };
    }

    const responses = await this.db.execute({
      sql: `
        SELECT r.*,
          (SELECT COUNT(*) FROM response_reactions WHERE response_id = r.id) as reaction_count,
          (SELECT type FROM response_reactions WHERE response_id = r.id AND user_id = ?) as user_reaction
        FROM responses r
        WHERE r.confidence_id = ?
        ORDER BY r.created_at ASC
      `,
      args: [userId || '', id]
    });

    return {
      success: true,
      confidence: result.rows[0],
      responses: responses.rows
    };
  }

  async updateConfidence(id, data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const conf = await this.db.execute({
      sql: 'SELECT user_id FROM confidences WHERE id = ?',
      args: [id]
    });

    if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) {
      return { success: false, message: 'Not authorized' };
    }

    const moderation = await this.moderateContent(data.content);

    if (!moderation.approved) {
      return {
        success: false,
        message: 'Content rejected by moderation',
        reason: moderation.reason
      };
    }

    await this.db.execute({
      sql: 'UPDATE confidences SET content = ?, emotion = ?, moderation_score = ?, moderation_message = ? WHERE id = ?',
      args: [data.content, data.emotion, 1.0, moderation.reason, id]
    });

    return { success: true, warning: moderation.warning };
  }

  async deleteConfidence(id, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const conf = await this.db.execute({
      sql: 'SELECT user_id FROM confidences WHERE id = ?',
      args: [id]
    });

    if (conf.rows.length === 0 || conf.rows[0].user_id !== userId) {
      return { success: false, message: 'Not authorized' };
    }

    await this.db.execute({
      sql: 'DELETE FROM confidences WHERE id = ?',
      args: [id]
    });

    return { success: true };
  }

  async toggleReaction(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const existing = await this.db.execute({
      sql: 'SELECT * FROM reactions WHERE confidence_id = ? AND user_id = ?',
      args: [data.confidenceId, userId]
    });

    if (existing.rows.length > 0) {
      if (existing.rows[0].type === data.type) {
        await this.db.execute({
          sql: 'DELETE FROM reactions WHERE confidence_id = ? AND user_id = ?',
          args: [data.confidenceId, userId]
        });
        return { success: true, action: 'removed' };
      } else {
        await this.db.execute({
          sql: 'UPDATE reactions SET type = ? WHERE confidence_id = ? AND user_id = ?',
          args: [data.type, data.confidenceId, userId]
        });
        return { success: true, action: 'updated' };
      }
    }

    const reactionId = this.generateId('react');
    await this.db.execute({
      sql: 'INSERT INTO reactions (id, confidence_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [reactionId, data.confidenceId, userId, data.type, Date.now()]
    });

    return { success: true, action: 'added' };
  }

  async createResponse(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const moderation = await this.moderateContent(data.content);

    if (!moderation.approved) {
      return {
        success: false,
        message: 'Content rejected by moderation',
        reason: moderation.reason
      };
    }

    const responseId = this.generateId('resp');
    const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];

    await this.db.execute({
      sql: 'INSERT INTO responses (id, confidence_id, user_id, content, avatar, moderation_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [responseId, data.confidenceId, userId, data.content, avatar, 1.0, Date.now()]
    });

    return { success: true, responseId };
  }

  async toggleResponseReaction(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const existing = await this.db.execute({
      sql: 'SELECT * FROM response_reactions WHERE response_id = ? AND user_id = ?',
      args: [data.responseId, userId]
    });

    if (existing.rows.length > 0) {
      if (existing.rows[0].type === data.type) {
        await this.db.execute({
          sql: 'DELETE FROM response_reactions WHERE response_id = ? AND user_id = ?',
          args: [data.responseId, userId]
        });
        return { success: true, action: 'removed' };
      } else {
        await this.db.execute({
          sql: 'UPDATE response_reactions SET type = ? WHERE response_id = ? AND user_id = ?',
          args: [data.type, data.responseId, userId]
        });
        return { success: true, action: 'updated' };
      }
    }

    const reactionId = this.generateId('rreact');
    await this.db.execute({
      sql: 'INSERT INTO response_reactions (id, response_id, user_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [reactionId, data.responseId, userId, data.type, Date.now()]
    });

    return { success: true, action: 'added' };
  }

  async getProfile(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    const user = await this.db.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [userId]
    });

    if (user.rows.length === 0) {
      return { success: false, message: 'User not found' };
    }

    const confidences = await this.db.execute({
      sql: `
        SELECT c.id, c.content, c.emotion, c.created_at,
          (SELECT COUNT(*) FROM reactions WHERE confidence_id = c.id) as reaction_count,
          (SELECT COUNT(*) FROM responses WHERE confidence_id = c.id) as response_count
        FROM confidences c
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC
      `,
      args: [userId]
    });

    const totalReactions = await this.db.execute({
      sql: 'SELECT COUNT(*) as total FROM reactions r JOIN confidences c ON r.confidence_id = c.id WHERE c.user_id = ?',
      args: [userId]
    });

    const totalResponses = await this.db.execute({
      sql: 'SELECT COUNT(*) as total FROM responses r JOIN confidences c ON r.confidence_id = c.id WHERE c.user_id = ?',
      args: [userId]
    });

    const helpedCount = await this.db.execute({
      sql: 'SELECT COUNT(*) as total FROM (SELECT DISTINCT confidence_id FROM reactions WHERE user_id = ? UNION SELECT DISTINCT confidence_id FROM responses WHERE user_id = ?)',
      args: [userId, userId]
    });

    return {
      success: true,
      profile: {
        ...user.rows[0],
        settings: JSON.parse(user.rows[0].settings || '{}'),
        stats: {
          confidencesCount: confidences.rows.length,
          reactionsReceived: totalReactions.rows[0].total,
          responsesReceived: totalResponses.rows[0].total,
          peopleHelped: helpedCount.rows[0].total
        },
        confidences: confidences.rows
      }
    };
  }

  async updateSettings(data, headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    await this.db.execute({
      sql: 'UPDATE users SET settings = ? WHERE id = ?',
      args: [JSON.stringify(data), userId]
    });

    return { success: true };
  }

  async deleteAccount(headers) {
    const userId = headers['x-user-id'];
    if (!userId) return { success: false, message: 'Unauthorized' };

    await this.db.execute({
      sql: 'DELETE FROM users WHERE id = ?',
      args: [userId]
    });

    return { success: true };
  }

  async cleanExpiredConfidences() {
    const now = Date.now();
    await this.db.execute({
      sql: 'DELETE FROM confidences WHERE expires_at < ? AND user_id IN (SELECT id FROM users WHERE premium = 0)',
      args: [now]
    });
  }

  async healthCheck() {
    return {
      success: true,
      status: 'healthy',
      timestamp: Date.now()
    };
  }
}
