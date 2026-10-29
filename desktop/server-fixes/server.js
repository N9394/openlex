"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const auth_1 = __importDefault(require("./routes/auth"));
const account_1 = __importDefault(require("./routes/account"));
const docs_1 = __importDefault(require("./routes/docs"));
const documents_1 = __importDefault(require("./routes/documents"));
const drafts_1 = __importDefault(require("./routes/drafts"));
const navigator_1 = __importDefault(require("./routes/navigator"));
const research_1 = __importDefault(require("./routes/research"));
const rag_1 = __importDefault(require("./routes/rag"));
const vault_1 = __importDefault(require("./routes/vault"));
const auditDashboard_1 = __importDefault(require("./routes/auditDashboard"));
const organization_1 = __importDefault(require("./routes/organization"));
const workshop_1 = __importDefault(require("./routes/workshop"));
const ma_route_1 = require("./routes/ma_route");
const modelWarmup_1 = require("./services/modelWarmup");
const llmCache_1 = require("./services/llmCache");
const llmAdapter_1 = require("./services/llmAdapter");
const errorHandler_1 = require("./middleware/errorHandler");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8000;
// Loopback only: this legacy server has no business being reachable from the
// network. Every client (Electron app, dev UI) talks to http://127.0.0.1:PORT.
const HOST = '127.0.0.1';
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            upgradeInsecureRequests: null,
        },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
app.use((0, cors_1.default)({
    origin: process.env.CLIENT_URL ? process.env.CLIENT_URL.split(',') : (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173']),
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, cookie_parser_1.default)());
if (process.env.NODE_ENV !== 'production') {
    app.use((0, morgan_1.default)('dev'));
}
else {
    app.use((0, morgan_1.default)('combined'));
}
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads')));
app.get('/health', async (req, res) => {
    const [modelHealth, llmHealth] = await Promise.all([
        (0, modelWarmup_1.checkModelHealth)(),
        (0, llmAdapter_1.checkLLMHealth)(),
    ]);
    const cacheStats = (0, llmCache_1.getCacheStats)();
    const isHealthy = llmHealth.available || process.env.LLM_PROVIDER === 'mock';
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        ai: {
            provider: llmHealth.provider,
            model: llmHealth.model,
            status: llmHealth.available ? 'ready' : 'unavailable',
            error: llmHealth.error,
        },
        cache: {
            entries: cacheStats.entries,
            hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
        },
    });
});
app.use('/api/auth', auth_1.default);
app.use('/api/account', account_1.default);
app.use('/api/docs', docs_1.default);
app.use("/api/documents", documents_1.default);
app.use("/api/drafts", drafts_1.default);
app.use('/api/navigator', navigator_1.default);
app.use('/api/research', research_1.default);
app.use('/api/rag', rag_1.default);
app.use('/api/vault', vault_1.default);
app.use('/api/audit', auditDashboard_1.default);
app.use('/api/org', organization_1.default);
app.use('/api/workshop', workshop_1.default);
app.use('/api/ma', ma_route_1);

// Local-mode-only internal endpoints. These are bound to 127.0.0.1 inside
// the Electron App and called by the supervisor / pack_ingest module to
// add or remove jurisdictions in the local Qdrant. They have no auth
// because the entire backend is on loopback only when LEXVAULT_LOCAL_MODE=1.
if (process.env.LEXVAULT_LOCAL_MODE === '1') {
    const localOnly = (req, res, next) => {
        const ip = req.ip || req.socket?.remoteAddress || '';
        if (!/^(::1|127\.|::ffff:127\.)/.test(ip)) {
            return res.status(403).json({ error: 'local-only endpoint' });
        }
        next();
    };
    app.post('/api/internal/ingest-pack', localOnly, async (req, res, next) => {
        try {
            const { ingestPack } = require('../../electron/sidecars/pack_ingest');
            const { path: packPath, archiveDir } = req.body || {};
            if (!packPath) return res.status(400).json({ error: 'path required' });
            const result = await ingestPack(packPath, { archiveDir });
            res.json(result);
        } catch (err) { next(err); }
    });
    app.delete('/api/internal/jurisdiction/:code', localOnly, async (req, res, next) => {
        try {
            const { deleteJurisdiction } = require('../../electron/sidecars/pack_ingest');
            await deleteJurisdiction(req.params.code);
            res.json({ ok: true });
        } catch (err) { next(err); }
    });
}

app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.path}`,
    });
});
app.use(errorHandler_1.errorHandler);
// Local-mode bootstrap — when running inside the Electron App, the supervisor
// sets LEXVAULT_LOCAL_MODE=1 and points LEXVAULT_LICENSE_PATH at the signed
// license file (empty in community mode). We upsert a User row matching the
// license's account_id — or the local community user ('local') when there is
// no license — so all the existing Prisma joins work without an auth flow.
async function localModeBootstrap() {
    if (process.env.LEXVAULT_LOCAL_MODE !== '1') return;
    const licensePath = process.env.LEXVAULT_LICENSE_PATH;
    try {
        const fs = require('fs');
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        let p = { tier: 'community' };
        if (licensePath && fs.existsSync(licensePath)) {
            const signed = JSON.parse(fs.readFileSync(licensePath, 'utf8'));
            p = signed.payload || signed;
        } else {
            console.log('[local-mode] no license — community user, no sign-in');
        }
        const accountId = p.account_id || 'local';
        const email = p.email || 'local@lexvault';
        await prisma.user.upsert({
            where: { id: accountId },
            create: {
                id: accountId,
                email,
                passwordHash: 'local-mode-no-password',
                name: p.email?.split('@')[0] || 'OpenLex User',
                tier: p.tier || 'solo',
                language: p.language_pref || 'auto',
                weekResetDate: new Date(),
            },
            update: {
                email,
                tier: p.tier || 'solo',
                ...(p.language_pref ? { language: p.language_pref } : {}),
            },
        });
        console.log(`[local-mode] User row ready: ${accountId} (${email})`);
        await prisma.$disconnect();
    } catch (err) {
        console.error('[local-mode] bootstrap failed:', err);
    }
}

app.listen(PORT, HOST, async () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║  OpenLex desktop server (legacy) ready ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    if (process.env.LEXVAULT_LOCAL_MODE === '1') {
        console.log('Mode:        LOCAL (airgapped App)');
        await localModeBootstrap();
    }
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Server:      http://${HOST}:${PORT}`);
    console.log(`Health:      http://${HOST}:${PORT}/health`);
    console.log('');
    if (process.env.LLM_PROVIDER === 'ollama') {
        console.log('Warming up AI models...');
        (0, modelWarmup_1.warmupModels)()
            .then((report) => {
            if (report.allSuccess) {
                console.log(`AI models ready (${report.totalDuration}ms)`);
            }
            else {
                console.warn('Some AI models failed to warm up');
            }
        })
            .catch((error) => {
            console.error('Model warmup failed:', error);
        });
    }
});
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('\nSIGINT received, shutting down...');
    process.exit(0);
});
exports.default = app;
