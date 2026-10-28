"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENTITY_PROMPTS = exports.TIMELINE_PROMPTS = exports.STUDY_PROMPTS = exports.COMPARISON_PROMPTS = exports.EXPLAINER_PROMPTS = exports.ANALYSIS_PROMPTS = exports.ARCHIVIST_PROMPTS = void 0;
exports.getJurisdictionContext = getJurisdictionContext;
exports.getLanguageInstructions = getLanguageInstructions;
exports.ARCHIVIST_PROMPTS = {
    system: (contextData) => `You are Archivist, a knowledgeable and friendly legal AI assistant for LexVault.

YOUR PERSONALITY:
- Helpful and approachable, but professional
- Explains legal concepts in plain English
- Proactive in offering relevant help based on context
- Honest about limitations (you're not a lawyer, this isn't legal advice)

YOUR CAPABILITIES:
- Answer questions about uploaded documents
- Explain legal terms and concepts
- Guide users through document creation
- Search and retrieve vault items
- Provide platform navigation help

USER CONTEXT:
- Documents uploaded: ${contextData.documentsCount}
- Vault items saved: ${contextData.vaultItemsCount}
- Subscription: ${contextData.userTier}
- Current page: ${contextData.currentPage}

RESPONSE GUIDELINES:
- Keep responses concise (2-4 sentences for simple questions)
- Use bullet points for lists
- Reference specific documents by name when relevant
- Suggest next steps or related features
- If unsure, ask clarifying questions

Remember: You're helping users navigate legal documents, not providing legal advice.`,
    suggestions: (page, hasDocuments, hasVaultItems) => {
        const suggestions = [];
        if (page === '/dashboard') {
            if (!hasDocuments) {
                suggestions.push("How do I upload my first document?");
                suggestions.push("What types of documents can you analyze?");
            }
            else {
                suggestions.push("Summarize my recent uploads");
                suggestions.push("Which documents have the highest risk?");
            }
        }
        else if (page === '/navigator') {
            suggestions.push("What documents can you help me create?");
            suggestions.push("How does the Navigator work?");
        }
        else if (page === '/vault') {
            if (!hasVaultItems) {
                suggestions.push("How do I save items to my vault?");
            }
            else {
                suggestions.push("Find my favorite clauses");
                suggestions.push("Show templates in my vault");
            }
        }
        return suggestions;
    },
};
exports.ANALYSIS_PROMPTS = {
    fullAnalysis: (documentText, documentType, jurisdiction) => `Analyze this ${documentType} legal document thoroughly.

DOCUMENT TEXT:
${documentText}

JURISDICTION: ${jurisdiction}

Provide a comprehensive analysis including:

1. SUMMARY (3-5 key points about what this document does)

2. KEY CLAUSES (identify the most important provisions)
   For each clause:
   - Title
   - What it means in plain English
   - Importance level (high/medium/low)
   - Any concerns or risks

3. RISK FLAGS (identify problematic terms)
   Categories: green (safe), yellow (caution), red (danger)
   - What the risk is
   - Why it matters
   - Relevant clause text

4. IMPORTANT DATES (deadlines, effective dates, renewal dates)

5. GLOSSARY (define legal terms used)

6. MISSING ELEMENTS (what should be included but isn't)

7. OVERALL RISK SCORE (1-10, with explanation)

8. CLARITY SCORE (how readable is this document, 0-100)

Return as structured JSON.`,
    quickSummary: (documentText) => `Provide a quick summary of this legal document in 3-5 bullet points.

DOCUMENT:
${documentText}

Focus on:
- What type of document this is
- Who the parties are
- Main obligations
- Key dates or deadlines
- Any obvious red flags

Return as JSON: {"summary": ["point1", "point2", ...], "documentType": "type", "riskLevel": "low|medium|high"}`,
    clauseExtraction: (documentText, language) => `Extract and categorize ALL individual clauses from this ${language} legal document.

DOCUMENT:
${documentText}

For each clause, provide:
1. category: payment | termination | liability | confidentiality | dispute-resolution | intellectual-property | warranties | indemnification | force-majeure | general | other
2. title: Brief descriptive title
3. content: The full clause text
4. summary: 1-2 sentence plain English explanation
5. riskLevel: low | medium | high
6. implications: What this means for the reader (array of strings)

Return as JSON array: [{"category": "...", "title": "...", "content": "...", "summary": "...", "riskLevel": "...", "implications": [...]}]`,
    rightsExtraction: (documentText) => `Identify all RIGHTS granted to each party in this legal document.

DOCUMENT:
${documentText}

For each right found:
1. party: Who has this right (e.g., "Buyer", "Landlord", "Employee")
2. right: Description of the right
3. conditions: Any conditions or limitations
4. citation: The relevant text from the document

Return as JSON: {"rights": [{"party": "...", "right": "...", "conditions": "...", "citation": "..."}]}`,
    deadlineExtraction: (documentText) => `Extract ALL dates and deadlines from this legal document.

DOCUMENT:
${documentText}

For each date/deadline:
1. date: The actual date or relative timeframe
2. description: What happens on this date
3. importance: critical | important | informational
4. type: deadline | effective-date | expiration | renewal | notice-period | other
5. citation: Relevant text from document

Return as JSON: {"deadlines": [{"date": "...", "description": "...", "importance": "...", "type": "...", "citation": "..."}]}`,
    healthCheck: (documentText, documentType) => `Evaluate the quality and completeness of this ${documentType}.

DOCUMENT:
${documentText}

Assess:
1. COMPLETENESS - Does it have all required sections for a ${documentType}?
2. CLARITY - Is the language clear and unambiguous?
3. BALANCE - Are the terms fair to all parties?
4. ENFORCEABILITY - Are there any provisions that might not hold up legally?
5. MISSING ELEMENTS - What important clauses are absent?

For each issue found:
- severity: critical | warning | suggestion
- description: What the issue is
- recommendation: How to fix it
- section: Which part of the document

Return as JSON: {"overallScore": 0-100, "grade": "A+|A|B+|B|C+|C|D|F", "issues": [...], "strengths": [...]}`,
};
exports.EXPLAINER_PROMPTS = {
    explainTerm: (term, context) => `Explain the legal term "${term}" in plain English.

${context ? `CONTEXT: This term appears in: ${context}` : ''}

Provide:
1. DEFINITION - What it means in simple terms
2. EXAMPLE - A practical example of how it's used
3. WHY IT MATTERS - Why someone should care about this term
4. RELATED TERMS - Other legal terms that are related

Keep the explanation accessible to someone without legal training.
Use analogies where helpful.

Return as JSON: {"term": "${term}", "definition": "...", "example": "...", "whyItMatters": "...", "relatedTerms": [...]}`,
    explainClause: (clauseText, documentType) => `Explain this clause from a ${documentType} in plain English.

CLAUSE:
${clauseText}

Provide:
1. PLAIN ENGLISH - What this actually means
2. IMPLICATIONS - What are the practical consequences
3. WHAT TO WATCH FOR - Any potential concerns
4. TYPICAL OR UNUSUAL - Is this standard or non-standard for this type of document

Return as JSON: {"plainEnglish": "...", "implications": [...], "concerns": [...], "isTypical": true|false, "notes": "..."}`,
};
exports.COMPARISON_PROMPTS = {
    compareDocuments: (doc1, doc2, doc1Name, doc2Name) => `Compare these two legal documents and identify key differences.

DOCUMENT 1 (${doc1Name}):
${doc1}

DOCUMENT 2 (${doc2Name}):
${doc2}

Analyze:
1. STRUCTURAL DIFFERENCES - Different sections or organization
2. TERM DIFFERENCES - Different conditions, amounts, dates
3. RIGHTS DIFFERENCES - Different rights granted to parties
4. OBLIGATION DIFFERENCES - Different responsibilities
5. RISK DIFFERENCES - One document more favorable than the other?

For each difference:
- category: structural | terms | rights | obligations | risk
- description: What's different
- doc1Value: What Document 1 says
- doc2Value: What Document 2 says
- significance: minor | moderate | major

Return as JSON: {"summary": "...", "differences": [...], "recommendation": "which document is more favorable and why"}`,
};
exports.STUDY_PROMPTS = {
    generateFlashcards: (documentText, topic) => `Create educational flashcards from this ${topic} legal document.

DOCUMENT:
${documentText}

Create 10-15 flashcards that would help a law student understand:
- Key legal concepts used
- Important definitions
- Rights and obligations
- Common legal principles illustrated

For each flashcard:
- term: The concept or term (front of card)
- definition: Clear explanation (back of card)
- example: Practical example from the document
- category: concept | definition | principle | procedure

Return as JSON: {"flashcards": [{"term": "...", "definition": "...", "example": "...", "category": "..."}]}`,
    generateStudyGuide: (documentText, documentType) => `Create a comprehensive study guide from this ${documentType}.

DOCUMENT:
${documentText}

Create a study guide including:
1. KEY CONCEPTS - Main legal concepts illustrated
2. VOCABULARY - Important terms and definitions
3. STRUCTURE OVERVIEW - How this type of document is typically organized
4. PRACTICE QUESTIONS - Questions to test understanding
5. COMMON MISTAKES - What people often get wrong about this type of document

Return as JSON with these sections.`,
    generateQuiz: (documentText, difficulty) => `Create ${difficulty}-level quiz questions about this legal document.

DOCUMENT:
${documentText}

Create 10 multiple-choice questions appropriate for ${difficulty} level:
- beginner: Basic comprehension and term recognition
- intermediate: Application and analysis
- advanced: Evaluation and synthesis

For each question:
- question: The question text
- options: Array of 4 possible answers
- correctIndex: Index of correct answer (0-3)
- explanation: Why the answer is correct

Return as JSON: {"questions": [...]}`,
};
exports.TIMELINE_PROMPTS = {
    generateTimeline: (documentText) => `Extract all dates and create a chronological timeline from this document.

DOCUMENT:
${documentText}

For each timeline event:
- date: The date (or relative date like "30 days after signing")
- event: What happens
- type: start | deadline | milestone | renewal | termination | other
- isRecurring: true/false
- importance: high | medium | low

Return as JSON: {"events": [...], "duration": "total contract duration", "keyDates": ["most important dates"]}`,
    riskTimeline: (documentText) => `Analyze time-sensitive risks in this document.

DOCUMENT:
${documentText}

Identify:
1. IMMEDIATE RISKS - Things requiring attention now
2. UPCOMING DEADLINES - Important dates approaching
3. RECURRING OBLIGATIONS - Ongoing requirements
4. PENALTY TRIGGERS - What happens if deadlines are missed

Return as JSON: {"immediateRisks": [...], "upcomingDeadlines": [...], "recurringObligations": [...], "penaltyTriggers": [...]}`,
};
exports.ENTITY_PROMPTS = {
    extractEntities: (documentText) => `Extract the key entities and their relationships from this legal document.

DOCUMENT:
${documentText}

Identify:
1. PARTIES - All named parties and their roles
2. RELATIONSHIPS - How parties relate to each other
3. OBLIGATIONS - Who owes what to whom
4. ASSETS - Any property, money, or rights mentioned
5. CONDITIONS - Dependencies between events

For entities:
- name: Entity name
- type: person | company | property | money | date | other
- role: Their role in the document

For relationships:
- from: Source entity
- to: Target entity
- relationship: Type of relationship (owes, owns, represents, etc.)

Return as JSON: {"entities": [...], "relationships": [...]}`,
};
function getJurisdictionContext(jurisdiction) {
    const contexts = {
        US: 'Apply US common law principles. Reference UCC for commercial matters.',
        UK: 'Apply English common law. Reference relevant UK statutes.',
        DE: 'Apply German civil law (BGB). Use appropriate German legal terminology.',
        AT: 'Apply Austrian law (ABGB). Use appropriate Austrian legal terminology.',
        CH: 'Apply Swiss law (OR, ZGB). Consider cantonal variations.',
        EU: 'Consider applicable EU regulations and directives.',
        FR: 'Apply French civil law (Code civil).',
        CA: 'Apply Canadian law. Consider provincial jurisdiction.',
        AU: 'Apply Australian law. Consider state/territory jurisdiction.',
    };
    return contexts[jurisdiction] || `Apply ${jurisdiction} law.`;
}
function getLanguageInstructions(language) {
    const instructions = {
        en: 'Respond in English. Use standard legal English terminology.',
        de: 'Respond in German. Use standard German legal terminology (Rechtssprache).',
        fr: 'Respond in French. Use standard French legal terminology.',
        es: 'Respond in Spanish. Use standard Spanish legal terminology.',
    };
    return instructions[language] || instructions.en;
}
//# sourceMappingURL=prompts.js.map