"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const crypto_1 = __importDefault(require("crypto"));
const docx = require("docx");
const PDFDocument = require("pdfkit");
const { parseDocument } = require("../services/docParser");
const auth_1 = require("../middleware/auth");
const { undici } = (() => { try { return { undici: require("undici") }; } catch { return { undici: null }; } })();

// Prisma client for vault saves
let prisma;
try {
    const client_1 = require("@prisma/client");
    prisma = new client_1.PrismaClient();
} catch { prisma = null; }

const router = express_1.default.Router();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_FALLBACK_URL = process.env.OLLAMA_FALLBACK_URL ? `http://${process.env.OLLAMA_FALLBACK_URL}` : null;
const MODEL = process.env.OLLAMA_MODEL || 'qwen3:14b';
const SESSION_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Optional undici agent for long-running LLM requests
const llmAgent = undici ? new undici.Agent({
    headersTimeout: 5 * 60 * 1000,
    bodyTimeout: 5 * 60 * 1000,
    keepAliveTimeout: 5 * 60 * 1000,
}) : undefined;

// ---------------------------------------------------------------------------
// In-memory session store with 2h TTL
// ---------------------------------------------------------------------------
const sessions = new Map();

function createSession(filename, text) {
    const id = crypto_1.default.randomUUID();
    const session = { id, filename, text, originalText: text, variables: null, sections: null, checks: [], createdAt: Date.now() };
    sessions.set(id, session);
    return session;
}

function getSession(id) {
    const s = sessions.get(id);
    if (!s) return null;
    if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(id); return null; }
    return s;
}

// Cleanup expired sessions every 30 min
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
        if (now - s.createdAt > SESSION_TTL) sessions.delete(id);
    }
}, 30 * 60 * 1000);

