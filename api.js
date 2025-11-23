// api.js - API GATEWAY CONFIDENCE BOOK V2.0
// NEXUS AXION 4.1 avec Security & Logging

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfidenceBookService } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ========== RATE LIMITING ==========
const rateLimits = new Map();

function checkRateLimit(identifier, limit = 100, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  
  if (!rateLimits.has(identifier)) {
    rateLimits.set(identifier, []);
  }
  
  const requests = rateLimits.get(identifier);
  const validRequests = requests.filter(time => now - time < windowMs);
  
  if (validRequests.length >= limit) {
    console.log(`⚠️ [RATE LIMIT] ${identifier} exceeded (${validRequests.length}/${limit})`);
    return false;
  }
  
  validRequests.push(now);
  rateLimits.set(identifier, validRequests);
  
  return true;
}

// ========== MIDDLEWARE LOGGING ==========
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  console.log(`📡 [API] ${req.method} ${req.path} (IP: ${ip})`);
  next();
});

// ========== BACKEND INIT ==========
let backend;

async function initBackend() {
  console.log('🔧 [API GATEWAY] Initializing backend...');
  backend = new ConfidenceBookService();
  await backend.init();
  console.log('✅ [API GATEWAY] Backend ready');
}

// ========== PAGES HTML ==========
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'welcome.html'));
});

app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'auth.html'));
});

app.get('/feed', (req, res) => {
  res.sendFile(path.join(__dirname, 'feed.html'));
});

app.get('/confidence/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'confidence.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'settings.html'));
});

app.get('/support', (req, res) => {
  res.sendFile(path.join(__dirname, 'support.html'));
});

// ========== API ENDPOINTS ==========

// Health Check
app.get('/api/health', async (req, res) => {
  try {
    const result = await backend.healthCheck();
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create Anonymous User
app.post('/api/auth/anonymous', async (req, res) => {
  try {
    const ip = req.ip;
    if (!checkRateLimit(`auth_${ip}`, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ success: false, message: 'Too many accounts created' });
    }
    
    const result = await backend.createAnonymousUser();
    console.log(`✅ [API] User created: ${result.userId}`);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Verify User ID
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await backend.verifyUserID(userId);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Profile
app.get('/api/profile', async (req, res) => {
  try {
    const result = await backend.getProfile(req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Settings
app.put('/api/settings', async (req, res) => {
  try {
    const result = await backend.updateSettings(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Confidences
app.get('/api/confidences', async (req, res) => {
  try {
    const result = await backend.getConfidences(req.query);
    console.log(`✅ [API] Returned ${result.data?.length || 0} confidences`);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Single Confidence
app.get('/api/confidences/:id', async (req, res) => {
  try {
    const result = await backend.getConfidence(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Create Confidence
app.post('/api/confidences', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!checkRateLimit(`post_${userId}`, 20, 60 * 60 * 1000)) {
      return res.status(429).json({ success: false, message: 'Too many posts' });
    }
    
    console.log(`📝 [API] Creating confidence (emotion: ${req.body.emotion})`);
    const result = await backend.createConfidence(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Confidence
app.put('/api/confidences/:id', async (req, res) => {
  try {
    console.log(`✏️ [API] Updating confidence ${req.params.id}`);
    const result = await backend.updateConfidence(req.params.id, req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete Confidence
app.delete('/api/confidences/:id', async (req, res) => {
  try {
    console.log(`🗑️ [API] Deleting confidence ${req.params.id}`);
    const result = await backend.deleteConfidence(req.params.id, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add Reaction
app.post('/api/reactions', async (req, res) => {
  try {
    const result = await backend.addReaction(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add Response
app.post('/api/responses', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    if (!checkRateLimit(`comment_${userId}`, 50, 60 * 60 * 1000)) {
      return res.status(429).json({ success: false, message: 'Too many comments' });
    }
    
    console.log(`💬 [API] Adding response to confidence ${req.body.confidenceId}`);
    const result = await backend.addResponse(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add Response Reaction
app.post('/api/response-reactions', async (req, res) => {
  try {
    const result = await backend.addResponseReaction(req.body, req.headers);
    res.json(result);
  } catch (error) {
    console.error('❌ [API] Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ========== ERROR HANDLERS ==========
app.use((err, req, res, next) => {
  console.error('💥 [API] Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.use((req, res) => {
  console.warn(`⚠️ [API] 404: ${req.method} ${req.path}`);
  res.status(404).json({ success: false, message: 'Route not found' });
});

// ========== START SERVER ==========
async function startServer() {
  await initBackend();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║   🌌 CONFIDENCE BOOK V2.0                             ║
║   🌐 Server:     http://0.0.0.0:${PORT.toString().padEnd(27)}║
║   📂 Pages:      welcome, auth, feed, profile         ║
║   🛡️  Security:   Rate limiting enabled                ║
║   🤖 AI Models:  5 in fallback                        ║
║   ⚙️  Backend:    server.js                            ║
║   🔀 Gateway:     api.js (this file)                  ║
╚═══════════════════════════════════════════════════════╝
    `);
  });
}

startServer();