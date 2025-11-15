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
app.use(express.static(__dirname)); // Sert le frontend

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

// ========== ROUTE MAP ==========
const routeMap = {
  'POST:/api/auth/anonymous': (req) => backend.createAnonymousUser(),
  'GET:/api/confidences': (req) => backend.getConfidences(req.query),
  'POST:/api/confidences': (req) => backend.createConfidence(req.body, req.headers),
  'POST:/api/reactions': (req) => backend.addReaction(req.body, req.headers),
  'POST:/api/responses': (req) => backend.addResponse(req.body, req.headers),
  'GET:/api/health': (req) => backend.healthCheck(),
};

// ========== ROUTER CENTRAL ==========
function routeRequest(method, path, req) {
  const routeKey = `${method}:${path}`;
  
  console.log(`📡 [API GATEWAY] ${routeKey}`);
  console.log(`   └─ User: ${req.headers['x-user-id'] || 'anonymous'}`);
  
  const handler = routeMap[routeKey];
  
  if (!handler) {
    console.error(`❌ [API GATEWAY] Route not found: ${routeKey}`);
    throw new Error(`Route not mapped: ${routeKey}`);
  }
  
  return handler(req);
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
    const result = await routeRequest('GET', '/api/health', req);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Authentification anonyme
app.post('/api/auth/anonymous', async (req, res) => {
  try {
    const result = await routeRequest('POST', '/api/auth/anonymous', req);
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
    const result = await routeRequest('GET', '/api/confidences', req);
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
    const result = await routeRequest('POST', '/api/confidences', req);
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
    const result = await routeRequest('POST', '/api/reactions', req);
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
    const result = await routeRequest('POST', '/api/responses', req);
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
║   ✅ Routing:     ${Object.keys(routeMap).length} endpoints mapped                ║
╚═══════════════════════════════════════════════════════╝
    `);
  });
}

startServer();