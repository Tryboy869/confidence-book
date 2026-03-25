import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@libsql/client';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000; // Utilise le port de Render ou 3000

app.use(express.json());
app.use(express.static(__dirname));

const db = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// Initialisation de la base de données
async function initDB() {
  try {
    if (process.env.RESET_DB === 'true') {
      console.log("⚠️ RESET_DB est à true : Nettoyage de la base...");
      await db.execute("DROP TABLE IF EXISTS users;");
    }

    // Création de la table avec les bonnes colonnes (id, hash, created_at)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log("✅ Connexion Turso établie et tables prêtes !");
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation de la base :", error);
    throw error; // Empêche le serveur de se lancer si la DB n'est pas prête
  }
}

// Route de création d'utilisateur
app.post('/api/users/create', async (req, res) => {
    try {
        const { secretPhrase } = req.body;
        // Génération d'un ID unique
        const userId = `CB_${crypto.randomBytes(4).toString('hex')}`;
        // Hachage de la phrase secrète
        const hash = crypto.createHash('sha256').update(secretPhrase || "key").digest('hex');
        
        await db.execute({
            sql: "INSERT INTO users (id, hash, created_at) VALUES (?, ?, ?)",
            args: [userId, hash, new Date().toISOString()] // ISO format pour SQLite/Turso
        });

        res.json({ success: true, userId });
    } catch (e) {
        console.error("Erreur création utilisateur:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Lancement propre : Initialise la DB d'abord, puis lance le serveur
initDB().then(() => {
    app.listen(port, () => {
        console.log(`✅ SERVEUR LANCÉ SUR LE PORT ${port}`);
    });
}).catch(err => {
    console.error("Impossible de démarrer le serveur car la base de données a échoué.");
});