// ---------------------------------------------------------------------------
// LLM helper: OpenRouter primary, Ollama fallback
// ---------------------------------------------------------------------------
async function openRouterGenerate(payload, timeoutMs = 120000) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'qwen/qwen3.5-9b';
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
    const messages = [{ role: 'user', content: payload.prompt }];
    if (payload.system) messages.unshift({ role: 'system', content: payload.system });
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model, messages,
            temperature: payload.options?.temperature ?? 0,
            max_tokens: payload.options?.num_predict ?? 4096,
            reasoning: { effort: 'none' },
            provider: { order: ['Together', 'Venice'], allow_fallbacks: true },
        }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${data.error?.message || response.statusText}`);
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('OpenRouter empty response');
    // Return in Ollama-compatible format so callers don't need changes
    return { response: text };
}
async function ollamaGenerate(payload, timeoutMs = 120000) {
    // Try OpenRouter first
    if (process.env.OPENROUTER_API_KEY) {
        try {
            const result = await openRouterGenerate(payload, timeoutMs);
            return result;
        } catch (orErr) {
            console.warn(`[WORKSHOP] OpenRouter failed (${orErr.message}), falling back to Ollama`);
        }
    }
    // Fallback: Ollama
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const fetchOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal };
    if (llmAgent) fetchOpts.dispatcher = llmAgent;
    try {
        const res = await fetch(`${OLLAMA_URL}/api/generate`, fetchOpts);
        clearTimeout(timer);
        if (!res.ok) throw new Error(`Ollama ${res.status}`);
        return await res.json();
    } catch (err) {
        clearTimeout(timer);
        if (OLLAMA_FALLBACK_URL) {
            console.log(`[WORKSHOP] Primary Ollama failed (${err.message}), trying fallback...`);
            const c2 = new AbortController();
            const t2 = setTimeout(() => c2.abort(), 180000);
            const opts2 = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: c2.signal };
            if (llmAgent) opts2.dispatcher = llmAgent;
            try {
                const res2 = await fetch(`${OLLAMA_FALLBACK_URL}/api/generate`, opts2);
                clearTimeout(t2);
                if (!res2.ok) throw new Error(`Fallback ${res2.status}`);
                return await res2.json();
            } catch (e2) { clearTimeout(t2); throw e2; }
        }
        throw err;
    }
}

function sanitizeJsonString(str) {
    let result = '', inString = false, escaped = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i], code = ch.charCodeAt(0);
        if (escaped) { result += ch; escaped = false; continue; }
        if (ch === '\\') { result += ch; escaped = true; continue; }
        if (ch === '"') { inString = !inString; result += ch; continue; }
        if (inString && code < 32) {
            if (code === 10) result += '\\n';
            else if (code === 13) result += '\\r';
            else if (code === 9) result += '\\t';
            else result += '\\u' + ('0000' + code.toString(16)).slice(-4);
        } else { result += ch; }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Multer setup
// ---------------------------------------------------------------------------
const workshopStorage = multer_1.default.diskStorage({
    destination: async (req, file, cb) => {
        const dir = path_1.default.join(__dirname, '../../uploads/workshop');
        await promises_1.default.mkdir(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '.');
        cb(null, `${Date.now()}_${safe}`);
    },
});
const upload = (0, multer_1.default)({
    storage: workshopStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = ['application/pdf', 'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'].includes(file.mimetype);
        cb(null, ok);
    },
});

// ---------------------------------------------------------------------------
// POST /api/workshop/upload
// ---------------------------------------------------------------------------
router.post('/upload', auth_1.authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded or invalid type' });
        console.log(`[WORKSHOP] Upload: ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)} KB)`);
        const text = await parseDocument(req.file.path);
        const session = createSession(req.file.originalname, text);
        // Clean up uploaded file after parsing
        promises_1.default.unlink(req.file.path).catch(() => {});
        res.json({ sessionId: session.id, filename: session.filename, text: session.text, charCount: text.length });
    } catch (err) {
        console.error('[WORKSHOP] Upload error:', err);
        res.status(500).json({ error: 'Failed to parse document' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/workshop/extract  — Variable extraction (regex + LLM)
// ---------------------------------------------------------------------------
router.post('/extract', auth_1.authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found or expired' });

        const text = session.text;
        console.log(`[WORKSHOP] Extract: ${text.length} chars`);

        // --- Pass 1: Regex ---
        const regexVars = [];
        // Bracket placeholders: [PARTY A], [DATE], etc.
        for (const m of text.matchAll(/\[([A-Z][A-Z0-9 _/.-]{1,40})\]/g)) {
            regexVars.push({ name: m[1].trim(), type: 'other', currentValue: m[0], isPlaceholder: true });
        }
        // Angle bracket placeholders: <<NAME>>, <<AMOUNT>>
        for (const m of text.matchAll(/<<([A-Za-z][A-Za-z0-9 _.-]{1,40})>>/g)) {
            regexVars.push({ name: m[1].trim(), type: 'other', currentValue: m[0], isPlaceholder: true });
        }
        // Underscore blanks: ________ (4+ underscores)
        let blankIdx = 0;
        for (const m of text.matchAll(/_{4,}/g)) {
            blankIdx++;
            regexVars.push({ name: `Blank ${blankIdx}`, type: 'other', currentValue: m[0], isPlaceholder: true });
        }

        // Deduplicate regex vars by currentValue
        const seen = new Set();
        const uniqueRegex = regexVars.filter(v => { if (seen.has(v.currentValue)) return false; seen.add(v.currentValue); return true; });

        // --- Pass 2: LLM (chunked for large docs) ---
        const CHUNK_SIZE = 20000;
        const OVERLAP = 2000;
        const MAX_CHUNKS = 12;
        const chunks = [];
        let start = 0;
        while (start < text.length && chunks.length < MAX_CHUNKS) {
            chunks.push(text.substring(start, start + CHUNK_SIZE));
            start += CHUNK_SIZE - OVERLAP;
        }
        if (text.length > MAX_CHUNKS * (CHUNK_SIZE - OVERLAP)) {
            console.log(`[WORKSHOP] Document very large (${text.length} chars) — capped at ${MAX_CHUNKS} chunks`);
        }

        const regexPlaceholders = uniqueRegex.map(v => v.currentValue).join(', ');
        const llmVars = [];

        for (let i = 0; i < chunks.length; i++) {
            console.log(`[WORKSHOP] LLM extraction chunk ${i + 1}/${chunks.length}`);
            const prompt = `You are a legal template analysis assistant. Analyze this portion of a legal document and identify all filled-in values that should be replaceable variables (party names, dates, addresses, monetary amounts, company names, durations, jurisdictions).

