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
const modelWarmup_1 = require("./services/modelWarmup");
const llmCache_1 = require("./services/llmCache");
const llmAdapter_1 = require("./services/llmAdapter");
const errorHandler_1 = require("./middleware/errorHandler");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8000;
app.use((0, helmet_1.default)({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            upgradeInsecureRequests: null,
        },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
}));
app.use((0, cors_1.default)({
    origin: process.env.CLIENT_URL || ['http://localhost:3000', 'http://localhost:5173'],
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
app.use((0, cookie_parser_1.default)());
if (process.env.NODE_ENV !== 'production') {
    app.use((0, morgan_1.default)('dev'));
}
else {
    app.use((0, morgan_1.default)('combined', {
        skip: (req, res) => res.statusCode < 400
    }));
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
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.path}`,
    });
});
app.use(errorHandler_1.errorHandler);
app.listen(PORT, async () => {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║       LexVault Server Started          ║');
    console.log('╚════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📡 Server:      http://localhost:${PORT}`);
    console.log(`💚 Health:      http://localhost:${PORT}/health`);
    console.log('');
    console.log('Core features: Research | Analyse | Create | Vault');
    console.log('');
    if (process.env.LLM_PROVIDER === 'ollama') {
        console.log('🤖 Warming up AI models...');
        (0, modelWarmup_1.warmupModels)()
            .then((report) => {
            if (report.allSuccess) {
                console.log(`✅ AI models ready (${report.totalDuration}ms)`);
            }
            else {
                console.warn('⚠️  Some AI models failed to warm up');
            }
        })
            .catch((error) => {
            console.error('❌ Model warmup failed:', error);
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
//# sourceMappingURL=server.js.map