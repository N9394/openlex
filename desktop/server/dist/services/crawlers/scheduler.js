"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSchedules = getSchedules;
exports.updateSchedule = updateSchedule;
exports.runCrawler = runCrawler;
exports.runScheduledCrawls = runScheduledCrawls;
exports.runAllCrawlers = runAllCrawlers;
exports.getCrawlHistory = getCrawlHistory;
exports.getCrawlerStats = getCrawlerStats;
exports.initializeScheduler = initializeScheduler;
const client_1 = require("@prisma/client");
const bailiiCrawler_1 = require("./bailiiCrawler");
const eurlexCrawler_1 = require("./eurlexCrawler");
const germanLawCrawler_1 = require("./germanLawCrawler");
const canliiCrawler_1 = require("./canliiCrawler");
const justiaCrawler_1 = require("./justiaCrawler");
const prisma = new client_1.PrismaClient();
const CRAWLERS = {
    bailii: bailiiCrawler_1.createBAILIICrawler,
    eurlex: eurlexCrawler_1.createEURLexCrawler,
    germanlaw: germanLawCrawler_1.createGermanLawCrawler,
    canlii: canliiCrawler_1.createCanLIICrawler,
    justia: justiaCrawler_1.createJustiaCrawler,
};
const DEFAULT_SCHEDULES = {
    bailii: { frequency: 'weekly', enabled: true },
    eurlex: { frequency: 'weekly', enabled: true },
    germanlaw: { frequency: 'monthly', enabled: true },
    canlii: { frequency: 'weekly', enabled: true },
    justia: { frequency: 'weekly', enabled: true },
};
function calculateNextRun(frequency, from = new Date()) {
    const next = new Date(from);
    switch (frequency) {
        case 'daily':
            next.setDate(next.getDate() + 1);
            next.setHours(3, 0, 0, 0);
            break;
        case 'weekly':
            next.setDate(next.getDate() + 7);
            next.setHours(3, 0, 0, 0);
            break;
        case 'monthly':
            next.setMonth(next.getMonth() + 1);
            next.setDate(1);
            next.setHours(3, 0, 0, 0);
            break;
    }
    return next;
}
async function getSchedules() {
    try {
        const results = await prisma.$queryRawUnsafe(`SELECT * FROM crawler_schedules ORDER BY crawler`);
        return results.map(r => ({
            crawler: r.crawler,
            frequency: r.frequency,
            lastRun: r.last_run ? new Date(r.last_run) : undefined,
            nextRun: new Date(r.next_run),
            enabled: Boolean(r.enabled),
        }));
    }
    catch (error) {
        console.log('[Scheduler] Schedule table not found, using defaults');
        return Object.entries(DEFAULT_SCHEDULES).map(([crawler, config]) => ({
            crawler,
            frequency: config.frequency,
            nextRun: calculateNextRun(config.frequency),
            enabled: config.enabled,
        }));
    }
}
async function updateSchedule(crawler, updates) {
    try {
        const setClauses = [];
        const params = [];
        if (updates.frequency !== undefined) {
            setClauses.push('frequency = ?');
            params.push(updates.frequency);
        }
        if (updates.enabled !== undefined) {
            setClauses.push('enabled = ?');
            params.push(updates.enabled ? 1 : 0);
        }
        if (updates.nextRun !== undefined) {
            setClauses.push('next_run = ?');
            params.push(updates.nextRun.toISOString());
        }
        if (setClauses.length === 0)
            return false;
        params.push(crawler);
        await prisma.$executeRawUnsafe(`UPDATE crawler_schedules SET ${setClauses.join(', ')} WHERE crawler = ?`, ...params);
        return true;
    }
    catch (error) {
        console.error('[Scheduler] Error updating schedule:', error);
        return false;
    }
}
async function recordCrawlRun(crawler, result) {
    try {
        await prisma.$executeRawUnsafe(`UPDATE crawler_schedules SET last_run = ?, next_run = ? WHERE crawler = ?`, result.completedAt.toISOString(), calculateNextRun(DEFAULT_SCHEDULES[crawler]?.frequency || 'weekly').toISOString(), crawler);
        await prisma.$executeRawUnsafe(`INSERT INTO crawler_runs (crawler, started_at, completed_at, pages_crawled, documents_parsed, documents_ingested, errors, error_messages)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, crawler, result.startedAt.toISOString(), result.completedAt.toISOString(), result.pagesCrawled, result.documentsParsed, result.documentsIngested, result.errors, JSON.stringify(result.errorMessages));
    }
    catch (error) {
        console.error('[Scheduler] Error recording crawl run:', error);
    }
}
async function runCrawler(crawlerName, options) {
    const crawlerFactory = CRAWLERS[crawlerName];
    if (!crawlerFactory) {
        console.error(`[Scheduler] Unknown crawler: ${crawlerName}`);
        return null;
    }
    console.log(`[Scheduler] Starting crawler: ${crawlerName}`);
    try {
        const crawler = crawlerFactory();
        const result = await crawler.crawl(options);
        await recordCrawlRun(crawlerName, result);
        console.log(`[Scheduler] Completed crawler: ${crawlerName}`, {
            documents: result.documentsIngested,
            errors: result.errors,
        });
        return result;
    }
    catch (error) {
        console.error(`[Scheduler] Crawler ${crawlerName} failed:`, error);
        const errorResult = {
            crawler: crawlerName,
            startedAt: new Date(),
            completedAt: new Date(),
            pagesCrawled: 0,
            documentsParsed: 0,
            documentsIngested: 0,
            errors: 1,
            errorMessages: [error instanceof Error ? error.message : String(error)],
            amendmentsDetected: 0,
        };
        await recordCrawlRun(crawlerName, errorResult);
        return errorResult;
    }
}
async function runScheduledCrawls() {
    const results = new Map();
    const schedules = await getSchedules();
    const now = new Date();
    console.log(`[Scheduler] Checking ${schedules.length} schedules...`);
    for (const schedule of schedules) {
        if (!schedule.enabled) {
            console.log(`[Scheduler] Skipping disabled crawler: ${schedule.crawler}`);
            continue;
        }
        if (schedule.nextRun > now) {
            console.log(`[Scheduler] Crawler ${schedule.crawler} not due until ${schedule.nextRun.toISOString()}`);
            continue;
        }
        const result = await runCrawler(schedule.crawler);
        if (result) {
            results.set(schedule.crawler, result);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    console.log(`[Scheduler] Completed ${results.size} crawl runs`);
    return results;
}
async function runAllCrawlers(options) {
    const results = new Map();
    console.log(`[Scheduler] Running all crawlers...`);
    for (const crawlerName of Object.keys(CRAWLERS)) {
        const result = await runCrawler(crawlerName, options);
        if (result) {
            results.set(crawlerName, result);
        }
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    return results;
}
async function getCrawlHistory(crawler, limit = 20) {
    try {
        let sql = `SELECT * FROM crawler_runs`;
        const params = [];
        if (crawler) {
            sql += ` WHERE crawler = ?`;
            params.push(crawler);
        }
        sql += ` ORDER BY completed_at DESC LIMIT ?`;
        params.push(limit);
        const results = await prisma.$queryRawUnsafe(sql, ...params);
        return results.map(r => ({
            crawler: r.crawler,
            startedAt: new Date(r.started_at),
            completedAt: new Date(r.completed_at),
            pagesCrawled: r.pages_crawled,
            documentsParsed: r.documents_parsed,
            documentsIngested: r.documents_ingested,
            errors: r.errors,
            errorMessages: JSON.parse(r.error_messages || '[]'),
            amendmentsDetected: r.amendments_detected || 0,
        }));
    }
    catch (error) {
        console.error('[Scheduler] Error fetching crawl history:', error);
        return [];
    }
}
async function getCrawlerStats() {
    try {
        const [schedules, history] = await Promise.all([
            getSchedules(),
            getCrawlHistory(undefined, 100),
        ]);
        let totalDocuments = 0;
        const byJurisdiction = {};
        for (const run of history) {
            totalDocuments += run.documentsIngested;
        }
        try {
            const jurisdictionCounts = await prisma.$queryRawUnsafe(`SELECT jurisdiction, COUNT(*) as count FROM rag_chunks WHERE jurisdiction IS NOT NULL GROUP BY jurisdiction`);
            for (const row of jurisdictionCounts) {
                byJurisdiction[row.jurisdiction] = row.count;
            }
        }
        catch {
        }
        const sortedHistory = [...history].sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime());
        const lastRun = sortedHistory[0]?.completedAt;
        const enabledSchedules = schedules.filter(s => s.enabled);
        const sortedSchedules = [...enabledSchedules].sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());
        const nextRun = sortedSchedules[0]?.nextRun;
        return {
            crawlers: Object.keys(CRAWLERS),
            totalDocuments,
            lastRunDate: lastRun,
            nextScheduledRun: nextRun,
            byJurisdiction,
        };
    }
    catch (error) {
        console.error('[Scheduler] Error fetching stats:', error);
        return {
            crawlers: Object.keys(CRAWLERS),
            totalDocuments: 0,
            byJurisdiction: {},
        };
    }
}
async function initializeScheduler() {
    try {
        await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS crawler_schedules (
        crawler TEXT PRIMARY KEY,
        frequency TEXT NOT NULL,
        last_run TEXT,
        next_run TEXT NOT NULL,
        enabled INTEGER DEFAULT 1
      )
    `);
        await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS crawler_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crawler TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        pages_crawled INTEGER DEFAULT 0,
        documents_parsed INTEGER DEFAULT 0,
        documents_ingested INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        error_messages TEXT,
        amendments_detected INTEGER DEFAULT 0
      )
    `);
        for (const [crawler, config] of Object.entries(DEFAULT_SCHEDULES)) {
            const nextRun = calculateNextRun(config.frequency);
            await prisma.$executeRawUnsafe(`INSERT OR IGNORE INTO crawler_schedules (crawler, frequency, next_run, enabled)
         VALUES (?, ?, ?, ?)`, crawler, config.frequency, nextRun.toISOString(), config.enabled ? 1 : 0);
        }
        console.log('[Scheduler] Initialized scheduler tables');
    }
    catch (error) {
        console.error('[Scheduler] Error initializing:', error);
    }
}
exports.default = {
    getSchedules,
    updateSchedule,
    runCrawler,
    runScheduledCrawls,
    runAllCrawlers,
    getCrawlHistory,
    getCrawlerStats,
    initializeScheduler,
    CRAWLERS: Object.keys(CRAWLERS),
};
//# sourceMappingURL=scheduler.js.map