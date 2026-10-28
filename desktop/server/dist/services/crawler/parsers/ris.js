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
exports.RISParser = exports.RIS_URL_PATTERNS = void 0;
exports.buildRISSearchUrl = buildRISSearchUrl;
exports.extractSearchResultUrls = extractSearchResultUrls;
exports.parseRISDocument = parseRISDocument;
const cheerio = __importStar(require("cheerio"));
const crypto = __importStar(require("crypto"));
const generic_1 = require("./generic");
exports.RIS_URL_PATTERNS = {
    bundesrecht: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=',
    landesrecht: 'https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrNO&Gesetzesnummer=',
    judikatur: 'https://www.ris.bka.gv.at/Dokumente/',
    search: 'https://www.ris.bka.gv.at/Ergebnis.wxe',
};
class RISParser {
    genericParser;
    constructor() {
        this.genericParser = new generic_1.GenericParser({
            defaultJurisdiction: 'AT',
            defaultLanguage: 'de',
            defaultDocumentType: 'legislation',
            contentSelectors: [
                '.contentBlock',
                '.Content',
                '#ContentPlaceHolderHaupspalte',
                '.WordSection1',
                '#document',
                'body',
            ],
            removeSelectors: [
                'nav',
                '.navigation',
                '.menu',
                '#header',
                '#footer',
                '.header',
                '.footer',
                '.toolbar',
                '.breadcrumb',
            ],
        });
    }
    parse(html, url) {
        try {
            const $ = cheerio.load(html);
            const risType = this.detectDocumentType(url);
            switch (risType) {
                case 'bundesrecht':
                case 'landesrecht':
                    return this.parseLegislation($, url, risType);
                case 'judikatur':
                    return this.parseJudikatur($, url);
                default:
                    const generic = this.genericParser.parse(html, url, 'ris_austria');
                    if (generic) {
                        return {
                            ...generic,
                            source: 'ris_austria',
                            risType: risType || 'bundesrecht',
                            isCurrent: true,
                        };
                    }
                    return null;
            }
        }
        catch (error) {
            console.error(`[RISParser] Error parsing ${url}:`, error);
            return null;
        }
    }
    detectDocumentType(url) {
        const lowerUrl = url.toLowerCase();
        if (lowerUrl.includes('bundesnormen') || lowerUrl.includes('bundesrecht')) {
            return 'bundesrecht';
        }
        if (lowerUrl.includes('landesrecht') || lowerUrl.includes('lrno') || lowerUrl.includes('lrwien')) {
            return 'landesrecht';
        }
        if (lowerUrl.includes('judikatur') || lowerUrl.includes('justiz')) {
            return 'judikatur';
        }
        if (lowerUrl.includes('erlaesse')) {
            return 'erlaesse';
        }
        if (lowerUrl.includes('staatsvertraege')) {
            return 'staatsvertraege';
        }
        return null;
    }
    parseLegislation($, url, risType) {
        const titleEl = $('.Titel, .T1, h1').first();
        const title = this.cleanText(titleEl.text()) || 'Untitled Law';
        const lawNumberEl = $('.Bgbl, .LGBl, .Fundstelle').first();
        const lawNumber = this.cleanText(lawNumberEl.text());
        const paragraphs = this.extractParagraphs($);
        let content = title + '\n\n';
        if (lawNumber) {
            content += lawNumber + '\n\n';
        }
        for (const para of paragraphs) {
            if (para.title) {
                content += `${para.number ? '§ ' + para.number + ' ' : ''}${para.title}\n`;
            }
            content += para.content + '\n\n';
        }
        const dateText = $('.Stand, .Inkrafttreten, .Datum').first().text();
        const date = this.parseGermanDate(dateText);
        const isCurrent = !$('.Historic, .Historisch').length;
        const amendments = this.extractAmendments($);
        const relatedDocuments = this.extractRelatedLaws($, url);
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
        const gesetzesnummerMatch = url.match(/Gesetzesnummer=(\d+)/);
        const sourceId = gesetzesnummerMatch
            ? gesetzesnummerMatch[1]
            : crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
        return {
            sourceId,
            source: 'ris_austria',
            documentType: 'legislation',
            title,
            content,
            url,
            jurisdiction: 'AT',
            language: 'de',
            date,
            risType,
            lawNumber,
            paragraphs,
            isCurrent,
            amendments,
            relatedDocuments,
            contentHash,
            crawledAt: new Date(),
            metadata: {
                parser: 'ris',
                risType,
            },
        };
    }
    parseJudikatur($, url) {
        const caseNumberEl = $('.Geschaeftszahl, .GZ, .Aktenzeichen').first();
        const caseNumber = this.cleanText(caseNumberEl.text());
        const titleEl = $('.Leitsatz, .Entscheidungstext h1, .Titel').first();
        let title = this.cleanText(titleEl.text());
        if (!title && caseNumber) {
            title = caseNumber;
        }
        const decisionEl = $('.Entscheidungstext, .Volltext, .ContentBlock').first();
        const content = this.cleanText(decisionEl.text());
        if (!content || content.length < 100) {
            return null;
        }
        const courtEl = $('.Gericht, .Behoerde').first();
        const court = this.cleanText(courtEl.text());
        const dateEl = $('.Entscheidungsdatum, .Datum').first();
        const date = this.parseGermanDate(dateEl.text());
        const topics = [];
        $('.Schlagwort, .Norm, .Rechtssatz').each((_, el) => {
            const topic = this.cleanText($(el).text());
            if (topic)
                topics.push(topic);
        });
        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
        const sourceId = caseNumber
            ? crypto.createHash('md5').update(caseNumber).digest('hex').slice(0, 16)
            : crypto.createHash('md5').update(url).digest('hex').slice(0, 16);
        return {
            sourceId,
            source: 'ris_austria',
            documentType: 'case_law',
            title: title || 'Untitled Decision',
            content,
            url,
            jurisdiction: 'AT',
            language: 'de',
            date,
            number: caseNumber,
            court,
            topics: topics.length > 0 ? topics : undefined,
            risType: 'judikatur',
            isCurrent: true,
            contentHash,
            crawledAt: new Date(),
            metadata: {
                parser: 'ris',
                caseNumber,
                court,
            },
        };
    }
    extractParagraphs($) {
        const paragraphs = [];
        $('.Paragraph, .Art, .Section, [class*="para"]').each((_, el) => {
            const paraEl = $(el);
            const numberEl = paraEl.find('.ParagraphNr, .ArtikelNr, .SectionNr').first();
            let number = this.cleanText(numberEl.text());
            number = number.replace(/^§\s*/, '').trim();
            const titleEl = paraEl.find('.Ueberschrift, .ParagraphTitel, h2, h3').first();
            const title = this.cleanText(titleEl.text());
            const contentEl = paraEl.find('.Absatz, .Text, p').first();
            let content = '';
            if (contentEl.length) {
                content = this.cleanText(contentEl.text());
            }
            else {
                const clone = paraEl.clone();
                clone.find('.ParagraphNr, .ArtikelNr, .Ueberschrift').remove();
                content = this.cleanText(clone.text());
            }
            if (number && content) {
                paragraphs.push({ number, title: title || undefined, content });
            }
        });
        return paragraphs;
    }
    extractAmendments($) {
        const amendments = [];
        $('.Aenderung, .Amendment, .Novelle, .BGBl').each((_, el) => {
            const text = this.cleanText($(el).text());
            const date = this.parseGermanDate(text);
            if (date) {
                const refMatch = text.match(/(BGBl\.?\s*(?:I|II|III)?\s*Nr\.?\s*\d+\/\d+)/i);
                amendments.push({
                    date,
                    description: text,
                    reference: refMatch?.[1],
                });
            }
        });
        return amendments;
    }
    extractRelatedLaws($, baseUrl) {
        const related = [];
        $('.Verweis, .Link, a[href*="Gesetzesnummer"]').each((_, el) => {
            const link = $(el);
            const href = link.attr('href');
            const title = this.cleanText(link.text());
            if (href && title && !href.includes('javascript')) {
                try {
                    const absoluteUrl = new URL(href, baseUrl).href;
                    related.push({
                        title,
                        url: absoluteUrl,
                        relationship: 'related',
                    });
                }
                catch {
                }
            }
        });
        return related.length > 0 ? related : undefined;
    }
    parseGermanDate(text) {
        if (!text)
            return undefined;
        const patterns = [
            /(\d{1,2})\.(\d{1,2})\.(\d{4})/,
            /(\d{1,2})\.\s*(Januar|Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s+(\d{4})/i,
            /Stand[:\s]+(\d{1,2})\.(\d{1,2})\.(\d{4})/,
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                if (match[2]?.match(/[a-z]/i)) {
                    const monthNames = {
                        januar: 0, jänner: 0, februar: 1, märz: 2, april: 3, mai: 4, juni: 5,
                        juli: 6, august: 7, september: 8, oktober: 9, november: 10, dezember: 11,
                    };
                    const month = monthNames[match[2].toLowerCase()];
                    if (month !== undefined) {
                        return new Date(parseInt(match[3]), month, parseInt(match[1]));
                    }
                }
                else {
                    return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
                }
            }
        }
        return undefined;
    }
    cleanText(text) {
        return text.replace(/\s+/g, ' ').trim();
    }
}
exports.RISParser = RISParser;
function buildRISSearchUrl(options) {
    const { type, query, dateFrom, dateTo, pageSize = 50, page = 0 } = options;
    const params = new URLSearchParams();
    switch (type) {
        case 'bundesrecht':
            params.set('Abfrage', 'Bundesnormen');
            break;
        case 'landesrecht':
            params.set('Abfrage', 'LrNO');
            break;
        case 'judikatur':
            params.set('Abfrage', 'Justiz');
            break;
        case 'erlaesse':
            params.set('Abfrage', 'Erlaesse');
            break;
        case 'staatsvertraege':
            params.set('Abfrage', 'Staatsvertraege');
            break;
    }
    if (query) {
        params.set('Suchworte', query);
    }
    if (dateFrom) {
        params.set('VonDatum', formatGermanDate(dateFrom));
    }
    if (dateTo) {
        params.set('BisDatum', formatGermanDate(dateTo));
    }
    params.set('ShowPrintPreview', 'False');
    params.set('ResultPageSize', pageSize.toString());
    params.set('Position', (page * pageSize + 1).toString());
    return `${exports.RIS_URL_PATTERNS.search}?${params.toString()}`;
}
function extractSearchResultUrls(html, baseUrl) {
    const $ = cheerio.load(html);
    const urls = [];
    $('a[href*="Dokument"], a[href*="GeltendeFassung"]').each((_, el) => {
        const href = $(el).attr('href');
        if (href) {
            try {
                const absoluteUrl = new URL(href, baseUrl).href;
                if (!urls.includes(absoluteUrl)) {
                    urls.push(absoluteUrl);
                }
            }
            catch {
            }
        }
    });
    return urls;
}
function formatGermanDate(date) {
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}
function parseRISDocument(html, url) {
    const parser = new RISParser();
    return parser.parse(html, url);
}
//# sourceMappingURL=ris.js.map