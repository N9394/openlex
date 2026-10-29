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
exports.SLOVAK_LAWS = void 0;
exports.scrapeSlovakLaw = scrapeSlovakLaw;
exports.scrapeAndIngestSlovakLaw = scrapeAndIngestSlovakLaw;
exports.scrapeAndIngestMultipleSlovakLaws = scrapeAndIngestMultipleSlovakLaws;
exports.scrapeSlovakCourtDecisions = scrapeSlovakCourtDecisions;
exports.fetchSlovakSupremeCourtDecisions = fetchSlovakSupremeCourtDecisions;
exports.ingestAllSlovakLaws = ingestAllSlovakLaws;
const crypto = __importStar(require("crypto"));
exports.SLOVAK_LAWS = {
    OZ: { zbierkaNumber: '40/1964', fullName: 'Občiansky zákonník', fullNameEn: 'Civil Code' },
    ZoR: { zbierkaNumber: '36/2005', fullName: 'Zákon o rodine', fullNameEn: 'Family Act' },
    DevZak: { zbierkaNumber: '87/2015', fullName: 'Zákon o ochrane spotrebiteľa pri zmluvách na diaľku', fullNameEn: 'Distance Contracts Consumer Protection Act' },
    ObZ: { zbierkaNumber: '513/1991', fullName: 'Obchodný zákonník', fullNameEn: 'Commercial Code' },
    ZoOK: { zbierkaNumber: '7/2005', fullName: 'Zákon o konkurze a reštrukturalizácii', fullNameEn: 'Bankruptcy and Restructuring Act' },
    ZoOZ: { zbierkaNumber: '530/2003', fullName: 'Zákon o obchodnom registri', fullNameEn: 'Commercial Register Act' },
    TZ: { zbierkaNumber: '300/2005', fullName: 'Trestný zákon', fullNameEn: 'Criminal Code' },
    TP: { zbierkaNumber: '301/2005', fullName: 'Trestný poriadok', fullNameEn: 'Criminal Procedure Code' },
    ZoTPO: { zbierkaNumber: '91/2016', fullName: 'Zákon o trestnej zodpovednosti právnických osôb', fullNameEn: 'Corporate Criminal Liability Act' },
    CSP: { zbierkaNumber: '160/2015', fullName: 'Civilný sporový poriadok', fullNameEn: 'Civil Contentious Procedure Code' },
    CMP: { zbierkaNumber: '161/2015', fullName: 'Civilný mimosporový poriadok', fullNameEn: 'Civil Non-Contentious Procedure Code' },
    SSP: { zbierkaNumber: '162/2015', fullName: 'Správny súdny poriadok', fullNameEn: 'Administrative Court Procedure Code' },
    EP: { zbierkaNumber: '233/1995', fullName: 'Exekučný poriadok', fullNameEn: 'Execution Procedure Code' },
    ZP: { zbierkaNumber: '311/2001', fullName: 'Zákonník práce', fullNameEn: 'Labor Code' },
    ZoZam: { zbierkaNumber: '5/2004', fullName: 'Zákon o službách zamestnanosti', fullNameEn: 'Employment Services Act' },
    ZoBOZP: { zbierkaNumber: '124/2006', fullName: 'Zákon o bezpečnosti a ochrane zdravia pri práci', fullNameEn: 'Occupational Safety and Health Act' },
    ZOVS: { zbierkaNumber: '552/2003', fullName: 'Zákon o výkone práce vo verejnom záujme', fullNameEn: 'Public Interest Employment Act' },
    ZoKV: { zbierkaNumber: '2/1991', fullName: 'Zákon o kolektívnom vyjednávaní', fullNameEn: 'Collective Bargaining Act' },
    ZoSP: { zbierkaNumber: '461/2003', fullName: 'Zákon o sociálnom poistení', fullNameEn: 'Social Insurance Act' },
    ZoZP: { zbierkaNumber: '580/2004', fullName: 'Zákon o zdravotnom poistení', fullNameEn: 'Health Insurance Act' },
    ZoSS: { zbierkaNumber: '448/2008', fullName: 'Zákon o sociálnych službách', fullNameEn: 'Social Services Act' },
    ZoDP: { zbierkaNumber: '595/2003', fullName: 'Zákon o dani z príjmov', fullNameEn: 'Income Tax Act' },
    ZoDPH: { zbierkaNumber: '222/2004', fullName: 'Zákon o dani z pridanej hodnoty', fullNameEn: 'VAT Act' },
    ZoSD: { zbierkaNumber: '563/2009', fullName: 'Zákon o správe daní (daňový poriadok)', fullNameEn: 'Tax Administration Act' },
    ZoDzN: { zbierkaNumber: '582/2004', fullName: 'Zákon o miestnych daniach a miestnom poplatku', fullNameEn: 'Local Taxes Act' },
    KZ: { zbierkaNumber: '162/1995', fullName: 'Katastrálny zákon', fullNameEn: 'Cadastre Act' },
    ZoBN: { zbierkaNumber: '182/1993', fullName: 'Zákon o vlastníctve bytov a nebytových priestorov', fullNameEn: 'Apartment Ownership Act' },
    ZoNB: { zbierkaNumber: '116/1990', fullName: 'Zákon o nájme a podnájme nebytových priestorov', fullNameEn: 'Non-Residential Lease Act' },
    SP: { zbierkaNumber: '71/1967', fullName: 'Správny poriadok', fullNameEn: 'Administrative Procedure Code' },
    ZoPS: { zbierkaNumber: '372/1990', fullName: 'Zákon o priestupkoch', fullNameEn: 'Misdemeanor Act' },
    ZoSS_SUP: { zbierkaNumber: '757/2004', fullName: 'Zákon o súdoch', fullNameEn: 'Courts Act' },
    Ustava: { zbierkaNumber: '460/1992', fullName: 'Ústava Slovenskej republiky', fullNameEn: 'Constitution of the Slovak Republic' },
    ZoOOU: { zbierkaNumber: '18/2018', fullName: 'Zákon o ochrane osobných údajov (GDPR)', fullNameEn: 'Personal Data Protection Act (GDPR)' },
    ZoES: { zbierkaNumber: '22/2004', fullName: 'Zákon o elektronickom obchode', fullNameEn: 'E-Commerce Act' },
    ZoKB: { zbierkaNumber: '69/2018', fullName: 'Zákon o kybernetickej bezpečnosti', fullNameEn: 'Cybersecurity Act' },
    AutZ: { zbierkaNumber: '185/2015', fullName: 'Autorský zákon', fullNameEn: 'Copyright Act' },
    ZoOZ_IP: { zbierkaNumber: '506/2009', fullName: 'Zákon o ochranných známkach', fullNameEn: 'Trademark Act' },
    ZoP: { zbierkaNumber: '435/2001', fullName: 'Patentový zákon', fullNameEn: 'Patent Act' },
    ZoUV: { zbierkaNumber: '517/2007', fullName: 'Zákon o úžitkových vzoroch', fullNameEn: 'Utility Model Act' },
    ZoB: { zbierkaNumber: '483/2001', fullName: 'Zákon o bankách', fullNameEn: 'Banking Act' },
    ZoCP: { zbierkaNumber: '566/2001', fullName: 'Zákon o cenných papieroch', fullNameEn: 'Securities Act' },
    ZoKI: { zbierkaNumber: '129/2010', fullName: 'Zákon o spotrebiteľských úveroch', fullNameEn: 'Consumer Credit Act' },
    ZoNBS: { zbierkaNumber: '566/1992', fullName: 'Zákon o Národnej banke Slovenska', fullNameEn: 'National Bank Act' },
    ZoPoj: { zbierkaNumber: '39/2015', fullName: 'Zákon o poisťovníctve', fullNameEn: 'Insurance Act' },
    ZoOS: { zbierkaNumber: '250/2007', fullName: 'Zákon o ochrane spotrebiteľa', fullNameEn: 'Consumer Protection Act' },
    ZoRS: { zbierkaNumber: '391/2015', fullName: 'Zákon o alternatívnom riešení spotrebiteľských sporov', fullNameEn: 'Alternative Consumer Dispute Resolution Act' },
    ZoZP_ENV: { zbierkaNumber: '17/1992', fullName: 'Zákon o životnom prostredí', fullNameEn: 'Environmental Act' },
    ZoO: { zbierkaNumber: '79/2015', fullName: 'Zákon o odpadoch', fullNameEn: 'Waste Act' },
    ZoVod: { zbierkaNumber: '364/2004', fullName: 'Vodný zákon', fullNameEn: 'Water Act' },
    ZoEIA: { zbierkaNumber: '24/2006', fullName: 'Zákon o posudzovaní vplyvov na životné prostredie', fullNameEn: 'EIA Act' },
    ZoVO: { zbierkaNumber: '343/2015', fullName: 'Zákon o verejnom obstarávaní', fullNameEn: 'Public Procurement Act' },
};
function buildSlovLexDirectoryUrl(zbierkaNumber) {
    const [number, year] = zbierkaNumber.split('/');
    return `https://static.slov-lex.sk/static/SK/ZZ/${year}/${number}/`;
}
async function discoverAvailableVersions(zbierkaNumber) {
    const directoryUrl = buildSlovLexDirectoryUrl(zbierkaNumber);
    try {
        const response = await fetch(directoryUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; OpenLex/1.0; Educational)',
                'Accept': 'text/html',
            },
        });
        if (!response.ok)
            return [];
        const html = await response.text();
        const versionPattern = /href="(\d{8})\.html"/g;
        const versions = [];
        let match;
        while ((match = versionPattern.exec(html)) !== null) {
            versions.push(match[1]);
        }
        return versions.sort((a, b) => b.localeCompare(a));
    }
    catch (error) {
        console.error(`[Slovak Scraper] Error discovering versions: ${error}`);
        return [];
    }
}
async function fetchSlovLexWithFallback(zbierkaNumber) {
    const [number, year] = zbierkaNumber.split('/');
    const versions = await discoverAvailableVersions(zbierkaNumber);
    if (versions.length === 0) {
        console.log(`[Slovak Scraper] No versions found for ${zbierkaNumber}, trying common dates...`);
        const today = new Date();
        const fallbackVersions = [
            `${today.getFullYear()}1101`,
            `${today.getFullYear()}0101`,
            `${today.getFullYear() - 1}1101`,
            `${today.getFullYear() - 1}0101`,
        ];
        versions.push(...fallbackVersions);
    }
    console.log(`[Slovak Scraper] Found ${versions.length} versions for ${zbierkaNumber}`);
    for (const version of versions.slice(0, 5)) {
        const url = `https://static.slov-lex.sk/static/SK/ZZ/${year}/${number}/${version}.html`;
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; OpenLex/1.0; Educational)',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
                },
            });
            if (response.ok) {
                const html = await response.text();
                if (html.length > 1000 && (html.includes('§') || html.includes('Čl.')) && !html.includes('Stránka nenájdená')) {
                    console.log(`[Slovak Scraper] Found valid version: ${version} (${html.length} bytes)`);
                    return { html, url };
                }
            }
        }
        catch (error) {
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    return null;
}
function buildOtvoreneSudySearchUrl(query, page = 1) {
    const params = new URLSearchParams({
        q: query,
        page: page.toString(),
    });
    return `https://otvorenesudy.sk/decrees?${params.toString()}`;
}
function extractTextFromHtml(html) {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<\/?(p|div|br|li|tr|h[1-6])[^>]*>/gi, '\n');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&aacute;/g, 'á');
    text = text.replace(/&eacute;/g, 'é');
    text = text.replace(/&iacute;/g, 'í');
    text = text.replace(/&oacute;/g, 'ó');
    text = text.replace(/&uacute;/g, 'ú');
    text = text.replace(/&yacute;/g, 'ý');
    text = text.replace(/&scaron;/g, 'š');
    text = text.replace(/&ccaron;/g, 'č');
    text = text.replace(/&zcaron;/g, 'ž');
    text = text.replace(/&rcaron;/g, 'ř');
    text = text.replace(/&lcaron;/g, 'ľ');
    text = text.replace(/&tcaron;/g, 'ť');
    text = text.replace(/&dcaron;/g, 'ď');
    text = text.replace(/&ncaron;/g, 'ň');
    text = text.replace(/&ocirc;/g, 'ô');
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n/g, '\n\n');
    return text.trim();
}
function parseSlovakSections(html, lawCode) {
    const sections = [];
    const sectionPattern = /(?:§|Čl\.?)\s*(\d+[a-z]?)\b\.?\s*([^§]*?)(?=(?:§|Čl\.?)\s*\d|$)/gi;
    const textContent = extractTextFromHtml(html);
    let match;
    while ((match = sectionPattern.exec(textContent)) !== null) {
        const sectionNum = match[1];
        let content = match[2].trim();
        let title = '';
        const titleMatch = content.match(/^([^\n.]+)/);
        if (titleMatch && titleMatch[1].length < 150) {
            title = titleMatch[1].trim();
        }
        if (content.length > 10) {
            sections.push({
                sectionNumber: `§ ${sectionNum}`,
                title: title || `Paragraf ${sectionNum}`,
                content: content.substring(0, 5000),
                lawName: lawCode,
                jurisdiction: 'SK',
            });
        }
    }
    return sections;
}
async function scrapeSlovakLaw(lawCode) {
    const lawInfo = exports.SLOVAK_LAWS[lawCode];
    if (!lawInfo) {
        console.error(`[Slovak Scraper] Unknown law code: ${lawCode}`);
        return null;
    }
    console.log(`[Slovak Scraper] Fetching ${lawCode} (${lawInfo.zbierkaNumber})...`);
    try {
        const result = await fetchSlovLexWithFallback(lawInfo.zbierkaNumber);
        if (!result) {
            console.error(`[Slovak Scraper] Could not find valid version for ${lawCode}`);
            return null;
        }
        const { html, url } = result;
        console.log(`[Slovak Scraper] Received ${html.length} bytes from ${url}`);
        const sections = parseSlovakSections(html, lawCode);
        console.log(`[Slovak Scraper] Parsed ${sections.length} sections from ${lawCode}`);
        return {
            lawCode,
            fullTitle: lawInfo.fullName,
            shortTitle: lawCode,
            zbierkaNumber: lawInfo.zbierkaNumber,
            sections,
            scrapedAt: new Date(),
            sourceUrl: url,
        };
    }
    catch (error) {
        console.error(`[Slovak Scraper] Error scraping ${lawCode}:`, error);
        return null;
    }
}
async function scrapeAndIngestSlovakLaw(lawCode) {
    try {
        const law = await scrapeSlovakLaw(lawCode);
        if (!law || law.sections.length === 0) {
            return {
                success: false,
                sectionsFound: 0,
                chunksCreated: 0,
                error: `Failed to scrape ${lawCode} or no sections found`,
            };
        }
        const { ingestContent } = await Promise.resolve().then(() => __importStar(require('../rag/ingestion')));
        let chunksCreated = 0;
        for (const section of law.sections) {
            const content = `${section.sectionNumber} ${section.title}\n\n${section.content}`;
            try {
                const result = await ingestContent(content, {
                    sourceType: 'legislation',
                    sourceName: `${law.fullTitle} - ${section.sectionNumber}`,
                    sourceId: crypto.createHash('md5').update(`${lawCode}-${section.sectionNumber}`).digest('hex').slice(0, 16),
                    sourceUrl: law.sourceUrl,
                    jurisdiction: 'SK',
                    documentType: 'legislation',
                }, false);
                chunksCreated += result.chunksCreated;
            }
            catch (error) {
                console.error(`[Slovak Scraper] Error ingesting ${section.sectionNumber}:`, error);
            }
        }
        console.log(`[Slovak Scraper] Ingested ${law.fullTitle}: ${law.sections.length} sections, ${chunksCreated} chunks`);
        return {
            success: true,
            sectionsFound: law.sections.length,
            chunksCreated,
        };
    }
    catch (error) {
        return {
            success: false,
            sectionsFound: 0,
            chunksCreated: 0,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
async function scrapeAndIngestMultipleSlovakLaws(lawCodes) {
    const results = {};
    let totalSections = 0;
    let totalChunks = 0;
    for (const lawCode of lawCodes) {
        console.log(`[Slovak Scraper] Processing ${lawCode}...`);
        const result = await scrapeAndIngestSlovakLaw(lawCode);
        results[lawCode] = {
            success: result.success,
            sections: result.sectionsFound,
            chunks: result.chunksCreated,
            error: result.error,
        };
        if (result.success) {
            totalSections += result.sectionsFound;
            totalChunks += result.chunksCreated;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return { totalSections, totalChunks, results };
}
function extractSlovakDecisionMetadata(html, textContent, url) {
    let caseNumber = '';
    let court = '';
    let date = '';
    const caseNumPatterns = [
        /spisová značka[:\s]*([^\s<,]+)/i,
        /sp\.\s*zn\.[:\s]*([^\s<,]+)/i,
        /(\d+[A-Za-z]{1,4}\/\d+\/\d{4})/,
        /(\d+[A-Za-z]{1,4}\s*\/\s*\d+\s*\/\s*\d{4})/,
    ];
    for (const pattern of caseNumPatterns) {
        const match = textContent.match(pattern) || html.match(pattern);
        if (match) {
            caseNumber = match[1].replace(/\s+/g, '').trim();
            break;
        }
    }
    const courtPatterns = [
        /súd[:\s]+([^,<\n]+)/i,
        /(Najvyšší súd SR|Ústavný súd SR|Krajský súd [^,<\n]+|Okresný súd [^,<\n]+)/i,
        /(NS SR|ÚS SR|KS [A-Za-zÀ-ž\s]+|OS [A-Za-zÀ-ž\s]+)/,
    ];
    for (const pattern of courtPatterns) {
        const match = textContent.match(pattern) || html.match(pattern);
        if (match) {
            court = match[1].trim().substring(0, 50);
            break;
        }
    }
    const datePatterns = [
        /dátum[:\s]+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i,
        /zo dňa[:\s]+(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/i,
        /(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/,
    ];
    for (const pattern of datePatterns) {
        const match = textContent.match(pattern);
        if (match) {
            date = match[1].replace(/\s+/g, '');
            break;
        }
    }
    const titleParts = [];
    if (court) {
        titleParts.push(court);
    }
    if (caseNumber) {
        titleParts.push(caseNumber);
    }
    if (date) {
        titleParts.push(date);
    }
    if (titleParts.length === 0) {
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (titleMatch) {
            let htmlTitle = titleMatch[1].trim();
            htmlTitle = htmlTitle.replace(/^(Otvorené Súdy\s*[-–—|]\s*)/i, '');
            htmlTitle = htmlTitle.replace(/^(Rozhodnutie\s*[-–—|]\s*)/i, '');
            if (htmlTitle.length > 5 && htmlTitle.toLowerCase() !== 'rozhodnutie') {
                titleParts.push(htmlTitle.substring(0, 100));
            }
        }
    }
    if (titleParts.length === 0) {
        const urlMatch = url.match(/\/decrees\/(\d+)/);
        if (urlMatch) {
            titleParts.push(`Rozhodnutie č. ${urlMatch[1]}`);
        }
        else {
            titleParts.push('Súdne rozhodnutie SK');
        }
    }
    return {
        title: titleParts.join(' '),
        caseNumber,
        court,
        date,
    };
}
async function scrapeSlovakCourtDecisions(options = {}) {
    const { searchTerms = ['zmluva', 'pracovný pomer', 'rozvod', 'dedičstvo', 'obchodná spoločnosť'], maxDecisions = 50, } = options;
    const { ingestContent } = await Promise.resolve().then(() => __importStar(require('../rag/ingestion')));
    let decisionsFound = 0;
    let chunksCreated = 0;
    const errors = [];
    const seenUrls = new Set();
    for (const term of searchTerms) {
        if (decisionsFound >= maxDecisions)
            break;
        try {
            const searchUrl = buildOtvoreneSudySearchUrl(term);
            console.log(`[Slovak Courts] Searching: ${term}`);
            const response = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; OpenLex/1.0; Educational)',
                    'Accept': 'text/html,application/xhtml+xml',
                    'Accept-Language': 'sk-SK,sk;q=0.9,en;q=0.8',
                },
            });
            if (!response.ok) {
                errors.push(`Search failed for "${term}": HTTP ${response.status}`);
                continue;
            }
            const html = await response.text();
            const linkPattern = /href="(\/decrees\/\d+)"/g;
            let linkMatch;
            const decisionLinks = [];
            while ((linkMatch = linkPattern.exec(html)) !== null) {
                const fullUrl = `https://otvorenesudy.sk${linkMatch[1]}`;
                if (!seenUrls.has(fullUrl)) {
                    seenUrls.add(fullUrl);
                    decisionLinks.push(fullUrl);
                }
            }
            console.log(`[Slovak Courts] Found ${decisionLinks.length} decisions for "${term}"`);
            for (const decisionUrl of decisionLinks.slice(0, Math.min(10, maxDecisions - decisionsFound))) {
                try {
                    const decisionResponse = await fetch(decisionUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (compatible; OpenLex/1.0; Educational)',
                            'Accept': 'text/html',
                        },
                    });
                    if (!decisionResponse.ok)
                        continue;
                    const decisionHtml = await decisionResponse.text();
                    const textContent = extractTextFromHtml(decisionHtml);
                    if (textContent.length < 500)
                        continue;
                    const decisionMeta = extractSlovakDecisionMetadata(decisionHtml, textContent, decisionUrl);
                    const result = await ingestContent(textContent.substring(0, 10000), {
                        sourceType: 'case_law',
                        sourceName: decisionMeta.title,
                        sourceId: crypto.createHash('md5').update(decisionUrl).digest('hex').slice(0, 16),
                        sourceUrl: decisionUrl,
                        jurisdiction: 'SK',
                        documentType: 'case_law',
                    }, false);
                    decisionsFound++;
                    chunksCreated += result.chunksCreated;
                    console.log(`[Slovak Courts] Ingested: ${decisionMeta.title.substring(0, 50)}... (${result.chunksCreated} chunks)`);
                }
                catch (error) {
                    errors.push(`Failed to fetch ${decisionUrl}: ${error instanceof Error ? error.message : 'Unknown'}`);
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        catch (error) {
            errors.push(`Search error for "${term}": ${error instanceof Error ? error.message : 'Unknown'}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log(`[Slovak Courts] Ingestion complete: ${decisionsFound} decisions, ${chunksCreated} chunks`);
    return { decisionsFound, chunksCreated, errors };
}
async function fetchSlovakSupremeCourtDecisions(options = {}) {
    const { startDate = '2020-01-01', maxDecisions = 500, chambers = [1, 2, 3, 4], } = options;
    const { ingestContent } = await Promise.resolve().then(() => __importStar(require('../rag/ingestion')));
    let decisionsFound = 0;
    let chunksCreated = 0;
    const errors = [];
    const processedIds = new Set();
    const chamberNames = {
        1: 'Občianskoprávne (Civil Law)',
        2: 'Obchodnoprávne (Commercial Law)',
        3: 'Správne (Administrative Law)',
        4: 'Trestnoprávne (Criminal Law)',
    };
    console.log(`[NSUD API] Fetching decisions since ${startDate} from ${chambers.length} chambers...`);
    try {
        const listUrl = `https://www.nsud.sk/ws/opendata.php?getLastDecision&date=${startDate}`;
        console.log(`[NSUD API] Fetching decision list from: ${listUrl}`);
        const listResponse = await fetch(listUrl, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'OpenLex/1.0 (Legal Research)',
            },
        });
        if (!listResponse.ok) {
            throw new Error(`Failed to fetch decision list: HTTP ${listResponse.status}`);
        }
        const decisionIds = (await listResponse.json());
        console.log(`[NSUD API] Found ${decisionIds.length} total decisions since ${startDate}`);
        const idsToProcess = decisionIds.slice(0, Math.min(decisionIds.length, maxDecisions * 2));
        console.log(`[NSUD API] Processing up to ${idsToProcess.length} decisions...`);
        for (const id of idsToProcess) {
            if (decisionsFound >= maxDecisions)
                break;
            if (processedIds.has(id))
                continue;
            try {
                const decisionUrl = `https://www.nsud.sk/ws/opendata.php?getDecision&id=${id}`;
                const decisionResponse = await fetch(decisionUrl, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'OpenLex/1.0 (Legal Research)',
                    },
                });
                if (!decisionResponse.ok) {
                    errors.push(`Failed to fetch decision ${id}: HTTP ${decisionResponse.status}`);
                    continue;
                }
                const decision = (await decisionResponse.json());
                processedIds.add(id);
                const chamberNum = parseInt(decision.kolegium, 10);
                if (!chambers.includes(chamberNum))
                    continue;
                if (!decision.obsah || decision.obsah.length < 200)
                    continue;
                const chamberName = chamberNames[chamberNum] || `Kolégium ${decision.kolegium}`;
                const title = `Najvyšší súd SR ${decision.cislo} ${decision.datum} (${chamberName})`;
                const result = await ingestContent(decision.obsah.substring(0, 15000), {
                    sourceType: 'case_law',
                    sourceName: title,
                    sourceId: decision.ecli || crypto.createHash('md5').update(`nsud-${id}`).digest('hex').slice(0, 16),
                    sourceUrl: `https://www.nsud.sk/rozhodnutie/?id=${id}`,
                    jurisdiction: 'SK',
                    documentType: 'case_law',
                }, false);
                decisionsFound++;
                chunksCreated += result.chunksCreated;
                if (decisionsFound % 50 === 0) {
                    console.log(`[NSUD API] Progress: ${decisionsFound} decisions, ${chunksCreated} chunks`);
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
            catch (error) {
                errors.push(`Error processing decision ${id}: ${error instanceof Error ? error.message : 'Unknown'}`);
            }
        }
    }
    catch (error) {
        errors.push(`API error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    console.log(`[NSUD API] Ingestion complete: ${decisionsFound} decisions, ${chunksCreated} chunks`);
    if (errors.length > 0) {
        console.log(`[NSUD API] Encountered ${errors.length} errors`);
    }
    return { decisionsFound, chunksCreated, errors };
}
async function ingestAllSlovakLaws() {
    const keyLaws = Object.keys(exports.SLOVAK_LAWS);
    console.log(`[Slovak Scraper] Ingesting ${keyLaws.length} Slovak laws...`);
    return scrapeAndIngestMultipleSlovakLaws(keyLaws);
}
//# sourceMappingURL=slovakLegalScraper.js.map