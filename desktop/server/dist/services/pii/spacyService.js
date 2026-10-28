"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkNERHealth = checkNERHealth;
exports.detectWithNER = detectWithNER;
exports.batchDetectWithNER = batchDetectWithNER;
exports.detectWithNERSafe = detectWithNERSafe;
const types_1 = require("./types");
const NER_SERVICE_URL = process.env.NER_SERVICE_URL || 'http://localhost:5050';
const REQUEST_TIMEOUT = 30000;
async function checkNERHealth() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(`${NER_SERVICE_URL}/health`, {
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (response.ok) {
            const data = await response.json();
            return {
                available: true,
                modelsLoaded: data.models_loaded || [],
            };
        }
        return {
            available: false,
            modelsLoaded: [],
            error: `Service returned ${response.status}`,
        };
    }
    catch (error) {
        return {
            available: false,
            modelsLoaded: [],
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
async function detectWithNER(text, language = 'en') {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
        const response = await fetch(`${NER_SERVICE_URL}/detect`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text, language }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `NER service returned ${response.status}`);
        }
        const data = await response.json();
        return data.entities.map(entity => ({
            text: entity.text,
            category: types_1.NER_LABEL_MAP[entity.label] || 'other',
            start: entity.start,
            end: entity.end,
            method: 'ner',
            confidence: entity.confidence,
            confidenceLevel: entity.confidence >= 0.9 ? 'high' :
                entity.confidence >= 0.75 ? 'medium' : 'low',
            context: `spaCy ${entity.label}`,
        }));
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            console.error('[NER] Request timed out');
            throw new Error('NER service request timed out');
        }
        console.error('[NER] Detection failed:', error);
        throw error;
    }
}
async function batchDetectWithNER(texts, language = 'en') {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT * 2);
        const response = await fetch(`${NER_SERVICE_URL}/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ texts, language }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `NER service returned ${response.status}`);
        }
        const data = await response.json();
        return data.results.map((result) => {
            if (result.error) {
                console.warn(`[NER] Error for text ${result.text_index}: ${result.error}`);
                return [];
            }
            return result.entities.map((entity) => ({
                text: entity.text,
                category: types_1.NER_LABEL_MAP[entity.label] || 'other',
                start: entity.start,
                end: entity.end,
                method: 'ner',
                confidence: entity.confidence,
                confidenceLevel: entity.confidence >= 0.9 ? 'high' :
                    entity.confidence >= 0.75 ? 'medium' : 'low',
                context: `spaCy ${entity.label}`,
            }));
        });
    }
    catch (error) {
        console.error('[NER] Batch detection failed:', error);
        throw error;
    }
}
async function detectWithNERSafe(text, language = 'en') {
    try {
        const health = await checkNERHealth();
        if (!health.available) {
            console.warn('[NER] Service unavailable, skipping NER detection');
            return { detections: [], serviceUsed: false };
        }
        const detections = await detectWithNER(text, language);
        return { detections, serviceUsed: true };
    }
    catch (error) {
        console.error('[NER] Detection failed, falling back:', error);
        return { detections: [], serviceUsed: false };
    }
}
//# sourceMappingURL=spacyService.js.map