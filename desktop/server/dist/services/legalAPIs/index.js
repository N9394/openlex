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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchSlovakDecree = exports.fetchSlovakLegislation = exports.getOtvoreneSudyClient = exports.OtvoreneSudyClient = exports.getSlovLexClient = exports.SlovLexClient = exports.IMPORTANT_SA_COURTS = exports.SOUTH_AFRICAN_COURTS = exports.fetchSAFLIICase = exports.searchSAFLII = exports.getSAFLIIClient = exports.SAFLIIClient = exports.IMPORTANT_CANADIAN_LEGISLATION = exports.IMPORTANT_CANADIAN_COURTS = exports.fetchCanLIICase = exports.searchCanLII = exports.getCanLIIClient = exports.CanLIIClient = exports.KEY_EU_LEGISLATION = exports.getDocumentTypeFromCELEX = exports.parseCELEX = exports.fetchEURLexDocument = exports.searchEURLex = exports.getEURLexClient = exports.EURLexClient = exports.IMPORTANT_US_COURTS = exports.fetchCourtListenerCase = exports.searchCourtListener = exports.getCourtListenerClient = exports.CourtListenerClient = void 0;
exports.searchLegalAPIs = searchLegalAPIs;
exports.fetchLegalDocuments = fetchLegalDocuments;
exports.checkAPIStatus = checkAPIStatus;
__exportStar(require("./types"), exports);
var courtlistener_1 = require("./courtlistener");
Object.defineProperty(exports, "CourtListenerClient", { enumerable: true, get: function () { return courtlistener_1.CourtListenerClient; } });
Object.defineProperty(exports, "getCourtListenerClient", { enumerable: true, get: function () { return courtlistener_1.getCourtListenerClient; } });
Object.defineProperty(exports, "searchCourtListener", { enumerable: true, get: function () { return courtlistener_1.searchCourtListener; } });
Object.defineProperty(exports, "fetchCourtListenerCase", { enumerable: true, get: function () { return courtlistener_1.fetchCase; } });
Object.defineProperty(exports, "IMPORTANT_US_COURTS", { enumerable: true, get: function () { return courtlistener_1.IMPORTANT_US_COURTS; } });
var eurlex_1 = require("./eurlex");
Object.defineProperty(exports, "EURLexClient", { enumerable: true, get: function () { return eurlex_1.EURLexClient; } });
Object.defineProperty(exports, "getEURLexClient", { enumerable: true, get: function () { return eurlex_1.getEURLexClient; } });
Object.defineProperty(exports, "searchEURLex", { enumerable: true, get: function () { return eurlex_1.searchEURLex; } });
Object.defineProperty(exports, "fetchEURLexDocument", { enumerable: true, get: function () { return eurlex_1.fetchEURLexDocument; } });
Object.defineProperty(exports, "parseCELEX", { enumerable: true, get: function () { return eurlex_1.parseCELEX; } });
Object.defineProperty(exports, "getDocumentTypeFromCELEX", { enumerable: true, get: function () { return eurlex_1.getDocumentTypeFromCELEX; } });
Object.defineProperty(exports, "KEY_EU_LEGISLATION", { enumerable: true, get: function () { return eurlex_1.KEY_EU_LEGISLATION; } });
var canlii_1 = require("./canlii");
Object.defineProperty(exports, "CanLIIClient", { enumerable: true, get: function () { return canlii_1.CanLIIClient; } });
Object.defineProperty(exports, "getCanLIIClient", { enumerable: true, get: function () { return canlii_1.getCanLIIClient; } });
Object.defineProperty(exports, "searchCanLII", { enumerable: true, get: function () { return canlii_1.searchCanLII; } });
Object.defineProperty(exports, "fetchCanLIICase", { enumerable: true, get: function () { return canlii_1.fetchCanLIICase; } });
Object.defineProperty(exports, "IMPORTANT_CANADIAN_COURTS", { enumerable: true, get: function () { return canlii_1.IMPORTANT_CANADIAN_COURTS; } });
Object.defineProperty(exports, "IMPORTANT_CANADIAN_LEGISLATION", { enumerable: true, get: function () { return canlii_1.IMPORTANT_CANADIAN_LEGISLATION; } });
var saflii_1 = require("./saflii");
Object.defineProperty(exports, "SAFLIIClient", { enumerable: true, get: function () { return saflii_1.SAFLIIClient; } });
Object.defineProperty(exports, "getSAFLIIClient", { enumerable: true, get: function () { return saflii_1.getSAFLIIClient; } });
Object.defineProperty(exports, "searchSAFLII", { enumerable: true, get: function () { return saflii_1.searchSAFLII; } });
Object.defineProperty(exports, "fetchSAFLIICase", { enumerable: true, get: function () { return saflii_1.fetchSAFLIICase; } });
Object.defineProperty(exports, "SOUTH_AFRICAN_COURTS", { enumerable: true, get: function () { return saflii_1.SOUTH_AFRICAN_COURTS; } });
Object.defineProperty(exports, "IMPORTANT_SA_COURTS", { enumerable: true, get: function () { return saflii_1.IMPORTANT_SA_COURTS; } });
var slovlex_1 = require("./slovlex");
Object.defineProperty(exports, "SlovLexClient", { enumerable: true, get: function () { return slovlex_1.SlovLexClient; } });
Object.defineProperty(exports, "getSlovLexClient", { enumerable: true, get: function () { return slovlex_1.getSlovLexClient; } });
Object.defineProperty(exports, "OtvoreneSudyClient", { enumerable: true, get: function () { return slovlex_1.OtvoreneSudyClient; } });
Object.defineProperty(exports, "getOtvoreneSudyClient", { enumerable: true, get: function () { return slovlex_1.getOtvoreneSudyClient; } });
Object.defineProperty(exports, "fetchSlovakLegislation", { enumerable: true, get: function () { return slovlex_1.fetchSlovakLegislation; } });
Object.defineProperty(exports, "fetchSlovakDecree", { enumerable: true, get: function () { return slovlex_1.fetchSlovakDecree; } });
const courtlistener_2 = require("./courtlistener");
const eurlex_2 = require("./eurlex");
const canlii_2 = require("./canlii");
async function searchLegalAPIs(query, filters = {}, options = {}) {
    const { jurisdiction = 'ALL', documentType = 'all' } = filters;
    const { maxResultsPerSource = 10, fetchContent = false } = options;
    const results = [];
    const promises = [];
    if (jurisdiction === 'US' || jurisdiction === 'ALL') {
        if (documentType === 'case_law' || documentType === 'all') {
            const searchUS = async () => {
                try {
                    const client = new courtlistener_2.CourtListenerClient();
                    if (fetchContent) {
                        const cases = await client.searchAll(query, {
                            filed_after: filters.dateAfter,
                            filed_before: filters.dateBefore,
                        }, { maxResults: maxResultsPerSource });
                        for (const cluster of cases.slice(0, maxResultsPerSource)) {
                            try {
                                const opinions = await client.getOpinionsForCluster(cluster.id);
                                const mainOpinion = opinions[0];
                                let content = '';
                                if (mainOpinion) {
                                    content = await client.getOpinionText(mainOpinion.id) || '';
                                }
                                results.push({
                                    source: 'courtlistener',
                                    document: {
                                        sourceId: `cl_${cluster.id}`,
                                        source: 'courtlistener',
                                        title: cluster.case_name || 'Untitled Case',
                                        content,
                                        url: `https://www.courtlistener.com/opinion/${cluster.id}/`,
                                        jurisdiction: 'US',
                                        date: cluster.date_filed ? new Date(cluster.date_filed) : undefined,
                                        contentHash: '',
                                        fetchedAt: new Date(),
                                    },
                                });
                            }
                            catch (err) {
                                console.error(`[LegalAPIs] Error fetching content for cluster ${cluster.id}:`, err);
                            }
                        }
                    }
                    else {
                        const searchResult = await client.searchOpinions(query, {
                            filed_after: filters.dateAfter,
                            filed_before: filters.dateBefore,
                        }, { pageSize: maxResultsPerSource });
                        for (const cluster of searchResult.results) {
                            const clusterAny = cluster;
                            const caseName = cluster.case_name || clusterAny.caseName || 'Untitled Case';
                            const dateFiled = cluster.date_filed || clusterAny.dateFiled;
                            const summary = cluster.syllabus || clusterAny.snippet || '';
                            results.push({
                                source: 'courtlistener',
                                document: {
                                    sourceId: `cl_${cluster.id || clusterAny.cluster_id}`,
                                    source: 'courtlistener',
                                    title: caseName,
                                    content: summary,
                                    url: `https://www.courtlistener.com/opinion/${cluster.id || clusterAny.cluster_id}/`,
                                    jurisdiction: 'US',
                                    date: dateFiled ? new Date(dateFiled) : undefined,
                                    contentHash: '',
                                    fetchedAt: new Date(),
                                },
                            });
                        }
                    }
                }
                catch (error) {
                    console.error('[LegalAPIs] CourtListener search error:', error);
                }
            };
            promises.push(searchUS());
        }
    }
    if (jurisdiction === 'EU' || jurisdiction === 'ALL') {
        if (documentType !== 'case_law') {
            const searchEU = async () => {
                try {
                    const client = new eurlex_2.EURLexClient();
                    const searchResult = await client.searchLegislation(query, {
                        year: filters.dateAfter
                            ? [parseInt(filters.dateAfter.slice(0, 4)), new Date().getFullYear()]
                            : undefined,
                    }, { limit: maxResultsPerSource });
                    for (const meta of searchResult.documents) {
                        let content = '';
                        if (fetchContent) {
                            try {
                                const doc = await client.getDocument(meta.celex);
                                content = doc?.content || '';
                            }
                            catch (err) {
                                console.error(`[LegalAPIs] Error fetching EUR-Lex content for ${meta.celex}:`, err);
                            }
                        }
                        results.push({
                            source: 'eurlex',
                            document: {
                                sourceId: `eurlex_${meta.celex}`,
                                source: 'eurlex',
                                title: meta.title.EN || meta.title[Object.keys(meta.title)[0]] || meta.celex,
                                content,
                                url: `https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX:${meta.celex}`,
                                jurisdiction: 'EU',
                                date: meta.date ? new Date(meta.date) : undefined,
                                contentHash: '',
                                fetchedAt: new Date(),
                            },
                        });
                    }
                }
                catch (error) {
                    console.error('[LegalAPIs] EUR-Lex search error:', error);
                }
            };
            promises.push(searchEU());
        }
    }
    if (jurisdiction === 'CA' || jurisdiction === 'ALL') {
        const searchCA = async () => {
            try {
                const client = new canlii_2.CanLIIClient();
                const searchResult = await client.searchCases(query, {
                    decisionDateRange: {
                        start: filters.dateAfter,
                        end: filters.dateBefore,
                    },
                }, { resultCount: maxResultsPerSource });
                for (const meta of searchResult.results) {
                    let content = '';
                    if (fetchContent) {
                        try {
                            const doc = await client.getCase(meta.databaseId, meta.caseId.en);
                            content = doc?.content || '';
                        }
                        catch (err) {
                            console.error(`[LegalAPIs] Error fetching CanLII content for ${meta.caseId.en}:`, err);
                        }
                    }
                    results.push({
                        source: 'canlii',
                        document: {
                            sourceId: `canlii_${meta.databaseId}_${meta.caseId.en}`,
                            source: 'canlii',
                            title: meta.title,
                            content,
                            url: `https://www.canlii.org/en/ca/${meta.databaseId}/doc/${meta.caseId.en}`,
                            jurisdiction: 'CA',
                            date: meta.decisionDate ? new Date(meta.decisionDate) : undefined,
                            citation: meta.citation,
                            contentHash: '',
                            fetchedAt: new Date(),
                        },
                    });
                }
            }
            catch (error) {
                console.error('[LegalAPIs] CanLII search error:', error);
            }
        };
        promises.push(searchCA());
    }
    await Promise.all(promises);
    return results;
}
async function fetchLegalDocuments(options = {}) {
    const { sources = ['courtlistener', 'eurlex', 'canlii'], maxPerSource = 100, daysBack = 365, onProgress, } = options;
    const result = {
        totalFetched: 0,
        bySource: {
            courtlistener: 0,
            eurlex: 0,
            canlii: 0,
        },
        documents: [],
        errors: [],
    };
    if (sources.includes('courtlistener')) {
        try {
            const client = new courtlistener_2.CourtListenerClient();
            for (const courtId of courtlistener_2.IMPORTANT_US_COURTS.slice(0, 3)) {
                onProgress?.({
                    source: 'courtlistener',
                    fetched: result.bySource.courtlistener,
                    total: maxPerSource,
                    currentDocument: `Court: ${courtId}`,
                });
                const cases = await client.fetchCasesFromCourt(courtId, {
                    limit: Math.floor(maxPerSource / 3),
                    startDate: getDateString(daysBack),
                });
                for (const c of cases) {
                    result.documents.push(c);
                    result.bySource.courtlistener++;
                    result.totalFetched++;
                }
            }
        }
        catch (error) {
            result.errors.push(`CourtListener: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    if (sources.includes('eurlex')) {
        try {
            const client = new eurlex_2.EURLexClient();
            const keyRegCelexes = Object.values(eurlex_2.KEY_EU_LEGISLATION).slice(0, Math.floor(maxPerSource / 2));
            for (const celex of keyRegCelexes) {
                onProgress?.({
                    source: 'eurlex',
                    fetched: result.bySource.eurlex,
                    total: maxPerSource,
                    currentDocument: celex,
                });
                const doc = await client.getDocument(celex);
                if (doc) {
                    result.documents.push(doc);
                    result.bySource.eurlex++;
                    result.totalFetched++;
                }
            }
            const recent = await client.fetchRecentLegislation({
                daysBack,
                limit: maxPerSource - result.bySource.eurlex,
                onProgress: (fetched, total) => {
                    onProgress?.({
                        source: 'eurlex',
                        fetched: result.bySource.eurlex + fetched,
                        total: result.bySource.eurlex + total,
                    });
                },
            });
            for (const doc of recent) {
                result.documents.push(doc);
                result.bySource.eurlex++;
                result.totalFetched++;
            }
        }
        catch (error) {
            result.errors.push(`EUR-Lex: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    if (sources.includes('canlii')) {
        try {
            const client = new canlii_2.CanLIIClient();
            for (const courtId of canlii_2.IMPORTANT_CANADIAN_COURTS.slice(0, 3)) {
                onProgress?.({
                    source: 'canlii',
                    fetched: result.bySource.canlii,
                    total: maxPerSource,
                    currentDocument: `Court: ${courtId}`,
                });
                const cases = await client.fetchCasesFromCourt(courtId, {
                    limit: Math.floor(maxPerSource / 3),
                    startDate: getDateString(daysBack),
                });
                for (const c of cases) {
                    result.documents.push(c);
                    result.bySource.canlii++;
                    result.totalFetched++;
                }
            }
        }
        catch (error) {
            result.errors.push(`CanLII: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    return result;
}
function getDateString(daysBack) {
    const date = new Date();
    date.setDate(date.getDate() - daysBack);
    return date.toISOString().split('T')[0];
}
async function checkAPIStatus() {
    const statuses = [];
    try {
        const clClient = new courtlistener_2.CourtListenerClient();
        await clClient.listCourts();
        statuses.push({
            source: 'courtlistener',
            available: true,
            hasApiKey: !!process.env.COURTLISTENER_API_KEY,
        });
    }
    catch (error) {
        statuses.push({
            source: 'courtlistener',
            available: false,
            hasApiKey: !!process.env.COURTLISTENER_API_KEY,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
    try {
        const euClient = new eurlex_2.EURLexClient();
        await euClient.searchLegislation('GDPR', {}, { limit: 1 });
        statuses.push({
            source: 'eurlex',
            available: true,
            hasApiKey: true,
        });
    }
    catch (error) {
        statuses.push({
            source: 'eurlex',
            available: false,
            hasApiKey: true,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
    try {
        const canClient = new canlii_2.CanLIIClient();
        await canClient.listDatabases();
        statuses.push({
            source: 'canlii',
            available: true,
            hasApiKey: !!process.env.CANLII_API_KEY,
        });
    }
    catch (error) {
        statuses.push({
            source: 'canlii',
            available: false,
            hasApiKey: !!process.env.CANLII_API_KEY,
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
    return statuses;
}
//# sourceMappingURL=index.js.map