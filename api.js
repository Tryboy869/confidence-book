// api.js - API GATEWAY CONFIDENCE BOOK (Clean & Complete)

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfidenceBookService } from './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

let backend;

async function startServer() {
  backend = new ConfidenceBookService();
  await backend.init();
  
  // Frontend
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });
  
  // Health
  app.get('/api/health', async (req, res) => {
    const result = await backend.healthCheck();
    res.json(result);
  });
  
  // Auth
  app.post('/api/auth/device', async (req, res) => {
    try {
      const result = await backend.authenticateDevice(req.body.deviceId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  // Confidences
  app.get('/api/confidences', async (req, res) => {
    try {
      const result = await backend.getConfidences(req.query);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/confidences', async (req, res) => {
    try {
      const result = await backend.createConfidence(req.body, req.headers);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.delete('/api/confidences/:id', async (req, res) => {
    try {
      const result = await backend.deleteConfidence(req.params.id, req.headers);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.put('/api/confidences/:id', async (req, res) => {
    try {
      const result = await backend.updateConfidence(req.params.id, req.body, req.headers);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  // Reactions
  app.post('/api/reactions', async (req, res) => {
    try {
      const result = await backend.addReaction(req.body, req.headers);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  // Responses
  app.post('/api/responses', async (req, res) => {
    try {
      const result = await backend.addResponse(req.body, req.headers);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.post('/api/response-reactions', async (req, res) => {
    try {
      const result = await backend.addResponseReaction(req.body, req.headers);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  // Notifications
  app.get('/api/notifications', async (req, res) => {
    try {
      const result = await backend.getNotifications(req.headers['x-user-id']);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.get('/api/notifications/unread', async (req, res) => {
    try {
      const result = await backend.getUnreadCount(req.headers['x-user-id']);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  app.put('/api/notifications/:id/read', async (req, res) => {
    try {
      const result = await backend.markAsRead(req.params.id);
      res.json(result);
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  });
  
  // Errors
  app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
  });
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════╗
║   🌌 CONFIDENCE BOOK                                  ║
║   🌐 http://0.0.0.0:${PORT.toString().padEnd(39)}║
╚═══════════════════════════════════════════════════════╝
    `);
  });
}

startServer();