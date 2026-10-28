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
exports.searchBundesrecht = searchBundesrecht;
exports.searchJudikatur = searchJudikatur;
exports.fetchDocumentHtml = fetchDocumentHtml;
exports.risDocumentToParsed = risDocumentToParsed;
exports.fetchKeyAustrianLaws = fetchKeyAustrianLaws;
exports.fetchAndIngestAustrianLaws = fetchAndIngestAustrianLaws;
exports.fetchAndIngestAustrianCaseLaw = fetchAndIngestAustrianCaseLaw;
const crypto = __importStar(require("crypto"));
const RIS_API_BASE = 'https://data.bka.gv.at/ris/api/v2.6';
async function searchBundesrecht(options = {}) {
    const { query, pageSize = 'Fifty', page = 1 } = options;
    const params = new URLSearchParams();
    if (query)
        params.set('Suchworte', query);
    params.set('DokumenteProSeite', pageSize);
    params.set('Seitennummer', page.toString());
    const url = `${RIS_API_BASE}/Bundesrecht?${params.toString()}`;
    console.log(`[RIS API] Fetching: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`RIS API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return parseSearchResult(data);
}
async function searchJudikatur(options = {}) {
    const { query, pageSize = 'Fifty', page = 1, court = 'Justiz', caseNumber, dateFrom, dateTo } = options;
    const params = new URLSearchParams();
    params.set('Applikation', court);
    if (query)
        params.set('Suchworte', query);
    if (caseNumber)
        params.set('Geschaeftszahl', caseNumber);
    if (dateFrom)
        params.set('EntscheidungsdatumVon', dateFrom);
    if (dateTo)
        params.set('EntscheidungsdatumBis', dateTo);
    params.set('DokumenteProSeite', pageSize);
    params.set('Seitennummer', page.toString());
    const url = `${RIS_API_BASE}/Judikatur?${params.toString()}`;
    console.log(`[RIS API] Fetching: ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`RIS API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return parseSearchResult(data);
}
function parseSearchResult(data) {
    const hits = data?.OgdSearchResult?.OgdDocumentResults?.Hits;
    const documents = data?.OgdSearchResult?.OgdDocumentResults?.OgdDocumentReference || [];
    const totalHits = parseInt(hits?.['#text'] || '0', 10);
    const pageNumber = parseInt(hits?.['@pageNumber'] || '1', 10);
    const pageSize = parseInt(hits?.['@pageSize'] || '10', 10);
    const parsedDocs = [];
    for (const doc of Array.isArray(documents) ? documents : [documents]) {
        const metadata = doc?.Data?.Metadaten;
        if (!metadata)
            continue;
        const technical = metadata.Technisch || {};
        const general = metadata.Allgemein || {};
        const bundesrecht = metadata.Bundesrecht || {};
        const judikatur = metadata.Judikatur || {};
        const documentList = doc?.Data?.Dokumentliste?.ContentReference;
        let xmlUrl, htmlUrl, pdfUrl;
        const urls = Array.isArray(documentList) ? documentList[0]?.Urls?.ContentUrl : documentList?.Urls?.ContentUrl;
        if (urls) {
            for (const urlEntry of Array.isArray(urls) ? urls : [urls]) {
                if (urlEntry.DataType === 'Xml')
                    xmlUrl = urlEntry.Url;
                if (urlEntry.DataType === 'Html')
                    htmlUrl = urlEntry.Url;
                if (urlEntry.DataType === 'Authentisch' || urlEntry.DataType === 'Pdf')
                    pdfUrl = urlEntry.Url;
            }
        }
        let title;
        let lawNumber;
        let publicationDate;
        if (judikatur.Geschaeftszahl || judikatur.Gericht) {
            const caseNumber = judikatur.Geschaeftszahl;
            const court = judikatur.Gericht || judikatur.GerichtName;
            const decisionDate = judikatur.Entscheidungsdatum;
            const titleParts = [];
            if (court)
                titleParts.push(court);
            if (caseNumber)
                titleParts.push(caseNumber);
            if (decisionDate) {
                const dateStr = formatDateForTitle(decisionDate);
                if (dateStr)
                    titleParts.push(dateStr);
            }
            title = titleParts.length > 0 ? titleParts.join(' ') : 'Untitled Case';
            lawNumber = caseNumber;
            publicationDate = decisionDate;
        }
        else {
            title = bundesrecht.Titel || bundesrecht.Kurztitel || 'Untitled';
            lawNumber = bundesrecht.BgblAuth?.Bgblnummer;
            publicationDate = bundesrecht.BgblAuth?.Ausgabedatum;
        }
        parsedDocs.push({
            id: technical.ID || crypto.randomUUID(),
            title,
            shortTitle: bundesrecht.Kurztitel || judikatur.Geschaeftszahl,
            lawNumber,
            publicationDate,
            eli: bundesrecht.Eli,
            documentUrl: general.DokumentUrl || '',
            xmlUrl,
            htmlUrl,
            pdfUrl,
        });
    }
    return {
        totalHits,
        pageNumber,
        pageSize,
        documents: parsedDocs,
    };
}
function formatDateForTitle(dateStr) {
    if (!dateStr)
        return null;
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime()))
            return dateStr;
        return date.toLocaleDateString('de-AT', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    catch {
        return dateStr;
    }
}
async function fetchDocumentHtml(htmlUrl) {
    try {
        console.log(`[RIS API] Fetching document: ${htmlUrl}`);
        const response = await fetch(htmlUrl);
        if (!response.ok) {
            console.error(`[RIS API] Failed to fetch document: ${response.status}`);
            return null;
        }
        return await response.text();
    }
    catch (error) {
        console.error(`[RIS API] Error fetching document:`, error);
        return null;
    }
}
function risDocumentToParsed(doc, content) {
    const sourceId = crypto.createHash('md5').update(doc.id).digest('hex').slice(0, 16);
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    return {
        sourceId,
        source: 'ris_austria',
        documentType: 'legislation',
        title: doc.title,
        content,
        url: doc.documentUrl || doc.htmlUrl || '',
        jurisdiction: 'AT',
        language: 'de',
        date: doc.publicationDate ? new Date(doc.publicationDate) : undefined,
        citation: doc.lawNumber,
        contentHash,
        crawledAt: new Date(),
        metadata: {
            parser: 'ris_api',
            id: doc.id,
            shortTitle: doc.shortTitle,
            eli: doc.eli,
            lawNumber: doc.lawNumber,
        },
    };
}
async function fetchKeyAustrianLaws() {
    const keyLaws = [
        'ABGB',
        'StGB',
        'UGB',
        'ZPO',
        'StPO',
        'ASVG',
        'EStG',
        'GmbHG',
        'AktG',
        'KSchG',
        'DSG',
        'MRG',
    ];
    const documents = [];
    for (const lawName of keyLaws) {
        console.log(`[RIS API] Fetching ${lawName}...`);
        try {
            const result = await searchBundesrecht({ query: lawName, pageSize: 'Ten' });
            if (result.documents.length > 0) {
                const doc = result.documents[0];
                if (doc.htmlUrl) {
                    const html = await fetchDocumentHtml(doc.htmlUrl);
                    if (html) {
                        const textContent = extractTextFromHtml(html);
                        const parsed = risDocumentToParsed(doc, textContent);
                        documents.push(parsed);
                        console.log(`[RIS API] Fetched ${lawName}: ${doc.title}`);
                    }
                }
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        catch (error) {
            console.error(`[RIS API] Error fetching ${lawName}:`, error);
        }
    }
    return documents;
}
function extractTextFromHtml(html) {
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}
async function fetchAndIngestAustrianLaws(options = {}) {
    const { laws, maxDocuments = 50, generateEmbeddings = true } = options;
    const { ingestContent } = await Promise.resolve().then(() => __importStar(require('../rag/ingestion')));
    let chunksCreated = 0;
    const errors = [];
    let documents;
    if (laws && laws.length > 0) {
        documents = [];
        for (const law of laws.slice(0, maxDocuments)) {
            try {
                const result = await searchBundesrecht({ query: law, pageSize: 'Ten' });
                if (result.documents.length > 0) {
                    const doc = result.documents[0];
                    if (doc.htmlUrl) {
                        const html = await fetchDocumentHtml(doc.htmlUrl);
                        if (html) {
                            const textContent = extractTextFromHtml(html);
                            documents.push(risDocumentToParsed(doc, textContent));
                        }
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            catch (error) {
                errors.push(`Failed to fetch ${law}: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        }
    }
    else {
        documents = await fetchKeyAustrianLaws();
    }
    for (const doc of documents) {
        try {
            const result = await ingestContent(doc.content, {
                sourceType: 'legislation',
                sourceName: doc.title,
                sourceId: doc.sourceId,
                jurisdiction: doc.jurisdiction,
                documentType: doc.documentType,
            }, generateEmbeddings);
            chunksCreated += result.chunksCreated;
            console.log(`[RIS API] Ingested ${doc.title}: ${result.chunksCreated} chunks`);
        }
        catch (error) {
            const errorMsg = `Failed to ingest ${doc.title}: ${error instanceof Error ? error.message : 'Unknown error'}`;
            errors.push(errorMsg);
            console.error(`[RIS API] ${errorMsg}`);
        }
    }
    return {
        documentsFound: documents.length,
        chunksCreated,
        errors,
    };
}
async function fetchAndIngestAustrianCaseLaw(options = {}) {
    const { courts = ['Justiz', 'Vfgh', 'Vwgh'], searchTerms = ['Ehe', 'Vertrag', 'Schadenersatz', 'Arbeitsrecht', 'Mietrecht', 'Erbrecht', 'Familienrecht'], maxPerCourt = 50, generateEmbeddings = false, } = options;
    const { ingestContent } = await Promise.resolve().then(() => __importStar(require('../rag/ingestion')));
    let totalDocuments = 0;
    let totalChunks = 0;
    const byCourt = {};
    const errors = [];
    const seenIds = new Set();
    for (const court of courts) {
        console.log(`[RIS API] Fetching case law from ${court}...`);
        byCourt[court] = { found: 0, ingested: 0 };
        for (const term of searchTerms) {
            if (byCourt[court].found >= maxPerCourt)
                break;
            try {
                const result = await searchJudikatur({
                    court,
                    query: term,
                    pageSize: 'Twenty',
                });
                console.log(`[RIS API] ${court} "${term}": ${result.totalHits} hits`);
                for (const doc of result.documents) {
                    if (seenIds.has(doc.id))
                        continue;
                    if (byCourt[court].found >= maxPerCourt)
                        break;
                    seenIds.add(doc.id);
                    if (doc.htmlUrl) {
                        const html = await fetchDocumentHtml(doc.htmlUrl);
                        if (html) {
                            const textContent = extractTextFromHtml(html);
                            if (textContent.length < 100)
                                continue;
                            try {
                                const ingestionResult = await ingestContent(textContent, {
                                    sourceType: 'case_law',
                                    sourceName: doc.title,
                                    sourceId: crypto.createHash('md5').update(doc.id).digest('hex').slice(0, 16),
                                    sourceUrl: doc.documentUrl || doc.htmlUrl,
                                    jurisdiction: 'AT',
                                    documentType: 'case_law',
                                }, generateEmbeddings);
                                byCourt[court].found++;
                                byCourt[court].ingested++;
                                totalDocuments++;
                                totalChunks += ingestionResult.chunksCreated;
                                console.log(`[RIS API] Ingested: ${doc.title.substring(0, 60)}... (${ingestionResult.chunksCreated} chunks)`);
                            }
                            catch (error) {
                                errors.push(`Failed to ingest ${doc.title}: ${error instanceof Error ? error.message : 'Unknown'}`);
                            }
                        }
                    }
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
            catch (error) {
                errors.push(`Search failed for ${court}/${term}: ${error instanceof Error ? error.message : 'Unknown'}`);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    console.log(`[RIS API] Case law ingestion complete: ${totalDocuments} documents, ${totalChunks} chunks`);
    return {
        documentsFound: totalDocuments,
        chunksCreated: totalChunks,
        byCourt,
        errors,
    };
}
//# sourceMappingURL=risApiClient.js.map