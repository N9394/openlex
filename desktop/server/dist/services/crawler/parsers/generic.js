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
exports.GenericParser = void 0;
exports.parseHtml = parseHtml;
exports.extractText = extractText;
exports.extractLinks = extractLinks;
const cheerio = __importStar(require("cheerio"));
const crypto = __importStar(require("crypto"));
const DEFAULT_OPTIONS = {
    contentSelectors: [
        'article',
        'main',
        '.content',
        '#content',
        '.article-content',
        '.document-content',
        '.case-content',
        '.judgment-body',
        'body',
    ],
    removeSelectors: [
        'nav',
        'header',
        'footer',
        '.sidebar',
        '.navigation',
        '.menu',
        '.advertisement',
        '.ads',
        'script',
        'style',
        'noscript',
        '.cookie-notice',
        '.social-share',
        '.related-articles',
    ],
    defaultJurisdiction: 'unknown',
    defaultLanguage: 'en',
    defaultDocumentType: 'other',
};
class GenericParser {
    options;
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    parse(html, url, source = 'custom') {
        try {
            const $ = cheerio.load(html);
            for (const selector of this.options.removeSelectors || []) {
                $(selector).remove();
            }
            let contentElement = null;
            for (const selector of this.options.contentSelectors || []) {
                const element = $(selector).first();
                if (element.length > 0 && element.text().trim().length > 100) {
                    contentElement = element;
                    break;
                }
            }
            if (!contentElement) {
                console.warn(`[GenericParser] No content found for ${url}`);
                return null;
            }
            const title = this.extractTitle($, url);
            const content = this.cleanText(contentElement.text());
            if (content.length < 50) {
                console.warn(`[GenericParser] Content too short for ${url}`);
                return null;
            }
            const date = this.extractDate($);
            const sections = this.extractSections($, contentElement);
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            const sourceId = this.generateSourceId(url);
            return {
                sourceId,
                source,
                documentType: this.options.defaultDocumentType,
                title,
                content,
                url,
                jurisdiction: this.options.defaultJurisdiction,
                language: this.detectLanguage(content) || this.options.defaultLanguage,
                date,
                sections: sections.length > 0 ? sections : undefined,
                contentHash,
                crawledAt: new Date(),
                metadata: {
                    originalUrl: url,
                    parsedWith: 'generic',
                },
            };
        }
        catch (error) {
            console.error(`[GenericParser] Error parsing ${url}:`, error);
            return null;
        }
    }
    extractTitle($, url) {
        if (this.options.titleSelector) {
            const customTitle = $(this.options.titleSelector).first().text().trim();
            if (customTitle)
                return customTitle;
        }
        const titleSelectors = [
            'h1',
            'title',
            '.document-title',
            '.case-title',
            '.article-title',
            '[itemprop="headline"]',
            'meta[property="og:title"]',
        ];
        for (const selector of titleSelectors) {
            let title = '';
            if (selector.startsWith('meta')) {
                title = $(selector).attr('content') || '';
            }
            else {
                title = $(selector).first().text().trim();
            }
            if (title && title.length > 5 && title.length < 500) {
                return this.cleanText(title);
            }
        }
        try {
            const urlObj = new URL(url);
            return urlObj.pathname.split('/').pop()?.replace(/[-_]/g, ' ') || 'Untitled Document';
        }
        catch {
            return 'Untitled Document';
        }
    }
    extractDate($) {
        if (this.options.dateSelector) {
            const dateText = $(this.options.dateSelector).first().text().trim();
            const parsed = this.parseDate(dateText);
            if (parsed)
                return parsed;
        }
        const dateSelectors = [
            'time[datetime]',
            '.date',
            '.published-date',
            '.judgment-date',
            '.document-date',
            '[itemprop="datePublished"]',
            'meta[property="article:published_time"]',
        ];
        for (const selector of dateSelectors) {
            let dateText = '';
            if (selector.startsWith('meta')) {
                dateText = $(selector).attr('content') || '';
            }
            else if (selector.includes('[datetime]')) {
                dateText = $(selector).first().attr('datetime') || $(selector).first().text();
            }
            else {
                dateText = $(selector).first().text().trim();
            }
            const parsed = this.parseDate(dateText);
            if (parsed)
                return parsed;
        }
        return undefined;
    }
    parseDate(dateStr) {
        if (!dateStr)
            return undefined;
        const isoDate = new Date(dateStr);
        if (!isNaN(isoDate.getTime())) {
            return isoDate;
        }
        const patterns = [
            /(\d{1,2})\.(\d{1,2})\.(\d{4})/,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
            /(\w+)\s+(\d{1,2}),?\s+(\d{4})/,
            /(\d{1,2})\s+(\w+)\s+(\d{4})/,
            /(\d{4})-(\d{2})-(\d{2})/,
        ];
        for (const pattern of patterns) {
            const match = dateStr.match(pattern);
            if (match) {
                if (pattern.source.startsWith('(\\d{4})')) {
                    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
                }
                else if (pattern.source.includes('\\w+')) {
                    const monthNames = [
                        'january', 'february', 'march', 'april', 'may', 'june',
                        'july', 'august', 'september', 'october', 'november', 'december',
                    ];
                    const monthStr = match[1].toLowerCase();
                    const monthIndex = monthNames.findIndex(m => m.startsWith(monthStr));
                    if (monthIndex !== -1) {
                        return new Date(parseInt(match[3]), monthIndex, parseInt(match[2]));
                    }
                }
                else {
                    return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
                }
            }
        }
        return undefined;
    }
    extractSections($, container) {
        const sections = [];
        container.find('h2, h3, h4, .section-heading, .paragraph-heading').each((_, el) => {
            const heading = $(el);
            const title = this.cleanText(heading.text());
            let content = '';
            let next = heading.next();
            while (next.length && !next.is('h2, h3, h4, .section-heading')) {
                content += next.text() + ' ';
                next = next.next();
            }
            content = this.cleanText(content);
            if (title && content.length > 20) {
                const numberMatch = title.match(/^(?:§|Art\.?|Section|Artikel|Abschnitt)?\s*(\d+[a-z]?)/i);
                sections.push({
                    title: title.replace(/^(?:§|Art\.?|Section|Artikel|Abschnitt)?\s*\d+[a-z]?\s*/i, '').trim() || title,
                    number: numberMatch?.[1],
                    content,
                });
            }
        });
        return sections;
    }
    detectLanguage(text) {
        const sample = text.toLowerCase().slice(0, 2000);
        const germanWords = ['und', 'der', 'die', 'das', 'ist', 'nicht', 'werden', 'gemäß', 'artikel'];
        const germanCount = germanWords.filter(w => sample.includes(` ${w} `)).length;
        const frenchWords = ['et', 'le', 'la', 'les', 'est', 'sont', 'dans', 'pour', 'avec'];
        const frenchCount = frenchWords.filter(w => sample.includes(` ${w} `)).length;
        const italianWords = ['e', 'il', 'la', 'che', 'non', 'sono', 'per', 'della', 'articolo'];
        const italianCount = italianWords.filter(w => sample.includes(` ${w} `)).length;
        const englishWords = ['the', 'and', 'is', 'are', 'was', 'were', 'have', 'has', 'shall'];
        const englishCount = englishWords.filter(w => sample.includes(` ${w} `)).length;
        const max = Math.max(germanCount, frenchCount, italianCount, englishCount);
        if (max < 2)
            return null;
        if (germanCount === max)
            return 'de';
        if (frenchCount === max)
            return 'fr';
        if (italianCount === max)
            return 'it';
        return 'en';
    }
    cleanText(text) {
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[^\S\n]+/g, ' ')
            .trim();
    }
    generateSourceId(url) {
        try {
            const urlObj = new URL(url);
            const path = urlObj.pathname + urlObj.search;
            return crypto.createHash('md5').update(path).digest('hex').slice(0, 16);
        }
        catch {
            return crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
        }
    }
}
exports.GenericParser = GenericParser;
function parseHtml(html, url, options) {
    const parser = new GenericParser(options);
    return parser.parse(html, url);
}
function extractText(html) {
    const $ = cheerio.load(html);
    $('script, style, noscript, nav, header, footer').remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
}
function extractLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = [];
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                if (absoluteUrl.startsWith('http')) {
                    links.push(absoluteUrl);
                }
            }
            catch {
            }
        }
    });
    return [...new Set(links)];
}
//# sourceMappingURL=generic.js.map