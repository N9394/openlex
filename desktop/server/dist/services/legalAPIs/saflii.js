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
exports.SAFLIIClient = exports.IMPORTANT_SA_COURTS = exports.SOUTH_AFRICAN_COURTS = void 0;
exports.getSAFLIIClient = getSAFLIIClient;
exports.searchSAFLII = searchSAFLII;
exports.fetchSAFLIICase = fetchSAFLIICase;
const bottleneck_1 = __importDefault(require("bottleneck"));
const crypto = __importStar(require("crypto"));
const https = __importStar(require("https"));
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
});
const DEFAULT_CONFIG = {
    baseUrl: 'https://www.saflii.org',
    timeout: 30000,
    userAgent: 'LexVault-Crawler/1.0 (Legal Research; contact@lexvault.com)',
    rateLimit: {
        maxRequests: 60,
        windowMs: 60000,
        minDelay: 1000,
    },
};
exports.SOUTH_AFRICAN_COURTS = {
    'ZACC': { name: 'Constitutional Court', level: 1, path: 'za/cases/ZACC' },
    'ZASCA': { name: 'Supreme Court of Appeal', level: 2, path: 'za/cases/ZASCA' },
    'ZAGPPHC': { name: 'High Court - Gauteng, Pretoria', level: 3, path: 'za/cases/ZAGPPHC' },
    'ZAGPJHC': { name: 'High Court - Gauteng, Johannesburg', level: 3, path: 'za/cases/ZAGPJHC' },
    'ZAWCHC': { name: 'High Court - Western Cape', level: 3, path: 'za/cases/ZAWCHC' },
    'ZAKZPHC': { name: 'High Court - KZN, Pietermaritzburg', level: 3, path: 'za/cases/ZAKZPHC' },
    'ZAKZDHC': { name: 'High Court - KZN, Durban', level: 3, path: 'za/cases/ZAKZDHC' },
    'ZAECGHC': { name: 'High Court - Eastern Cape, Grahamstown', level: 3, path: 'za/cases/ZAECGHC' },
    'ZAFSHC': { name: 'High Court - Free State', level: 3, path: 'za/cases/ZAFSHC' },
    'ZANCHC': { name: 'High Court - Northern Cape', level: 3, path: 'za/cases/ZANCHC' },
    'ZALAC': { name: 'Labour Appeal Court', level: 2, path: 'za/cases/ZALAC' },
    'ZALC': { name: 'Labour Court', level: 3, path: 'za/cases/ZALC' },
    'ZALCC': { name: 'Land Claims Court', level: 3, path: 'za/cases/ZALCC' },
    'ZATC': { name: 'Tax Court', level: 3, path: 'za/cases/ZATC' },
    'ZAEC': { name: 'Electoral Court', level: 3, path: 'za/cases/ZAEC' },
};
exports.IMPORTANT_SA_COURTS = ['ZACC', 'ZASCA', 'ZAGPPHC', 'ZAGPJHC', 'ZAWCHC'];
class SAFLIIClient {
    baseUrl;
    timeout;
    userAgent;
    limiter;
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
        this.timeout = config.timeout || DEFAULT_CONFIG.timeout;
        this.userAgent = config.userAgent || DEFAULT_CONFIG.userAgent;
        const rateLimit = config.rateLimit || DEFAULT_CONFIG.rateLimit;
        this.limiter = new bottleneck_1.default({
            maxConcurrent: 1,
            minTime: rateLimit.minDelay,
        });
    }
    async fetchPage(url) {
        return this.limiter.schedule(async () => {
            return new Promise((resolve) => {
                const urlObj = new URL(url);
                const timeoutId = setTimeout(() => {
                    resolve(null);
                }, this.timeout);
                const options = {
                    hostname: urlObj.hostname,
                    port: 443,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: {
                        'User-Agent': this.userAgent,
                        'Accept': 'text/html',
                    },
                    agent: httpsAgent,
                };
                const req = https.request(options, (res) => {
                    if (res.statusCode === 301 || res.statusCode === 302) {
                        const redirectUrl = res.headers.location;
                        if (redirectUrl) {
                            clearTimeout(timeoutId);
                            this.fetchPage(redirectUrl).then(resolve);
                            return;
                        }
                    }
                    if (res.statusCode !== 200) {
                        console.warn(`[SAFLII] HTTP ${res.statusCode} for ${url}`);
                        clearTimeout(timeoutId);
                        resolve(null);
                        return;
                    }
                    let data = '';
                    res.on('data', (chunk) => {
                        data += chunk;
                    });
                    res.on('end', () => {
                        clearTimeout(timeoutId);
                        resolve(data);
                    });
                });
                req.on('error', (error) => {
                    console.error(`[SAFLII] Request error for ${url}:`, error.message);
                    clearTimeout(timeoutId);
                    resolve(null);
                });
                req.end();
            });
        });
    }
    async getCaseList(courtCode, year) {
        const court = exports.SOUTH_AFRICAN_COURTS[courtCode];
        if (!court) {
            throw new Error(`Unknown court code: ${courtCode}`);
        }
        const url = year
            ? `${this.baseUrl}/${court.path}/${year}/`
            : `${this.baseUrl}/${court.path}/`;
        const html = await this.fetchPage(url);
        if (!html) {
            return [];
        }
        return this.parseCaseList(html);
    }
    parseCaseList(html, baseUrl) {
        const cases = [];
        const linkPattern = /<a\s+href="([^"]*\d+\.html)"[^>]*>([^<]+)<\/a>/gi;
        let match;
        while ((match = linkPattern.exec(html)) !== null) {
            const [, href, fullTitle] = match;
            if (href.includes('databases') || href.includes('search')) {
                continue;
            }
            const titleMatch = fullTitle.match(/^(.+?)\s*\(([^)]+)\)\s*\(([^)]+)\)$/);
            let title = this.cleanText(fullTitle);
            let citation;
            let dateStr;
            if (titleMatch) {
                title = this.cleanText(titleMatch[1]);
                dateStr = titleMatch[3];
                citation = titleMatch[2];
            }
            let fullUrl;
            if (href.startsWith('http')) {
                fullUrl = href;
            }
            else if (href.startsWith('/')) {
                fullUrl = `${this.baseUrl}${href}`;
            }
            else {
                const pathMatch = href.match(/(\d{4})\/(\d+)\.html/);
                if (pathMatch) {
                    const courtMatch = html.match(/South Africa:\s*([^<]+)/i);
                    const court = courtMatch ? this.getCourtCode(courtMatch[1]) : 'ZACC';
                    fullUrl = `${this.baseUrl}/za/cases/${court}/${pathMatch[1]}/${pathMatch[2]}.html`;
                }
                else {
                    fullUrl = `${this.baseUrl}${href.replace(/^\.\./, '')}`;
                }
            }
            cases.push({
                title,
                url: fullUrl,
                date: dateStr,
                citation,
            });
        }
        return cases;
    }
    getCourtCode(name) {
        const nameLower = name.toLowerCase().trim();
        for (const [code, info] of Object.entries(exports.SOUTH_AFRICAN_COURTS)) {
            if (nameLower.includes(info.name.toLowerCase()) || info.name.toLowerCase().includes(nameLower)) {
                return code;
            }
        }
        return 'ZACC';
    }
    async getCase(url) {
        const html = await this.fetchPage(url);
        if (!html) {
            return null;
        }
        return this.parseCase(html, url);
    }
    parseCase(html, url) {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i)
            || html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        const title = titleMatch ? this.cleanText(titleMatch[1]) : 'Untitled Case';
        const content = this.extractContent(html);
        if (!content || content.length < 100) {
            console.warn(`[SAFLII] Content too short for ${url}`);
            return null;
        }
        const courtMatch = url.match(/\/za\/cases\/([A-Z]+)\//i);
        const courtCode = courtMatch ? courtMatch[1].toUpperCase() : 'UNKNOWN';
        const court = exports.SOUTH_AFRICAN_COURTS[courtCode];
        const citationMatch = html.match(/\[(\d{4})\]\s+(ZACC|ZASCA|ZA[A-Z]+)\s+(\d+)/i)
            || html.match(/Citation[:\s]+([^\n<]+)/i);
        const citation = citationMatch ? this.cleanText(citationMatch[0]) : undefined;
        const dateMatch = html.match(/(?:Date|Decided|Judgment)[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i)
            || html.match(/(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i);
        const dateStr = dateMatch ? dateMatch[1] : undefined;
        const date = dateStr ? this.parseDate(dateStr) : undefined;
        const judgesMatch = html.match(/(?:Coram|Judges?|Before)[:\s]+([^\n<]+)/i);
        const judges = judgesMatch ? this.cleanText(judgesMatch[1]) : undefined;
        const partiesMatch = title.match(/^(.+)\s+v\s+(.+)$/i);
        const parties = partiesMatch ? `${partiesMatch[1].trim()} v ${partiesMatch[2].trim()}` : undefined;
        const sourceId = this.generateSourceId(url);
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
        return {
            sourceId,
            source: 'saflii',
            title,
            content,
            url,
            jurisdiction: 'ZA',
            date,
            citation,
            contentHash,
            fetchedAt: new Date(),
            court: court?.name || courtCode,
            courtCode,
            neutralCitation: citation,
            judges,
            parties,
        };
    }
    extractContent(html) {
        const selectors = [
            /<div[^>]*class="[^"]*judgment[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/body)/i,
            /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/body)/i,
            /<pre[^>]*>([\s\S]*?)<\/pre>/i,
            /<table[^>]*class="[^"]*MsoNormal[^"]*"[^>]*>([\s\S]*?)<\/table>/i,
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
    async fetchCasesFromCourt(courtCode, options = {}) {
        const { limit = 50, year, onProgress } = options;
        const cases = [];
        try {
            const caseList = await this.getCaseList(courtCode, year);
            const toFetch = caseList.slice(0, limit);
            console.log(`[SAFLII] Found ${caseList.length} cases for ${courtCode}, fetching ${toFetch.length}`);
            for (let i = 0; i < toFetch.length; i++) {
                const entry = toFetch[i];
                onProgress?.(i + 1, toFetch.length);
                try {
                    const caseData = await this.getCase(entry.url);
                    if (caseData) {
                        cases.push(caseData);
                    }
                }
                catch (error) {
                    console.error(`[SAFLII] Error fetching ${entry.url}:`, error);
                }
            }
        }
        catch (error) {
            console.error(`[SAFLII] Error fetching from ${courtCode}:`, error);
        }
        return cases;
    }
    async searchCases(query, options = {}) {
        const { limit = 20 } = options;
        const searchUrl = `${this.baseUrl}/cgi-bin/sinosrch.cgi?query=${encodeURIComponent(query)}&meta=/za/cases`;
        const html = await this.fetchPage(searchUrl);
        if (!html) {
            return [];
        }
        return this.parseCaseList(html).slice(0, limit);
    }
    cleanText(text) {
        return text
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
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
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }
    generateSourceId(url) {
        const match = url.match(/\/za\/cases\/([A-Z]+)\/(\d{4})\/(\d+)\.html/i);
        if (match) {
            return `saflii:${match[1].toLowerCase()}/${match[2]}/${match[3]}`;
        }
        return `saflii:${crypto.createHash('md5').update(url).digest('hex').slice(0, 12)}`;
    }
    parseDate(dateStr) {
        try {
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? undefined : date;
        }
        catch {
            return undefined;
        }
    }
}
exports.SAFLIIClient = SAFLIIClient;
let clientInstance = null;
function getSAFLIIClient() {
    if (!clientInstance) {
        clientInstance = new SAFLIIClient();
    }
    return clientInstance;
}
async function searchSAFLII(query, options) {
    return getSAFLIIClient().searchCases(query, options);
}
async function fetchSAFLIICase(url) {
    return getSAFLIIClient().getCase(url);
}
//# sourceMappingURL=saflii.js.map