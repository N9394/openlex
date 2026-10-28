"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RobotsTxtParser = void 0;
exports.isUrlAllowed = isUrlAllowed;
exports.getSitemapUrls = getSitemapUrls;
const ROBOTS_CACHE_TTL = 60 * 60 * 1000;
const FETCH_TIMEOUT = 10000;
class RobotsTxtParser {
    cache;
    constructor() {
        this.cache = new Map();
    }
    async fetch(robotsUrl, userAgent) {
        const cached = this.cache.get(robotsUrl);
        if (cached && Date.now() - cached.fetchedAt.getTime() < cached.ttl * 1000) {
            return cached;
        }
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
            const response = await fetch(robotsUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                const rules = this.createEmptyRules();
                this.cache.set(robotsUrl, rules);
                return rules;
            }
            const text = await response.text();
            const rules = this.parse(text);
            this.cache.set(robotsUrl, rules);
            return rules;
        }
        catch (error) {
            console.warn(`[RobotsParser] Failed to fetch ${robotsUrl}:`, error);
            return this.createEmptyRules();
        }
    }
    parse(content) {
        const rules = {
            rules: new Map(),
            sitemaps: [],
            fetchedAt: new Date(),
            ttl: ROBOTS_CACHE_TTL / 1000,
        };
        const lines = content.split('\n');
        let currentUserAgents = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) {
                continue;
            }
            const colonIndex = line.indexOf(':');
            if (colonIndex === -1)
                continue;
            const directive = line.substring(0, colonIndex).trim().toLowerCase();
            const value = line.substring(colonIndex + 1).trim();
            switch (directive) {
                case 'user-agent':
                    if (currentUserAgents.length > 0) {
                        currentUserAgents = [];
                    }
                    currentUserAgents.push(value.toLowerCase());
                    if (!rules.rules.has(value.toLowerCase())) {
                        rules.rules.set(value.toLowerCase(), {
                            allow: [],
                            disallow: [],
                        });
                    }
                    break;
                case 'allow':
                    for (const ua of currentUserAgents) {
                        const rule = rules.rules.get(ua);
                        if (rule) {
                            rule.allow.push(value);
                        }
                    }
                    break;
                case 'disallow':
                    for (const ua of currentUserAgents) {
                        const rule = rules.rules.get(ua);
                        if (rule) {
                            rule.disallow.push(value);
                        }
                    }
                    break;
                case 'crawl-delay':
                    const delay = parseFloat(value);
                    if (!isNaN(delay)) {
                        for (const ua of currentUserAgents) {
                            const rule = rules.rules.get(ua);
                            if (rule) {
                                rule.crawlDelay = delay * 1000;
                            }
                        }
                    }
                    break;
                case 'sitemap':
                    rules.sitemaps.push(value);
                    break;
            }
        }
        return rules;
    }
    isAllowed(url, userAgent, rules) {
        try {
            const urlPath = new URL(url).pathname;
            const normalizedUA = userAgent.toLowerCase();
            let applicableRules = rules.rules.get(normalizedUA);
            if (!applicableRules) {
                for (const [ua, rule] of rules.rules.entries()) {
                    if (normalizedUA.includes(ua) || ua.includes(normalizedUA.split('/')[0])) {
                        applicableRules = rule;
                        break;
                    }
                }
            }
            if (!applicableRules) {
                applicableRules = rules.rules.get('*');
            }
            if (!applicableRules) {
                return true;
            }
            for (const pattern of applicableRules.allow) {
                if (this.matchesPattern(urlPath, pattern)) {
                    return true;
                }
            }
            for (const pattern of applicableRules.disallow) {
                if (this.matchesPattern(urlPath, pattern)) {
                    return false;
                }
            }
            return true;
        }
        catch (error) {
            return true;
        }
    }
    getCrawlDelay(userAgent, rules) {
        const normalizedUA = userAgent.toLowerCase();
        const specificRule = rules.rules.get(normalizedUA);
        if (specificRule?.crawlDelay !== undefined) {
            return specificRule.crawlDelay;
        }
        const wildcardRule = rules.rules.get('*');
        return wildcardRule?.crawlDelay;
    }
    matchesPattern(path, pattern) {
        if (!pattern) {
            return false;
        }
        if (pattern === '') {
            return false;
        }
        let regexPattern = pattern
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*');
        if (regexPattern.endsWith('$')) {
            regexPattern = regexPattern.slice(0, -1) + '$';
        }
        else {
            regexPattern = '^' + regexPattern;
        }
        try {
            const regex = new RegExp(regexPattern);
            return regex.test(path);
        }
        catch {
            return path.startsWith(pattern.replace(/\*.*$/, ''));
        }
    }
    createEmptyRules() {
        return {
            rules: new Map(),
            sitemaps: [],
            fetchedAt: new Date(),
            ttl: ROBOTS_CACHE_TTL / 1000,
        };
    }
    clearCache() {
        this.cache.clear();
    }
    getCached(robotsUrl) {
        return this.cache.get(robotsUrl);
    }
}
exports.RobotsTxtParser = RobotsTxtParser;
async function isUrlAllowed(url, userAgent = 'LexVault-Bot/1.0') {
    const parser = new RobotsTxtParser();
    const urlObj = new URL(url);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
    const rules = await parser.fetch(robotsUrl, userAgent);
    return parser.isAllowed(url, userAgent, rules);
}
async function getSitemapUrls(baseUrl, userAgent = 'LexVault-Bot/1.0') {
    const parser = new RobotsTxtParser();
    const urlObj = new URL(baseUrl);
    const robotsUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
    const rules = await parser.fetch(robotsUrl, userAgent);
    return rules.sitemaps;
}
//# sourceMappingURL=robotsParser.js.map