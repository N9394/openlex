export interface JurisdictionEntry {
    id: string;
    jurisdiction: string;
    topic: string;
    content: string;
    keyStatutes: string[];
    commonPitfalls: string[];
    practiceNotes?: string[];
    lastUpdated: string;
    language: 'en' | 'de';
}
export type JurisdictionTopic = 'non-compete' | 'at-will-employment' | 'statute-of-limitations' | 'contract-formation' | 'consumer-protection' | 'data-privacy' | 'arbitration' | 'choice-of-law';
//# sourceMappingURL=types.d.ts.map