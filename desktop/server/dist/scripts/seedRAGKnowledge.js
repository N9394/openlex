"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedRAGKnowledge = seedRAGKnowledge;
const setup_1 = require("../services/rag/setup");
const ingestion_1 = require("../services/rag/ingestion");
const clauses_1 = require("../data/rag/clauses");
const jurisdiction_1 = require("../data/rag/jurisdiction");
async function seedRAGKnowledge(options = {}) {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     RAG Knowledge Base Seeder          ║');
    console.log('╚════════════════════════════════════════╝\n');
    try {
        console.log('[1/4] Setting up RAG tables...');
        await (0, setup_1.setupRAGTables)();
        const existingStats = await (0, setup_1.getRAGStats)();
        console.log(`[INFO] Existing chunks: ${existingStats.totalChunks}`);
        if (options.clear && existingStats.totalChunks > 0) {
            console.log('[2/4] Clearing existing RAG data...');
            await (0, setup_1.clearRAGData)();
        }
        else if (existingStats.totalChunks > 0) {
            console.log('[2/4] Skipping clear (existing data will be kept)');
        }
        else {
            console.log('[2/4] No existing data to clear');
        }
        console.log('\n[3/4] Ingesting clause templates...');
        console.log(`  - Total clauses: ${clauses_1.CLAUSE_STATS.total}`);
        console.log(`  - Categories: ${Object.keys(clauses_1.CLAUSE_STATS.byCategory).length}`);
        console.log(`  - Document types: ${Object.keys(clauses_1.CLAUSE_STATS.byDocumentType).length}`);
        const clauseResult = await (0, ingestion_1.bulkIngestClauses)(clauses_1.ALL_CLAUSES);
        console.log(`  ✓ Ingested ${clauseResult.success} clauses (${clauseResult.failed} failed)`);
        console.log('\n[4/4] Ingesting jurisdiction knowledge...');
        console.log(`  - Total entries: ${jurisdiction_1.JURISDICTION_STATS.total}`);
        console.log(`  - Jurisdictions: ${Object.keys(jurisdiction_1.JURISDICTION_STATS.byJurisdiction).join(', ')}`);
        console.log(`  - Topics: ${Object.keys(jurisdiction_1.JURISDICTION_STATS.byTopic).length}`);
        const jurisdictionResult = await (0, ingestion_1.bulkIngestJurisdiction)(jurisdiction_1.ALL_JURISDICTION_ENTRIES);
        console.log(`  ✓ Ingested ${jurisdictionResult.success} entries (${jurisdictionResult.failed} failed)`);
        const finalStats = await (0, setup_1.getRAGStats)();
        console.log('\n╔════════════════════════════════════════╗');
        console.log('║          Ingestion Complete            ║');
        console.log('╚════════════════════════════════════════╝');
        console.log(`\nTotal chunks: ${finalStats.totalChunks}`);
        console.log('\nBy source type:');
        for (const [type, count] of Object.entries(finalStats.bySourceType)) {
            console.log(`  - ${type}: ${count}`);
        }
        console.log('\nBy jurisdiction:');
        for (const [juris, count] of Object.entries(finalStats.byJurisdiction)) {
            console.log(`  - ${juris}: ${count}`);
        }
        return { success: true, stats: finalStats };
    }
    catch (error) {
        console.error('\n[ERROR] Ingestion failed:', error);
        return { success: false, error };
    }
}
const args = process.argv.slice(2);
const shouldClear = args.includes('--clear');
seedRAGKnowledge({ clear: shouldClear })
    .then((result) => {
    if (result.success) {
        console.log('\n✅ RAG knowledge base seeded successfully!');
        process.exit(0);
    }
    else {
        console.error('\n❌ RAG knowledge base seeding failed');
        process.exit(1);
    }
})
    .catch((err) => {
    console.error('\n❌ Unexpected error:', err);
    process.exit(1);
});
//# sourceMappingURL=seedRAGKnowledge.js.map