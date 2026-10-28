import { PIIDetection, DetectOptions, PIICategory } from './types';
export declare function detectPII(text: string, options?: DetectOptions): Promise<PIIDetection[]>;
export declare function detectPIISync(text: string, options?: Omit<DetectOptions, 'useNER'>): PIIDetection[];
export declare function getDetectionStats(detections: PIIDetection[]): {
    total: number;
    byCategory: Record<PIICategory, number>;
    byMethod: Record<string, number>;
    averageConfidence: number;
};
export declare function likelyContainsPII(text: string): boolean;
export declare function extractUniqueEntities(detections: PIIDetection[]): Map<PIICategory, Set<string>>;
//# sourceMappingURL=detector.d.ts.map