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

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN, // Vérifie que ce nom est EXACTEMENT le même que sur Render
});

async function init() {
  try {
    // C'est ici que l'erreur arrivait (ligne 24)
    // Si tu as écrit 'client.execute' au lieu de 'db.execute', ça plante !
    if (process.env.RESET_DB === 'true') {
      console.log("🔄 Réinitialisation de la base de données...");
      await client.execute("DROP TABLE IF EXISTS users;"); 
    }
    
    await client.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        password TEXT
      );
    `);
    console.log("✅ Base de données prête");
  } catch (error) {
    console.error("❌ Erreur init:", error);
  }
}

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
