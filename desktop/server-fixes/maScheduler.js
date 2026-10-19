"use strict";
/**
 * M&A LLM Priority Scheduler
 *
 * Global scheduler with priority queues for interactive vs background (M&A) LLM calls.
 * Interactive calls (research, doc analysis, navigator) get reserved slots.
 * Background calls (M&A pipeline) use remaining capacity.
 *
 * For OpenRouter: maxSlots=8, reservedInteractive=6
 * For DGX Spark vLLM: maxSlots=64, reservedInteractive=48
 */

const { callLLM, callLLMStream } = require('../services/llmAdapter');

const MAX_SLOTS = parseInt(process.env.LLM_MAX_SLOTS || '8', 10);
const RESERVED_INTERACTIVE = parseInt(process.env.LLM_RESERVED_INTERACTIVE || '6', 10);
const MAX_BACKGROUND = parseInt(process.env.LLM_MAX_BACKGROUND || '32', 10);
const QUEUE_TIMEOUT = 10 * 60 * 1000; // 10 min
const LLM_CALL_TIMEOUT = 120 * 1000; // 120s max per LLM call

class LLMScheduler {
    constructor(maxSlots = MAX_SLOTS, reservedInteractive = RESERVED_INTERACTIVE) {
        this.maxSlots = maxSlots;
        this.reservedInteractive = reservedInteractive;
        this.maxBackground = Math.min(maxSlots - reservedInteractive, MAX_BACKGROUND);

        this.interactiveActive = 0;
        this.backgroundActive = 0;

        this.interactiveQueue = [];
        this.backgroundQueue = [];

        console.log(`[LLM Scheduler] Initialized: ${maxSlots} total slots, ${reservedInteractive} reserved interactive, ${this.maxBackground} max background`);
    }

    get totalActive() {
        return this.interactiveActive + this.backgroundActive;
    }

    get availableForBackground() {
        // Background can use: total - currently active interactive - currently active background
        // But capped at maxBackground and cannot use reserved interactive slots
        const available = this.maxSlots - this.interactiveActive - this.backgroundActive;
        const bgCap = this.maxBackground - this.backgroundActive;
        return Math.min(available, bgCap);
    }

    get availableForInteractive() {
        return this.maxSlots - this.totalActive;
    }

    /**
     * Acquire a slot. Returns a promise that resolves with a release function.
     */
    acquire(priority = 'interactive') {
        return new Promise((resolve, reject) => {
            const request = {
                priority,
                resolve,
                reject,
                enqueuedAt: Date.now(),
            };

            if (priority === 'interactive') {
                if (this.availableForInteractive > 0) {
                    this.interactiveActive++;
                    resolve(() => this._release('interactive'));
                    return;
                }
                this.interactiveQueue.push(request);
            } else {
                if (this.availableForBackground > 0) {
                    this.backgroundActive++;
                    resolve(() => this._release('background'));
                    return;
                }
                this.backgroundQueue.push(request);
            }
        });
    }

    _release(priority) {
        if (priority === 'interactive') {
            this.interactiveActive--;
        } else {
            this.backgroundActive--;
        }
        this._processQueues();
    }

    _processQueues() {
        // Always prioritize interactive queue first
        while (this.interactiveQueue.length > 0 && this.availableForInteractive > 0) {
            const req = this.interactiveQueue.shift();
            if (Date.now() - req.enqueuedAt > QUEUE_TIMEOUT) {
                req.reject(new Error('LLM scheduler queue timeout (interactive)'));
                continue;
            }
            this.interactiveActive++;
            req.resolve(() => this._release('interactive'));
        }

        // Then process background queue
        while (this.backgroundQueue.length > 0 && this.availableForBackground > 0) {
            const req = this.backgroundQueue.shift();
            if (Date.now() - req.enqueuedAt > QUEUE_TIMEOUT) {
                req.reject(new Error('LLM scheduler queue timeout (background)'));
                continue;
            }
            this.backgroundActive++;
            req.resolve(() => this._release('background'));
        }
    }

    /**
     * Call LLM with priority scheduling, timeout protection, and retry on timeout
     */
    async call(messages, options = {}, priority = 'interactive') {
        const timeout = options.timeout || (priority === 'background' ? LLM_CALL_TIMEOUT : LLM_CALL_TIMEOUT * 2);
        const maxRetries = priority === 'background' ? 1 : 0; // background gets 1 retry on timeout

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const release = await this.acquire(priority);
            try {
                return await Promise.race([
                    callLLM(messages, options),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(`LLM call timed out after ${timeout / 1000}s`)), timeout)
                    )
                ]);
            } catch (err) {
                if (attempt < maxRetries && err.message?.includes('timed out')) {
                    console.warn(`[LLM Scheduler] Timeout on attempt ${attempt + 1}, retrying (${priority})`);
                    continue;
                }
                throw err;
            } finally {
                release();
            }
        }
    }

    /**
     * Stream LLM with priority scheduling
     */
    async *stream(messages, options = {}, priority = 'interactive') {
        const release = await this.acquire(priority);
        try {
            for await (const token of callLLMStream(messages, options)) {
                yield token;
            }
        } finally {
            release();
        }
    }

    getStatus() {
        return {
            totalSlots: this.maxSlots,
            reservedInteractive: this.reservedInteractive,
            maxBackground: this.maxBackground,
            interactiveActive: this.interactiveActive,
            backgroundActive: this.backgroundActive,
            interactiveQueued: this.interactiveQueue.length,
            backgroundQueued: this.backgroundQueue.length,
        };
    }
}

// Global singleton
const scheduler = new LLMScheduler();

// Convenience wrappers — same signature as callLLM but routed through scheduler
async function callLLMInteractive(messages, options = {}) {
    return scheduler.call(messages, options, 'interactive');
}

async function callLLMBackground(messages, options = {}) {
    return scheduler.call(messages, options, 'background');
}

async function* callLLMStreamInteractive(messages, options = {}) {
    yield* scheduler.stream(messages, options, 'interactive');
}

async function* callLLMStreamBackground(messages, options = {}) {
    yield* scheduler.stream(messages, options, 'background');
}

exports.LLMScheduler = LLMScheduler;
exports.scheduler = scheduler;
exports.callLLMInteractive = callLLMInteractive;
exports.callLLMBackground = callLLMBackground;
exports.callLLMStreamInteractive = callLLMStreamInteractive;
exports.callLLMStreamBackground = callLLMStreamBackground;