${regexPlaceholders ? `These bracket/underscore placeholders were already found — do NOT include them: ${regexPlaceholders}` : ''}

DOCUMENT TEXT (chunk ${i + 1} of ${chunks.length}):
${chunks[i]}

Return ONLY a JSON array of variables found. Each variable:
{"name": "descriptive label", "type": "name|date|address|amount|company|jurisdiction|duration|other", "currentValue": "exact text as it appears in the document"}

IMPORTANT:
- currentValue must be the EXACT string from the document (copy-paste, not paraphrased)
- Only include values that appear multiple times OR are clearly variable data (not boilerplate legal text)
- Types: name (person names), date (any date), address (physical addresses), amount (money/percentages), company (entity names), jurisdiction (country/state/city), duration (time periods), other
- Return [] if no variables found in this chunk`;

            try {
                const data = await ollamaGenerate({
                    model: MODEL,
                    prompt,
                    stream: false,
                    think: false,
                    options: { temperature: 0, num_predict: 2048, num_ctx: 32768 },
                }, 90000);

                const jsonMatch = (data.response || '').match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const parsed = JSON.parse(sanitizeJsonString(jsonMatch[0]));
                    if (Array.isArray(parsed)) {
                        for (const v of parsed) {
                            if (v.currentValue && typeof v.currentValue === 'string') {
                                llmVars.push({
                                    name: String(v.name || 'Unknown'),
                                    type: String(v.type || 'other'),
                                    currentValue: v.currentValue,
                                    isPlaceholder: false,
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.warn(`[WORKSHOP] LLM extraction chunk ${i + 1} failed:`, err.message);
            }
        }

        // --- Post-processing ---
        // Verify currentValue exists in text
        const verified = llmVars.filter(v => text.includes(v.currentValue));
        const discarded = llmVars.length - verified.length;
        if (discarded > 0) console.log(`[WORKSHOP] Discarded ${discarded} hallucinated variables`);

        // Deduplicate across regex + LLM
        const allVars = [...uniqueRegex];
        const existingValues = new Set(uniqueRegex.map(v => v.currentValue));
        for (const v of verified) {
            if (!existingValues.has(v.currentValue)) {
                existingValues.add(v.currentValue);
                allVars.push(v);
            }
        }

        // Find all occurrences for each variable
        for (const v of allVars) {
            let count = 0, idx = 0;
            while ((idx = text.indexOf(v.currentValue, idx)) !== -1) { count++; idx += v.currentValue.length; }
            v.occurrences = count;
        }

        // Detect sections via heading regex
        const sections = [];
        const headingRe = /^(?:(?:ARTICLE|SECTION|PART)\s+[IVXLCDM\d]+[.:]\s*|(?:\d+\.)+\s+)[A-Z].*/gm;
        let hMatch;
        while ((hMatch = headingRe.exec(text)) !== null) {
            sections.push({ title: hMatch[0].trim(), offset: hMatch.index });
        }
        // Also match all-caps headings on their own line
        const capsRe = /^[A-Z][A-Z ]{3,}$/gm;
        while ((hMatch = capsRe.exec(text)) !== null) {
            // Avoid duplicating headings already caught
            if (!sections.some(s => Math.abs(s.offset - hMatch.index) < 5)) {
                sections.push({ title: hMatch[0].trim(), offset: hMatch.index });
            }
        }
        sections.sort((a, b) => a.offset - b.offset);

        session.variables = allVars;
        session.sections = sections;

        console.log(`[WORKSHOP] Extracted ${allVars.length} variables, ${sections.length} sections`);
        res.json({ variables: allVars, sections });

    } catch (err) {
        console.error('[WORKSHOP] Extract error:', err);
        res.status(500).json({ error: 'Variable extraction failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/workshop/rewrite  — Clause rewriting with optional RAG
// ---------------------------------------------------------------------------
router.post('/rewrite', auth_1.authenticateToken, async (req, res) => {
    try {
        const { sessionId, clauseText, instruction, jurisdiction } = req.body;
        if (!clauseText || !instruction) return res.status(400).json({ error: 'clauseText and instruction required' });

        const session = sessionId ? getSession(sessionId) : null;
        console.log(`[WORKSHOP] Rewrite: ${clauseText.length} chars, instruction: "${instruction.substring(0, 80)}"`);

        // Optional RAG for jurisdiction-specific rewrites
        let ragContext = '';
        if (jurisdiction) {
            try {
                const { enhancedSearch } = require('../services/rag/retrieval');
                const results = await enhancedSearch(instruction, [jurisdiction], { limit: 5 });
                if (results && results.length > 0) {
                    ragContext = '\n\nRELEVANT LEGAL SOURCES:\n' + results.slice(0, 5).map((r, i) =>
                        `<source index="${i + 1}"><name>${r.source_name || 'Unknown'}</name><content>${(r.content || '').substring(0, 800)}</content></source>`
                    ).join('\n');
                    console.log(`[WORKSHOP] RAG: ${results.length} sources for rewrite`);
                }
            } catch (ragErr) {
                console.warn('[WORKSHOP] RAG failed for rewrite:', ragErr.message);
            }
        }

        const prompt = `You are a legal document editor. Rewrite the following clause according to the instruction.

