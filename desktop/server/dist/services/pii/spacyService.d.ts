import { PIIDetection } from './types';
export declare function checkNERHealth(): Promise<{
    available: boolean;
    modelsLoaded: string[];
    error?: string;
}>;
export declare function detectWithNER(text: string, language?: 'en' | 'de'): Promise<PIIDetection[]>;
export declare function batchDetectWithNER(texts: string[], language?: 'en' | 'de'): Promise<PIIDetection[][]>;
export declare function detectWithNERSafe(text: string, language?: 'en' | 'de'): Promise<{
    detections: PIIDetection[];
    serviceUsed: boolean;
}>;
//# sourceMappingURL=spacyService.d.ts.map