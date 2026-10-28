"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupRAGTables = setupRAGTables;
exports.getRAGStats = getRAGStats;
exports.clearRAGData = clearRAGData;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function setupRAGTables() {
    console.log('[RAG] Setting up database tables...');
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS rag_chunks (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_url TEXT,
      source_id TEXT,
      jurisdiction TEXT,
      language TEXT DEFAULT 'en',
      document_type TEXT,
      clause_type TEXT,
      user_id TEXT,
      org_id TEXT,
      is_global INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE rag_chunks ADD COLUMN content_hash TEXT;`);
        console.log('[RAG] Added content_hash column');
    }
    catch (e) {
    }
    try {
        await prisma.$executeRawUnsafe(`ALTER TABLE rag_chunks ADD COLUMN word_count INTEGER;`);
        console.log('[RAG] Added word_count column');
    }
    catch (e) {
    }
    const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_chunks_source_type ON rag_chunks(source_type);',
        'CREATE INDEX IF NOT EXISTS idx_chunks_jurisdiction ON rag_chunks(jurisdiction);',
        'CREATE INDEX IF NOT EXISTS idx_chunks_document_type ON rag_chunks(document_type);',
        'CREATE INDEX IF NOT EXISTS idx_chunks_clause_type ON rag_chunks(clause_type);',
        'CREATE INDEX IF NOT EXISTS idx_chunks_user_id ON rag_chunks(user_id);',
        'CREATE INDEX IF NOT EXISTS idx_chunks_org_id ON rag_chunks(org_id);',
        'CREATE INDEX IF NOT EXISTS idx_chunks_is_global ON rag_chunks(is_global);',
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_chunks_content_hash ON rag_chunks(content_hash);',
    ];
    for (const idx of indexes) {
        await prisma.$executeRawUnsafe(idx);
    }
    await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
      content,
      source_name,
      jurisdiction,
      clause_type,
      content='rag_chunks',
      content_rowid='rowid'
    );
  `);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS rag_chunks_ai;`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS rag_chunks_ad;`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS rag_chunks_au;`);
    await prisma.$executeRawUnsafe(`
    CREATE TRIGGER rag_chunks_ai AFTER INSERT ON rag_chunks BEGIN
      INSERT INTO chunk_fts(rowid, content, source_name, jurisdiction, clause_type)
      VALUES (NEW.rowid, NEW.content, NEW.source_name, NEW.jurisdiction, NEW.clause_type);
    END;
  `);
    await prisma.$executeRawUnsafe(`
    CREATE TRIGGER rag_chunks_ad AFTER DELETE ON rag_chunks BEGIN
      INSERT INTO chunk_fts(chunk_fts, rowid, content, source_name, jurisdiction, clause_type)
      VALUES ('delete', OLD.rowid, OLD.content, OLD.source_name, OLD.jurisdiction, OLD.clause_type);
    END;
  `);
    await prisma.$executeRawUnsafe(`
    CREATE TRIGGER rag_chunks_au AFTER UPDATE ON rag_chunks BEGIN
      INSERT INTO chunk_fts(chunk_fts, rowid, content, source_name, jurisdiction, clause_type)
      VALUES ('delete', OLD.rowid, OLD.content, OLD.source_name, OLD.jurisdiction, OLD.clause_type);
      INSERT INTO chunk_fts(rowid, content, source_name, jurisdiction, clause_type)
      VALUES (NEW.rowid, NEW.content, NEW.source_name, NEW.jurisdiction, NEW.clause_type);
    END;
  `);
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS rag_queries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      query TEXT NOT NULL,
      retrieved_count INTEGER,
      top_sources TEXT,
      response_length INTEGER,
      was_helpful INTEGER,
      search_time_ms INTEGER,
      generation_time_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
    await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS chunk_embeddings (
      id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL UNIQUE,
      embedding TEXT NOT NULL,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chunk_id) REFERENCES rag_chunks(id) ON DELETE CASCADE
    );
  `);
    await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON chunk_embeddings(chunk_id);
  `);
    console.log('[RAG] Database setup complete');
}
async function getRAGStats() {
    const total = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*) as count FROM rag_chunks
  `);
    const bySource = await prisma.$queryRawUnsafe(`
    SELECT source_type, COUNT(*) as count FROM rag_chunks GROUP BY source_type
  `);
    const byJuris = await prisma.$queryRawUnsafe(`
    SELECT jurisdiction, COUNT(*) as count FROM rag_chunks
    WHERE jurisdiction IS NOT NULL GROUP BY jurisdiction
  `);
    return {
        totalChunks: Number(total[0]?.count || 0),
        bySourceType: Object.fromEntries(bySource.map((r) => [r.source_type, Number(r.count)])),
        byJurisdiction: Object.fromEntries(byJuris.map((r) => [r.jurisdiction, Number(r.count)])),
    };
}
async function clearRAGData() {
    console.log('[RAG] Clearing all RAG data...');
    await prisma.$executeRawUnsafe(`DELETE FROM chunk_embeddings;`);
    await prisma.$executeRawUnsafe(`DELETE FROM rag_chunks;`);
    await prisma.$executeRawUnsafe(`DELETE FROM rag_queries;`);
    await prisma.$executeRawUnsafe(`INSERT INTO chunk_fts(chunk_fts) VALUES('rebuild');`);
    console.log('[RAG] All RAG data cleared');
}
//# sourceMappingURL=setup.js.map