ORIGINAL CLAUSE:
${clauseText}

INSTRUCTION: ${instruction}
${jurisdiction ? `TARGET JURISDICTION: ${jurisdiction}` : ''}
${ragContext}

RULES:
- Preserve the general structure and format of the clause
- Only change what the instruction asks for
- Keep bracket placeholders [LIKE THIS] intact
- Maintain formal legal language
- If jurisdiction is specified, ensure compliance with that jurisdiction's law
- Do NOT add statute citations (e.g. "§ 1121 ABGB") in the clause text

Return ONLY the rewritten clause text. No explanation, no markdown wrapping.`;

        const data = await ollamaGenerate({
            model: MODEL,
            prompt,
            stream: false,
            think: false,
            options: { temperature: 0, num_predict: 4096, num_ctx: 32768 },
        }, 120000);

        const rewritten = (data.response || '').trim();
        console.log(`[WORKSHOP] Rewrite complete: ${rewritten.length} chars`);
        res.json({ rewritten });

    } catch (err) {
        console.error('[WORKSHOP] Rewrite error:', err);
        res.status(500).json({ error: 'Clause rewriting failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/workshop/suggest  — LLM reads section, returns improvement ideas
// ---------------------------------------------------------------------------
router.post('/suggest', auth_1.authenticateToken, async (req, res) => {
    try {
        const { sessionId, sectionText } = req.body;
        if (!sectionText) return res.status(400).json({ error: 'sectionText required' });

        const session = sessionId ? getSession(sessionId) : null;
        console.log(`[WORKSHOP] Suggest: ${sectionText.length} chars`);

        const prompt = `You are a legal document improvement advisor. Read the following contract section and suggest 3-5 specific improvements.

SECTION TEXT:
${sectionText.substring(0, 6000)}

Return ONLY a JSON array of suggestion strings. Each suggestion should be a short, actionable instruction (1-2 sentences) that could be used as a rewrite instruction.

Examples of good suggestions:
- "Add a liability cap of [AMOUNT] for indirect damages"
- "Include a force majeure clause covering pandemics and natural disasters"
- "Specify the notice period for termination (currently missing)"
- "Clarify governing law and dispute resolution mechanism"
- "Add data protection obligations per GDPR Article 28"

Focus on:
- Missing standard clauses
- Ambiguous language that could cause disputes
- Missing protections for either party
- Compliance gaps (GDPR, consumer protection, etc.)
- Practical enforceability issues

