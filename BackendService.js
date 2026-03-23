import { createClient } from '@libsql/client';
import crypto from 'crypto';

export class BackendService {
    constructor() {
        this.db = null;
    }

    async init() {
        this.db = createClient({
            url: process.env.DATABASE_URL || "file:local.db",
            authToken: process.env.DATABASE_AUTH_TOKEN || ""
        });

        if (process.env.RESET_DB === 'true') {
            await this.resetDatabase();
        }
    }

    async resetDatabase() {
        console.log('🔄 Initialisation des tables...');
        try {
            await this.db.execute('DROP TABLE IF EXISTS users');
            await this.db.execute(`
                CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    secret_phrase_hash TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    settings TEXT DEFAULT '{"theme":"dark"}'
                )
            `);
            console.log('✅ Tables créées avec succès.');
        } catch (error) {
            console.error('❌ Erreur Reset DB:', error);
        }
    }

    generateId(prefix) {
        return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
    }

    hashPhrase(phrase) {
        return crypto.createHash('sha256').update(phrase).digest('hex');
    }

    async createUser(secretPhrase) {
        const userId = this.generateId('CB');
        const phraseHash = this.hashPhrase(secretPhrase);
        await this.db.execute({
            sql: 'INSERT INTO users (id, secret_phrase_hash, created_at) VALUES (?, ?, ?)',
            args: [userId, phraseHash, Date.now()]
        });
        return { success: true, userId };
    }
}
