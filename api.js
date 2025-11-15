// api.js - API GATEWAY CONFIDENCE BOOK
// Point d'entrée unique selon architecture NEXUS AXION 3.5

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfidenceBookService } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.static(__dirname));

// Logging middleware
app.use((req, res, next) => {
  console.log(`📡 [API GATEWAY] ${req.method} ${req.path}`);
  next();
});

// ========== INITIALISER BACKEND ==========
let backend;

async function initBackend() {
  console.log('🔧 [API GATEWAY] Initializing Confidence Book backend...');
  backend = new ConfidenceBookService();
  await backend.init();
  console.log('✅ [API GATEWAY] Backend ready');
}

// ========== EXPOSE FRONTEND ==========
app.get('/', (req, res) => {
  console.log('🌐 [API GATEWAY] Serving frontend');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== API ENDPOINTS ==========

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const result = await backend.healthCheck();
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Authentification anonyme
app.post('/api/auth/anonymous', async (req, res) => {
  try {
    console.log('📡 [API GATEWAY] POST /api/auth/anonymous');
    const result = await backend.createAnonymousUser();
    console.log(`✅ [API GATEWAY] Anonymous user created: ${result.userId}`);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Récupérer confidences
app.get('/api/confidences', async (req, res) => {
  try {
    console.log('📡 [API GATEWAY] GET /api/confidences');
    const result = await backend.getConfidences(req.query);
    console.log(`✅ [API GATEWAY] Returned ${result.data?.length || 0} confidences`);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Créer confidence
app.post('/api/confidences', async (req, res) => {
  try {
    console.log(`📝 [API GATEWAY] Creating confidence:`, {
      emotion: req.body.emotion,
      contentLength: req.body.content?.length
    });
    const result = await backend.createConfidence(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Ajouter réaction
app.post('/api/reactions', async (req, res) => {
  try {
    console.log(`💙 [API GATEWAY] Adding reaction:`, req.body);
    const result = await backend.addReaction(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Ajouter réponse
app.post('/api/responses', async (req, res) => {
  try {
    console.log(`💬 [API GATEWAY] Adding response to confidence ${req.body.confidenceId}`);
    const result = await backend.addResponse(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Supprimer confidence
app.delete('/api/confidences/:id', async (req, res) => {
  try {
    console.log(`🗑️ [API GATEWAY] Deleting confidence ${req.params.id}`);
    const result = await backend.deleteConfidence(req.params.id, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Modifier confidence
app.put('/api/confidences/:id', async (req, res) => {
  try {
    console.log(`✏️ [API GATEWAY] Updating confidence ${req.params.id}`);
    const result = await backend.updateConfidence(req.params.id, req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== ERROR HANDLERS ==========
app.use((err, req, res, next) => {
  console.error('💥 [API GATEWAY] Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
  console.warn(`⚠️ [API GATEWAY] 404: ${req.method} ${req.path}`);
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ========== START SERVER ==========
async function startServer() {
  await initBackend();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║   🌌 CONFIDENCE BOOK - API GATEWAY                    ║
║   🌐 Server:     http://0.0.0.0:${PORT.toString().padEnd(27)}║
║   📂 Frontend:   index.html                           ║
║   ⚙️  Backend:    server.js                            ║
║   🔀 Gateway:     api.js (this file)                  ║
╚═══════════════════════════════════════════════════════╝
    `);
  });
}

startServer();