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
exports.CrawlScheduler = void 0;
exports.getScheduler = getScheduler;
exports.createScheduler = createScheduler;
const crypto = __importStar(require("crypto"));
const fetcher_1 = require("./fetcher");
class PriorityQueue {
    items = [];
    enqueue(item) {
        let inserted = false;
        for (let i = 0; i < this.items.length; i++) {
            if (item.priority > this.items[i].priority) {
                this.items.splice(i, 0, item);
                inserted = true;
                break;
            }
        }
        if (!inserted) {
            this.items.push(item);
        }
    }
    dequeue() {
        return this.items.shift();
    }
    peek() {
        return this.items[0];
    }
    get size() {
        return this.items.length;
    }
    isEmpty() {
        return this.items.length === 0;
    }
    clear() {
        this.items = [];
    }
    toArray() {
        return [...this.items];
    }
}
class CrawlScheduler {
    queue;
    scheduledTasks;
    seenUrls;
    contentHashes;
    fetchers;
    isRunning = false;
    stats;
    _onDocumentParsed;
    constructor() {
        this.queue = new PriorityQueue();
        this.scheduledTasks = new Map();
        this.seenUrls = new Set();
        this.contentHashes = new Set();
        this.fetchers = new Map();
        this.stats = this.createEmptyStats();
    }
    addToQueue(url, sourceId, options = {}) {
        const { priority = 0, maxRetries = 3 } = options;
        if (this.seenUrls.has(url)) {
            this.stats.duplicatesSkipped++;
            return false;
        }
        this.seenUrls.add(url);
        const item = {
            id: crypto.randomUUID(),
            url,
            sourceId,
            priority,
            retries: 0,
            maxRetries,
            addedAt: new Date(),
            nextAttempt: new Date(),
            status: 'pending',
        };
        this.queue.enqueue(item);
        return true;
    }
    addManyToQueue(urls, sourceId, options = {}) {
        let added = 0;
        for (const url of urls) {
            if (this.addToQueue(url, sourceId, options)) {
                added++;
            }
        }
        return added;
    }
    isDuplicateContent(content) {
        const hash = fetcher_1.Fetcher.getContentHash(content);
        if (this.contentHashes.has(hash)) {
            return true;
        }
        this.contentHashes.add(hash);
        return false;
    }
    registerFetcher(sourceId, config) {
        const fetcher = new fetcher_1.Fetcher({
            id: sourceId,
            ...config,
        });
        this.fetchers.set(sourceId, fetcher);
        return fetcher;
    }
    getFetcher(sourceId) {
        return this.fetchers.get(sourceId);
    }
    onDocument(callback) {
        this._onDocumentParsed = callback;
    }
    async processNext() {
        if (this.queue.isEmpty()) {
            return null;
        }
        const item = this.queue.dequeue();
        item.status = 'processing';
        const fetcher = this.fetchers.get(item.sourceId);
        if (!fetcher) {
            item.status = 'failed';
            item.error = `No fetcher registered for source: ${item.sourceId}`;
            this.stats.failedFetches++;
            this.stats.errors.push({
                url: item.url,
                error: item.error,
                timestamp: new Date(),
            });
            return item;
        }
        try {
            const result = await fetcher.fetch(item.url);
            this.stats.totalUrls++;
            if (result.success) {
                item.status = 'completed';
                item.contentHash = result.html ? fetcher_1.Fetcher.getContentHash(result.html) : undefined;
                this.stats.successfulFetches++;
                this.stats.bytesTotal += result.size;
                this.stats.avgFetchTime =
                    (this.stats.avgFetchTime * (this.stats.successfulFetches - 1) + result.fetchTime) /
                        this.stats.successfulFetches;
                if (result.html && this.isDuplicateContent(result.html)) {
                    this.stats.duplicatesSkipped++;
                }
            }
            else {
                if (item.retries < item.maxRetries) {
                    item.retries++;
                    item.status = 'pending';
                    item.nextAttempt = new Date(Date.now() + 1000 * Math.pow(2, item.retries));
                    this.queue.enqueue(item);
                }
                else {
                    item.status = 'failed';
                    item.error = result.error;
                    this.stats.failedFetches++;
                    this.stats.errors.push({
                        url: item.url,
                        error: result.error || 'Unknown error',
                        timestamp: new Date(),
                    });
                }
            }
            return item;
        }
        catch (error) {
            item.status = 'failed';
            item.error = error instanceof Error ? error.message : 'Unknown error';
            this.stats.failedFetches++;
            this.stats.errors.push({
                url: item.url,
                error: item.error,
                timestamp: new Date(),
            });
            return item;
        }
    }
    async run(options = {}) {
        const { maxIterations, onProgress, delayBetweenItems = 100 } = options;
        this.isRunning = true;
        this.stats.startedAt = new Date();
        let iterations = 0;
        while (this.isRunning && !this.queue.isEmpty()) {
            if (maxIterations && iterations >= maxIterations) {
                break;
            }
            await this.processNext();
            iterations++;
            onProgress?.(this.getStats());
            if (delayBetweenItems > 0) {
                await this.sleep(delayBetweenItems);
            }
        }
        this.stats.endedAt = new Date();
        this.isRunning = false;
        return this.getStats();
    }
    stop() {
        this.isRunning = false;
    }
    getStats() {
        return { ...this.stats };
    }
    getQueueSize() {
        return this.queue.size;
    }
    clearQueue() {
        this.queue.clear();
        this.seenUrls.clear();
    }
    clearContentHashes() {
        this.contentHashes.clear();
    }
    resetStats() {
        this.stats = this.createEmptyStats();
    }
    scheduleTask(task) {
        const scheduled = {
            ...task,
            nextRun: this.calculateNextRun(task.cronExpression),
        };
        this.scheduledTasks.set(task.id, scheduled);
        console.log(`[Scheduler] Task ${task.id} scheduled for ${scheduled.nextRun}`);
    }
    getScheduledTasks() {
        return Array.from(this.scheduledTasks.values());
    }
    removeTask(taskId) {
        return this.scheduledTasks.delete(taskId);
    }
    async checkScheduledTasks() {
        const now = new Date();
        const runTasks = [];
        for (const [id, task] of this.scheduledTasks.entries()) {
            if (task.enabled && task.nextRun && task.nextRun <= now) {
                runTasks.push(id);
                task.lastRun = now;
                task.nextRun = this.calculateNextRun(task.cronExpression);
            }
        }
        return runTasks;
    }
    calculateNextRun(cronExpression) {
        const parts = cronExpression.split(' ');
        if (parts.length < 5) {
            return new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
        const [minute, hour] = parts;
        const now = new Date();
        const next = new Date(now);
        next.setMinutes(parseInt(minute, 10) || 0);
        next.setHours(parseInt(hour, 10) || 0);
        next.setSeconds(0);
        next.setMilliseconds(0);
        if (next <= now) {
            next.setDate(next.getDate() + 1);
        }
        return next;
    }
    createEmptyStats() {
        return {
            totalUrls: 0,
            successfulFetches: 0,
            failedFetches: 0,
            documentsParsed: 0,
            documentsIngested: 0,
            duplicatesSkipped: 0,
            bytesTotal: 0,
            avgFetchTime: 0,
            startedAt: new Date(),
            errors: [],
        };
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.CrawlScheduler = CrawlScheduler;
let schedulerInstance = null;
function getScheduler() {
    if (!schedulerInstance) {
        schedulerInstance = new CrawlScheduler();
    }
    return schedulerInstance;
}
function createScheduler() {
    return new CrawlScheduler();
}
//# sourceMappingURL=scheduler.js.map