Return ONLY the JSON array, no explanation.`;

        const data = await ollamaGenerate({
            model: MODEL,
            prompt,
            stream: false,
            think: false,
            options: { temperature: 0, num_predict: 1024, num_ctx: 32768 },
        }, 90000);

        const raw = (data.response || '').trim();
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        let suggestions = [];
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(sanitizeJsonString(jsonMatch[0]));
                if (Array.isArray(parsed)) {
                    suggestions = parsed.filter(s => typeof s === 'string' && s.length > 5).slice(0, 5);
                }
            } catch (e) {
                console.warn('[WORKSHOP] Suggest JSON parse failed:', e.message);
            }
        }

        if (suggestions.length === 0) {
            // Fallback: try to extract lines from the response
            suggestions = raw.split('\n')
                .map(l => l.replace(/^[\d.\-*]+\s*/, '').replace(/^["']|["']$/g, '').trim())
                .filter(l => l.length > 10 && l.length < 200)
                .slice(0, 5);
        }

        console.log(`[WORKSHOP] Suggest: ${suggestions.length} suggestions`);
        res.json({ suggestions });

    } catch (err) {
        console.error('[WORKSHOP] Suggest error:', err);
        res.status(500).json({ error: 'Suggestion generation failed' });
    }
});

// ---------------------------------------------------------------------------
// Jurisdiction → language map for search query translation
// ---------------------------------------------------------------------------
const JURISDICTION_LANGUAGES = {
    'AT': 'German', 'DE': 'German', 'CH': 'German',
    'SK': 'Slovak', 'CZ': 'Czech',
    'FR': 'French', 'RO': 'Romanian',
    'CY': 'Greek', 'ZA': 'English',
    'US': 'English', 'US-CA': 'English', 'UK': 'English',
    'EW': 'English', 'SC': 'English', 'NI': 'English', 'EU': 'English',
};

// ---------------------------------------------------------------------------
// POST /api/workshop/check  — Legal fact-check via RAG + LLM judge
// ---------------------------------------------------------------------------
router.post('/check', auth_1.authenticateToken, async (req, res) => {
    try {
        const { sessionId, clauseText, jurisdiction } = req.body;
        if (!clauseText) return res.status(400).json({ error: 'clauseText required' });
        if (!jurisdiction) return res.status(400).json({ error: 'jurisdiction required' });

        const session = sessionId ? getSession(sessionId) : null;
        console.log(`[WORKSHOP] Check: ${clauseText.length} chars, jurisdiction: ${jurisdiction}`);

        // Step 1: LLM generates search query in target language
        const targetLang = JURISDICTION_LANGUAGES[jurisdiction] || 'English';
        let searchQuery = clauseText.substring(0, 500);
        try {
            const queryPrompt = `Extract the core legal topic from this contract clause and write a search query in ${targetLang} to find the relevant statute provisions in ${jurisdiction} law.

CLAUSE:
${clauseText.substring(0, 2000)}

Return ONLY the search query in ${targetLang} (1-2 sentences, no explanation). Focus on the legal concepts, obligations, and rights involved.`;

            const queryData = await ollamaGenerate({
                model: MODEL,
                prompt: queryPrompt,
                stream: false,
                think: false,
                options: { temperature: 0, num_predict: 256, num_ctx: 8192 },
            }, 30000);

            const generatedQuery = (queryData.response || '').trim().replace(/^["']|["']$/g, '');
            if (generatedQuery.length > 10) {
                searchQuery = generatedQuery;
                console.log(`[WORKSHOP] Check: LLM search query (${targetLang}): "${searchQuery.substring(0, 80)}..."`);
            }
        } catch (queryErr) {
            console.warn('[WORKSHOP] Check query generation failed, using clause text:', queryErr.message);
        }

        // Step 2: Search legal database with translated query
        let sources = [];
        try {
            const { enhancedSearch } = require('../services/rag/retrieval');
            const results = await enhancedSearch(searchQuery, { jurisdiction, limit: 8, rerank: true });
            if (results && results.length > 0) {
                sources = results.slice(0, 5).map(r => ({
                    name: r.source_name || r.payload?.source_name || 'Unknown',
                    excerpt: (r.content || r.payload?.content || '').substring(0, 500),
                    score: r.rerank_score || r.score || 0,
                }));
                console.log(`[WORKSHOP] Check RAG: ${results.length} sources found`);
            }
        } catch (ragErr) {
            console.warn('[WORKSHOP] Check RAG failed:', ragErr.message);
        }

        // Step 3: LLM analysis — compare clause against statutes
        const sourcesXml = sources.length > 0
            ? sources.map((s, i) => `<source index="${i + 1}"><name>${s.name}</name><content>${s.excerpt}</content></source>`).join('\n')
            : '<no_sources>No relevant statutes found in the database for this jurisdiction.</no_sources>';

        const analysisPrompt = `You are a legal compliance checker. Compare this contract clause against the legal sources and determine if it is legally compliant.

