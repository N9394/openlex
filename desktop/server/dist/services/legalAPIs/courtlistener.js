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
exports.IMPORTANT_US_COURTS = exports.CourtListenerClient = void 0;
exports.getCourtListenerClient = getCourtListenerClient;
exports.searchCourtListener = searchCourtListener;
exports.fetchCase = fetchCase;
const bottleneck_1 = __importDefault(require("bottleneck"));
const crypto = __importStar(require("crypto"));
const types_1 = require("./types");
const DEFAULT_CONFIG = types_1.DEFAULT_API_CONFIGS.courtlistener;
class CourtListenerClient {
    baseUrl;
    apiKey;
    timeout;
    userAgent;
    limiter;
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || DEFAULT_CONFIG.baseUrl;
        this.apiKey = config.apiKey || process.env.COURTLISTENER_API_KEY;
        this.timeout = config.timeout || DEFAULT_CONFIG.timeout;
        this.userAgent = config.userAgent || DEFAULT_CONFIG.userAgent;
        const rateLimit = config.rateLimit || DEFAULT_CONFIG.rateLimit;
        this.limiter = new bottleneck_1.default({
            maxConcurrent: 2,
            minTime: rateLimit.minDelay,
        });
        if (!this.apiKey) {
            console.warn('[CourtListener] No API key provided. Rate limits will be more restrictive. ' +
                'Set COURTLISTENER_API_KEY environment variable for higher limits.');
        }
    }
    async request(endpoint, options = {}) {
        const { method = 'GET', params, body } = options;
        const url = new URL(`${this.baseUrl}${endpoint}`);
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }
        return this.limiter.schedule(async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.timeout);
            try {
                const headers = {
                    'User-Agent': this.userAgent,
                    'Accept': 'application/json',
                };
                if (this.apiKey) {
                    headers['Authorization'] = `Token ${this.apiKey}`;
                }
                if (body) {
                    headers['Content-Type'] = 'application/json';
                }
                const response = await fetch(url.toString(), {
                    method,
                    headers,
                    body: body ? JSON.stringify(body) : undefined,
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`CourtListener API error ${response.status}: ${errorText}`);
                }
                return await response.json();
            }
            catch (error) {
                clearTimeout(timeoutId);
                if (error instanceof Error && error.name === 'AbortError') {
                    throw new Error('CourtListener API request timeout');
                }
                throw error;
            }
        });
    }
    async listCourts() {
        const results = [];
        let nextUrl = '/courts/';
        while (nextUrl) {
            const response = await this.request(nextUrl);
            results.push(...response.results);
            nextUrl = response.next ? new URL(response.next).pathname + new URL(response.next).search : null;
        }
        return results;
    }
    async getCourt(courtId) {
        return this.request(`/courts/${courtId}/`);
    }
    async searchOpinions(query, filters = {}, options = {}) {
        const { page = 1, pageSize = 20 } = options;
        const params = {
            q: query,
            page,
            page_size: pageSize,
            ...filters,
        };
        return this.request('/search/', { params });
    }
    async searchAll(query, filters = {}, options = {}) {
        const { maxResults = 1000, onProgress } = options;
        const results = [];
        let page = 1;
        const pageSize = 20;
        while (results.length < maxResults) {
            const response = await this.searchOpinions(query, filters, { page, pageSize });
            results.push(...response.results);
            onProgress?.(results.length, Math.min(response.count, maxResults));
            if (!response.next || results.length >= maxResults) {
                break;
            }
            page++;
        }
        return results.slice(0, maxResults);
    }
    async getCluster(clusterId) {
        return this.request(`/clusters/${clusterId}/`);
    }
    async listClusters(filters = {}, options = {}) {
        const { page = 1, pageSize = 20 } = options;
        return this.request('/clusters/', {
            params: {
                page,
                page_size: pageSize,
                ...filters,
            },
        });
    }
    async getOpinion(opinionId) {
        return this.request(`/opinions/${opinionId}/`);
    }
    async getOpinionsForCluster(clusterId) {
        const response = await this.request('/opinions/', {
            params: { cluster: clusterId },
        });
        return response.results;
    }
    async getOpinionText(opinionId) {
        const opinion = await this.getOpinion(opinionId);
        if (opinion.plain_text) {
            return opinion.plain_text;
        }
        if (opinion.html_with_citations) {
            return this.stripHtml(opinion.html_with_citations);
        }
        if (opinion.html) {
            return this.stripHtml(opinion.html);
        }
        if (opinion.html_lawbox) {
            return this.stripHtml(opinion.html_lawbox);
        }
        if (opinion.html_columbia) {
            return this.stripHtml(opinion.html_columbia);
        }
        return null;
    }
    async fetchCasesFromCourt(courtId, options = {}) {
        const { limit = 100, startDate, endDate, onProgress } = options;
        const filters = {
            court: courtId,
        };
        if (startDate) {
            filters.filed_after = startDate;
        }
        if (endDate) {
            filters.filed_before = endDate;
        }
        const clusters = await this.searchAll('*', filters, {
            maxResults: limit,
            onProgress,
        });
        const cases = [];
        for (const cluster of clusters) {
            try {
                const opinions = await this.getOpinionsForCluster(cluster.id);
                const mainOpinion = opinions[0];
                if (!mainOpinion)
                    continue;
                const text = await this.getOpinionText(mainOpinion.id);
                if (!text)
                    continue;
                cases.push(this.normalizeCase(cluster, mainOpinion, text, courtId));
            }
            catch (error) {
                console.error(`[CourtListener] Error fetching case ${cluster.id}:`, error);
            }
        }
        return cases;
    }
    async fetchRecentCases(courtIds, options = {}) {
        const { daysBack = 30, limitPerCourt = 50, onProgress } = options;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        const startDateStr = startDate.toISOString().split('T')[0];
        const allCases = [];
        for (const courtId of courtIds) {
            try {
                const cases = await this.fetchCasesFromCourt(courtId, {
                    limit: limitPerCourt,
                    startDate: startDateStr,
                    onProgress: (fetched, _total) => onProgress?.(courtId, fetched),
                });
                allCases.push(...cases);
                console.log(`[CourtListener] Fetched ${cases.length} cases from ${courtId}`);
            }
            catch (error) {
                console.error(`[CourtListener] Error fetching from ${courtId}:`, error);
            }
        }
        return allCases;
    }
    normalizeCase(cluster, _opinion, text, courtId) {
        const contentHash = crypto.createHash('sha256').update(text).digest('hex');
        const clusterAny = cluster;
        const caseName = cluster.case_name || clusterAny.caseName || cluster.case_name_short || clusterAny.caseNameShort || 'Untitled Case';
        const caseNameFull = cluster.case_name_full || clusterAny.caseNameFull || courtId;
        const dateFiled = cluster.date_filed || clusterAny.dateFiled;
        const natureOfSuit = cluster.nature_of_suit || clusterAny.natureOfSuit;
        const precedentialStatus = cluster.precedential_status || clusterAny.precedentialStatus;
        const citationCount = cluster.citation_count ?? clusterAny.citeCount;
        return {
            sourceId: `cl_${cluster.id}`,
            source: 'courtlistener',
            title: caseName,
            content: text,
            url: `https://www.courtlistener.com/opinion/${cluster.id}/`,
            jurisdiction: 'US',
            date: dateFiled ? new Date(dateFiled) : undefined,
            citation: undefined,
            contentHash,
            fetchedAt: new Date(),
            court: caseNameFull,
            courtId,
            judges: cluster.judges || clusterAny.judge || undefined,
            natureOfSuit: natureOfSuit || undefined,
            precedentialStatus: precedentialStatus || undefined,
            citationCount: citationCount || undefined,
        };
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
}
exports.CourtListenerClient = CourtListenerClient;
let clientInstance = null;
function getCourtListenerClient() {
    if (!clientInstance) {
        clientInstance = new CourtListenerClient();
    }
    return clientInstance;
}
async function searchCourtListener(query, filters) {
    const client = getCourtListenerClient();
    const result = await client.searchOpinions(query, filters);
    return result.results;
}
async function fetchCase(clusterId) {
    const client = getCourtListenerClient();
    try {
        const cluster = await client.getCluster(clusterId);
        const opinions = await client.getOpinionsForCluster(clusterId);
        const mainOpinion = opinions[0];
        if (!mainOpinion)
            return null;
        const text = await client.getOpinionText(mainOpinion.id);
        if (!text)
            return null;
        const courtId = cluster.docket?.split('/').pop() || 'unknown';
        return {
            sourceId: `cl_${cluster.id}`,
            source: 'courtlistener',
            title: cluster.case_name || 'Untitled Case',
            content: text,
            url: `https://www.courtlistener.com/opinion/${cluster.id}/`,
            jurisdiction: 'US',
            date: cluster.date_filed ? new Date(cluster.date_filed) : undefined,
            contentHash: crypto.createHash('sha256').update(text).digest('hex'),
            fetchedAt: new Date(),
            court: cluster.case_name_full || courtId,
            courtId,
            judges: cluster.judges || undefined,
            precedentialStatus: cluster.precedential_status || undefined,
            citationCount: cluster.citation_count || undefined,
        };
    }
    catch (error) {
        console.error(`[CourtListener] Error fetching case ${clusterId}:`, error);
        return null;
    }
}
exports.IMPORTANT_US_COURTS = [
    'scotus',
    'ca1',
    'ca2',
    'ca3',
    'ca4',
    'ca5',
    'ca6',
    'ca7',
    'ca8',
    'ca9',
    'ca10',
    'ca11',
    'cadc',
    'cafc',
];
//# sourceMappingURL=courtlistener.js.map