export interface MicroLearningBite {
    id: string;
    title: string;
    category: 'contracts' | 'property' | 'employment' | 'consumer' | 'basics';
    readTime: number;
    summary: string;
    content: string;
    keyTakeaways: string[];
    relatedBites: string[];
}
export declare const microLearningLibrary: MicroLearningBite[];
export declare function getMicroLearningBite(id: string): MicroLearningBite | undefined;
export declare function getMicroLearningByCategory(category: string): MicroLearningBite[];
export declare function searchMicroLearning(query: string): MicroLearningBite[];
//# sourceMappingURL=microLearning.d.ts.map