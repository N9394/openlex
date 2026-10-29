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
exports.Fetcher = void 0;
exports.createFetcher = createFetcher;
exports.fetchWithRateLimit = fetchWithRateLimit;
const bottleneck_1 = __importDefault(require("bottleneck"));
const crypto = __importStar(require("crypto"));
const types_1 = require("./types");
const robotsParser_1 = require("./robotsParser");
const DEFAULT_TIMEOUT = 30000;
const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;
class Fetcher {
    limiter;
    robotsParser;
    config;
    cache;
    cacheTTL;
    constructor(config) {
        const defaults = types_1.DEFAULT_SOURCE_CONFIGS[config.source] || {};
        this.config = {
            ...defaults,
            ...config,
            baseUrl: config.baseUrl || defaults.baseUrl || '',
            rateLimit: config.rateLimit || defaults.rateLimit || 2000,
            maxConcurrent: config.maxConcurrent || defaults.maxConcurrent || 2,
            userAgent: config.userAgent || defaults.userAgent || 'OpenLex-Bot/1.0',
            respectRobotsTxt: config.respectRobotsTxt ?? defaults.respectRobotsTxt ?? true,
            jurisdictions: config.jurisdictions || defaults.jurisdictions || [],
            languages: config.languages || defaults.languages || ['en'],
            requiresAuth: config.requiresAuth ?? defaults.requiresAuth ?? false,
            useHeadless: config.useHeadless ?? defaults.useHeadless ?? false,
        };
        this.limiter = new bottleneck_1.default({
            maxConcurrent: this.config.maxConcurrent,
            minTime: this.config.rateLimit,
        });
        this.robotsParser = new robotsParser_1.RobotsTxtParser();
        this.cache = new Map();
        this.cacheTTL = 60 * 60 * 1000;
        console.log(`[Fetcher] Initialized for ${config.source} with ${this.config.rateLimit}ms rate limit`);
    }
    async fetch(url, options = {}) {
        const { timeout = DEFAULT_TIMEOUT, retries = MAX_RETRIES, skipCache = false, skipRobots = false, } = options;
        if (!skipCache) {
            const cached = this.getCached(url);
            if (cached) {
                return { ...cached, fromCache: true };
            }
        }
        if (this.config.respectRobotsTxt && !skipRobots) {
            const allowed = await this.checkRobotsTxt(url);
            if (!allowed) {
                return {
                    url,
                    statusCode: 403,
                    headers: {},
                    contentType: '',
                    size: 0,
                    fetchTime: 0,
                    success: false,
                    error: 'Blocked by robots.txt',
                    fromCache: false,
                };
            }
        }
        return this.limiter.schedule(() => this.fetchWithRetry(url, timeout, retries));
    }
    async fetchWithRetry(url, timeout, retriesLeft) {
        const startTime = Date.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': this.config.userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': this.config.languages.join(','),
                },
                signal: controller.signal,
                redirect: 'follow',
            });
            clearTimeout(timeoutId);
            const html = response.ok ? await response.text() : undefined;
            const headers = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            const result = {
                url,
                statusCode: response.status,
                headers,
                html,
                contentType: headers['content-type'] || '',
                size: html ? Buffer.byteLength(html, 'utf8') : 0,
                fetchTime: Date.now() - startTime,
                success: response.ok,
                error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
                fromCache: false,
            };
            if (result.success) {
                this.setCache(url, result);
            }
            return result;
        }
        catch (error) {
            const isTimeout = error instanceof Error && error.name === 'AbortError';
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (retriesLeft > 0 && (isTimeout || this.isRetryableError(error))) {
                const delay = RETRY_DELAY_BASE * Math.pow(2, MAX_RETRIES - retriesLeft);
                console.log(`[Fetcher] Retrying ${url} after ${delay}ms (${retriesLeft} retries left)`);
                await this.sleep(delay);
                return this.fetchWithRetry(url, timeout, retriesLeft - 1);
            }
            return {
                url,
                statusCode: 0,
                headers: {},
                contentType: '',
                size: 0,
                fetchTime: Date.now() - startTime,
                success: false,
                error: isTimeout ? 'Request timeout' : errorMessage,
                fromCache: false,
            };
        }
    }
    async checkRobotsTxt(url) {
        try {
            const urlObj = new URL(url);
            const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
            const rules = await this.robotsParser.fetch(robotsUrl, this.config.userAgent);
            return this.robotsParser.isAllowed(url, this.config.userAgent, rules);
        }
        catch (error) {
            console.warn(`[Fetcher] Could not check robots.txt for ${url}:`, error);
            return true;
        }
    }
    isRetryableError(error) {
        if (!(error instanceof Error))
            return false;
        const retryableMessages = [
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'ENOTFOUND',
            'EAI_AGAIN',
            'socket hang up',
            'network',
        ];
        return retryableMessages.some(msg => error.message.toLowerCase().includes(msg.toLowerCase()));
    }
    getCached(url) {
        const cached = this.cache.get(url);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.result;
        }
        this.cache.delete(url);
        return null;
    }
    setCache(url, result) {
        this.cache.set(url, { result, timestamp: Date.now() });
        if (this.cache.size > 1000) {
            const now = Date.now();
            for (const [key, value] of this.cache.entries()) {
                if (now - value.timestamp > this.cacheTTL) {
                    this.cache.delete(key);
                }
            }
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async fetchMany(urls, options = {}) {
        const { timeout = DEFAULT_TIMEOUT, onProgress } = options;
        const results = [];
        let completed = 0;
        for (const url of urls) {
            const result = await this.fetch(url, { timeout });
            results.push(result);
            completed++;
            onProgress?.(completed, urls.length);
        }
        return results;
    }
    static getContentHash(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }
    getStats() {
        const counts = this.limiter.counts();
        return {
            queued: counts.QUEUED || 0,
            running: counts.RUNNING || 0,
            done: counts.DONE || 0,
            cacheSize: this.cache.size,
        };
    }
    clearCache() {
        this.cache.clear();
    }
    async stop() {
        await this.limiter.stop();
    }
}
exports.Fetcher = Fetcher;
function createFetcher(source, overrides) {
    return new Fetcher({
        id: `${source}_${Date.now()}`,
        source,
        ...overrides,
    });
}
async function fetchWithRateLimit(url, options) {
    const fetcher = new Fetcher({
        id: 'oneoff',
        source: 'custom',
        baseUrl: new URL(url).origin,
        rateLimit: options?.rateLimit || 1000,
        maxConcurrent: 1,
        userAgent: options?.userAgent || 'OpenLex-Bot/1.0',
        respectRobotsTxt: true,
        jurisdictions: [],
        languages: ['en'],
        requiresAuth: false,
        useHeadless: false,
    });
    return fetcher.fetch(url, { timeout: options?.timeout });
}
//# sourceMappingURL=fetcher.js.map