import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { BackendService } from './BackendService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

const service = new BackendService();

// --- ROUTES API ---

// Créer un utilisateur
app.post('/api/users/create', async (req, res) => {
    try {
        const { secretPhrase } = req.body;
        if (!secretPhrase) return res.status(400).json({ success: false, message: "Phrase manquante" });
        const result = await service.createUser(secretPhrase);
        res.json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Vérifier un utilisateur (Login)
app.post('/api/users/verify', async (req, res) => {
    try {
        const { input } = req.body;
        if (!input) return res.status(400).json({ success: false, message: "Entrée manquante" });
        const result = await service.verifyUser(input);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Route par défaut (Sert ton fichier HTML)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- DÉMARRAGE DU SERVEUR ---
async function start() {
    try {
        await service.init();
        app.listen(port, () => {
            console.log(`🚀 Serveur Confidence Book prêt !`);
            console.log(`🔗 URL : http://localhost:${port}`);
        });
    } catch (err) {
        console.error("❌ Erreur critique au démarrage :", err);
    }
}

start();
