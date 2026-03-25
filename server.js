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
const port = 3000;

app.use(express.json());
app.use(express.static(__dirname));

const db = createClient({
  url: process.env.DATABASE_URL, // Cherche l'URL libsql:// sur Render
  authToken: process.env.DATABASE_AUTH_TOKEN, // Cherche le Token sur Render
});

// 2. Fonction d'initialisation automatique
async function initDB() {
  try {
    // Si tu as mis RESET_DB=true sur Render, on nettoie tout
    if (process.env.RESET_DB === 'true') {
      console.log("⚠️ RESET_DB est à true : Nettoyage de la base...");
      await db.execute("DROP TABLE IF EXISTS users;");
    }

    // Création de la table si elle n'existe pas (Indispensable pour Turso vide)
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log("✅ Connexion Turso établie et tables prêtes !");
  } catch (error) {
    console.error("❌ Erreur lors de l'initialisation de la base :", error);
  }
}
initDB();

app.post('/api/users/create', async (req, res) => {
    try {
        const { secretPhrase } = req.body;
        const userId = `CB_${crypto.randomBytes(4).toString('hex')}`;
        const hash = crypto.createHash('sha256').update(secretPhrase || "key").digest('hex');
        
        await db.execute({
            sql: "INSERT INTO users (id, hash, created_at) VALUES (?, ?, ?)",
            args: [userId, hash, Date.now()]
        });
        res.json({ success: true, userId });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

init().then(() => {
    app.listen(port, () => {
        console.log(`SERVEUR LANCÉ SUR LE PORT ${port}`);
    });
});
