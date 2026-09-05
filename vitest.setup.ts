import { afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Use a temporary test database
const testDbPath = path.join(__dirname, 'test_baas_platform.db');

// Clean up any existing test DB
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

// Set env var so database.ts uses test DB
process.env.DB_PATH = testDbPath;
process.env.NODE_ENV = 'test';

// Apply security migration to test DB after it's created
setTimeout(() => {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(testDbPath);
    
    const migration = fs.readFileSync('src/migrations/001_security_auth_fixed.sql', 'utf-8');
    // FIX 2026-09-03: split por ';' rompía con comentarios multilinea ("-- ...")
    // y triggers BEGIN...END. Ahora se parsea respetando bloques (igual que
    // applySqlMigrations() en database.ts).
    const statements: string[] = [];
    let current = '';
    let depth = 0;
    for (const line of migration.split('\n')) {
      current += line + '\n';
      const ups = (line.match(/\bBEGIN\b/gi) || []).length;
      const downs = (line.match(/\bEND\b/gi) || []).length;
      depth += ups - downs;
      const semi = (line.match(/;/g) || []).length;
      if (depth <= 0 && semi > 0) {
        const clean = current.replace(/^(\s*--[^\n]*\n)+/g, '').trim();
        if (clean.length > 0 && !clean.includes('PRAGMA')) statements.push(clean);
        current = '';
        depth = Math.max(0, depth);
      }
    }
    const tail = current.replace(/^(\s*--[^\n]*\n)+/g, '').trim();
    if (tail.length > 0 && !tail.includes('PRAGMA')) statements.push(tail);

    statements.forEach(stmt => {
      try {
        db.exec(stmt);
      } catch (e) {
        if (!e.message.includes('already exists') && !e.message.includes('duplicate column')) {
          console.error('Migration statement failed:', e.message);
        }
      }
    });
    
    console.log('✅ Security migration applied to test DB');
    db.close();
  } catch (error) {
    console.error('⚠️  Security migration failed for test DB:', error.message);
  }
}, 100); // Small delay to ensure DB is initialized

// Cleanup after all tests
afterAll(() => {
  try {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  } catch (e) {
    // ignore
  }
});
