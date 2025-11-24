// scripts/reset-db.js - Reset Database Script
// À UTILISER UNIQUEMENT EN DÉVELOPPEMENT OU POUR MIGRATION

import { createClient } from '@libsql/client';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function resetDatabase() {
  console.log('\n🚨 DATABASE RESET SCRIPT 🚨\n');
  console.log('⚠️  WARNING: This will DELETE ALL DATA in the database!');
  console.log('   - All users');
  console.log('   - All confidences');
  console.log('   - All reactions');
  console.log('   - All responses\n');
  
  const confirm1 = await question('Type "YES" to continue: ');
  
  if (confirm1.trim() !== 'YES') {
    console.log('❌ Reset cancelled');
    rl.close();
    return;
  }
  
  const confirm2 = await question('Are you ABSOLUTELY sure? Type "DELETE ALL DATA": ');
  
  if (confirm2.trim() !== 'DELETE ALL DATA') {
    console.log('❌ Reset cancelled');
    rl.close();
    return;
  }
  
  console.log('\n🔧 Connecting to database...');
  
  const db = createClient({
    url: process.env.DATABASE_URL || 'file:local.db',
    authToken: process.env.DATABASE_AUTH_TOKEN
  });
  
  try {
    console.log('🗑️  Dropping all tables...');
    
    await db.execute('DROP TABLE IF EXISTS response_reactions');
    await db.execute('DROP TABLE IF EXISTS responses');
    await db.execute('DROP TABLE IF EXISTS reactions');
    await db.execute('DROP TABLE IF EXISTS confidences');
    await db.execute('DROP TABLE IF EXISTS users');
    
    console.log('✅ All tables dropped');
    
    console.log('🔧 Recreating tables...');
    
    // Users
    await db.execute(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_active INTEGER,
        settings TEXT DEFAULT '{}'
      )
    `);
    
    // Confidences
    await db.execute(`
      CREATE TABLE confidences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        emotion TEXT NOT NULL,
        moderation_score REAL,
        moderation_message TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    // Reactions
    await db.execute(`
      CREATE TABLE reactions (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id),
        UNIQUE(confidence_id, user_id)
      )
    `);
    
    // Responses
    await db.execute(`
      CREATE TABLE responses (
        id TEXT PRIMARY KEY,
        confidence_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        content TEXT NOT NULL,
        avatar TEXT NOT NULL,
        moderation_score REAL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (confidence_id) REFERENCES confidences(id)
      )
    `);
    
    // Response Reactions
    await db.execute(`
      CREATE TABLE response_reactions (
        id TEXT PRIMARY KEY,
        response_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (response_id) REFERENCES responses(id),
        UNIQUE(response_id, user_id)
      )
    `);
    
    console.log('✅ Tables recreated');
    
    console.log('\n✅ DATABASE RESET COMPLETE');
    console.log('   All data has been deleted and tables recreated.\n');
    
  } catch (error) {
    console.error('❌ Error during reset:', error);
  } finally {
    rl.close();
  }
}

resetDatabase();