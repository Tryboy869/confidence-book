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
    url: process.env.DATABASE_URL || "file:local.db"
});

// Initialisation simplifiée
async function init() {
    await db.execute("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, hash TEXT, created_at INTEGER)");
    console.log("Base de données prête");
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
