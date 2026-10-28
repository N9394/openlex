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
exports.DOCUMENT_TYPES = void 0;
exports.detectDocumentType = detectDocumentType;
exports.generateQuestions = generateQuestions;
exports.draftDocumentStream = draftDocumentStream;
exports.draftDocument = draftDocument;
const undici_1 = require("undici");
const firmMemoryService_1 = require("./firmMemoryService");
const rag_1 = require("./rag");
const mandatoryTerms_1 = require("../data/mandatoryTerms");
const llmAgent = new undici_1.Agent({
    headersTimeout: 5 * 60 * 1000,
    bodyTimeout: 5 * 60 * 1000,
    keepAliveTimeout: 5 * 60 * 1000,
});
const FAST_MODEL = process.env.OLLAMA_MODEL_FAST || 'gemma3:1b';
const FULL_MODEL = process.env.OLLAMA_MODEL || 'gemma3:4b';
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
function sanitizeJsonString(str) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const code = char.charCodeAt(0);
        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            result += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            result += char;
            continue;
        }
        if (inString && code < 32) {
            if (code === 10)
                result += '\\n';
            else if (code === 13)
                result += '\\r';
            else if (code === 9)
                result += '\\t';
            else
                result += '\\u' + ('0000' + code.toString(16)).slice(-4);
        }
        else {
            result += char;
        }
    }
    return result;
}
exports.DOCUMENT_TYPES = {
    nda: {
        name: 'Non-Disclosure Agreement (NDA)',
        description: 'Protects confidential information shared between parties',
        keywords: ['nda', 'confidential', 'secret', 'non-disclosure', 'confidentiality', 'proprietary', 'trade secret'],
    },
    service_agreement: {
        name: 'Service Agreement',
        description: 'Defines terms for providing services',
        keywords: ['service', 'freelance', 'contractor', 'consulting', 'work for', 'hire', 'engagement'],
    },
    employment_contract: {
        name: 'Employment Contract',
        description: 'Formal employment relationship terms',
        keywords: ['employment', 'employee', 'job', 'position', 'salary', 'full-time', 'part-time', 'hire'],
    },
    lease_agreement: {
        name: 'Lease Agreement',
        description: 'Rental terms for property',
        keywords: ['lease', 'rent', 'tenant', 'landlord', 'property', 'apartment', 'house', 'room'],
    },
    sales_agreement: {
        name: 'Sales Agreement',
        description: 'Terms for buying or selling goods',
        keywords: ['sale', 'sell', 'buy', 'purchase', 'goods', 'product', 'transaction'],
    },
    partnership_agreement: {
        name: 'Partnership Agreement',
        description: 'Terms between business partners',
        keywords: ['partnership', 'partner', 'joint venture', 'co-founder', 'equity', 'shares'],
    },
    loan_agreement: {
        name: 'Loan Agreement',
        description: 'Terms for lending money',
        keywords: ['loan', 'lend', 'borrow', 'money', 'repayment', 'interest', 'debt'],
    },
    release_waiver: {
        name: 'Release & Waiver',
        description: 'Release from liability or claims',
        keywords: ['release', 'waiver', 'liability', 'claim', 'indemnify', 'hold harmless'],
    },
    cease_desist: {
        name: 'Cease and Desist Letter',
        description: 'Demand to stop specific actions',
        keywords: ['cease', 'desist', 'stop', 'infringement', 'violation', 'demand'],
    },
    power_of_attorney: {
        name: 'Power of Attorney',
        description: 'Authorization to act on behalf of another',
        keywords: ['power of attorney', 'authorize', 'represent', 'agent', 'principal', 'act on behalf'],
    },
};
const JURISDICTION_KEYWORDS = {
    UK: { code: 'UK', keywords: ['uk', 'united kingdom', 'british', 'england', 'english', 'london', 'scotland', 'wales'] },
    US: { code: 'US', keywords: ['us', 'usa', 'united states', 'american', 'america', 'california', 'new york', 'texas', 'delaware'] },
    AU: { code: 'AU', keywords: ['australia', 'australian', 'sydney', 'melbourne', 'brisbane'] },
    DE: { code: 'DE', keywords: ['germany', 'german', 'berlin', 'munich', 'frankfurt', 'deutsche'] },
    AT: { code: 'AT', keywords: ['austria', 'austrian', 'vienna', 'wien', 'österreich'] },
    SK: { code: 'SK', keywords: ['slovakia', 'slovak', 'bratislava', 'slovensko'] },
    FR: { code: 'FR', keywords: ['france', 'french', 'paris', 'français'] },
    CH: { code: 'CH', keywords: ['switzerland', 'swiss', 'zurich', 'geneva', 'schweiz', 'suisse'] },
    SG: { code: 'SG', keywords: ['singapore', 'singaporean'] },
    AE: { code: 'AE', keywords: ['uae', 'dubai', 'abu dhabi', 'emirates', 'difc'] },
    HK: { code: 'HK', keywords: ['hong kong', 'hk'] },
    CY: { code: 'CY', keywords: ['cyprus', 'cypriot', 'nicosia', 'limassol'] },
    CA: { code: 'CA', keywords: ['canada', 'canadian', 'toronto', 'vancouver', 'ontario'] },
    NL: { code: 'NL', keywords: ['netherlands', 'dutch', 'amsterdam', 'holland'] },
    IE: { code: 'IE', keywords: ['ireland', 'irish', 'dublin'] },
    IN: { code: 'IN', keywords: ['india', 'indian', 'mumbai', 'delhi', 'bangalore'] },
    CN: { code: 'CN', keywords: ['china', 'chinese', 'beijing', 'shanghai'] },
    JP: { code: 'JP', keywords: ['japan', 'japanese', 'tokyo'] },
};
function detectPartyJurisdictions(situation) {
    const lowerSituation = situation.toLowerCase();
    const detectedParties = [];
    const findJurisdiction = (text) => {
        const cleanText = text.toLowerCase().trim();
        for (const [, jurInfo] of Object.entries(JURISDICTION_KEYWORDS)) {
            for (const kw of jurInfo.keywords) {
                if (kw.length <= 3) {
                    const regex = new RegExp(`\\b${kw}\\b`, 'i');
                    if (regex.test(cleanText)) {
                        return jurInfo.code;
                    }
                }
                else {
                    if (cleanText.includes(kw)) {
                        return jurInfo.code;
                    }
                }
            }
        }
        return null;
    };
    const addParty = (jurisdiction) => {
        if (!detectedParties.some(p => p.jurisdiction === jurisdiction)) {
            detectedParties.push({
                jurisdiction,
                name: `Party ${detectedParties.length + 1}`,
            });
        }
    };
    const partyPatterns = [
        /(?:a|an)\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:company|business|firm|startup|corporation|entity|party|client|investor)/gi,
        /(?:based|headquartered|located|incorporated)\s+in\s+(?:the\s+)?([a-z\s]+?)(?:\s+(?:to|for|and|with|is|are|,|\.))/gi,
        /([a-z]+)[-]based\s+(?:[a-z]+\s+)?(?:company|business|firm|startup|corporation|entity)/gi,
        /(?:company|business|firm|party|investor|client)\s+from\s+(?:the\s+)?([a-z\s]+?)(?:\s+(?:to|for|and|with|is|are|,|\.))/gi,
        /(?:my|our|their|the)\s+([a-z]+)[-\s]+(?:based\s+)?(?:[a-z]+\s+)?(?:company|business|firm|startup)/gi,
    ];
    for (const pattern of partyPatterns) {
        let match;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(situation)) !== null) {
            const locationPhrase = match[1];
            const jurisdiction = findJurisdiction(locationPhrase);
            if (jurisdiction) {
                addParty(jurisdiction);
            }
        }
    }
    for (const [, jurInfo] of Object.entries(JURISDICTION_KEYWORDS)) {
        if (detectedParties.some(p => p.jurisdiction === jurInfo.code)) {
            continue;
        }
        for (const kw of jurInfo.keywords) {
            if (kw.length < 3)
                continue;
            const contextPatterns = [
                new RegExp(`\\b${kw}[-]based\\b`, 'i'),
                new RegExp(`\\bbased\\s+in\\s+(?:the\\s+)?${kw}\\b`, 'i'),
                new RegExp(`\\bfrom\\s+(?:the\\s+)?${kw}\\b`, 'i'),
                new RegExp(`\\b${kw}(?:n|an|ese|ish)?\\s+(?:company|business|firm|startup|investor|party|client)\\b`, 'i'),
            ];
            if (contextPatterns.some(p => p.test(situation))) {
                addParty(jurInfo.code);
                break;
            }
        }
    }
    console.log(`[NAVIGATOR] Detected ${detectedParties.length} party jurisdictions:`, detectedParties);
    return detectedParties;
}
const DOCUMENT_PROMPTS = {
    nda: (situation, answers, jurisdiction) => `Draft a professional Non-Disclosure Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Type: ${answers.direction === 'mutual' ? 'Mutual NDA (both parties share confidential information)' : 'One-Way NDA (one party discloses to the other)'}
- Duration: ${answers.duration || '2'} years
- Purpose: ${answers.purpose || 'Business discussions'}
- Jurisdiction: ${jurisdiction}

Create a complete NDA with these sections:
1. PARTIES - Identify Disclosing Party and Receiving Party with [BRACKET] placeholders
2. RECITALS - Brief background explaining why parties are entering this agreement
3. DEFINITION OF CONFIDENTIAL INFORMATION - Comprehensive definition including documents, data, trade secrets, business information
4. EXCLUSIONS - Information that is NOT confidential (public knowledge, independently developed, etc.)
5. OBLIGATIONS OF RECEIVING PARTY - Duty to protect, limit use, restrict disclosure
6. PERMITTED DISCLOSURES - When disclosure is allowed (legal requirement, employees who need to know)
7. TERM AND TERMINATION - How long the agreement lasts, survival of confidentiality obligations
8. RETURN OF MATERIALS - Obligation to return or destroy confidential information
9. REMEDIES - Injunctive relief, damages for breach
10. GENERAL PROVISIONS - Governing law, entire agreement, amendments, severability

Use formal legal language. Include [BRACKETS] for all variable information like names, addresses, dates.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Non-Disclosure Agreement","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    service_agreement: (situation, answers, jurisdiction) => `Draft a professional Service Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Service Type: ${answers.service_type || 'Professional services'}
- Payment Structure: ${answers.payment === 'fixed' ? 'Fixed project fee' : answers.payment === 'hourly' ? 'Hourly rate' : answers.payment === 'milestone' ? 'Milestone-based payments' : 'Monthly retainer'}
- Duration: ${answers.duration === 'one-time' ? 'One-time project' : answers.duration === 'ongoing' ? 'Ongoing relationship' : 'Fixed term'}
- Jurisdiction: ${jurisdiction}

Create a complete Service Agreement with these sections:
1. PARTIES - Service Provider and Client with [BRACKET] placeholders
2. SERVICES - Detailed description of services to be provided
3. TERM - Start date, end date or ongoing terms, renewal provisions
4. COMPENSATION - Payment amount, schedule, invoicing, late payment terms
5. EXPENSES - Reimbursable expenses, approval process
6. INDEPENDENT CONTRACTOR STATUS - Clarify this is not employment
7. INTELLECTUAL PROPERTY - Who owns work product, pre-existing IP
8. CONFIDENTIALITY - Protection of client's confidential information
9. WARRANTIES - What the provider guarantees about their work
10. LIMITATION OF LIABILITY - Cap on damages, exclusion of consequential damages
11. TERMINATION - How either party can end the agreement, notice period
12. GENERAL PROVISIONS - Governing law, dispute resolution, amendments

Use clear, professional language. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Service Agreement","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    employment_contract: (situation, answers, jurisdiction) => `Draft a professional Employment Contract.

CONTEXT: ${situation}

SPECIFICATIONS:
- Employment Type: ${answers.employment_type || 'Full-time'}
- Position: ${answers.role || '[JOB TITLE]'}
- Benefits: ${answers.benefits || 'Standard benefits package'}
- Jurisdiction: ${jurisdiction}

Create a complete Employment Contract with these sections:
1. PARTIES - Employer and Employee with [BRACKET] placeholders
2. POSITION AND DUTIES - Job title, responsibilities, reporting structure
3. TERM OF EMPLOYMENT - Start date, at-will or fixed term, probationary period
4. COMPENSATION - Base salary, payment schedule, overtime (if applicable)
5. BENEFITS - Health insurance, retirement, paid time off, other benefits
6. WORKING HOURS - Standard hours, flexibility, remote work policy
7. CONFIDENTIALITY - Protection of employer's confidential information
8. INTELLECTUAL PROPERTY - Assignment of inventions and work product
9. NON-COMPETE (if applicable) - Restrictions on competing after employment
10. NON-SOLICITATION - Restrictions on soliciting employees or clients
11. TERMINATION - Notice requirements, grounds for termination, severance
12. GENERAL PROVISIONS - Governing law, entire agreement, amendments

Use formal employment law language appropriate for ${jurisdiction}. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Employment Contract","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    lease_agreement: (situation, answers, jurisdiction) => `Draft a professional Lease Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Property Type: ${answers.property_type || 'Residential property'}
- Lease Term: ${answers.lease_term || '1 year'}
- Furnished: ${answers.furnished || 'Unfurnished'}
- Jurisdiction: ${jurisdiction}

Create a complete Lease Agreement with these sections:
1. PARTIES - Landlord and Tenant with [BRACKET] placeholders
2. PROPERTY - Full address and description of the rental property
3. TERM - Lease start date, end date, renewal options
4. RENT - Monthly amount, due date, payment methods, late fees
5. SECURITY DEPOSIT - Amount, conditions for return, deductions
6. UTILITIES - Which utilities are included, tenant responsibilities
7. USE OF PROPERTY - Permitted uses, occupancy limits, guests
8. MAINTENANCE AND REPAIRS - Landlord vs tenant responsibilities
9. ALTERATIONS - Rules about modifications to the property
10. PETS - Pet policy, deposits, restrictions
11. INSURANCE - Renter's insurance requirements
12. ENTRY BY LANDLORD - Notice requirements for inspections
13. TERMINATION - Early termination, breach conditions, eviction process
14. MOVE-OUT - Condition requirements, cleaning, key return
15. GENERAL PROVISIONS - Governing law, notices, amendments

Use standard residential lease language for ${jurisdiction}. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Residential Lease Agreement","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    sales_agreement: (situation, answers, jurisdiction) => `Draft a professional Sales Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Jurisdiction: ${jurisdiction}

Create a complete Sales Agreement with these sections:
1. PARTIES - Seller and Buyer with [BRACKET] placeholders
2. GOODS/PRODUCTS - Detailed description of items being sold
3. PURCHASE PRICE - Total price, currency, price breakdown if applicable
4. PAYMENT TERMS - Payment schedule, methods, deposits
5. DELIVERY - Delivery date, location, shipping terms, risk of loss
6. INSPECTION AND ACCEPTANCE - Buyer's right to inspect, acceptance criteria
7. WARRANTIES - Seller's warranties about the goods, disclaimers
8. TITLE AND OWNERSHIP - When title transfers to buyer
9. RISK OF LOSS - When risk transfers to buyer
10. RETURNS AND REFUNDS - Return policy, restocking fees
11. LIMITATION OF LIABILITY - Cap on seller's liability
12. DISPUTE RESOLUTION - How disputes will be resolved
13. GENERAL PROVISIONS - Governing law, entire agreement, amendments

Use commercial sales language appropriate for ${jurisdiction}. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Sales Agreement","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    partnership_agreement: (situation, answers, jurisdiction) => `Draft a professional Partnership Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Jurisdiction: ${jurisdiction}

Create a complete Partnership Agreement with these sections:
1. PARTIES - All partners with [BRACKET] placeholders
2. PARTNERSHIP NAME AND PURPOSE - Business name, objectives, scope
3. TERM - Duration of partnership, start date
4. CAPITAL CONTRIBUTIONS - Initial contributions from each partner
5. PROFIT AND LOSS SHARING - How profits/losses are divided
6. MANAGEMENT AND VOTING - Decision-making authority, voting rights
7. PARTNER DUTIES - Time commitment, fiduciary duties, non-compete
8. COMPENSATION - Salaries, draws, expense reimbursement
9. BANKING AND ACCOUNTING - Bank accounts, fiscal year, record keeping
10. ADMISSION OF NEW PARTNERS - Process for adding partners
11. WITHDRAWAL OF PARTNER - Voluntary withdrawal, buyout terms
12. DEATH OR DISABILITY - What happens if a partner dies or becomes disabled
13. DISSOLUTION - When and how the partnership can be dissolved
14. DISPUTE RESOLUTION - How partner disputes will be handled
15. GENERAL PROVISIONS - Governing law, amendments, notices

Use partnership law language appropriate for ${jurisdiction}. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Partnership Agreement","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    loan_agreement: (situation, answers, jurisdiction) => `Draft a professional Loan Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Jurisdiction: ${jurisdiction}

Create a complete Loan Agreement with these sections:
1. PARTIES - Lender and Borrower with [BRACKET] placeholders
2. LOAN AMOUNT - Principal amount being loaned
3. INTEREST RATE - Annual percentage rate, how interest accrues
4. REPAYMENT TERMS - Payment schedule, due dates, payment amounts
5. PREPAYMENT - Rights to pay early, any prepayment penalties
6. LATE PAYMENTS - Late fees, grace period
7. SECURITY/COLLATERAL (if applicable) - Assets securing the loan
8. USE OF FUNDS - Permitted uses for the loan proceeds
9. REPRESENTATIONS AND WARRANTIES - Borrower's promises
10. COVENANTS - Ongoing obligations of borrower
11. EVENTS OF DEFAULT - What constitutes default
12. REMEDIES - Lender's rights upon default, acceleration
13. GENERAL PROVISIONS - Governing law, notices, amendments

Use lending/finance language appropriate for ${jurisdiction}. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Loan Agreement","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    release_waiver: (situation, answers, jurisdiction) => `Draft a professional Release and Waiver of Liability.

CONTEXT: ${situation}

SPECIFICATIONS:
- Jurisdiction: ${jurisdiction}

Create a complete Release and Waiver with these sections:
1. PARTIES - Releasor (person giving up rights) and Releasee (person being released)
2. RECITALS - Background explaining the situation and reason for release
3. RELEASE OF CLAIMS - Comprehensive release of all claims, known and unknown
4. WAIVER OF LIABILITY - Waiver of right to sue for specified activities
5. ASSUMPTION OF RISK - Acknowledgment of risks involved
6. INDEMNIFICATION - Agreement to hold harmless and indemnify
7. COVENANT NOT TO SUE - Promise not to bring legal action
8. SCOPE OF RELEASE - What is and is not covered
9. CONSIDERATION - What the releasor receives in exchange
10. REPRESENTATIONS - Releasor's acknowledgments and promises
11. GENERAL PROVISIONS - Governing law, severability, entire agreement

Use liability release language appropriate for ${jurisdiction}. Make clear and unambiguous. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Release and Waiver of Liability","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    cease_desist: (situation, answers, jurisdiction) => `Draft a professional Cease and Desist Letter.

CONTEXT: ${situation}

SPECIFICATIONS:
- Jurisdiction: ${jurisdiction}

Create a complete Cease and Desist Letter with these sections:
1. HEADER - Date, recipient name and address
2. RE LINE - Subject matter (e.g., "Cease and Desist: [Description of Violation]")
3. INTRODUCTION - Identify sender and their rights/interests
4. STATEMENT OF FACTS - Describe the infringing/harmful conduct in detail
5. LEGAL BASIS - Cite relevant laws, rights, or contractual provisions being violated
6. DEMAND TO CEASE - Clear demand to immediately stop the conduct
7. DEMAND TO DESIST - Demand to not engage in such conduct in the future
8. REMEDIAL ACTIONS - Any corrective actions required (removal, destruction, etc.)
9. DEADLINE - Specific date by which compliance is required
10. CONSEQUENCES - Warning of legal action if demands are not met
11. CLOSING - Professional closing with contact information

Use firm but professional language. Be specific about the violations. Include [BRACKETS] for variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Cease and Desist Letter","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    power_of_attorney: (situation, answers, jurisdiction) => `Draft a professional Power of Attorney document.

CONTEXT: ${situation}

SPECIFICATIONS:
- Jurisdiction: ${jurisdiction}

Create a complete Power of Attorney with these sections:
1. DECLARATION - Statement that this is a Power of Attorney
2. PRINCIPAL - Person granting the power, with [BRACKET] placeholders
3. AGENT/ATTORNEY-IN-FACT - Person receiving the power
4. POWERS GRANTED - Specific powers being delegated (financial, healthcare, legal, etc.)
5. LIMITATIONS - Any restrictions on the agent's authority
6. EFFECTIVE DATE - When the POA becomes effective (immediately or upon incapacity)
7. DURATION - How long the POA remains in effect
8. SUCCESSOR AGENTS - Backup agents if primary is unavailable
9. COMPENSATION - Whether agent will be compensated
10. THIRD PARTY RELIANCE - Protection for third parties who rely on this POA
11. REVOCATION - How the principal can revoke the POA
12. GOVERNING LAW - Which jurisdiction's laws apply
13. SIGNATURE BLOCK - Spaces for principal, witnesses, notary

Use Power of Attorney language appropriate for ${jurisdiction}. Follow state-specific requirements. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"Power of Attorney","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
    unknown: (situation, answers, jurisdiction) => `Draft a professional legal document based on the user's needs.

CONTEXT: ${situation}

ADDITIONAL DETAILS:
- Purpose: ${answers.document_purpose || 'As described above'}
- Parties: ${answers.parties || 'To be specified'}
- Key Terms: ${answers.key_terms || 'As appropriate'}
- Jurisdiction: ${jurisdiction}

Create a comprehensive legal document with appropriate sections for this type of agreement. Include:
1. PARTIES - All parties involved with [BRACKET] placeholders
2. RECITALS/BACKGROUND - Context for the agreement
3. DEFINITIONS - Key terms used in the document
4. MAIN TERMS - The core provisions based on the purpose
5. OBLIGATIONS - What each party must do
6. TERM AND TERMINATION - Duration and how to end the agreement
7. REPRESENTATIONS AND WARRANTIES - Promises by each party
8. LIMITATION OF LIABILITY - Limits on damages
9. DISPUTE RESOLUTION - How disputes will be handled
10. GENERAL PROVISIONS - Governing law, notices, amendments, severability

Use professional legal language appropriate for ${jurisdiction}. Include [BRACKETS] for all variable information.

OUTPUT FORMAT - Return ONLY valid JSON:
{"title":"[Appropriate Document Title]","sections":[{"title":"SECTION NAME","content":"Full section text..."}]}`,
};
async function detectDocumentType(situation) {
    console.log(`[NAVIGATOR] Detecting document type with ${FAST_MODEL}`);
    const prompt = `You are a legal document classifier. Based on the user's description, determine what type of legal document they need.

USER'S SITUATION:
${situation}

AVAILABLE DOCUMENT TYPES:
${Object.entries(exports.DOCUMENT_TYPES).map(([key, val]) => `- ${key}: ${val.name} - ${val.description}`).join('\n')}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "documentType": "the_document_type_key",
  "confidence": "high" | "medium" | "low",
  "reasoning": "Brief explanation of why this document type was chosen"
}

If the situation doesn't clearly match any document type, use "unknown" as the documentType.`;
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: FAST_MODEL,
                prompt: '/no_think\n' + prompt,
                stream: false,
                think: false,
                options: {
                    temperature: 0.1,
                    num_predict: 256,
                },
            }),
            dispatcher: llmAgent,
        });
        if (!response.ok) {
            throw new Error(`Ollama returned ${response.status}`);
        }
        const data = await response.json();
        const jsonMatch = data.response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.warn('[NAVIGATOR] Could not parse JSON from response, using fallback detection');
            return fallbackDetection(situation);
        }
        const parsed = JSON.parse(jsonMatch[0]);
        const docType = parsed.documentType;
        const docInfo = exports.DOCUMENT_TYPES[docType];
        const detectedParties = detectPartyJurisdictions(situation);
        const jurisdictionResult = (0, mandatoryTerms_1.autoDetectJurisdictionForCreation)(situation);
        const detectedJurisdiction = jurisdictionResult.jurisdiction ? {
            code: jurisdictionResult.jurisdiction,
            name: (0, mandatoryTerms_1.getJurisdictionName)(jurisdictionResult.jurisdiction),
            confidence: jurisdictionResult.confidence,
            reason: jurisdictionResult.reason,
            needsConfirmation: jurisdictionResult.needsConfirmation,
        } : undefined;
        if (detectedJurisdiction) {
            console.log(`[NAVIGATOR] Auto-detected jurisdiction: ${detectedJurisdiction.code} (${detectedJurisdiction.confidence})`);
        }
        return {
            documentType: docType,
            confidence: parsed.confidence || 'medium',
            name: docInfo?.name || 'Custom Document',
            description: docInfo?.description || 'A document tailored to your needs',
            reasoning: parsed.reasoning || '',
            detectedParties,
            detectedJurisdiction,
        };
    }
    catch (error) {
        console.error('[NAVIGATOR] Document type detection failed:', error);
        const detectedParties = detectPartyJurisdictions(situation);
        const jurisdictionResult = (0, mandatoryTerms_1.autoDetectJurisdictionForCreation)(situation);
        const detectedJurisdiction = jurisdictionResult.jurisdiction ? {
            code: jurisdictionResult.jurisdiction,
            name: (0, mandatoryTerms_1.getJurisdictionName)(jurisdictionResult.jurisdiction),
            confidence: jurisdictionResult.confidence,
            reason: jurisdictionResult.reason,
            needsConfirmation: jurisdictionResult.needsConfirmation,
        } : undefined;
        const fallback = fallbackDetection(situation);
        return { ...fallback, detectedParties, detectedJurisdiction };
    }
}
function fallbackDetection(situation) {
    const lowerSituation = situation.toLowerCase();
    for (const [key, config] of Object.entries(exports.DOCUMENT_TYPES)) {
        const matchCount = config.keywords.filter(kw => lowerSituation.includes(kw)).length;
        if (matchCount >= 2) {
            return {
                documentType: key,
                confidence: 'medium',
                name: config.name,
                description: config.description,
                reasoning: 'Detected based on keywords in your description',
            };
        }
    }
    return {
        documentType: 'unknown',
        confidence: 'low',
        name: 'Custom Document',
        description: 'We\'ll help you create a document based on your specific needs',
        reasoning: 'Could not determine specific document type - will ask clarifying questions',
    };
}
async function generateDynamicQuestions(documentType, situation, language, jurisdiction) {
    console.log(`[NAVIGATOR] Generating dynamic questions with ${FAST_MODEL}`);
    const docInfo = exports.DOCUMENT_TYPES[documentType];
    const documentName = docInfo?.name || 'legal document';
    const languageInstructions = {
        en: 'Write questions in English.',
        de: 'Write questions in German (Deutsch).',
        fr: 'Write questions in French (Français).',
        es: 'Write questions in Spanish (Español).',
    };
    const prompt = `You are a legal document assistant. Generate 3-5 relevant follow-up questions to gather information needed to draft a ${documentName}.

USER'S SITUATION:
${situation}

DOCUMENT TYPE: ${documentType}
JURISDICTION: ${jurisdiction}
${languageInstructions[language] || languageInstructions.en}

Based on the user's specific situation, generate questions that:
1. Gather essential legal elements for this type of document
2. Are relevant to their specific context (don't ask about things they already mentioned)
3. Cover parties, key terms, duration, and jurisdiction-specific requirements
4. Are clear and easy to understand

IMPORTANT: Each question should have a type:
- "select": Multiple choice with predefined options (best for common choices)
- "text": Free text input (best for unique information)
- "multiselect": Multiple selections allowed (best for optional features)

Return ONLY a JSON array (no markdown, no explanation):
[
  {
    "id": "unique_id",
    "question": "The question text",
    "type": "select" | "text" | "multiselect",
    "options": [{"value": "option_key", "label": "Display text"}],
    "required": true | false
  }
]

For "text" type questions, omit the "options" field.`;
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: FAST_MODEL,
                prompt: '/no_think\n' + prompt,
                stream: false,
                think: false,
                options: {
                    temperature: 0.3,
                    num_predict: 1024,
                },
            }),
            dispatcher: llmAgent,
        });
        if (!response.ok) {
            throw new Error(`Ollama returned ${response.status}`);
        }
        const data = await response.json();
        const jsonMatch = data.response.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.warn('[NAVIGATOR] Could not parse questions array from AI response');
            return [];
        }
        const sanitizedJson = sanitizeJsonString(jsonMatch[0]);
        const parsed = JSON.parse(sanitizedJson);
        const validQuestions = parsed
            .filter(q => q.id && q.question && q.type)
            .map(q => ({
            id: String(q.id),
            question: String(q.question),
            type: ['select', 'text', 'multiselect'].includes(q.type) ? q.type : 'text',
            options: q.type !== 'text' && Array.isArray(q.options) ? q.options : undefined,
            required: Boolean(q.required),
        }));
        return validQuestions;
    }
    catch (error) {
        console.error('[NAVIGATOR] Dynamic question generation failed:', error);
        throw error;
    }
}
async function generateQuestions(documentType, situation, options = {}) {
    const { language = 'en', jurisdiction = 'US' } = options;
    try {
        const aiQuestions = await generateDynamicQuestions(documentType, situation, language, jurisdiction);
        if (aiQuestions && aiQuestions.length > 0) {
            console.log(`[NAVIGATOR] Generated ${aiQuestions.length} dynamic questions`);
            return aiQuestions;
        }
    }
    catch (error) {
        console.warn('[NAVIGATOR] Dynamic question generation failed, using templates:', error);
    }
    const questionTemplates = {
        nda: [
            {
                id: 'direction',
                question: 'Who needs to keep information confidential?',
                type: 'select',
                options: [
                    { value: 'one-way', label: 'One party only (you\'re sharing information)' },
                    { value: 'mutual', label: 'Both parties (mutual exchange)' },
                ],
                required: true,
            },
            {
                id: 'duration',
                question: 'How long should the confidentiality last?',
                type: 'select',
                options: [
                    { value: '1', label: '1 year' },
                    { value: '2', label: '2 years' },
                    { value: '3', label: '3 years' },
                    { value: '5', label: '5 years' },
                    { value: 'perpetual', label: 'Indefinitely' },
                ],
                required: true,
            },
            {
                id: 'purpose',
                question: 'What is the purpose of sharing this information?',
                type: 'text',
                required: false,
            },
        ],
        service_agreement: [
            {
                id: 'service_type',
                question: 'What type of services will be provided?',
                type: 'text',
                required: true,
            },
            {
                id: 'payment',
                question: 'How will payment be structured?',
                type: 'select',
                options: [
                    { value: 'fixed', label: 'Fixed project fee' },
                    { value: 'hourly', label: 'Hourly rate' },
                    { value: 'milestone', label: 'Milestone-based payments' },
                    { value: 'retainer', label: 'Monthly retainer' },
                ],
                required: true,
            },
            {
                id: 'duration',
                question: 'What is the expected duration?',
                type: 'select',
                options: [
                    { value: 'one-time', label: 'One-time project' },
                    { value: 'ongoing', label: 'Ongoing relationship' },
                    { value: 'fixed-term', label: 'Fixed term (e.g., 6 months)' },
                ],
                required: true,
            },
        ],
        employment_contract: [
            {
                id: 'employment_type',
                question: 'What type of employment?',
                type: 'select',
                options: [
                    { value: 'full-time', label: 'Full-time' },
                    { value: 'part-time', label: 'Part-time' },
                    { value: 'fixed-term', label: 'Fixed-term contract' },
                    { value: 'probation', label: 'Probationary period' },
                ],
                required: true,
            },
            {
                id: 'role',
                question: 'What is the job title/role?',
                type: 'text',
                required: true,
            },
            {
                id: 'benefits',
                question: 'Which benefits should be included?',
                type: 'multiselect',
                options: [
                    { value: 'health', label: 'Health insurance' },
                    { value: 'vacation', label: 'Paid vacation' },
                    { value: 'remote', label: 'Remote work option' },
                    { value: 'bonus', label: 'Performance bonus' },
                ],
                required: false,
            },
        ],
        lease_agreement: [
            {
                id: 'property_type',
                question: 'What type of property?',
                type: 'select',
                options: [
                    { value: 'apartment', label: 'Apartment' },
                    { value: 'house', label: 'House' },
                    { value: 'room', label: 'Room' },
                    { value: 'commercial', label: 'Commercial space' },
                ],
                required: true,
            },
            {
                id: 'lease_term',
                question: 'What is the lease duration?',
                type: 'select',
                options: [
                    { value: '6-months', label: '6 months' },
                    { value: '1-year', label: '1 year' },
                    { value: '2-years', label: '2 years' },
                    { value: 'month-to-month', label: 'Month-to-month' },
                ],
                required: true,
            },
            {
                id: 'furnished',
                question: 'Is the property furnished?',
                type: 'select',
                options: [
                    { value: 'furnished', label: 'Furnished' },
                    { value: 'unfurnished', label: 'Unfurnished' },
                    { value: 'partially', label: 'Partially furnished' },
                ],
                required: true,
            },
        ],
        unknown: [
            {
                id: 'document_purpose',
                question: 'What is the main purpose of this document?',
                type: 'text',
                required: true,
            },
            {
                id: 'parties',
                question: 'Who are the parties involved?',
                type: 'text',
                required: true,
            },
            {
                id: 'key_terms',
                question: 'What are the most important terms to include?',
                type: 'text',
                required: false,
            },
        ],
    };
    return questionTemplates[documentType] || questionTemplates.unknown;
}
function buildFirmMemoryContext(style, clauses) {
    const sections = [];
    if (style) {
        sections.push(`FIRM WRITING STYLE (Based on your firm's historical patterns):
- Formality level: ${style.formalityLevel >= 0.7 ? 'Formal' : style.formalityLevel >= 0.4 ? 'Moderate' : 'Casual'}
- Target sentence length: ~${Math.round(style.avgSentenceLength)} words
- Numbering style: ${style.numberingStyle}
- Heading style: ${style.headingStyle}`);
        const preferredTerms = Object.entries(style.preferredTerms);
        if (preferredTerms.length > 0) {
            sections.push(`PREFERRED TERMINOLOGY (Use these terms):
${preferredTerms.slice(0, 10).map(([term, replacement]) => `- Use "${replacement}" instead of generic terms for "${term}"`).join('\n')}`);
        }
        if (style.avoidedTerms.length > 0) {
            sections.push(`TERMS TO AVOID:
${style.avoidedTerms.slice(0, 10).map(term => `- Avoid using "${term}"`).join('\n')}`);
        }
        if (style.industryTerms.length > 0) {
            sections.push(`INDUSTRY-SPECIFIC TERMS (Include where appropriate):
${style.industryTerms.slice(0, 10).map(term => `- ${term}`).join('\n')}`);
        }
    }
    if (clauses.size > 0) {
        const clauseExamples = [];
        for (const [key, pref] of clauses) {
            if (pref.confidence >= 0.5) {
                clauseExamples.push(`${key.toUpperCase()}:
Preferred phrasing: "${pref.preferredText.substring(0, 200)}${pref.preferredText.length > 200 ? '...' : ''}"`);
                if (pref.avoidList.length > 0) {
                    clauseExamples.push(`  Avoid: ${pref.avoidList.slice(0, 3).join(', ')}`);
                }
            }
        }
        if (clauseExamples.length > 0) {
            sections.push(`FIRM CLAUSE PREFERENCES (Based on your firm's historical patterns):
${clauseExamples.slice(0, 5).join('\n\n')}`);
        }
    }
    if (sections.length === 0) {
        return '';
    }
    return `\n\n=== YOUR FIRM'S PATTERNS ===
The following patterns are based on your firm's historical document analysis. Apply these consistently:

${sections.join('\n\n')}

=== END FIRM PATTERNS ===\n`;
}
async function draftDocumentStream(documentType, situation, answers, jurisdiction = 'US', language = 'en', organizationId, onChunk, thinkingBudget = 1) {
    console.log(`[NAVIGATOR] Drafting ${documentType} document with ${FULL_MODEL} (lang: ${language}, streaming: ${!!onChunk}, thinking: ${thinkingBudget})`);
    const languageInstructions = {
        en: 'Write the document in English.',
        de: 'Schreibe das Dokument auf Deutsch. Verwende deutsche Rechtsbegriffe.',
        fr: 'Rédigez le document en français. Utilisez la terminologie juridique française.',
        es: 'Redacte el documento en español. Utilice la terminología jurídica española.',
    };
    const langInstruction = languageInstructions[language] || languageInstructions.en;
    const promptGenerator = DOCUMENT_PROMPTS[documentType] || DOCUMENT_PROMPTS.unknown;
    const basePrompt = promptGenerator(situation, answers, jurisdiction);
    let ragClauseContext = '';
    try {
        ragClauseContext = await getRAGClauseContext(documentType, jurisdiction);
        if (ragClauseContext) {
            console.log(`[NAVIGATOR] Applied RAG clause context for ${documentType}`);
        }
    }
    catch (error) {
        console.warn('[NAVIGATOR] Failed to fetch RAG context, continuing without:', error);
    }
    let firmMemoryContext = '';
    if (organizationId) {
        try {
            const relevantClauseTypes = getRelevantClauseTypes(documentType);
            const { style, clauses, hasFirmMemory } = await (0, firmMemoryService_1.getDraftingContext)(organizationId, relevantClauseTypes);
            if (hasFirmMemory) {
                firmMemoryContext = buildFirmMemoryContext(style, clauses);
                console.log(`[NAVIGATOR] Applied firm memory patterns (${clauses.size} clause preferences, style: ${style ? 'yes' : 'no'})`);
            }
        }
        catch (error) {
            console.warn('[NAVIGATOR] Failed to fetch firm memory, continuing without:', error);
        }
    }
    const jurisdictionContext = getJurisdictionContext(jurisdiction);
    let mandatoryTermsContext = '';
    try {
        const mandatoryTerms = (0, mandatoryTerms_1.getMandatoryTermsFor)(jurisdiction, documentType);
        if (mandatoryTerms.length > 0) {
            const termsForPrompt = mandatoryTerms
                .filter(t => t.requirement === 'mandatory')
                .map(t => `- ${t.statuteRef}: ${t.description}${t.defaultText ? ` (Example: "${t.defaultText}")` : ''}`)
                .join('\n');
            if (termsForPrompt) {
                mandatoryTermsContext = `\n\n## MANDATORY LEGAL REQUIREMENTS (${jurisdiction})
The following requirements MUST be included in this document:
${termsForPrompt}

Ensure each of these requirements is addressed in the appropriate section.\n`;
                console.log(`[NAVIGATOR] Added ${mandatoryTerms.filter(t => t.requirement === 'mandatory').length} mandatory terms for ${jurisdiction} (streaming)`);
            }
        }
    }
    catch (error) {
        console.warn('[NAVIGATOR] Failed to fetch mandatory terms:', error);
    }
    const prompt = `CRITICAL JURISDICTION REQUIREMENT: ${jurisdictionContext}
You MUST draft this document to comply ONLY with ${jurisdiction} law. Do NOT use legal concepts or requirements from other jurisdictions.
${mandatoryTermsContext}
${langInstruction}${ragClauseContext}${firmMemoryContext}\n\n${basePrompt}`;
    try {
        if (onChunk) {
            const response = await fetch(`${OLLAMA_URL}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: FULL_MODEL,
                    prompt: thinkingBudget === 0 ? '/no_think\n' + prompt : prompt,
                    stream: true,
                    think: thinkingBudget > 0,
                    options: {
                        temperature: 0.3,
                        num_predict: 4096,
                        top_p: 0.9,
                    },
                }),
                dispatcher: llmAgent,
            });
            if (!response.ok) {
                throw new Error(`Ollama returned ${response.status}`);
            }
            let fullResponse = '';
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split('\n').filter(l => l.trim());
                    for (const line of lines) {
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.response) {
                                fullResponse += parsed.response;
                                onChunk(parsed.response);
                            }
                        }
                        catch {
                        }
                    }
                }
            }
            try {
                const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const sanitizedJson = sanitizeJsonString(jsonMatch[0]);
                    const parsed = JSON.parse(sanitizedJson);
                    if (parsed.title && parsed.sections && Array.isArray(parsed.sections)) {
                        return {
                            title: parsed.title,
                            sections: parsed.sections,
                        };
                    }
                }
            }
            catch (parseError) {
                console.warn('[NAVIGATOR] Could not parse JSON from streamed response, returning raw');
            }
            return {
                title: 'Generated Document',
                sections: [{ title: 'Document', content: fullResponse }],
            };
        }
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: FULL_MODEL,
                prompt: '/no_think\n' + prompt,
                stream: false,
                think: false,
                options: {
                    temperature: 0.3,
                    num_predict: 4096,
                    top_p: 0.9,
                },
            }),
            dispatcher: llmAgent,
        });
        if (!response.ok) {
            throw new Error(`Ollama returned ${response.status}`);
        }
        const data = await response.json();
        const jsonMatch = data.response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Could not parse document from response');
        }
        const sanitizedJson = sanitizeJsonString(jsonMatch[0]);
        const parsed = JSON.parse(sanitizedJson);
        if (!parsed.title || !parsed.sections || !Array.isArray(parsed.sections)) {
            throw new Error('Invalid document structure');
        }
        return {
            title: parsed.title,
            sections: parsed.sections,
        };
    }
    catch (error) {
        console.error('[NAVIGATOR] Document drafting failed:', error);
        throw error;
    }
}
async function draftDocument(documentType, situation, answers, jurisdiction = 'US', language = 'en', organizationId) {
    console.log(`[NAVIGATOR] Drafting ${documentType} document with ${FULL_MODEL} (lang: ${language})`);
    const languageInstructions = {
        en: 'Write the document in English.',
        de: 'Schreibe das Dokument auf Deutsch. Verwende deutsche Rechtsbegriffe.',
        fr: 'Rédigez le document en français. Utilisez la terminologie juridique française.',
        es: 'Redacte el documento en español. Utilice la terminología jurídica española.',
    };
    const langInstruction = languageInstructions[language] || languageInstructions.en;
    const promptGenerator = DOCUMENT_PROMPTS[documentType] || DOCUMENT_PROMPTS.unknown;
    const basePrompt = promptGenerator(situation, answers, jurisdiction);
    let ragClauseContext = '';
    try {
        ragClauseContext = await getRAGClauseContext(documentType, jurisdiction);
        if (ragClauseContext) {
            console.log(`[NAVIGATOR] Applied RAG clause context for ${documentType}`);
        }
    }
    catch (error) {
        console.warn('[NAVIGATOR] Failed to fetch RAG context, continuing without:', error);
    }
    let firmMemoryContext = '';
    if (organizationId) {
        try {
            const relevantClauseTypes = getRelevantClauseTypes(documentType);
            const { style, clauses, hasFirmMemory } = await (0, firmMemoryService_1.getDraftingContext)(organizationId, relevantClauseTypes);
            if (hasFirmMemory) {
                firmMemoryContext = buildFirmMemoryContext(style, clauses);
                console.log(`[NAVIGATOR] Applied firm memory patterns (${clauses.size} clause preferences, style: ${style ? 'yes' : 'no'})`);
            }
        }
        catch (error) {
            console.warn('[NAVIGATOR] Failed to fetch firm memory, continuing without:', error);
        }
    }
    const jurisdictionContext = getJurisdictionContext(jurisdiction);
    let mandatoryTermsContext = '';
    try {
        const mandatoryTerms = (0, mandatoryTerms_1.getMandatoryTermsFor)(jurisdiction, documentType);
        if (mandatoryTerms.length > 0) {
            const termsForPrompt = mandatoryTerms
                .filter(t => t.requirement === 'mandatory')
                .map(t => `- ${t.statuteRef}: ${t.description}${t.defaultText ? ` (Example: "${t.defaultText}")` : ''}`)
                .join('\n');
            if (termsForPrompt) {
                mandatoryTermsContext = `\n\n## MANDATORY LEGAL REQUIREMENTS (${jurisdiction})
The following requirements MUST be included in this document:
${termsForPrompt}

Ensure each of these requirements is addressed in the appropriate section.\n`;
                console.log(`[NAVIGATOR] Added ${mandatoryTerms.filter(t => t.requirement === 'mandatory').length} mandatory terms for ${jurisdiction}`);
            }
        }
    }
    catch (error) {
        console.warn('[NAVIGATOR] Failed to fetch mandatory terms:', error);
    }
    const prompt = `CRITICAL JURISDICTION REQUIREMENT: ${jurisdictionContext}
You MUST draft this document to comply ONLY with ${jurisdiction} law. Do NOT use legal concepts or requirements from other jurisdictions.
${mandatoryTermsContext}
${langInstruction}${ragClauseContext}${firmMemoryContext}\n\n${basePrompt}`;
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: FULL_MODEL,
                prompt: '/no_think\n' + prompt,
                stream: false,
                think: false,
                options: {
                    temperature: 0.3,
                    num_predict: 4096,
                    top_p: 0.9,
                },
            }),
            dispatcher: llmAgent,
        });
        if (!response.ok) {
            throw new Error(`Ollama returned ${response.status}`);
        }
        const data = await response.json();
        const jsonMatch = data.response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error('Could not parse document from response');
        }
        const sanitizedJson = sanitizeJsonString(jsonMatch[0]);
        const parsed = JSON.parse(sanitizedJson);
        if (!parsed.title || !parsed.sections || !Array.isArray(parsed.sections)) {
            throw new Error('Invalid document structure');
        }
        return {
            title: parsed.title,
            sections: parsed.sections,
        };
    }
    catch (error) {
        console.error('[NAVIGATOR] Document drafting failed:', error);
        throw error;
    }
}
async function getRAGClauseContext(documentType, jurisdiction) {
    try {
        const centralEuropeanJurisdictions = ['AT', 'SK', 'EU', 'DE', 'CH'];
        const isCentralEuropean = centralEuropeanJurisdictions.includes(jurisdiction.toUpperCase());
        const searchQuery = `${documentType.replace(/_/g, ' ')} ${jurisdiction}`;
        let results;
        if (isCentralEuropean) {
            const { search } = await Promise.resolve().then(() => __importStar(require('./rag/retrieval')));
            results = await search(searchQuery, {
                sourceTypes: ['legislation', 'jurisdiction_kb'],
                jurisdiction,
                limit: 5,
            });
            if (results.length === 0) {
                results = await (0, rag_1.searchClauses)(searchQuery, {
                    jurisdiction,
                    documentType,
                    limit: 5,
                });
            }
        }
        else {
            results = await (0, rag_1.searchClauses)(searchQuery, {
                jurisdiction,
                documentType,
                limit: 5,
            });
        }
        if (results.length === 0) {
            return '';
        }
        const isLegislation = isCentralEuropean && results.some(r => r.sourceName?.toLowerCase().includes('gesetz') ||
            r.sourceName?.toLowerCase().includes('zákon') ||
            r.sourceName?.toLowerCase().includes('verordnung'));
        const header = isLegislation
            ? '=== APPLICABLE LEGISLATION ==='
            : '=== REFERENCE CLAUSE TEMPLATES ===';
        const description = isLegislation
            ? `The following are excerpts from ${jurisdiction} legislation. Your drafted document MUST comply with these legal requirements:`
            : 'The following are vetted clause templates from our legal library. Use these as reference for proper legal language and structure:';
        const clauseExamples = results.map((r, idx) => {
            return `[${idx + 1}] ${r.sourceName}${r.clauseType ? ` (${r.clauseType})` : ''}:
${r.content.substring(0, 500)}${r.content.length > 500 ? '...' : ''}`;
        });
        return `\n\n${header}
${description}

${clauseExamples.join('\n\n')}

=== END ${isLegislation ? 'LEGISLATION' : 'REFERENCE TEMPLATES'} ===\n`;
    }
    catch (error) {
        console.warn('[NAVIGATOR] Failed to fetch RAG clause context:', error);
        return '';
    }
}
function getRelevantClauseTypes(documentType) {
    const clauseTypeMap = {
        nda: ['confidentiality', 'termination', 'governing_law', 'entire_agreement', 'severability'],
        service_agreement: ['payment', 'termination', 'intellectual_property', 'limitation_of_liability', 'confidentiality', 'warranty', 'governing_law'],
        employment_contract: ['termination', 'confidentiality', 'intellectual_property', 'governing_law', 'severability', 'notice'],
        lease_agreement: ['termination', 'payment', 'notice', 'governing_law', 'severability'],
        sales_agreement: ['payment', 'warranty', 'limitation_of_liability', 'termination', 'governing_law'],
        partnership_agreement: ['termination', 'governing_law', 'notice', 'severability', 'entire_agreement'],
        loan_agreement: ['payment', 'termination', 'governing_law', 'notice', 'severability'],
        release_waiver: ['indemnification', 'limitation_of_liability', 'governing_law', 'entire_agreement', 'severability'],
        cease_desist: ['notice', 'governing_law'],
        power_of_attorney: ['termination', 'notice', 'governing_law', 'severability'],
        unknown: ['termination', 'confidentiality', 'governing_law', 'limitation_of_liability', 'severability'],
    };
    return clauseTypeMap[documentType] || clauseTypeMap.unknown;
}
function getJurisdictionContext(jurisdiction) {
    const contexts = {
        US: 'This document should comply with US law. Include standard US legal terminology.',
        UK: 'This document should comply with UK law (England and Wales). Use UK legal terminology.',
        DE: 'This document should comply with German law (BGB, HGB). Include German legal references where appropriate.',
        AT: 'This document should comply with Austrian law (ABGB). Include Austrian legal references.',
        CH: 'This document should comply with Swiss law (OR, ZGB). Include Swiss legal references.',
        EU: 'This document should comply with EU regulations. Reference relevant EU directives where applicable.',
        FR: 'This document should comply with French law (Code civil). Use French legal terminology.',
        CA: 'This document should comply with Canadian law. Consider both federal and provincial requirements.',
        AU: 'This document should comply with Australian law. Include relevant Australian legal references.',
    };
    return contexts[jurisdiction] || `This document should comply with ${jurisdiction} law.`;
}
//# sourceMappingURL=navigatorService.js.map