"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtvoreneSudyClient = exports.SlovLexClient = void 0;
exports.getSlovLexClient = getSlovLexClient;
exports.getOtvoreneSudyClient = getOtvoreneSudyClient;
exports.fetchSlovakLegislation = fetchSlovakLegislation;
exports.fetchSlovakDecree = fetchSlovakDecree;
const bottleneck_1 = __importDefault(require("bottleneck"));
const crypto = __importStar(require("crypto"));
const DEFAULT_SLOVLEX_CONFIG = {
    baseUrl: 'https://static.slov-lex.sk',
    timeout: 30000,
    userAgent: 'LexVault-Crawler/1.0 (Legal Research)',
    rateLimit: {
        maxRequests: 60,
        windowMs: 60000,
        minDelay: 500,
    },
};
const DEFAULT_OTVORENESUDY_CONFIG = {
    baseUrl: 'https://otvorenesudy.sk',
    apiUrl: 'https://api.otvorenesudy.sk',
    timeout: 30000,
    userAgent: 'LexVault-Crawler/1.0 (Legal Research)',
    rateLimit: {
        maxRequests: 60,
        windowMs: 60000,
        minDelay: 500,
    },
};
class SlovLexClient {
    baseUrl;
    timeout;
    userAgent;
    limiter;
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_SLOVLEX_CONFIG.baseUrl;
        this.timeout = config.timeout || DEFAULT_SLOVLEX_CONFIG.timeout;
        this.userAgent = config.userAgent || DEFAULT_SLOVLEX_CONFIG.userAgent;
        const rateLimit = config.rateLimit || DEFAULT_SLOVLEX_CONFIG.rateLimit;
        this.limiter = new bottleneck_1.default({
            maxConcurrent: 1,
            minTime: rateLimit.minDelay,
        });
    }
    async fetchPage(url) {
        return this.limiter.schedule(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html',
                        'Accept-Language': 'sk,en;q=0.9',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    console.warn(`[Slov-Lex] HTTP ${response.status} for ${url}`);
                    return null;
                }
                return await response.text();
            }
            catch (error) {
                clearTimeout(timeoutId);
                console.error(`[Slov-Lex] Fetch error for ${url}:`, error);
                return null;
            }
        });
    }
    async getLegislation(year, number) {
        const numStr = String(number);
        const url = `${this.baseUrl}/static/SK/ZZ/${year}/${numStr}/vyhlasene_znenie.html`;
        console.log(`[Slov-Lex] Fetching ${url}...`);
        const html = await this.fetchPage(url);
        if (!html || html.length < 500) {
            console.warn(`[Slov-Lex] No content found for ${year}/${numStr}`);
            return null;
        }
        return this.parseLegislation(html, url, year, numStr);
    }
    parseLegislation(html, url, year, number) {
        const nameMatch = html.match(/<td[^>]*class="title"[^>]*>Názov:<\/td>\s*<td[^>]*class="value"[^>]*>([^<]+)<\/td>/i);
        let title = nameMatch ? this.cleanText(nameMatch[1]) : '';
        if (!title || title.length < 5) {
            const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)
                || html.match(/<title>([^<]+)<\/title>/i);
            title = titleMatch ? this.cleanText(titleMatch[1]) : `${number}/${year} Z.z.`;
        }
        if (!title.includes(number)) {
            title = `${title} (${number}/${year} Z.z.)`;
        }
        const content = this.extractContent(html);
        if (!content || content.length < 100) {
            console.warn(`[Slov-Lex] Content too short for ${url}`);
            return null;
        }
        const effectiveDateMatch = html.match(/data-ucinnostod="(\d{4}-\d{2}-\d{2})"/);
        let effectiveDate;
        if (effectiveDateMatch) {
            effectiveDate = new Date(effectiveDateMatch[1]);
        }
        else {
            const textDateMatch = html.match(/účinn(?:ý|osť)[:\s]+od[:\s]+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i);
            effectiveDate = textDateMatch ? this.parseSkDate(textDateMatch[1]) : undefined;
        }
        const hasCurrentVersion = html.includes('data-ucinnostdo=""') || html.includes(`${new Date().getFullYear()}`);
        const inForce = hasCurrentVersion && !html.match(/<h1[^>]*>.*zrušen.*<\/h1>/i);
        const legalAreaMatch = html.match(/Právna oblasť:[^<]*<\/td>\s*<td[^>]*>\s*<ul>\s*<li>([^<]+)/i);
        let actType;
        if (legalAreaMatch) {
            const area = legalAreaMatch[1].toLowerCase();
            if (area.includes('ústav'))
                actType = 'ústavný zákon';
            else if (area.includes('zákon'))
                actType = 'zákon';
            else if (area.includes('vyhláš'))
                actType = 'vyhláška';
            else if (area.includes('nariad'))
                actType = 'nariadenie';
            else
                actType = this.determineActType(title, number);
        }
        else {
            actType = this.determineActType(title, number);
        }
        const sourceId = `slovlex:zz/${year}/${number}`;
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
        return {
            sourceId,
            source: 'slovlex',
            title,
            content,
            url,
            jurisdiction: 'SK',
            date: effectiveDate,
            contentHash,
            fetchedAt: new Date(),
            collectionNumber: `${number}/${year} Z.z.`,
            year,
            actType,
            inForce,
            effectiveDate,
        };
    }
    extractContent(html) {
        const selectors = [
            /<div[^>]*class="[^"]*predpis[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div[^>]*class="[^"]*footer|<\/main)/i,
            /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<article[^>]*>([\s\S]*?)<\/article>/i,
            /<body[^>]*>([\s\S]*?)<\/body>/i,
        ];
        for (const selector of selectors) {
            const match = html.match(selector);
            if (match && match[1]) {
                const content = this.stripHtml(match[1]);
                if (content && content.length > 200) {
                    return content;
                }
            }
        }
        return this.stripHtml(html);
    }
    async listLegislationForYear(year) {
        const url = `${this.baseUrl}/pravne-predpisy/SK/ZZ/${year}/`;
        const html = await this.fetchPage(url);
        if (!html) {
            return [];
        }
        return this.parseLegislationList(html, year);
    }
    parseLegislationList(html, year) {
        const results = [];
        const pattern = /<a[^>]*href="([^"]*\/ZZ\/\d{4}\/(\d+)\/)"[^>]*>([^<]+)<\/a>/gi;
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const [, href, number, title] = match;
            results.push({
                number: number,
                year,
                title: this.cleanText(title),
                url: href.startsWith('http') ? href : `${this.baseUrl}${href}`,
            });
        }
        return results;
    }
    async fetchLegislationBulk(options = {}) {
        const { year = new Date().getFullYear(), limit = 50, onProgress } = options;
        const results = [];
        const list = await this.listLegislationForYear(year);
        const toFetch = list.slice(0, limit);
        console.log(`[Slov-Lex] Found ${list.length} acts for ${year}, fetching ${toFetch.length}`);
        for (let i = 0; i < toFetch.length; i++) {
            const entry = toFetch[i];
            onProgress?.(i + 1, toFetch.length);
            try {
                const doc = await this.getLegislation(year, entry.number);
                if (doc) {
                    results.push(doc);
                }
            }
            catch (error) {
                console.error(`[Slov-Lex] Error fetching ${entry.number}/${year}:`, error);
            }
        }
        return results;
    }
    determineActType(title, number) {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('zákon') || lowerTitle.includes('zákona'))
            return 'zákon';
        if (lowerTitle.includes('vyhláška'))
            return 'vyhláška';
        if (lowerTitle.includes('nariadenie'))
            return 'nariadenie';
        if (lowerTitle.includes('oznámenie'))
            return 'oznámenie';
        if (lowerTitle.includes('ústavný zákon'))
            return 'ústavný zákon';
        if (lowerTitle.includes('opatrenie'))
            return 'opatrenie';
        return 'predpis';
    }
    parseSkDate(dateStr) {
        try {
            const match = dateStr.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
            if (match) {
                const [, day, month, year] = match;
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
        }
        catch {
        }
        return undefined;
    }
    cleanText(text) {
        return text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
    }
    stripHtml(html) {
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
exports.SlovLexClient = SlovLexClient;
class OtvoreneSudyClient {
    baseUrl;
    apiUrl;
    timeout;
    userAgent;
    limiter;
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_OTVORENESUDY_CONFIG.baseUrl;
        this.apiUrl = config.apiUrl || DEFAULT_OTVORENESUDY_CONFIG.apiUrl;
        this.timeout = config.timeout || DEFAULT_OTVORENESUDY_CONFIG.timeout;
        this.userAgent = config.userAgent || DEFAULT_OTVORENESUDY_CONFIG.userAgent;
        const rateLimit = config.rateLimit || DEFAULT_OTVORENESUDY_CONFIG.rateLimit;
        this.limiter = new bottleneck_1.default({
            maxConcurrent: 2,
            minTime: rateLimit.minDelay,
        });
    }
    async fetchPage(url) {
        return this.limiter.schedule(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const response = await fetch(url, {
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html,application/json',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    return null;
                }
                return await response.text();
            }
            catch (error) {
                clearTimeout(timeoutId);
                return null;
            }
        });
    }
    async getRecentDecrees(limit = 20) {
        const url = `${this.baseUrl}/decrees`;
        const html = await this.fetchPage(url);
        if (!html) {
            return [];
        }
        return this.parseDecreeList(html).slice(0, limit);
    }
    parseDecreeList(html) {
        const cases = [];
        const pattern = /<a[^>]*href="(\/decrees\/(\d+))"[^>]*>([^<]+)<\/a>/gi;
        let match;
        while ((match = pattern.exec(html)) !== null) {
            const [, href, id, title] = match;
            cases.push({
                sourceId: `slovlex:decree/${id}`,
                source: 'slovlex',
                title: this.cleanText(title),
                content: '',
                url: `${this.baseUrl}${href}`,
                jurisdiction: 'SK',
                contentHash: '',
                fetchedAt: new Date(),
                court: 'Unknown',
                courtId: '',
            });
        }
        return cases;
    }
    async getDecree(id) {
        const url = `${this.baseUrl}/decrees/${id}`;
        const html = await this.fetchPage(url);
        if (!html) {
            return null;
        }
        return this.parseDecree(html, url, String(id));
    }
    parseDecree(html, url, id) {
        const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        const title = titleMatch ? this.cleanText(titleMatch[1]) : `Decree ${id}`;
        const content = this.extractDecreeContent(html);
        if (!content || content.length < 100) {
            return null;
        }
        const courtMatch = html.match(/(?:Súd|Court)[:\s]+([^<\n]+)/i);
        const court = courtMatch ? this.cleanText(courtMatch[1]) : 'Unknown';
        const caseNumberMatch = html.match(/(?:Sp\.\s*zn\.|Case\s*No\.?)[:\s]+([^<\n]+)/i);
        const caseNumber = caseNumberMatch ? this.cleanText(caseNumberMatch[1]) : undefined;
        const dateMatch = html.match(/(?:Dátum|Date)[:\s]+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i);
        const date = dateMatch ? this.parseSkDate(dateMatch[1]) : undefined;
        const judgesMatch = html.match(/(?:Sudca|Sudcovia|Judge)[:\s]+([^<\n]+)/i);
        const judges = judgesMatch ? this.cleanText(judgesMatch[1]) : undefined;
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
        return {
            sourceId: `slovlex:decree/${id}`,
            source: 'slovlex',
            title,
            content,
            url,
            jurisdiction: 'SK',
            date,
            contentHash,
            fetchedAt: new Date(),
            court,
            courtId: '',
            caseNumber,
            judges,
        };
    }
    extractDecreeContent(html) {
        const selectors = [
            /<div[^>]*class="[^"]*decree-content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<article[^>]*>([\s\S]*?)<\/article>/i,
        ];
        for (const selector of selectors) {
            const match = html.match(selector);
            if (match && match[1]) {
                const content = this.stripHtml(match[1]);
                if (content && content.length > 200) {
                    return content;
                }
            }
        }
        return this.stripHtml(html);
    }
    parseSkDate(dateStr) {
        try {
            const match = dateStr.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
            if (match) {
                const [, day, month, year] = match;
                return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            }
        }
        catch {
        }
        return undefined;
    }
    cleanText(text) {
        return text.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    }
    stripHtml(html) {
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
}
exports.OtvoreneSudyClient = OtvoreneSudyClient;
let slovLexInstance = null;
let otvoreneSudyInstance = null;
function getSlovLexClient() {
    if (!slovLexInstance) {
        slovLexInstance = new SlovLexClient();
    }
    return slovLexInstance;
}
function getOtvoreneSudyClient() {
    if (!otvoreneSudyInstance) {
        otvoreneSudyInstance = new OtvoreneSudyClient();
    }
    return otvoreneSudyInstance;
}
async function fetchSlovakLegislation(year, number) {
    return getSlovLexClient().getLegislation(year, number);
}
async function fetchSlovakDecree(id) {
    return getOtvoreneSudyClient().getDecree(id);
}
//# sourceMappingURL=slovlex.js.map