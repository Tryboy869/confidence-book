// api.js - ORCHESTRATEUR CENTRAL NEXUS AXION 3.5
// Point d'entrée unique du déploiement - Connecte frontend ↔ backend

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { BackendService } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARE ==========
app.use(express.json());
app.use(express.static(__dirname));

// ========== INITIALISER BACKEND SERVICE ==========
let backend;

async function initBackend() {
  console.log('🔧 [API GATEWAY] Initializing backend service...');
  try {
    backend = new BackendService();
    await backend.init();
    console.log('✅ [API GATEWAY] Backend service ready');
  } catch (error) {
    console.error('❌ [API GATEWAY] Backend init failed:', error);
    process.exit(1);
  }
}

// ========== API GATEWAY ROUTES MAPPING ==========
// Chaque endpoint frontend est mappé automatiquement vers fonction backend

const routeMap = {
  // Health & Diagnostics
  'GET:/api/health': (req) => backend.healthCheck(),
  
  // Confidences CRUD
  'GET:/api/confidences': (req) => backend.getConfidences(req.query),
  'POST:/api/confidences': (req) => backend.publishConfidence(req.body, req.headers),
  
  // Notifications
  'GET:/api/notifications': (req) => backend.getNotifications(req.headers),
  'POST:/api/notifications/:id/read': (req) => backend.markNotificationRead(req.params.id, req.headers),
  
  // Reactions
  'POST:/api/reactions': (req) => backend.addReaction(req.body, req.headers),
};

// ========== ROUTER CENTRAL ==========
// Cette fonction route TOUS les appels API vers le backend

function routeRequest(method, path, req) {
  const routeKey = `${method}:${path}`;
  
  console.log(`📡 [API GATEWAY] Routing: ${routeKey}`);
  console.log(`   └─ Headers:`, req.headers['x-user-id'] ? `User: ${req.headers['x-user-id']}` : 'Anonymous');
  console.log(`   └─ Body:`, req.body ? JSON.stringify(req.body).substring(0, 100) : 'None');
  
  const handler = routeMap[routeKey];
  
  if (!handler) {
    console.error(`❌ [API GATEWAY] Route not found: ${routeKey}`);
    throw new Error(`Route not mapped: ${routeKey}`);
  }
  
  return handler(req);
}

// ========== EXPOSE FRONTEND ==========
app.get('/', (req, res) => {
  console.log('🌐 [API GATEWAY] Serving frontend: index.html');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== API ENDPOINTS (AUTO-ROUTED) ==========

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const result = await routeRequest('GET', '/api/health', req);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Health check error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get Confidences
app.get('/api/confidences', async (req, res) => {
  try {
    const result = await routeRequest('GET', '/api/confidences', req);
    console.log(`✅ [API GATEWAY] Returned ${result.data?.length || 0} confidences`);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Get confidences error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement'
    });
  }
});

// Publish Confidence
app.post('/api/confidences', async (req, res) => {
  try {
    console.log(`📝 [API GATEWAY] Publishing confidence (${req.body?.text?.length || 0} chars)`);
    const result = await routeRequest('POST', '/api/confidences', req);
    
    if (result.success) {
      console.log(`✅ [API GATEWAY] Confidence published: ${result.data?.id}`);
    } else {
      console.warn(`⚠️ [API GATEWAY] Confidence rejected: ${result.message}`);
    }
    
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Publish confidence error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la publication'
    });
  }
});

// Get Notifications
app.get('/api/notifications', async (req, res) => {
  try {
    const result = await routeRequest('GET', '/api/notifications', req);
    console.log(`✅ [API GATEWAY] Returned ${result.data?.length || 0} notifications`);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération'
    });
  }
});

// Mark Notification as Read
app.post('/api/notifications/:id/read', async (req, res) => {
  try {
    console.log(`✅ [API GATEWAY] Marking notification as read: ${req.params.id}`);
    const result = await routeRequest('POST', `/api/notifications/${req.params.id}/read`, req);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Mark notification error:', error);
    res.status(500).json({ success: false });
  }
});

// Add Reaction
app.post('/api/reactions', async (req, res) => {
  try {
    console.log(`💙 [API GATEWAY] Adding reaction: ${req.body?.type}`);
    const result = await routeRequest('POST', '/api/reactions', req);
    res.json(result);
  } catch (error) {
    console.error('❌ [API GATEWAY] Add reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'enregistrement'
    });
  }
});

// ========== ERROR HANDLER ==========
app.use((err, req, res, next) => {
  console.error('💥 [API GATEWAY] Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Erreur serveur interne',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ========== 404 HANDLER ==========
app.use((req, res) => {
  console.warn(`⚠️ [API GATEWAY] 404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    message: 'Route introuvable'
  });
});

// ========== START SERVER ==========
async function startServer() {
  try {
    // 1. Initialiser backend
    await initBackend();
    
    // 2. Démarrer serveur
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🌌 CONFIDENCE BOOK - API GATEWAY                    ║
║   Architecture: NEXUS AXION 3.5                      ║
║                                                       ║
║   🌐 Server:     http://0.0.0.0:${PORT.toString().padEnd(4)}                    ║
║   📂 Frontend:   index.html (served at /)            ║
║   ⚙️  Backend:    server.js (BackendService)          ║
║   🔀 Gateway:     api.js (this file)                 ║
║                                                       ║
║   Status:                                            ║
║   ✅ Database:    ${backend.db ? 'Connected' : 'Offline'.padEnd(9)}                     ║
║   ✅ AI:          ${backend.groq ? 'Connected' : 'Offline'.padEnd(9)}                     ║
║   ✅ Routing:     ${Object.keys(routeMap).length} endpoints mapped               ║
║                                                       ║
║   🔧 Endpoints:                                       ║
║      GET  /                                          ║
║      GET  /api/health                                ║
║      GET  /api/confidences                           ║
║      POST /api/confidences                           ║
║      GET  /api/notifications                         ║
║      POST /api/notifications/:id/read                ║
║      POST /api/reactions                             ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
      
      console.log('📡 [API GATEWAY] Ready to route requests...\n');
    });
    
  } catch (error) {
    console.error('💥 [API GATEWAY] Failed to start:', error);
    process.exit(1);
  }
}

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGTERM', () => {
  console.log('🛑 [API GATEWAY] SIGTERM received, shutting down...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 [API GATEWAY] SIGINT received, shutting down...');
  process.exit(0);
});

// ========== LAUNCH ==========
startServer();