CLAUSE TO CHECK:
${clauseText.substring(0, 3000)}

JURISDICTION: ${jurisdiction}

LEGAL SOURCES:
${sourcesXml}

Return a JSON object:
{
  "status": "supported" | "issue" | "no_match",
  "explanation": "2-4 sentence explanation. Cite specific statute provisions."
}

Rules:
- "supported": Clause is consistent with the found legal sources
- "issue": Clause conflicts with, violates, or is missing required elements per law
- "no_match": No relevant legal sources found
- If no sources were found, return "no_match"
- Be specific about which statute/section is relevant

Return ONLY the JSON object.`;

        const analysisData = await ollamaGenerate({
            model: MODEL,
            prompt: analysisPrompt,
            stream: false,
            think: false,
            options: { temperature: 0, num_predict: 1024, num_ctx: 32768 },
        }, 120000);

        const analysisRaw = (analysisData.response || '').trim();
        const analysisMatch = analysisRaw.match(/\{[\s\S]*\}/);
        let status = 'no_match';
        let explanation = 'Could not analyze the clause.';

        if (analysisMatch) {
            try {
                const parsed = JSON.parse(sanitizeJsonString(analysisMatch[0]));
                if (parsed.status && ['supported', 'issue', 'no_match'].includes(parsed.status)) {
                    status = parsed.status;
                }
                if (parsed.explanation) {
                    explanation = String(parsed.explanation);
                }
            } catch (e) {
                console.warn('[WORKSHOP] Check analysis JSON parse failed:', e.message);
                explanation = analysisRaw.substring(0, 500);
            }
        }

        if (sources.length === 0) status = 'no_match';

        // Step 4: Judge call — verify if clause does anything illegal
        let judgeVerdict = null;
        if (sources.length > 0 && status !== 'no_match') {
            try {
                const judgePrompt = `You are a legal compliance judge. Review the following analysis and determine if the contract clause violates or conflicts with the cited legal provisions.

CLAUSE:
${clauseText.substring(0, 2000)}

JURISDICTION: ${jurisdiction}

ANALYSIS CONCLUSION: ${status}
ANALYSIS EXPLANATION: ${explanation}

SOURCES REVIEWED:
${sourcesXml}

Does this clause do anything ILLEGAL or legally problematic under ${jurisdiction} law based on the sources?

