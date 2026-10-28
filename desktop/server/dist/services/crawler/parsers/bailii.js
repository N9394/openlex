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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BAILIIParser = exports.BAILII_URL_PATTERNS = void 0;
exports.buildBAILIISearchUrl = buildBAILIISearchUrl;
exports.extractBAILIISearchResults = extractBAILIISearchResults;
exports.parseBAILIIDocument = parseBAILIIDocument;
const cheerio = __importStar(require("cheerio"));
const crypto = __importStar(require("crypto"));
exports.BAILII_URL_PATTERNS = {
    base: 'https://www.bailii.org',
    ukCourts: 'https://www.bailii.org/databases.html#uk',
    search: 'https://www.bailii.org/cgi-bin/find10.cgi',
};
const COURT_CODES = {
    'uksc': 'UKSC',
    'ewca': 'EWCA',
    'ewhc': 'EWHC',
    'ukut': 'UKUT',
    'ukftt': 'UKFTT',
    'nica': 'NICA',
    'csih': 'CSIH',
    'csoh': 'CSOH',
};
class BAILIIParser {
    constructor() {
    }
    parse(html, url) {
        try {
            const $ = cheerio.load(html);
            const court = this.detectCourt(url);
            const title = this.extractTitle($);
            if (!title) {
                console.warn(`[BAILIIParser] Could not extract title from ${url}`);
                return null;
            }
            const neutralCitation = this.extractNeutralCitation($, html);
            const content = this.extractJudgmentContent($);
            if (!content || content.length < 200) {
                console.warn(`[BAILIIParser] Content too short for ${url}`);
                return null;
            }
            const date = this.extractDate($, html);
            const parties = this.extractParties($, title);
            const judges = this.extractJudges($);
            const keywords = this.extractKeywords($);
            const sections = this.extractSections($);
            const relatedDocuments = this.extractCitations($, url);
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            const sourceId = neutralCitation
                ? crypto.createHash('md5').update(neutralCitation).digest('hex').slice(0, 16)
                : crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
            return {
                sourceId,
                source: 'bailii_uk',
                documentType: 'case_law',
                title,
                content,
                url,
                jurisdiction: this.getJurisdiction(court),
                language: 'en',
                date,
                citation: neutralCitation,
                court,
                neutralCitation,
                parties,
                judges: judges.length > 0 ? judges : undefined,
                keywords: keywords.length > 0 ? keywords : undefined,
                sections: sections.length > 0 ? sections : undefined,
                relatedDocuments: relatedDocuments && relatedDocuments.length > 0 ? relatedDocuments : undefined,
                contentHash,
                crawledAt: new Date(),
                metadata: {
                    parser: 'bailii',
                    court,
                    neutralCitation,
                },
            };
        }
        catch (error) {
            console.error(`[BAILIIParser] Error parsing ${url}:`, error);
            return null;
        }
    }
    detectCourt(url) {
        const lowerUrl = url.toLowerCase();
        for (const [code, court] of Object.entries(COURT_CODES)) {
            if (lowerUrl.includes(`/${code}/`)) {
                return court;
            }
        }
        if (lowerUrl.includes('/uksc/'))
            return 'UKSC';
        if (lowerUrl.includes('/ewca/'))
            return 'EWCA';
        if (lowerUrl.includes('/ewhc/'))
            return 'EWHC';
        return 'other';
    }
    getJurisdiction(court) {
        switch (court) {
            case 'UKSC':
            case 'UKUT':
            case 'UKFTT':
                return 'UK';
            case 'EWCA':
            case 'EWHC':
                return 'EWCW';
            case 'CSIH':
            case 'CSOH':
                return 'SC';
            case 'NICA':
                return 'NI';
            default:
                return 'UK';
        }
    }
    extractTitle($) {
        const selectors = [
            'title',
            'h1',
            '.case-title',
            '.parties',
            'meta[name="citation_title"]',
        ];
        for (const selector of selectors) {
            let title = '';
            if (selector.startsWith('meta')) {
                title = $(selector).attr('content') || '';
            }
            else {
                title = $(selector).first().text();
            }
            title = this.cleanText(title);
            if (title) {
                title = title.replace(/^BAILII\s*[-:]\s*/i, '');
                title = title.replace(/\s*\[?\d{4}\]?\s*[A-Z]+\s*\d+\s*$/i, '').trim();
                if (title.length > 10 && title.length < 500) {
                    return title;
                }
            }
        }
        return null;
    }
    extractNeutralCitation($, html) {
        const metaCitation = $('meta[name="citation_neutral"]').attr('content');
        if (metaCitation) {
            return this.cleanText(metaCitation);
        }
        const citationPattern = /\[(\d{4})\]\s*([A-Z]{2,})\s*(\d+)/;
        const match = html.match(citationPattern);
        if (match) {
            return `[${match[1]}] ${match[2]} ${match[3]}`;
        }
        return undefined;
    }
    extractJudgmentContent($) {
        $('nav, header, footer, .navigation, .bailii-header, .bailii-footer').remove();
        const judgmentSelectors = [
            '.bailii-body',
            '.judgment',
            '#judgment-body',
            '.content',
            'body',
        ];
        for (const selector of judgmentSelectors) {
            const el = $(selector).first();
            if (el.length) {
                const text = this.cleanText(el.text());
                if (text.length > 200) {
                    return text;
                }
            }
        }
        return this.cleanText($('body').text());
    }
    extractDate($, html) {
        const metaDate = $('meta[name="citation_date"]').attr('content');
        if (metaDate) {
            const parsed = new Date(metaDate);
            if (!isNaN(parsed.getTime())) {
                return parsed;
            }
        }
        const datePatterns = [
            /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i,
            /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
        ];
        for (const pattern of datePatterns) {
            const match = html.match(pattern);
            if (match) {
                const monthNames = {
                    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
                    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
                };
                if (match[2]?.match(/[a-z]/i)) {
                    const month = monthNames[match[2].toLowerCase()];
                    if (month !== undefined) {
                        return new Date(parseInt(match[3]), month, parseInt(match[1]));
                    }
                }
                else if (match[1]?.match(/[a-z]/i)) {
                    const month = monthNames[match[1].toLowerCase()];
                    if (month !== undefined) {
                        return new Date(parseInt(match[3]), month, parseInt(match[2]));
                    }
                }
                else {
                    return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
                }
            }
        }
        return undefined;
    }
    extractParties(_$, title) {
        const parties = {};
        const vsMatch = title.match(/^(.+?)\s+v\.?\s+(.+?)(?:\s*\[|$)/i);
        if (vsMatch) {
            const first = this.cleanText(vsMatch[1]);
            const second = this.cleanText(vsMatch[2]);
            if (first.toLowerCase() === 'r' || first.toLowerCase() === 'regina') {
                parties.claimant = 'The Crown';
                parties.defendant = second;
            }
            else {
                parties.claimant = first;
                parties.defendant = second;
            }
        }
        const reMatch = title.match(/^(?:In\s+)?Re\s+(.+?)(?:\s*\[|$)/i);
        if (reMatch) {
            parties.claimant = this.cleanText(reMatch[1]);
        }
        return Object.keys(parties).length > 0 ? parties : undefined;
    }
    extractJudges($) {
        const judges = [];
        const judgePatterns = [
            /Lord\s+(?:Justice\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
            /Lady\s+(?:Justice\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
            /(?:Mr|Mrs|Ms)\s+Justice\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/g,
            /(?:Lord|Lady|Baroness|Baron)\s+([A-Z][a-zA-Z]+)/g,
        ];
        const content = $('body').text();
        for (const pattern of judgePatterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                const judge = match[0].trim();
                if (!judges.includes(judge) && judges.length < 10) {
                    judges.push(judge);
                }
            }
        }
        return judges;
    }
    extractKeywords($) {
        const keywords = [];
        const metaKeywords = $('meta[name="keywords"]').attr('content');
        if (metaKeywords) {
            keywords.push(...metaKeywords.split(',').map(k => k.trim()).filter(k => k));
        }
        $('.subject, .keywords, .topics').each((_, el) => {
            const text = $(el).text();
            if (text) {
                keywords.push(...text.split(/[,;]/).map(k => k.trim()).filter(k => k && k.length < 50));
            }
        });
        return [...new Set(keywords)].slice(0, 20);
    }
    extractSections($) {
        const sections = [];
        $('p, div').each((_, el) => {
            const text = $(el).text();
            const paraMatch = text.match(/^(\d+)\.\s+(.{50,})/);
            if (paraMatch) {
                sections.push({
                    title: 'Paragraph',
                    number: paraMatch[1],
                    content: this.cleanText(paraMatch[2]),
                });
            }
        });
        $('h2, h3, h4').each((_, el) => {
            const heading = $(el);
            const title = this.cleanText(heading.text());
            let content = '';
            let next = heading.next();
            while (next.length && !next.is('h2, h3, h4')) {
                content += next.text() + ' ';
                next = next.next();
            }
            content = this.cleanText(content);
            if (title && content.length > 50) {
                sections.push({ title, content });
            }
        });
        return sections.slice(0, 50);
    }
    extractCitations($, baseUrl) {
        const citations = [];
        $('a[href*="/ew/"], a[href*="/uk/"], a[href*="/ie/"]').each((_, el) => {
            const link = $(el);
            const href = link.attr('href');
            const title = this.cleanText(link.text());
            if (href && title && title.length > 5 && title.length < 200) {
                try {
                    const absoluteUrl = new URL(href, baseUrl).href;
                    if (!citations.some(c => c.url === absoluteUrl)) {
                        citations.push({
                            title,
                            url: absoluteUrl,
                            relationship: 'cites',
                        });
                    }
                }
                catch {
                }
            }
        });
        return citations.slice(0, 50);
    }
    cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
}
exports.BAILIIParser = BAILIIParser;
function buildBAILIISearchUrl(options) {
    const { query, court, dateFrom, dateTo, maxResults = 100 } = options;
    const params = new URLSearchParams();
    if (query) {
        params.set('query', query);
    }
    if (court && court !== 'other') {
        params.set('court', court.toLowerCase());
    }
    if (dateFrom) {
        params.set('date_from', dateFrom.toISOString().split('T')[0]);
    }
    if (dateTo) {
        params.set('date_to', dateTo.toISOString().split('T')[0]);
    }
    params.set('max_results', maxResults.toString());
    return `${exports.BAILII_URL_PATTERNS.search}?${params.toString()}`;
}
function extractBAILIISearchResults(html, baseUrl) {
    const $ = cheerio.load(html);
    const urls = [];
    $('a[href*="/ew/"], a[href*="/uk/"], a[href*="/ie/"], a[href*="/cases/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.includes('.html')) {
            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                if (!urls.includes(absoluteUrl) && absoluteUrl.includes('bailii.org')) {
                    urls.push(absoluteUrl);
                }
            }
            catch {
            }
        }
    });
    return urls;
}
function parseBAILIIDocument(html, url) {
    const parser = new BAILIIParser();
    return parser.parse(html, url);
}
//# sourceMappingURL=bailii.js.map