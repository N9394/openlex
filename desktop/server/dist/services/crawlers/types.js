"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = exports.DEFAULT_CRAWLER_CONFIG = void 0;
exports.fetchWithRetry = fetchWithRetry;
exports.htmlToText = htmlToText;
exports.DEFAULT_CRAWLER_CONFIG = {
    rateLimit: 1,
    respectRobotsTxt: true,
    userAgent: 'LexVault-Crawler/1.0 (Legal Research; contact@lexvault.com)',
    maxPages: 100,
    timeoutMs: 30000,
};
class RateLimiter {
    lastRequest = 0;
    minInterval;
    constructor(requestsPerSecond) {
        this.minInterval = 1000 / requestsPerSecond;
    }
    async wait() {
        const now = Date.now();
        const elapsed = now - this.lastRequest;
        if (elapsed < this.minInterval) {
            await new Promise(resolve => setTimeout(resolve, this.minInterval - elapsed));
        }
        this.lastRequest = Date.now();
    }
}
exports.RateLimiter = RateLimiter;
async function fetchWithRetry(url, options = {}) {
    const { rateLimiter, userAgent = exports.DEFAULT_CRAWLER_CONFIG.userAgent, timeoutMs = exports.DEFAULT_CRAWLER_CONFIG.timeoutMs, maxRetries = 3, } = options;
    if (rateLimiter) {
        await rateLimiter.wait();
    }
    let lastError = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);
            const response = await fetch(url, {
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok && response.status !== 404) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const html = await response.text();
            return { html, status: response.status };
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }
    throw lastError || new Error('Failed to fetch URL');
}
function htmlToText(html) {
    return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/\s+/g, ' ')
        .trim();
}
//# sourceMappingURL=types.js.map