Return ONLY a JSON object:
{
  "illegal": true | false,
  "severity": "critical" | "moderate" | "minor" | "none",
  "judgeNote": "One sentence summary of the legal risk, if any."
}`;

                const judgeData = await ollamaGenerate({
                    model: MODEL,
                    prompt: judgePrompt,
                    stream: false,
                    think: false,
                    options: { temperature: 0, num_predict: 512, num_ctx: 16384 },
                }, 60000);

                const judgeRaw = (judgeData.response || '').trim();
                const judgeMatch = judgeRaw.match(/\{[\s\S]*\}/);
                if (judgeMatch) {
                    const jp = JSON.parse(sanitizeJsonString(judgeMatch[0]));
                    judgeVerdict = {
                        illegal: !!jp.illegal,
                        severity: ['critical', 'moderate', 'minor', 'none'].includes(jp.severity) ? jp.severity : 'none',
                        judgeNote: String(jp.judgeNote || ''),
                    };
                    // Upgrade status to issue if judge found illegal
                    if (judgeVerdict.illegal && status === 'supported') {
                        status = 'issue';
                        explanation = judgeVerdict.judgeNote + ' ' + explanation;
                    }
                    console.log(`[WORKSHOP] Judge: illegal=${judgeVerdict.illegal}, severity=${judgeVerdict.severity}`);
                }
            } catch (judgeErr) {
                console.warn('[WORKSHOP] Judge call failed:', judgeErr.message);
            }
        }

        const result = { status, sources, explanation, clauseText: clauseText.substring(0, 500), jurisdiction, timestamp: Date.now(), searchQuery: searchQuery.substring(0, 200), judge: judgeVerdict };

        // Store in session
        if (session) {
            if (!session.checks) session.checks = [];
            session.checks.push(result);
        }

        console.log(`[WORKSHOP] Check complete: ${status} (${sources.length} sources)`);
        res.json(result);

    } catch (err) {
        console.error('[WORKSHOP] Check error:', err);
        res.status(500).json({ error: 'Legal check failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/workshop/update-text  — Update session text after edits
// ---------------------------------------------------------------------------
router.post('/update-text', auth_1.authenticateToken, (req, res) => {
    try {
        const { sessionId, text } = req.body;
        if (!sessionId || !text) return res.status(400).json({ error: 'sessionId and text required' });
        const session = getSession(sessionId);
        if (!session) return res.status(404).json({ error: 'Session not found or expired' });
        session.text = text;
        res.json({ ok: true });
    } catch (err) {
        console.error('[WORKSHOP] Update-text error:', err);
        res.status(500).json({ error: 'Failed to update text' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/workshop/export  — DOCX or PDF download
// ---------------------------------------------------------------------------
function safeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._\- ]/g, '_').replace(/\.{2,}/g, '.').slice(0, 200);
}

router.post('/export', auth_1.authenticateToken, async (req, res) => {
    try {
        const { title, text, format } = req.body;
        if (!text) return res.status(400).json({ error: 'text is required' });

        const docTitle = title || 'Workshop Document';
        const fname = safeFilename(docTitle.replace(/\s+/g, '_'));

        if (format === 'pdf') {
            // PDF export via pdfkit
            const doc = new PDFDocument({ margin: 60, size: 'A4' });
            const chunks = [];
            doc.on('data', c => chunks.push(c));
            doc.on('end', () => {
                const buf = Buffer.concat(chunks);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
                res.send(buf);
            });

            doc.fontSize(18).font('Helvetica-Bold').text(docTitle, { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(9).font('Helvetica').fillColor('#888888').text(`Generated by OpenLex on ${new Date().toLocaleDateString()}`, { align: 'center' });
            doc.moveDown(1);
            doc.fillColor('#000000');

            // Split text into paragraphs and render
            const paragraphs = text.split('\n');
            for (const para of paragraphs) {
                const trimmed = para.trim();
                if (!trimmed) { doc.moveDown(0.3); continue; }

                // Detect headings (ALL CAPS or numbered sections)
                if (/^(?:(?:ARTICLE|SECTION|PART)\s+[IVXLCDM\d]+|(?:\d+\.)+)\s+[A-Z]/.test(trimmed) || /^[A-Z][A-Z ]{3,}$/.test(trimmed)) {
                    doc.moveDown(0.5);
                    doc.fontSize(12).font('Helvetica-Bold').text(trimmed);
                    doc.moveDown(0.3);
                    doc.fontSize(10).font('Helvetica');
                } else {
                    doc.fontSize(10).font('Helvetica').text(trimmed, { align: 'justify', lineGap: 2 });
                }
            }

            doc.end();

        } else {
            // DOCX export (default)
            const docChildren = [];
            docChildren.push(new docx.Paragraph({
                heading: docx.HeadingLevel.HEADING_1,
                alignment: docx.AlignmentType.CENTER,
                children: [new docx.TextRun({ text: docTitle, bold: true })],
            }));
            docChildren.push(new docx.Paragraph({
                alignment: docx.AlignmentType.CENTER,
                children: [new docx.TextRun({ text: `Generated by OpenLex on ${new Date().toLocaleDateString()}`, size: 18, color: '888888', italics: true })],
            }));
            docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));

            const paragraphs = text.split('\n');
            for (const para of paragraphs) {
                const trimmed = para.trim();
                if (!trimmed) {
                    docChildren.push(new docx.Paragraph({ children: [new docx.TextRun('')] }));
                    continue;
                }

                // Detect headings
                if (/^(?:(?:ARTICLE|SECTION|PART)\s+[IVXLCDM\d]+|(?:\d+\.)+)\s+[A-Z]/.test(trimmed) || /^[A-Z][A-Z ]{3,}$/.test(trimmed)) {
                    docChildren.push(new docx.Paragraph({
                        heading: docx.HeadingLevel.HEADING_2,
                        children: [new docx.TextRun({ text: trimmed, bold: true })],
                    }));
                } else if (/^[-*]\s/.test(trimmed)) {
                    docChildren.push(new docx.Paragraph({
                        bullet: { level: 0 },
                        children: [new docx.TextRun(trimmed.slice(2))],
                    }));
                } else if (/^\d+\.\s/.test(trimmed)) {
                    docChildren.push(new docx.Paragraph({
                        numbering: { reference: 'default-numbering', level: 0 },
                        children: [new docx.TextRun(trimmed.replace(/^\d+\.\s/, ''))],
                    }));
                } else {
                    docChildren.push(new docx.Paragraph({ children: [new docx.TextRun(trimmed)] }));
                }
            }

            const doc2 = new docx.Document({
                numbering: { config: [{ reference: 'default-numbering', levels: [{ level: 0, format: docx.LevelFormat.DECIMAL, text: '%1.', alignment: docx.AlignmentType.START }] }] },
                sections: [{
                    properties: {},
                    footers: {
                        default: new docx.Footer({
                            children: [new docx.Paragraph({
                                alignment: docx.AlignmentType.CENTER,
                                children: [new docx.TextRun({ text: `Generated by OpenLex on ${new Date().toLocaleDateString()}`, size: 16, color: '888888', italics: true })],
                            })],
                        }),
                    },
                    children: docChildren,
                }],
            });

            const buffer = await docx.Packer.toBuffer(doc2);
            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${fname}.docx"`);
            res.send(buffer);
        }

    } catch (err) {
        console.error('[WORKSHOP] Export error:', err);
        res.status(500).json({ error: 'Export failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/workshop/save-to-vault  — Save check results or full doc to vault
// ---------------------------------------------------------------------------
router.post('/save-to-vault', auth_1.authenticateToken, async (req, res) => {
    try {
        if (!prisma) return res.status(500).json({ error: 'Database not available' });

        const userId = req.user.userId;
        const { type, title, content, category, tags, notes, sourceType } = req.body;

        if (!title || !content) return res.status(400).json({ error: 'title and content required' });

        const validTypes = ['clause', 'template', 'draft'];
        const itemType = validTypes.includes(type) ? type : 'clause';

        const vaultItem = await prisma.vaultItem.create({
            data: {
                userId,
                type: itemType,
                title,
                content,
                category: category || null,
                tags: tags ? JSON.stringify(tags) : null,
                notes: notes || null,
                sourceType: sourceType || 'workshop',
            },
        });

        let createdTags = [];
        try { createdTags = vaultItem.tags ? JSON.parse(vaultItem.tags) : []; } catch { createdTags = []; }

        console.log(`[WORKSHOP] Saved to vault: ${vaultItem.id} (${itemType}: "${title.substring(0, 50)}")`);
        res.status(201).json({ ...vaultItem, tags: createdTags });

    } catch (err) {
        console.error('[WORKSHOP] Save to vault error:', err);
        res.status(500).json({ error: 'Failed to save to vault' });
    }
});

exports.default = router;
