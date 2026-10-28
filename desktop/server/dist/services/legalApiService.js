"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROVIDERS = exports.JURISDICTIONS = void 0;
exports.searchByJurisdiction = searchByJurisdiction;
exports.searchMultiJurisdiction = searchMultiJurisdiction;
exports.searchCourtListener = searchCourtListener;
exports.searchFindCaseLaw = searchFindCaseLaw;
exports.searchOpenLegalData = searchOpenLegalData;
exports.searchEurLex = searchEurLex;
exports.searchLegifrance = searchLegifrance;
exports.searchCanLII = searchCanLII;
exports.searchAustLII = searchAustLII;
exports.getEndpointsForJurisdiction = getEndpointsForJurisdiction;
exports.getAvailableEndpoints = getAvailableEndpoints;
exports.seedLegalApiEndpoints = seedLegalApiEndpoints;
exports.formatCitation = formatCitation;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const ENGLISH_TO_GERMAN_TERMS = {
    'employment': ['Arbeitsrecht', 'Beschäftigung', 'Anstellung', 'Arbeit'],
    'termination': ['Kündigung', 'Beendigung', 'Auflösung'],
    'dismissal': ['Entlassung', 'Kündigung', 'fristlose Kündigung'],
    'notice period': ['Kündigungsfrist', 'Kündigungsfristen'],
    'notice': ['Kündigung', 'Kündigungsfrist', 'Mitteilung'],
    'employee': ['Arbeitnehmer', 'Angestellte', 'Dienstnehmer'],
    'employer': ['Arbeitgeber', 'Dienstgeber'],
    'salary': ['Gehalt', 'Entgelt', 'Lohn', 'Vergütung'],
    'wages': ['Lohn', 'Entgelt', 'Gehalt'],
    'contract': ['Vertrag', 'Arbeitsvertrag', 'Dienstvertrag'],
    'employment contract': ['Arbeitsvertrag', 'Dienstvertrag'],
    'unfair dismissal': ['ungerechtfertigte Kündigung', 'Kündigungsanfechtung'],
    'severance': ['Abfertigung', 'Abfindung'],
    'probation': ['Probezeit'],
    'trial period': ['Probezeit'],
    'working hours': ['Arbeitszeit', 'Arbeitszeitgesetz'],
    'overtime': ['Überstunden', 'Mehrarbeit'],
    'vacation': ['Urlaub', 'Urlaubsanspruch'],
    'holiday': ['Urlaub', 'Feiertag'],
    'sick leave': ['Krankenstand', 'Krankmeldung'],
    'maternity': ['Mutterschutz', 'Mutterschaft'],
    'parental leave': ['Elternkarenz', 'Karenz'],
    'breach': ['Vertragsverletzung', 'Vertragsbruch', 'Verletzung'],
    'liability': ['Haftung', 'Schadenersatz'],
    'damages': ['Schadenersatz', 'Schaden', 'Schadensersatz'],
    'warranty': ['Gewährleistung', 'Garantie'],
    'guarantee': ['Garantie', 'Gewährleistung'],
    'consumer': ['Verbraucher', 'Konsument'],
    'obligation': ['Pflicht', 'Verpflichtung', 'Schuld'],
    'performance': ['Leistung', 'Erfüllung'],
    'non-performance': ['Nichterfüllung', 'Leistungsstörung'],
    'default': ['Verzug', 'Zahlungsverzug'],
    'property': ['Eigentum', 'Besitz', 'Vermögen'],
    'ownership': ['Eigentum', 'Eigentumsrecht'],
    'possession': ['Besitz'],
    'lease': ['Miete', 'Mietvertrag', 'Pacht'],
    'rent': ['Miete', 'Mietrecht'],
    'tenant': ['Mieter', 'Pächter'],
    'landlord': ['Vermieter', 'Eigentümer'],
    'divorce': ['Scheidung', 'Ehescheidung'],
    'marriage': ['Ehe', 'Heirat'],
    'custody': ['Obsorge', 'Sorgerecht'],
    'alimony': ['Unterhalt', 'Alimente'],
    'child support': ['Kindesunterhalt', 'Alimente'],
    'company': ['Gesellschaft', 'Unternehmen', 'Firma'],
    'corporation': ['Kapitalgesellschaft', 'AG', 'Aktiengesellschaft'],
    'partnership': ['Personengesellschaft', 'OG', 'KG'],
    'shareholder': ['Gesellschafter', 'Aktionär'],
    'director': ['Geschäftsführer', 'Vorstand'],
    'liability company': ['GmbH', 'Gesellschaft mit beschränkter Haftung'],
    'court': ['Gericht', 'Gerichtshof'],
    'lawsuit': ['Klage', 'Rechtsstreit', 'Prozess'],
    'plaintiff': ['Kläger'],
    'defendant': ['Beklagter'],
    'appeal': ['Berufung', 'Rechtsmittel', 'Revision'],
    'judgment': ['Urteil', 'Entscheidung'],
    'decision': ['Entscheidung', 'Beschluss', 'Urteil'],
    'law': ['Recht', 'Gesetz'],
    'statute': ['Gesetz', 'Bundesgesetz'],
    'regulation': ['Verordnung', 'Regelung'],
    'article': ['Artikel', 'Paragraph'],
    'paragraph': ['Absatz', 'Paragraph', '§'],
    'section': ['Abschnitt', 'Paragraph', '§'],
    'rights': ['Rechte', 'Recht'],
    'legal': ['rechtlich', 'Recht'],
    'civil': ['zivil', 'Zivilrecht', 'bürgerlich'],
    'criminal': ['Strafrecht', 'strafrechtlich'],
    'administrative': ['Verwaltung', 'Verwaltungsrecht'],
    'ABGB': ['ABGB', 'Allgemeines Bürgerliches Gesetzbuch'],
    'AngG': ['AngG', 'Angestelltengesetz'],
    'ASVG': ['ASVG', 'Allgemeines Sozialversicherungsgesetz'],
    'KSchG': ['KSchG', 'Konsumentenschutzgesetz'],
    'UGB': ['UGB', 'Unternehmensgesetzbuch'],
    'MRG': ['MRG', 'Mietrechtsgesetz'],
    'ArbVG': ['ArbVG', 'Arbeitsverfassungsgesetz'],
    'AZG': ['AZG', 'Arbeitszeitgesetz'],
    'UrlaubsG': ['UrlaubsG', 'Urlaubsgesetz'],
    'MSchG': ['MSchG', 'Mutterschutzgesetz'],
};
function extractGermanTerms(query) {
    const lowerQuery = query.toLowerCase();
    const terms = new Set();
    const originalWords = query.split(/\s+/).filter(w => w.length > 2);
    originalWords.forEach(w => terms.add(w));
    for (const [english, germanTerms] of Object.entries(ENGLISH_TO_GERMAN_TERMS)) {
        if (lowerQuery.includes(english.toLowerCase())) {
            germanTerms.forEach(term => terms.add(term));
        }
    }
    for (const word of originalWords) {
        const lowerWord = word.toLowerCase();
        for (const [english, germanTerms] of Object.entries(ENGLISH_TO_GERMAN_TERMS)) {
            if (english.toLowerCase().includes(lowerWord) || lowerWord.includes(english.toLowerCase())) {
                germanTerms.slice(0, 2).forEach(term => terms.add(term));
            }
        }
    }
    return Array.from(terms);
}
function successResponse(results, provider, startTime) {
    return {
        success: true,
        results,
        metadata: {
            provider,
            responseTime: Date.now() - startTime,
            cached: false,
        },
    };
}
function errorResponse(code, message, provider) {
    return {
        success: false,
        results: [],
        error: { code, message, provider },
    };
}
async function searchLocalRAG(query, jurisdiction, options = {}) {
    const startTime = Date.now();
    const { limit = 10 } = options;
    const provider = `Local RAG (${jurisdiction})`;
    try {
        const cleanQuery = query
            .replace(/["*(){}[\]^~:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!cleanQuery) {
            return successResponse([], provider, startTime);
        }
        const allTerms = (jurisdiction === 'AT' || jurisdiction === 'CH')
            ? extractGermanTerms(cleanQuery)
            : cleanQuery.split(' ').filter(w => w.length > 2);
        const sanitizedTerms = allTerms
            .map(w => w.replace(/'/g, "''"))
            .filter(w => w.length > 2)
            .slice(0, 12);
        if (sanitizedTerms.length === 0) {
            return successResponse([], provider, startTime);
        }
        const ftsQuery = sanitizedTerms.map(w => `"${w}"`).join(' OR ');
        console.log(`[LegalAPI] Local RAG search: original="${cleanQuery}" terms=[${sanitizedTerms.slice(0, 5).join(', ')}...] jurisdiction=${jurisdiction}`);
        let results = [];
        try {
            results = await prisma.$queryRawUnsafe(`
        SELECT
          r.id,
          r.source_type,
          r.source_name,
          r.source_url,
          r.jurisdiction,
          r.clause_type,
          substr(r.content, 1, 500) as excerpt
        FROM rag_chunks r
        JOIN chunk_fts f ON r.rowid = f.rowid
        WHERE chunk_fts MATCH '${ftsQuery}'
          AND r.jurisdiction = ?
        ORDER BY rank
        LIMIT ?
      `, jurisdiction, limit);
        }
        catch (ftsError) {
            console.warn(`[LegalAPI] FTS5 search failed, falling back to LIKE:`, ftsError);
            const likeTerms = sanitizedTerms.slice(0, 3);
            const likeConditions = likeTerms.map(t => `r.content LIKE '%${t}%'`).join(' OR ');
            results = await prisma.$queryRawUnsafe(`
        SELECT
          r.id,
          r.source_type,
          r.source_name,
          r.source_url,
          r.jurisdiction,
          r.clause_type,
          substr(r.content, 1, 500) as excerpt
        FROM rag_chunks r
        WHERE (${likeConditions})
          AND r.jurisdiction = ?
        LIMIT ?
      `, jurisdiction, limit);
        }
        const legalResults = results.map((r, index) => ({
            id: r.id,
            source: `Local ${jurisdiction} Database`,
            jurisdiction: r.jurisdiction || jurisdiction,
            title: r.source_name || 'Unknown Source',
            citation: r.clause_type ? `[${r.clause_type}]` : '',
            date: '',
            court: '',
            excerpt: r.excerpt || '',
            url: r.source_url || '',
            relevance: Math.max(60, 95 - index * 5),
            metadata: {
                sourceType: r.source_type,
                clauseType: r.clause_type,
            },
        }));
        console.log(`[LegalAPI] Local RAG search for ${jurisdiction}: found ${legalResults.length} results`);
        return successResponse(legalResults, provider, startTime);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[LegalAPI] Local RAG search failed:`, error);
        return errorResponse('PROVIDER_ERROR', message, provider);
    }
}
exports.JURISDICTIONS = {
    US: 'US',
    UK: 'UK',
    DE: 'DE',
    AT: 'AT',
    CH: 'CH',
    EU: 'EU',
    FR: 'FR',
    CA: 'CA',
    AU: 'AU',
};
exports.PROVIDERS = {
    COURTLISTENER: 'courtlistener',
    FINDCASELAW: 'findcaselaw',
    OPENLEGALDATA: 'openlegaldata',
    EURLEX: 'eurlex',
    LEGIFRANCE: 'legifrance',
    CANLII: 'canlii',
    AUSTLII: 'austlii',
};
async function searchByJurisdiction(jurisdiction, query, options = {}) {
    const startTime = Date.now();
    const { limit = 20 } = options;
    switch (jurisdiction.toUpperCase()) {
        case 'US':
            return searchCourtListener(query, { ...options, limit });
        case 'UK':
            return searchFindCaseLaw(query, { ...options, limit });
        case 'DE':
            return searchOpenLegalData(query, { ...options, limit });
        case 'EU':
            return searchEurLex(query, { ...options, limit });
        case 'FR':
            return searchLegifrance(query, { ...options, limit });
        case 'CA':
            return searchCanLII(query, { ...options, limit });
        case 'AU':
            return searchAustLII(query, { ...options, limit });
        case 'AT':
        case 'CH':
            const localAtResponse = await searchLocalRAG(query, jurisdiction, { ...options, limit: Math.floor(limit * 0.7) });
            const euAtResponse = await searchEurLex(query, { ...options, limit: Math.floor(limit * 0.3) });
            const localResultsWithBoost = localAtResponse.results.map(r => ({
                ...r,
                relevance: Math.min(100, r.relevance + 30),
            }));
            const euResultsWithPenalty = euAtResponse.results.map(r => ({
                ...r,
                relevance: Math.max(10, r.relevance - 20),
            }));
            const combinedAtResults = [...localResultsWithBoost, ...euResultsWithPenalty]
                .sort((a, b) => b.relevance - a.relevance)
                .slice(0, limit);
            return {
                success: true,
                results: combinedAtResults,
                metadata: {
                    provider: `Local RAG (${jurisdiction}) + EUR-Lex`,
                    responseTime: Date.now() - startTime,
                    cached: false,
                },
            };
        default:
            console.warn(`[LegalAPI] No provider for jurisdiction: ${jurisdiction}`);
            return errorResponse('PROVIDER_ERROR', `No provider configured for jurisdiction: ${jurisdiction}`, 'unknown');
    }
}
async function searchMultiJurisdiction(jurisdictions, query, options = {}) {
    const startTime = Date.now();
    const { limit = 20 } = options;
    const perJurisdiction = Math.floor(limit / jurisdictions.length) || 10;
    const searches = jurisdictions.map(async (j) => ({
        jurisdiction: j,
        response: await searchByJurisdiction(j, query, { ...options, limit: perJurisdiction }),
    }));
    const responses = await Promise.all(searches);
    const allResults = [];
    const errors = [];
    const successfulProviders = [];
    const failedProviders = [];
    for (const { jurisdiction, response } of responses) {
        if (response.success) {
            allResults.push(...response.results);
            if (response.metadata?.provider) {
                successfulProviders.push(response.metadata.provider);
            }
        }
        else if (response.error) {
            errors.push({
                jurisdiction,
                code: response.error.code,
                message: response.error.message,
                provider: response.error.provider,
            });
            failedProviders.push(response.error.provider);
        }
    }
    const sortedResults = allResults
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, limit);
    return {
        success: errors.length === 0 || sortedResults.length > 0,
        results: sortedResults,
        errors,
        metadata: {
            totalResponseTime: Date.now() - startTime,
            successfulProviders,
            failedProviders,
        },
    };
}
const COURTLISTENER_API = 'https://www.courtlistener.com/api/rest/v3';
async function searchCourtListener(query, options = {}) {
    const startTime = Date.now();
    const { limit = 20, court } = options;
    const provider = 'CourtListener';
    const apiToken = process.env.COURTLISTENER_API_TOKEN;
    try {
        const params = new URLSearchParams({
            q: query,
            order_by: 'score desc',
            type: 'o',
        });
        if (court) {
            params.append('court', court);
        }
        const headers = {
            'Accept': 'application/json',
            'User-Agent': 'LexVault/1.0 (Research Tool)',
        };
        if (apiToken) {
            headers['Authorization'] = `Token ${apiToken}`;
        }
        const response = await fetch(`${COURTLISTENER_API}/search/?${params}`, { headers });
        if (!response.ok) {
            if (response.status === 403) {
                console.warn('[LegalAPI] CourtListener requires API token. Set COURTLISTENER_API_TOKEN env var.');
                return errorResponse('AUTH_REQUIRED', 'API token required. Set COURTLISTENER_API_TOKEN env var.', provider);
            }
            if (response.status === 429) {
                return errorResponse('RATE_LIMITED', 'Rate limit exceeded', provider);
            }
            return errorResponse('PROVIDER_ERROR', `API returned status ${response.status}`, provider);
        }
        const data = await response.json();
        const rawResults = data.results?.slice(0, limit) || [];
        const results = rawResults.map((result, index) => ({
            id: `cl-${result.id}`,
            source: provider,
            jurisdiction: 'US',
            title: result.caseName || result.case_name || 'Unknown Case',
            citation: result.citation?.[0] || '',
            date: result.dateFiled || result.date_filed || '',
            court: result.court,
            excerpt: result.snippet || result.plain_text?.substring(0, 500) || '',
            url: `https://www.courtlistener.com${result.absolute_url || ''}`,
            relevance: Math.max(10, 100 - index * 5),
            metadata: {
                docket: result.docketNumber,
                citations: result.citation,
            },
        }));
        return successResponse(results, provider, startTime);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[LegalAPI] CourtListener search failed:', error);
        return errorResponse('NETWORK_ERROR', message, provider);
    }
}
const FINDCASELAW_API = 'https://caselaw.nationalarchives.gov.uk';
async function searchFindCaseLaw(query, options = {}) {
    const startTime = Date.now();
    const { limit = 20, court } = options;
    const provider = 'Find Case Law';
    try {
        const params = new URLSearchParams({ query });
        if (court)
            params.append('court', court.toLowerCase());
        const response = await fetch(`${FINDCASELAW_API}/atom.xml?${params}`, {
            headers: {
                'Accept': 'application/xml',
                'User-Agent': 'LexVault/1.0 (Research Tool)',
            },
        });
        if (!response.ok) {
            if (response.status === 429) {
                return errorResponse('RATE_LIMITED', 'Rate limit exceeded', provider);
            }
            return errorResponse('PROVIDER_ERROR', `API returned status ${response.status}`, provider);
        }
        const xml = await response.text();
        const results = [];
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
        let match;
        let index = 0;
        while ((match = entryRegex.exec(xml)) !== null && index < limit) {
            const entry = match[1];
            const title = entry.match(/<title[^>]*>([^<]+)<\/title>/)?.[1] || 'Unknown Case';
            const id = entry.match(/<id>([^<]+)<\/id>/)?.[1] || '';
            const updated = entry.match(/<updated>([^<]+)<\/updated>/)?.[1] || '';
            const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] || '';
            const courtName = entry.match(/<author>\s*<name>([^<]+)<\/name>/)?.[1] || '';
            const fclid = entry.match(/<fclid[^>]*>([^<]+)<\/fclid>/)?.[1] || '';
            const htmlLink = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"[^>]*type="text\/html"/)?.[1]
                || entry.match(/<link[^>]*href="([^"]+)"[^>]*rel="alternate"/)?.[1]
                || '';
            const neutralCitation = entry.match(/\[(\d{4})\]\s+([A-Z]+)\s+(\d+)/)?.[0] || fclid;
            results.push({
                id: `fcl-${fclid || index}`,
                source: provider,
                jurisdiction: 'UK',
                title: decodeXmlEntities(title),
                citation: neutralCitation,
                date: published || updated,
                court: decodeXmlEntities(courtName),
                excerpt: '',
                url: htmlLink || `${FINDCASELAW_API}/${fclid}`,
                relevance: Math.max(10, 100 - index * 5),
                metadata: {
                    fclid,
                },
            });
            index++;
        }
        return successResponse(results, provider, startTime);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[LegalAPI] Find Case Law search failed:', error);
        return errorResponse('NETWORK_ERROR', message, provider);
    }
}
function decodeXmlEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
const OPENLEGALDATA_API = 'https://de.openlegaldata.io/api';
async function searchOpenLegalData(query, options = {}) {
    const startTime = Date.now();
    const { limit = 20, court } = options;
    const provider = 'Open Legal Data';
    try {
        const params = new URLSearchParams({
            q: query,
            page_size: String(limit),
        });
        if (court)
            params.append('court__name', court);
        const response = await fetch(`${OPENLEGALDATA_API}/cases/?${params}`, {
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
            if (response.status === 429) {
                return errorResponse('RATE_LIMITED', 'Rate limit exceeded', provider);
            }
            return errorResponse('PROVIDER_ERROR', `API returned status ${response.status}`, provider);
        }
        const data = await response.json();
        const rawResults = data.results || [];
        const results = rawResults.map((result, index) => ({
            id: `old-${result.id}`,
            source: provider,
            jurisdiction: 'DE',
            title: result.name || result.file_number || 'Unbekannter Fall',
            citation: result.file_number || '',
            date: result.date || '',
            court: result.court?.name || '',
            excerpt: result.content?.substring(0, 500) || result.abstract || '',
            url: `https://de.openlegaldata.io/case/${result.id}`,
            relevance: Math.max(10, 100 - index * 5),
            metadata: {
                ecli: result.ecli,
                type: result.type,
            },
        }));
        return successResponse(results, provider, startTime);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[LegalAPI] Open Legal Data search failed:', error);
        return errorResponse('NETWORK_ERROR', message, provider);
    }
}
const EURLEX_SPARQL = 'https://publications.europa.eu/webapi/rdf/sparql';
const EU_MAJOR_DOCUMENTS = {
    'gdpr': [{ celex: '32016R0679', title: 'General Data Protection Regulation (GDPR)', date: '2016-04-27' }],
    'data protection': [{ celex: '32016R0679', title: 'General Data Protection Regulation (GDPR)', date: '2016-04-27' }],
    'dsgvo': [{ celex: '32016R0679', title: 'General Data Protection Regulation (GDPR)', date: '2016-04-27' }],
    'privacy': [{ celex: '32016R0679', title: 'General Data Protection Regulation (GDPR)', date: '2016-04-27' }],
    'consumer': [
        { celex: '32011L0083', title: 'Consumer Rights Directive', date: '2011-10-25' },
        { celex: '32019L0771', title: 'Sale of Goods Directive', date: '2019-05-20' },
    ],
    'contract': [{ celex: '32019L0771', title: 'Sale of Goods Directive', date: '2019-05-20' }],
    'digital': [
        { celex: '32019L0770', title: 'Digital Content Directive', date: '2019-05-20' },
        { celex: '32022R2065', title: 'Digital Services Act (DSA)', date: '2022-10-19' },
    ],
    'services': [{ celex: '32022R2065', title: 'Digital Services Act (DSA)', date: '2022-10-19' }],
    'competition': [{ celex: '32003R0001', title: 'Competition Regulation', date: '2002-12-16' }],
    'employment': [
        { celex: '32003L0088', title: 'Working Time Directive', date: '2003-11-04' },
        { celex: '31998L0059', title: 'Collective Redundancies Directive', date: '1998-07-20' },
    ],
    'labor': [{ celex: '32003L0088', title: 'Working Time Directive', date: '2003-11-04' }],
    'arbeitsrecht': [{ celex: '32003L0088', title: 'Working Time Directive', date: '2003-11-04' }],
    'environment': [{ celex: '32011L0092', title: 'Environmental Impact Assessment Directive', date: '2011-12-13' }],
    'trademark': [{ celex: '32017R1001', title: 'EU Trade Mark Regulation', date: '2017-06-14' }],
    'ai': [{ celex: '32024R1689', title: 'AI Act', date: '2024-07-12' }],
    'artificial intelligence': [{ celex: '32024R1689', title: 'AI Act', date: '2024-07-12' }],
};
async function searchEurLex(query, options = {}) {
    const startTime = Date.now();
    const { limit = 20 } = options;
    const provider = 'EUR-Lex';
    const results = [];
    const lowerQuery = query.toLowerCase();
    for (const [keyword, docs] of Object.entries(EU_MAJOR_DOCUMENTS)) {
        if (lowerQuery.includes(keyword)) {
            for (const doc of docs) {
                if (!results.find(r => r.citation === doc.celex)) {
                    results.push({
                        id: `eurlex-${doc.celex}`,
                        source: provider,
                        jurisdiction: 'EU',
                        title: doc.title,
                        citation: doc.celex,
                        date: doc.date,
                        court: 'European Union',
                        excerpt: `Key EU legislation matching your query "${query}"`,
                        url: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${doc.celex}`,
                        relevance: 100,
                        metadata: { celex: doc.celex },
                    });
                }
            }
        }
    }
    if (results.length > 0) {
        return successResponse(results.slice(0, limit), provider, startTime);
    }
    console.log(`[LegalAPI] EUR-Lex: No cached results for "${query}", providing search link`);
    return successResponse([{
            id: 'eurlex-search',
            source: provider,
            jurisdiction: 'EU',
            title: `Search EUR-Lex for: ${query}`,
            citation: '',
            date: '',
            court: 'European Union',
            excerpt: 'Click to search EUR-Lex directly for EU legislation and case law.',
            url: `https://eur-lex.europa.eu/search.html?scope=EURLEX&text=${encodeURIComponent(query)}&lang=en&type=quick`,
            relevance: 50,
            metadata: { type: 'search_link' },
        }], provider, startTime);
}
const LEGIFRANCE_API = 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app';
async function searchLegifrance(query, options = {}) {
    const startTime = Date.now();
    const { limit = 20 } = options;
    const provider = 'Légifrance';
    const accessToken = process.env.LEGIFRANCE_ACCESS_TOKEN;
    if (!accessToken) {
        console.warn('[LegalAPI] Légifrance requires LEGIFRANCE_ACCESS_TOKEN environment variable');
        return errorResponse('AUTH_REQUIRED', 'LEGIFRANCE_ACCESS_TOKEN environment variable required', provider);
    }
    try {
        const response = await fetch(`${LEGIFRANCE_API}/search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                recherche: {
                    champs: [{ typeChamp: 'ALL', criteres: [{ typeRecherche: 'EXACTE', valeur: query }] }],
                    pageNumber: 1,
                    pageSize: limit,
                    sort: 'PERTINENCE',
                },
            }),
        });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                return errorResponse('AUTH_REQUIRED', 'Invalid or expired OAuth token', provider);
            }
            if (response.status === 429) {
                return errorResponse('RATE_LIMITED', 'Rate limit exceeded', provider);
            }
            return errorResponse('PROVIDER_ERROR', `API returned status ${response.status}`, provider);
        }
        const data = await response.json();
        const rawResults = data.results || [];
        const results = rawResults.map((result, index) => ({
            id: `lf-${result.id || index}`,
            source: provider,
            jurisdiction: 'FR',
            title: result.titre || result.title || 'Document inconnu',
            citation: result.numero || result.reference || '',
            date: result.datePublication || result.date || '',
            court: result.nature || '',
            excerpt: result.extrait || result.excerpt || '',
            url: result.lien || `https://www.legifrance.gouv.fr/jorf/id/${result.id}`,
            relevance: Math.max(10, 100 - index * 5),
        }));
        return successResponse(results, provider, startTime);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[LegalAPI] Légifrance search failed:', error);
        return errorResponse('NETWORK_ERROR', message, provider);
    }
}
const CANLII_API = 'https://api.canlii.org/v1';
async function searchCanLII(query, options = {}) {
    const startTime = Date.now();
    const { limit = 20 } = options;
    const provider = 'CanLII';
    const apiKey = process.env.CANLII_API_KEY;
    if (!apiKey) {
        console.warn('[LegalAPI] CanLII requires CANLII_API_KEY environment variable');
        return errorResponse('AUTH_REQUIRED', 'CANLII_API_KEY environment variable required', provider);
    }
    try {
        const params = new URLSearchParams({
            api_key: apiKey,
            fulltext: query,
            resultCount: String(limit),
        });
        const response = await fetch(`${CANLII_API}/search/scc-csc?${params}`, {
            headers: { 'Accept': 'application/json' },
        });
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                return errorResponse('AUTH_REQUIRED', 'Invalid API key', provider);
            }
            if (response.status === 429) {
                return errorResponse('RATE_LIMITED', 'Rate limit exceeded', provider);
            }
            return errorResponse('PROVIDER_ERROR', `API returned status ${response.status}`, provider);
        }
        const data = await response.json();
        const rawResults = data.results || [];
        const results = rawResults.map((result, index) => ({
            id: `canlii-${result.caseId?.en || index}`,
            source: provider,
            jurisdiction: 'CA',
            title: result.title || 'Unknown Case',
            citation: result.citation || '',
            date: result.decisionDate || '',
            court: result.databaseId || '',
            excerpt: result.excerpt || '',
            url: result.url || `https://www.canlii.org/en/ca/scc/doc/${result.caseId?.en}`,
            relevance: Math.max(10, 100 - index * 5),
            metadata: {
                language: result.language,
            },
        }));
        return successResponse(results, provider, startTime);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[LegalAPI] CanLII search failed:', error);
        return errorResponse('NETWORK_ERROR', message, provider);
    }
}
async function searchAustLII(query, options = {}) {
    const startTime = Date.now();
    const { limit = 20 } = options;
    const provider = 'AustLII';
    try {
        const params = new URLSearchParams({
            mask_path: '',
            method: 'auto',
            query,
        });
        const response = await fetch(`https://www.austlii.edu.au/cgi-bin/sinosrch.cgi?${params}`, {
            headers: {
                'Accept': 'text/html',
                'User-Agent': 'LexVault/1.0 (Research Tool)',
            },
        });
        if (!response.ok) {
            if (response.status === 429) {
                return errorResponse('RATE_LIMITED', 'Rate limit exceeded', provider);
            }
            return errorResponse('PROVIDER_ERROR', `API returned status ${response.status}`, provider);
        }
        const html = await response.text();
        const results = [];
        const liMatches = html.matchAll(/<li[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/li>/gi);
        let index = 0;
        for (const match of liMatches) {
            if (index >= limit)
                break;
            const url = match[1];
            const title = match[2].trim();
            if (!url.includes('/cases/') && !url.includes('/legis/'))
                continue;
            results.push({
                id: `austlii-${index}`,
                source: provider,
                jurisdiction: 'AU',
                title: title || 'Unknown Document',
                citation: '',
                date: '',
                court: url.includes('/cth/') ? 'Commonwealth' : 'State/Territory',
                excerpt: '',
                url: url.startsWith('http') ? url : `https://www.austlii.edu.au${url}`,
                relevance: Math.max(10, 100 - index * 5),
            });
            index++;
        }
        return successResponse(results, provider, startTime);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error('[LegalAPI] AustLII search failed:', error);
        return errorResponse('NETWORK_ERROR', message, provider);
    }
}
async function getEndpointsForJurisdiction(jurisdiction) {
    const endpoints = await prisma.legalApiEndpoint.findMany({
        where: { jurisdiction: jurisdiction.toUpperCase() },
        select: { provider: true, name: true, isActive: true },
    });
    return endpoints;
}
async function getAvailableEndpoints(jurisdiction) {
    const whereClause = jurisdiction
        ? { jurisdiction: jurisdiction.toUpperCase() }
        : {};
    const endpoints = await prisma.legalApiEndpoint.findMany({
        where: whereClause,
        select: {
            jurisdiction: true,
            provider: true,
            name: true,
            baseUrl: true,
            authType: true,
            isActive: true,
        },
        orderBy: { jurisdiction: 'asc' },
    });
    return endpoints;
}
async function seedLegalApiEndpoints() {
    const endpoints = [
        { jurisdiction: 'US', provider: 'courtlistener', name: 'CourtListener', baseUrl: 'https://www.courtlistener.com/api/rest/v3', authType: 'none' },
        { jurisdiction: 'UK', provider: 'findcaselaw', name: 'Find Case Law', baseUrl: 'https://caselaw.nationalarchives.gov.uk', authType: 'none' },
        { jurisdiction: 'DE', provider: 'openlegaldata', name: 'Open Legal Data', baseUrl: 'https://de.openlegaldata.io/api', authType: 'none' },
        { jurisdiction: 'EU', provider: 'eurlex', name: 'EUR-Lex', baseUrl: 'https://publications.europa.eu/webapi/rdf/sparql', authType: 'none' },
        { jurisdiction: 'FR', provider: 'legifrance', name: 'Légifrance', baseUrl: 'https://api.piste.gouv.fr/dila/legifrance', authType: 'oauth' },
        { jurisdiction: 'CA', provider: 'canlii', name: 'CanLII', baseUrl: 'https://api.canlii.org/v1', authType: 'api_key' },
        { jurisdiction: 'AU', provider: 'austlii', name: 'AustLII', baseUrl: 'https://www.austlii.edu.au', authType: 'none' },
    ];
    for (const endpoint of endpoints) {
        await prisma.legalApiEndpoint.upsert({
            where: { jurisdiction_provider: { jurisdiction: endpoint.jurisdiction, provider: endpoint.provider } },
            create: endpoint,
            update: { name: endpoint.name, baseUrl: endpoint.baseUrl },
        });
    }
    console.log('[LegalAPI] Seeded legal API endpoints');
}
function formatCitation(result, format = 'default') {
    const { title, citation, date, court } = result;
    switch (format) {
        case 'bluebook':
            return `${title}, ${citation} (${court} ${date ? new Date(date).getFullYear() : ''})`.trim();
        case 'oscola':
            return `${title} [${date ? new Date(date).getFullYear() : ''}] ${court} ${citation}`.trim();
        case 'german':
            return `${court}, ${date} - ${citation}`.trim();
        default:
            return `${title}, ${citation} (${date})`.trim();
    }
}
//# sourceMappingURL=legalApiService.js.map