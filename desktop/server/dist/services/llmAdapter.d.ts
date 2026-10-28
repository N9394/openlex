export declare class LLMError extends Error {
    readonly code: string;
    constructor(message: string, code: string);
}
export declare class OllamaConnectionError extends LLMError {
    constructor(url: string, cause?: Error);
}
export declare class ModelNotFoundError extends LLMError {
    constructor(model: string);
}
export declare class AnalysisTimeoutError extends LLMError {
    constructor(timeoutMs: number);
}
export declare class LLMParseError extends LLMError {
    constructor(details: string);
}
export declare class LLMRetryExhaustedError extends LLMError {
    constructor(attempts: number, lastError?: Error);
}
export interface LLMHealthStatus {
    available: boolean;
    provider: string;
    model: string;
    error?: string;
    queue: {
        active: number;
        waiting: number;
        maxConcurrent: number;
    };
}
export declare function checkLLMHealth(): Promise<LLMHealthStatus>;
export interface DocumentSummary {
    title: string;
    content: string;
    keyPoints: string[];
}
export interface DocumentAnalysis {
    summary: DocumentSummary;
    keyClauses: KeyClause[];
    glossary: GlossaryTerm[];
    riskFlags: RiskFlag[];
    importantDates: ImportantDate[];
    readabilityScore: ReadabilityScore;
    overallRiskScore: OverallRiskScore;
    missingElements: MissingElement[];
    clarityScore: ClarityScore;
}
export interface ClarityScore {
    overall: number;
    grade: 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F';
    breakdown: {
        completeness: number;
        fairness: number;
        structure: number;
        precision: number;
    };
    strengths: string[];
    weaknesses: string[];
    recommendation: string;
}
export interface ReadabilityScore {
    score: number;
    grade: string;
    explanation: string;
}
export interface OverallRiskScore {
    score: number;
    level: 'low' | 'medium' | 'high';
    explanation: string;
}
export interface MissingElement {
    element: string;
    importance: 'critical' | 'recommended' | 'optional';
    explanation: string;
}
export interface KeyClause {
    title: string;
    content: string;
    importance: 'high' | 'medium' | 'low';
    riskLevel?: 'high' | 'medium' | 'low';
    citation?: string;
}
export interface GlossaryTerm {
    term: string;
    explanation: string;
    citation?: string;
}
export interface RiskFlag {
    level: 'green' | 'yellow' | 'red';
    category: string;
    issue?: string;
    explanation: string;
    citation?: string;
    statuteBasis?: {
        reference: string;
        title?: string;
        excerpt?: string;
        jurisdiction?: string;
    };
    nliConfidence?: number;
    isVerified?: boolean;
}
export interface ImportantDate {
    date: string;
    description: string;
}
export interface ExtractedClause {
    id: string;
    category: 'payment' | 'termination' | 'liability' | 'confidentiality' | 'dispute-resolution' | 'intellectual-property' | 'warranties' | 'indemnification' | 'force-majeure' | 'general' | 'other';
    title: string;
    content: string;
    summary: string;
    riskLevel: 'low' | 'medium' | 'high';
    citation: string;
    implications: string[];
    relatedClauses?: string[];
}
export type AnalysisDepth = 'quick' | 'standard' | 'thorough';
export interface LLMOptions {
    analysisDepth?: AnalysisDepth;
}
export declare function analyzeDocument(text: string, language?: string, jurisdiction?: string, options?: LLMOptions): Promise<DocumentAnalysis>;
export declare function extractClauses(text: string, language?: string): Promise<ExtractedClause[]>;
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}
import { TaskType } from './modelRouter';
export interface CallLLMOptions {
    temperature?: number;
    maxTokens?: number;
    useFastModel?: boolean;
    taskType?: TaskType;
}
export declare function callLLM(messages: ChatMessage[], options?: CallLLMOptions): Promise<string>;
export declare function callLLMStream(messages: ChatMessage[], options?: CallLLMOptions): AsyncGenerator<string>;
export interface Flashcard {
    term: string;
    definition: string;
    example?: string;
    difficulty?: 'easy' | 'medium' | 'hard';
    importance?: 'high' | 'medium' | 'low';
}
export declare function generateFlashcardsWithAI(text: string, filename: string): Promise<Flashcard[]>;
export interface StudyAnalysis {
    summary: string;
    chapters: Array<{
        title: string;
        content: string;
        keyPoints: string[];
    }>;
    importantTopics: string[];
    suggestedFlashcards: number;
    learningObjectives?: string[];
    mainConcepts?: string[];
    studyTips?: string[];
}
export interface LegalDocumentAnalysis {
    documentType: string;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    suggestedFlashcards: number;
    keyTerms?: string[];
}
export declare function analyzeDocumentForStudy(text: string, filename: string, type?: 'learning' | 'legal'): Promise<StudyAnalysis | LegalDocumentAnalysis>;
export interface AnswerValidation {
    isCorrect: boolean;
    score: number;
    feedback: string;
    keyConceptsMissed?: string[];
    keyConceptsIncluded?: string[];
}
export declare function validateAnswer(userAnswer: string, correctDefinition: string, term: string): Promise<AnswerValidation>;
interface ExtractedEntity {
    name: string;
    type: 'person' | 'organization' | 'document';
    role?: string;
    email?: string;
    phone?: string;
    notes?: string;
}
interface ExtractedRelationship {
    fromEntity: string;
    toEntity: string;
    relationType: string;
    label?: string;
    strength: 'weak' | 'normal' | 'strong';
}
interface ExtractedTimelineEvent {
    title: string;
    description: string;
    date: string;
    eventType: 'deadline' | 'meeting' | 'filing' | 'document_uploaded' | 'other';
    severity: 'low' | 'normal' | 'high' | 'critical';
    color: string;
}
interface RelationshipExtractionResult {
    entities: ExtractedEntity[];
    relationships: ExtractedRelationship[];
}
interface TimelineExtractionResult {
    events: ExtractedTimelineEvent[];
}
export declare function extractRelationshipsFromDocument(documentText: string, documentName: string): Promise<RelationshipExtractionResult>;
export declare function extractTimelineFromDocument(documentText: string, documentName: string): Promise<TimelineExtractionResult>;
export {};
//# sourceMappingURL=llmAdapter.d.ts.map