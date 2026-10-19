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
const FAST_MODEL = process.env.OLLAMA_MODEL_FAST || 'qwen3:8b';
const FULL_MODEL = process.env.OLLAMA_MODEL || 'qwen3:14b';
const OLLAMA_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_FALLBACK_URL = process.env.OLLAMA_FALLBACK_URL ? `http://${process.env.OLLAMA_FALLBACK_URL}` : null;
// Helper: OpenRouter primary, Ollama fallback
async function openRouterGenerate(payload, timeoutMs = 60000) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'qwen/qwen3.5-9b';
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');
    const messages = [{ role: 'user', content: payload.prompt }];
    if (payload.system) messages.unshift({ role: 'system', content: payload.system });
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
            model, messages,
            temperature: payload.options?.temperature ?? 0,
            max_tokens: payload.options?.num_predict ?? 2048,
            reasoning: { effort: 'none' },
            provider: { order: ['Together', 'Venice'], allow_fallbacks: true },
        }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${data.error?.message || response.statusText}`);
    const text = data.choices?.[0]?.message?.content || '';
    if (!text) throw new Error('OpenRouter empty response');
    return { response: text };
}
async function ollamaGenerate(payload, timeoutMs = 60000) {
    // Try OpenRouter first
    if (process.env.OPENROUTER_API_KEY) {
        try {
            return await openRouterGenerate(payload, timeoutMs);
        } catch (orErr) {
            console.warn(`[NAVIGATOR] OpenRouter failed (${orErr.message}), falling back to Ollama`);
        }
    }
    // Fallback: Ollama
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
            dispatcher: llmAgent,
        });
        clearTimeout(timer);
        if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
        return await response.json();
    } catch (primaryErr) {
        clearTimeout(timer);
        if (OLLAMA_FALLBACK_URL && OLLAMA_FALLBACK_URL !== `http://${OLLAMA_URL.replace('http://', '')}`) {
            console.log(`[NAVIGATOR] Primary Ollama failed (${primaryErr.message}), trying fallback...`);
            const fbController = new AbortController();
            const fbTimer = setTimeout(() => fbController.abort(), 120000);
            try {
                const response = await fetch(`${OLLAMA_FALLBACK_URL}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: fbController.signal,
                    dispatcher: llmAgent,
                });
                clearTimeout(fbTimer);
                if (!response.ok) throw new Error(`Ollama fallback returned ${response.status}`);
                console.log('[NAVIGATOR] Fallback succeeded');
                return await response.json();
            } catch (fbErr) {
                clearTimeout(fbTimer);
                throw fbErr;
            }
        }
        throw primaryErr;
    }
}
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
    RO: { code: 'RO', keywords: ['romania', 'romanian', 'bucharest', 'bucuresti', 'cluj', 'română'] },
    CZ: { code: 'CZ', keywords: ['czech', 'czech republic', 'czechia', 'prague', 'praha', 'česko'] },
    CY: { code: 'CY', keywords: ['cyprus', 'cypriot', 'nicosia', 'limassol'] },
    ZA: { code: 'ZA', keywords: ['south africa', 'south african', 'johannesburg', 'cape town', 'pretoria'] },
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
const CONTENT_QUALITY_RULES = `
OUTPUT FORMAT:
Return ONLY valid JSON: {"title":"...","sections":[{"title":"SECTION NAME","content":"..."}]}

CONTENT QUALITY RULES:
- Each section content must be SUBSTANTIAL — at least 3-5 paragraphs of proper legal prose
- Use numbered sub-clauses within content (e.g., "3.1 The Receiving Party shall..." / "3.2 The obligations under...")
- Use **bold** for defined terms on first use and for critical obligations
- Include [BRACKET] placeholders for all variable information (names, dates, amounts, addresses)
- Write as a practicing attorney would — formal, precise, enforceable language
- Each clause must stand on its own legally — no vague references or shortcuts
- CRITICAL: You MUST use the EXACT jurisdiction, duration, and other specifications listed above. Do NOT default to "England and Wales" or any other jurisdiction. Use the jurisdiction stated in SPECIFICATIONS.
- CRITICAL: Incorporate ALL user-provided answers into the document. If the user selected "mutual", draft a mutual agreement. If they specified a duration, use that duration.`;

const DOCUMENT_PROMPTS = {
    nda: (situation, answers, jurisdiction) => `Draft a professional Non-Disclosure Agreement governed by ${jurisdiction} law.

CONTEXT: ${situation}

SPECIFICATIONS (YOU MUST USE THESE EXACTLY):
- Type: ${answers.direction === 'mutual' ? 'Mutual NDA — BOTH parties share and receive confidential information. Use "each Party" or "the Parties" throughout, NOT "Disclosing Party" and "Receiving Party".' : 'One-Way NDA — one party discloses to the other. Use "Disclosing Party" and "Receiving Party".'}
- Duration: ${answers.duration === 'perpetual' ? 'Perpetual / indefinite' : (answers.duration || '2') + ' years'}
- Purpose: ${answers.purpose || 'Business discussions'}
- Governing Law: ${jurisdiction} — ALL references to governing law, jurisdiction, and venue MUST state ${jurisdiction}. Do NOT use "England and Wales" or any other jurisdiction.

Create a complete NDA with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of each party with [BRACKETS] for name, address, registration/company number
   - State that the parties are entering this agreement under the laws of ${jurisdiction}
   - Background recitals explaining the business relationship and purpose: ${answers.purpose || 'business discussions'}

2. DEFINITIONS
   - "Confidential Information" — comprehensive definition covering documents, digital files, oral disclosures, trade secrets, business plans, customer data, financial records, technical specifications
   - ${answers.direction === 'mutual' ? 'For this MUTUAL NDA: define both parties as simultaneously "Disclosing Party" and "Receiving Party". Use "each Party" throughout.' : 'Define "Disclosing Party", "Receiving Party"'}
   - Define "Representatives", "Purpose", "Permitted Purpose"
   - Include at least 6 defined terms with precise legal definitions

3. SCOPE AND OBLIGATIONS OF RECEIVING PARTY
   - Duty to protect using same degree of care as own confidential information (but no less than reasonable care)
   - Restriction on use solely for the stated Purpose
   - Restriction on disclosure except to Representatives who need to know and are bound by similar obligations
   - Obligation to promptly notify Disclosing Party of any unauthorized disclosure or breach

4. EXCLUSIONS FROM CONFIDENTIAL INFORMATION
   - Information already in public domain (not through breach by Receiving Party)
   - Information independently developed without use of Confidential Information (with burden of proof)
   - Information rightfully received from third party without restriction
   - Information required to be disclosed by law or court order (with prior written notice and minimization obligations)

5. PERMITTED DISCLOSURES
   - Disclosure to employees, agents, professional advisors who need to know for the Purpose
   - Prior written consent requirement for all other disclosures
   - Court-ordered or regulatory disclosure with notice to Disclosing Party and cooperation in seeking protective order

6. TERM AND TERMINATION
   - Agreement duration: ${answers.duration === 'perpetual' ? 'PERPETUAL — no fixed end date, continues until terminated' : (answers.duration || '2') + ' years from the Effective Date'}
   - Survival period for confidentiality obligations after termination (at least 2 additional years)
   - Right to terminate with written notice
   - Obligations that survive termination

7. RETURN AND DESTRUCTION OF MATERIALS
   - Obligation to return or certifiably destroy all Confidential Information upon termination or written request
   - Written certification of destruction required within 14 days
   - Exception for archival copies required by law or regulatory obligation

8. REMEDIES AND ENFORCEMENT
   - Acknowledgment that breach may cause irreparable harm not adequately compensable by damages
   - Right to seek injunctive and other equitable relief without proving actual damages or posting bond
   - Right to recover damages, costs, and reasonable legal fees

9. REPRESENTATIONS AND WARRANTIES
   - Each party has authority to enter the agreement
   - Execution does not conflict with other obligations or agreements
   - No representation as to accuracy or completeness of Confidential Information

10. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "This Agreement shall be governed by and construed in accordance with the laws of ${jurisdiction}"
    - Exclusive jurisdiction and venue: courts of ${jurisdiction}
    - Entire agreement — supersedes all prior discussions
    - Amendment only by written instrument signed by both parties
    - Severability — invalid provisions severed without affecting remainder
    - No waiver unless in writing
    - Assignment — not assignable without prior written consent
    - Notices — manner of delivery, addresses, when effective
    - Counterparts — may be executed in counterparts, electronic signatures valid

11. SIGNATURE BLOCK
    - Signature lines for each party with [NAME], [TITLE], [DATE]

${CONTENT_QUALITY_RULES}`,
    service_agreement: (situation, answers, jurisdiction) => `Draft a professional Service Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Service Type: ${answers.service_type || 'Professional services'}
- Payment Structure: ${answers.payment === 'fixed' ? 'Fixed project fee' : answers.payment === 'hourly' ? 'Hourly rate' : answers.payment === 'milestone' ? 'Milestone-based payments' : 'Monthly retainer'}
- Duration: ${answers.duration === 'one-time' ? 'One-time project' : answers.duration === 'ongoing' ? 'Ongoing relationship' : 'Fixed term'}
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Service Agreement with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of Service Provider and Client with [BRACKETS] for name, address, registration number
   - Recitals explaining the nature of the engagement and the Client's need for services
   - Statement that the parties wish to formalize the terms of the engagement

2. DEFINITIONS
   - Define "Services", "Deliverables", "Work Product", "Specifications", "Effective Date", "Fees"
   - Define "Confidential Information", "Intellectual Property", "Pre-Existing IP"
   - At least 8 defined terms with precise legal meanings

3. SCOPE OF SERVICES
   - Detailed description of services to be performed referencing attached schedules or specifications
   - Process for requesting additional services or change orders
   - Service Provider's right to determine manner and means of performing services
   - Client's obligation to provide necessary access, information, and cooperation

4. TERM AND RENEWAL
   - Commencement date and initial term
   - Automatic renewal provisions (if applicable) with opt-out notice period
   - Right of either party to terminate at will with written notice

5. COMPENSATION AND PAYMENT
   - Fee structure (${answers.payment === 'fixed' ? 'fixed project fee' : answers.payment === 'hourly' ? 'hourly rate' : answers.payment === 'milestone' ? 'milestone-based' : 'monthly retainer'}) with specific amounts in [BRACKETS]
   - Invoicing schedule and payment terms (net 30 days)
   - Late payment interest rate and collection costs
   - Expense reimbursement policy and pre-approval requirements

6. INDEPENDENT CONTRACTOR STATUS
   - Clear statement that Service Provider is an independent contractor, not an employee
   - No authority to bind Client or incur obligations on Client's behalf
   - Service Provider responsible for own taxes, insurance, and benefits
   - No entitlement to employee benefits or workers' compensation

7. INTELLECTUAL PROPERTY
   - Assignment of all Work Product and Deliverables to Client upon payment
   - Service Provider retains ownership of Pre-Existing IP with license grant to Client
   - Moral rights waiver where applicable
   - Representations that Work Product does not infringe third-party IP rights

8. CONFIDENTIALITY
   - Mutual obligation to protect Confidential Information
   - Permitted disclosures to employees and advisors with need to know
   - Survival of confidentiality obligations for [NUMBER] years after termination
   - Exclusions for publicly available information and independent development

9. WARRANTIES AND REPRESENTATIONS
   - Service Provider warrants services will be performed in professional and workmanlike manner
   - Compliance with applicable laws and regulations
   - Authority to enter agreement and perform services
   - Disclaimer of all other warranties, express or implied

10. LIMITATION OF LIABILITY
    - Cap on aggregate liability equal to fees paid in preceding [NUMBER] months
    - Exclusion of indirect, incidental, consequential, and punitive damages
    - Exceptions for breaches of confidentiality, IP infringement, and willful misconduct
    - Acknowledgment that limitations reflect allocation of risk

11. INDEMNIFICATION
    - Service Provider indemnifies Client against third-party claims arising from Provider's negligence or breach
    - Client indemnifies Service Provider against claims arising from Client's use of Deliverables
    - Indemnification procedures: prompt notice, control of defense, cooperation

12. TERMINATION
    - Termination for convenience by either party with [NUMBER] days written notice
    - Termination for cause upon material breach not cured within [NUMBER] days of notice
    - Effect of termination: payment for services rendered, return of materials
    - Survival of provisions: confidentiality, IP, limitation of liability, indemnification

13. DISPUTE RESOLUTION
    - Good faith negotiation for [NUMBER] days
    - Mediation before a mutually agreed mediator
    - Binding arbitration or litigation in courts of ${jurisdiction}
    - Prevailing party entitled to recover reasonable legal fees

14. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Entire agreement — supersedes all prior agreements and understandings
    - Amendment only by written instrument signed by both parties
    - Severability, no waiver, assignment restrictions, force majeure
    - Notices — manner of delivery and addresses
    - Counterparts and electronic signatures

15. SIGNATURE BLOCK
    - Signature lines for Service Provider and Client with [NAME], [TITLE], [DATE]

${CONTENT_QUALITY_RULES}`,
    employment_contract: (situation, answers, jurisdiction) => `Draft a professional Employment Contract.

CONTEXT: ${situation}

SPECIFICATIONS:
- Employment Type: ${answers.employment_type || 'Full-time'}
- Position: ${answers.role || '[JOB TITLE]'}
- Benefits: ${answers.benefits || 'Standard benefits package'}
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Employment Contract with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of Employer (company name, registration number, registered address) and Employee (full name, address) with [BRACKETS]
   - Recitals stating the Employer wishes to employ the Employee and the Employee wishes to accept employment

2. POSITION AND DUTIES
   - Job title: ${answers.role || '[JOB TITLE]'}
   - Reporting structure and supervisor
   - Principal duties and responsibilities (with reference to attached job description if applicable)
   - Obligation to devote full working time and best efforts to the Employer's business
   - Duty not to engage in outside employment without prior written consent

3. TERM OF EMPLOYMENT
   - Start date with [BRACKET] placeholder
   - Employment type: ${answers.employment_type || 'Full-time'}
   - Probationary period (if applicable) — duration and conditions for confirmation
   - At-will or fixed-term provisions as appropriate for ${jurisdiction}

4. COMPENSATION
   - Base salary: [AMOUNT] per annum, payable [monthly/bi-weekly]
   - Annual salary review — timing and process (no guarantee of increase)
   - Overtime policy and compensation (if applicable under ${jurisdiction} law)
   - Bonus or commission structure (if applicable) — discretionary vs. guaranteed

5. BENEFITS
   - Health insurance coverage (medical, dental, vision) and enrollment eligibility
   - Retirement/pension plan contributions
   - Paid time off: vacation days, sick leave, personal days — accrual and carryover policy
   - Additional benefits as selected: ${answers.benefits || 'Standard benefits package'}
   - Benefits subject to terms of applicable plan documents

6. WORKING HOURS AND LOCATION
   - Standard working hours per week and schedule
   - Remote work policy and hybrid arrangements (if applicable)
   - Overtime expectations and approval process
   - Travel requirements (if any)

7. CONFIDENTIALITY AND DATA PROTECTION
   - Broad definition of Confidential Information including trade secrets, client lists, financial data, business strategies
   - Obligation not to disclose during and after employment
   - Return of all confidential materials upon termination
   - Data protection obligations under applicable privacy laws

8. INTELLECTUAL PROPERTY AND INVENTIONS
   - Assignment of all inventions, works, and discoveries created during employment to Employer
   - Obligation to disclose and assist in protecting IP (executing patents, registrations)
   - Moral rights waiver where permitted by law
   - Exception for pre-existing IP and personal projects (if agreed)

9. NON-COMPETITION
   - Geographic scope and duration of non-compete restriction after termination
   - Definition of competing business or activity
   - Consideration for non-compete (if required by ${jurisdiction} law)
   - Acknowledgment of reasonableness

10. NON-SOLICITATION
    - Restriction on soliciting Employer's employees for [NUMBER] months after termination
    - Restriction on soliciting Employer's clients or customers for [NUMBER] months after termination
    - Definition of "solicit" — direct and indirect contact

11. TERMINATION
    - Termination by Employer with notice: [NUMBER] weeks/months written notice
    - Termination by Employee with notice: [NUMBER] weeks/months written notice
    - Termination for cause: grounds including gross misconduct, material breach, conviction of crime, persistent underperformance
    - Garden leave provisions (if applicable)
    - Severance pay provisions and conditions

12. POST-TERMINATION OBLIGATIONS
    - Return of all company property (laptop, phone, keys, documents, access cards)
    - Cooperation with transition and handover of responsibilities
    - Survival of confidentiality, non-compete, non-solicitation obligations
    - Final pay and accrued benefits settlement timeline

13. REPRESENTATIONS AND WARRANTIES
    - Employee represents they are legally authorized to work in ${jurisdiction}
    - No conflicting obligations or restrictive covenants with prior employers
    - All information provided during hiring process is true and accurate

14. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Entire agreement — supersedes all prior negotiations, offers, and representations
    - Amendment only by written instrument signed by both parties
    - Severability — if any provision is unenforceable, remainder continues in effect
    - No waiver unless in writing
    - Notices — manner of delivery and addresses

15. SIGNATURE BLOCK
    - Signature lines for Employer (authorized representative) and Employee with [NAME], [TITLE], [DATE]

${CONTENT_QUALITY_RULES}`,
    lease_agreement: (situation, answers, jurisdiction) => `Draft a professional Lease Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Property Type: ${answers.property_type || 'Residential property'}
- Lease Term: ${answers.lease_term || '1 year'}
- Furnished: ${answers.furnished || 'Unfurnished'}
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Lease Agreement with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of Landlord and Tenant with [BRACKETS] for name, address, identification
   - If Landlord is a company: registration number and registered address
   - Recitals stating the Landlord owns the property and wishes to lease it to the Tenant

2. PROPERTY DESCRIPTION
   - Full street address with [BRACKETS]
   - Description of premises (apartment number, floor, square footage, number of rooms)
   - Included fixtures, appliances, and furnishings (if ${answers.furnished || 'Unfurnished'} is furnished)
   - Parking spaces, storage units, or common areas included
   - Condition of property at commencement (reference to attached inventory/condition report)

3. LEASE TERM
   - Commencement date and expiration date: ${answers.lease_term || '1 year'}
   - Renewal options — automatic renewal, month-to-month conversion, or fixed renewal term
   - Required notice period for non-renewal by either party
   - Holdover tenancy provisions and applicable rent increase

4. RENT AND PAYMENT
   - Monthly rent amount: [AMOUNT] per month
   - Due date (first of each month) and acceptable payment methods
   - Late payment fee: [AMOUNT or PERCENTAGE] if not paid within [NUMBER] days of due date
   - Returned check/payment fee
   - Annual rent increase provisions (fixed percentage or CPI-linked)

5. SECURITY DEPOSIT
   - Amount: [AMOUNT] (typically one to two months' rent)
   - Conditions for withholding all or part of deposit (unpaid rent, damage beyond normal wear, cleaning)
   - Timeline for return after lease termination (per ${jurisdiction} law)
   - Itemized statement of deductions requirement
   - Interest on security deposit (if required by law)

6. UTILITIES AND SERVICES
   - Utilities included in rent (if any): water, gas, electricity, internet, trash collection
   - Tenant's responsibility for establishing utility accounts
   - Landlord's right to disconnect services for non-payment (limitations)
   - Common area maintenance charges (if applicable)

7. USE AND OCCUPANCY
   - Premises to be used solely as private residential dwelling
   - Maximum number of occupants
   - Guest policy and duration limits
   - Prohibition on illegal activities, nuisance, and disturbance to neighbors
   - Compliance with building rules, HOA regulations, and applicable laws

8. MAINTENANCE, REPAIRS, AND CONDITION
   - Landlord's obligation to maintain structural elements, plumbing, electrical, HVAC, and common areas
   - Tenant's obligation to maintain cleanliness and report needed repairs promptly
   - Tenant responsible for damage caused by Tenant, guests, or pets (beyond normal wear and tear)
   - Emergency repair procedures and Landlord's response time obligations
   - Right to professional cleaning at Tenant's expense if premises not maintained

9. ALTERATIONS AND IMPROVEMENTS
   - No alterations without prior written consent of Landlord
   - Tenant-installed improvements become property of Landlord unless otherwise agreed
   - Obligation to restore premises to original condition upon Landlord's request
   - Permitted minor modifications (picture hooks, curtain rods) without consent

10. PETS
    - Pet policy: [PERMITTED / NOT PERMITTED / WITH APPROVAL]
    - Additional pet deposit: [AMOUNT]
    - Restrictions on number, size, breed, or type of pets
    - Tenant's liability for pet damage and noise complaints

11. INSURANCE
    - Tenant required to maintain renter's insurance with minimum coverage of [AMOUNT]
    - Landlord to be named as additional interested party
    - Proof of insurance to be provided prior to move-in and annually thereafter
    - Landlord's insurance does not cover Tenant's personal property

12. ENTRY BY LANDLORD
    - Landlord's right to enter for inspections, repairs, showing to prospective tenants
    - Required notice period: [NUMBER] hours/days (per ${jurisdiction} law)
    - Emergency entry without notice (water leak, fire, gas leak)
    - Tenant's right to be present during non-emergency entry

13. TERMINATION AND DEFAULT
    - Termination by Tenant with [NUMBER] days/months written notice
    - Landlord's right to terminate for non-payment of rent (after [NUMBER] days notice)
    - Landlord's right to terminate for material breach (after cure period)
    - Early termination fee: [AMOUNT] (if applicable)
    - Remedies available to Landlord: eviction proceedings, damages, collection of unpaid rent

14. MOVE-OUT PROCEDURES
    - Property to be returned in same condition as received (normal wear excepted)
    - Professional cleaning requirements
    - Return of all keys, access cards, garage remotes
    - Forwarding address for security deposit return
    - Walk-through inspection scheduling

15. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Entire agreement — supersedes all prior negotiations and representations
    - Amendment only by written instrument signed by both parties
    - Severability, no waiver, notices, quiet enjoyment guarantee
    - Subordination to existing mortgages
    - Force majeure provisions

16. SIGNATURE BLOCK
    - Signature lines for Landlord and Tenant with [NAME], [DATE]
    - Witness lines (if required by ${jurisdiction} law)

${CONTENT_QUALITY_RULES}`,
    sales_agreement: (situation, answers, jurisdiction) => `Draft a professional Sales Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Sales Agreement with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of Seller and Buyer with [BRACKETS] for name, address, registration number
   - Recitals stating the Seller wishes to sell and the Buyer wishes to purchase the described goods

2. DEFINITIONS
   - Define "Goods", "Purchase Price", "Delivery Date", "Specifications", "Acceptance Period"
   - Define "Defect", "Warranty Period", "Force Majeure Event"
   - At least 6 defined terms

3. GOODS AND SPECIFICATIONS
   - Detailed description of goods being sold (quantities, models, specifications)
   - Reference to attached specifications or product descriptions
   - Seller's obligation to deliver goods conforming to specifications
   - Buyer's right to reject non-conforming goods

4. PURCHASE PRICE AND TAXES
   - Total purchase price: [AMOUNT] in [CURRENCY]
   - Price breakdown per unit or item (if applicable)
   - Taxes, duties, and tariffs — which party bears responsibility
   - Price adjustment provisions (if applicable for long-term contracts)

5. PAYMENT TERMS
   - Payment schedule: deposit of [PERCENTAGE] upon execution, balance upon delivery
   - Accepted payment methods (wire transfer, check, letter of credit)
   - Late payment interest rate: [PERCENTAGE] per annum
   - Right to suspend delivery for overdue payments
   - Set-off rights

6. DELIVERY AND SHIPPING
   - Delivery date: [DATE] or within [NUMBER] days of order confirmation
   - Delivery location: [ADDRESS]
   - Shipping terms (FOB, CIF, DDP, or other Incoterms)
   - Partial deliveries — permitted or not
   - Consequences of late delivery (liquidated damages, right to cancel)

7. INSPECTION AND ACCEPTANCE
   - Buyer's right to inspect goods within [NUMBER] days of delivery
   - Notification of defects or non-conformity within the inspection period
   - Deemed acceptance if no objection raised within the period
   - Seller's right to cure defects within [NUMBER] days of notice

8. TITLE AND RISK OF LOSS
   - Transfer of title upon full payment / upon delivery (as selected)
   - Risk of loss passes to Buyer upon delivery at designated location
   - Seller retains security interest until full payment (retention of title)

9. WARRANTIES
   - Seller warrants goods are free from defects in materials and workmanship for [NUMBER] months
   - Seller warrants goods conform to specifications and are fit for their intended purpose
   - Seller warrants clear title and right to sell
   - Warranty remedies: repair, replacement, or refund at Seller's option
   - Disclaimer of all other warranties, express or implied, including merchantability

10. RETURNS AND REMEDIES
    - Return policy for defective goods — process, shipping costs, timeline
    - Buyer's remedies for breach: rejection, replacement, price reduction, damages
    - No returns for non-defective goods unless otherwise agreed
    - Restocking fee: [PERCENTAGE] for non-defective returns (if permitted)

11. LIMITATION OF LIABILITY
    - Aggregate liability capped at the Purchase Price
    - Exclusion of indirect, incidental, consequential, and punitive damages
    - Exceptions for fraud, willful misconduct, personal injury
    - Acknowledgment that limitations reflect allocation of risk

12. INDEMNIFICATION
    - Seller indemnifies Buyer against third-party claims for IP infringement
    - Buyer indemnifies Seller against claims arising from misuse of goods
    - Indemnification procedures: prompt notice, control of defense

13. CONFIDENTIALITY
    - Obligation to keep pricing, specifications, and trade terms confidential
    - Permitted disclosures to professional advisors and as required by law
    - Survival of confidentiality obligations for [NUMBER] years

14. FORCE MAJEURE
    - Definition of Force Majeure events (natural disasters, war, pandemic, government actions)
    - Notice requirements and duty to mitigate
    - Right to terminate if Force Majeure continues beyond [NUMBER] days

15. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Dispute resolution: negotiation, mediation, then arbitration or litigation
    - Entire agreement, amendment, severability, no waiver, assignment restrictions
    - Notices — manner of delivery and addresses
    - Counterparts and electronic signatures

16. SIGNATURE BLOCK
    - Signature lines for Seller and Buyer with [NAME], [TITLE], [DATE]

${CONTENT_QUALITY_RULES}`,
    partnership_agreement: (situation, answers, jurisdiction) => `Draft a professional Partnership Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Partnership Agreement with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of all partners with [BRACKETS] for name, address, identification
   - Recitals stating the parties wish to form a partnership and carry on business together

2. PARTNERSHIP NAME AND PURPOSE
   - Partnership name: [PARTNERSHIP NAME]
   - Principal place of business: [ADDRESS]
   - Business purpose and scope of activities
   - Power to expand or modify business scope by unanimous/majority consent

3. DEFINITIONS
   - Define "Capital Account", "Net Profits", "Net Losses", "Distributable Cash", "Fiscal Year"
   - Define "Majority Interest", "Supermajority", "Fair Market Value"
   - At least 6 defined terms

4. TERM OF PARTNERSHIP
   - Commencement date and duration (perpetual or fixed term)
   - Events that trigger dissolution
   - Continuation of partnership upon withdrawal or death of a partner

5. CAPITAL CONTRIBUTIONS
   - Initial capital contribution of each partner: [AMOUNT] by [NAME]
   - Form of contributions (cash, property, services) and valuation method
   - Additional capital contribution obligations — when required, pro rata basis
   - Consequences of failure to make required contributions
   - No interest payable on capital contributions

6. PROFIT AND LOSS ALLOCATION
   - Allocation percentages for each partner: [PERCENTAGE] to [NAME]
   - Timing and frequency of distributions (quarterly, annually)
   - Priority of distributions: return of capital, preferred return, residual split
   - Tax allocation provisions and special allocations
   - Restriction on distributions that would impair partnership solvency

7. MANAGEMENT AND DECISION-MAKING
   - Day-to-day management authority of managing partner(s)
   - Decisions requiring majority vote vs. unanimous consent
   - Matters requiring unanimous consent: admission of new partners, sale of assets, borrowing above threshold, amendment of agreement
   - Meeting procedures: notice, quorum, voting, minutes
   - Deadlock resolution mechanism

8. PARTNER DUTIES AND OBLIGATIONS
   - Fiduciary duties: duty of loyalty, duty of care, duty to act in good faith
   - Time and attention commitment to partnership business
   - Non-competition during partnership term
   - Duty to account for partnership opportunities
   - Prohibition on self-dealing without disclosure and consent

9. COMPENSATION AND EXPENSES
   - Management fees or salaries payable to active partners: [AMOUNT] per [PERIOD]
   - Reimbursement of reasonable business expenses incurred on behalf of partnership
   - Expense approval process and documentation requirements
   - Draws against anticipated distributions

10. BOOKS, RECORDS, AND BANKING
    - Obligation to maintain accurate books of account
    - Partnership bank accounts — signatories and authority levels
    - Fiscal year: [CALENDAR YEAR / OTHER]
    - Annual financial statements and tax return preparation
    - Right of each partner to inspect books and records

11. ADMISSION OF NEW PARTNERS
    - Requires consent of [ALL / MAJORITY] existing partners
    - New partner's capital contribution requirements
    - Amendment of profit/loss allocation upon admission
    - New partner bound by all terms of this agreement

12. TRANSFER OF PARTNERSHIP INTEREST
    - Restrictions on transfer without consent of [ALL / MAJORITY] partners
    - Right of first refusal in favor of existing partners
    - Valuation methodology for transfers: [BOOK VALUE / FAIR MARKET VALUE / FORMULA]
    - Permitted transfers to family trusts or estate planning vehicles

13. WITHDRAWAL AND BUYOUT
    - Voluntary withdrawal with [NUMBER] months written notice
    - Buyout of withdrawing partner's interest at Fair Market Value
    - Payment terms for buyout: lump sum or installments over [NUMBER] months
    - Non-compete restriction following withdrawal: [NUMBER] years, [GEOGRAPHIC SCOPE]

14. DEATH, DISABILITY, OR INCAPACITY
    - Right of surviving partners to purchase deceased partner's interest
    - Valuation method and payment terms for estate buyout
    - Key person insurance requirements
    - Appointment of representative for disabled partner

15. DISSOLUTION AND WINDING UP
    - Events triggering dissolution: unanimous vote, bankruptcy, court order, illegality
    - Winding up procedures: collection of debts, liquidation of assets, payment of obligations
    - Distribution of remaining assets: return of capital contributions, then per profit-sharing ratios
    - Final accounting and tax filings

16. DISPUTE RESOLUTION
    - Good faith negotiation for [NUMBER] days
    - Mediation before a mutually agreed mediator
    - Binding arbitration under [ARBITRATION RULES] or litigation in courts of ${jurisdiction}
    - Prevailing party entitled to recover reasonable legal fees and costs

17. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Entire agreement — supersedes all prior agreements and understandings
    - Amendment only by written instrument signed by all partners
    - Severability, no waiver, notices, force majeure
    - Counterparts and electronic signatures

18. SIGNATURE BLOCK
    - Signature lines for each partner with [NAME], [DATE]

${CONTENT_QUALITY_RULES}`,
    loan_agreement: (situation, answers, jurisdiction) => `Draft a professional Loan Agreement.

CONTEXT: ${situation}

SPECIFICATIONS:
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Loan Agreement with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of Lender and Borrower with [BRACKETS] for name, address, registration number
   - Recitals stating the Borrower has requested a loan and the Lender has agreed to provide it on the terms set forth

2. DEFINITIONS
   - Define "Loan Amount", "Interest Rate", "Maturity Date", "Payment Date", "Business Day"
   - Define "Default", "Event of Default", "Collateral", "Obligations", "Outstanding Balance"
   - At least 8 defined terms

3. LOAN AMOUNT AND DISBURSEMENT
   - Principal amount: [AMOUNT] in [CURRENCY]
   - Disbursement method: wire transfer to Borrower's designated account
   - Disbursement date and conditions precedent to disbursement
   - Loan fee or origination fee: [AMOUNT or PERCENTAGE] (if applicable)

4. INTEREST
   - Annual interest rate: [PERCENTAGE]% per annum
   - Interest calculation method: simple / compound, 360-day year or 365-day year
   - Interest accrual period and payment schedule
   - Default interest rate: additional [PERCENTAGE]% per annum on overdue amounts

5. REPAYMENT TERMS
   - Repayment schedule: [MONTHLY / QUARTERLY / LUMP SUM AT MATURITY]
   - Payment amounts and due dates
   - Maturity date: [DATE]
   - Amortization schedule (if applicable) — reference to attached schedule
   - Application of payments: first to fees, then to accrued interest, then to principal

6. PREPAYMENT
   - Right to prepay in whole or in part without penalty / with [NUMBER] days notice
   - Prepayment penalty: [PERCENTAGE] of prepaid amount (if applicable)
   - Application of prepayments to remaining installments (inverse order of maturity)
   - Minimum prepayment amount: [AMOUNT]

7. LATE PAYMENT AND FEES
   - Grace period: [NUMBER] days after due date
   - Late payment fee: [AMOUNT or PERCENTAGE] of overdue amount
   - Returned payment fee: [AMOUNT]
   - Costs of collection including reasonable attorneys' fees

8. SECURITY AND COLLATERAL
   - Description of Collateral (if secured): [DESCRIPTION OF ASSETS]
   - Grant of security interest in Collateral
   - Borrower's obligation to maintain Collateral in good condition
   - Insurance requirements on Collateral
   - UCC financing statement filing (if applicable in ${jurisdiction})
   - If unsecured: statement that the loan is unsecured

9. REPRESENTATIONS AND WARRANTIES
   - Borrower is duly organized and in good standing
   - Authority to enter agreement and incur the Obligations
   - No pending litigation that would materially affect ability to repay
   - Financial statements provided are true, complete, and fairly present financial condition
   - No existing defaults under other material agreements

10. AFFIRMATIVE COVENANTS
    - Maintain books and records, provide financial statements [QUARTERLY / ANNUALLY]
    - Maintain insurance on Collateral and business operations
    - Comply with all applicable laws and regulations
    - Notify Lender promptly of any Event of Default or material adverse change
    - Permit Lender to inspect books and Collateral upon reasonable notice

11. NEGATIVE COVENANTS
    - No additional indebtedness above [AMOUNT] without Lender's prior consent
    - No sale, transfer, or disposal of Collateral without consent
    - No change in business structure, ownership, or nature of business
    - Maintain minimum [FINANCIAL METRIC] of [AMOUNT]

12. EVENTS OF DEFAULT
    - Failure to make any payment when due (after grace period)
    - Breach of any representation, warranty, or covenant
    - Bankruptcy, insolvency, or appointment of receiver
    - Material adverse change in Borrower's financial condition
    - Cross-default to other material agreements
    - Judgment entered against Borrower in excess of [AMOUNT]

13. REMEDIES UPON DEFAULT
    - Acceleration of all outstanding Obligations
    - Right to exercise remedies against Collateral (foreclosure, sale)
    - Right to set off against Borrower's accounts held by Lender
    - Appointment of receiver
    - All remedies cumulative and not exclusive

14. INDEMNIFICATION
    - Borrower indemnifies Lender against all losses, costs, and expenses arising from breach
    - Indemnification for environmental liabilities related to Collateral (if applicable)
    - Survival of indemnification obligations

15. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Dispute resolution: negotiation, then litigation in courts of ${jurisdiction}
    - Entire agreement, amendment, severability, no waiver
    - Assignment — Lender may assign; Borrower may not without consent
    - Notices — manner of delivery and addresses
    - Counterparts and electronic signatures

16. SIGNATURE BLOCK
    - Signature lines for Lender and Borrower with [NAME], [TITLE], [DATE]

${CONTENT_QUALITY_RULES}`,
    release_waiver: (situation, answers, jurisdiction) => `Draft a professional Release and Waiver of Liability.

CONTEXT: ${situation}

SPECIFICATIONS:
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Release and Waiver with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND IDENTIFICATION
   - Full identification of **Releasor** (person giving up rights) with [BRACKETS] for name, address, date of birth
   - Full identification of **Releasee** (person/entity being released) with [BRACKETS] for name, address
   - Include officers, directors, employees, agents, successors, and assigns of Releasee

2. RECITALS AND BACKGROUND
   - Detailed background explaining the situation, incident, or activity giving rise to this release
   - Reference to any prior agreements, injuries, disputes, or events
   - Statement of the parties' intent to settle and release all claims

3. CONSIDERATION
   - Statement of consideration received by Releasor: [DESCRIPTION — payment, settlement, participation in activity]
   - Amount of monetary consideration: [AMOUNT] (if applicable)
   - Acknowledgment that consideration is sufficient and adequate
   - Payment terms and method

4. RELEASE OF CLAIMS
   - Comprehensive release of all claims, demands, actions, causes of action, suits, damages, losses, costs, and expenses
   - Release covers claims both known and unknown, suspected and unsuspected, disclosed and undisclosed
   - Waiver of any statute or law that would limit release to known claims (e.g., California Civil Code 1542)
   - Specific types of claims released: negligence, strict liability, breach of contract, breach of warranty, statutory claims
   - Release effective as of [DATE] covering all events up to the date of execution

5. WAIVER OF LIABILITY
   - Releasor waives any right to assert claims against Releasee arising from the described activity or incident
   - Waiver applies to personal injury, property damage, wrongful death, and economic losses
   - Waiver extends to Releasee's agents, employees, contractors, and affiliated entities

6. ASSUMPTION OF RISK
   - Releasor acknowledges understanding of the risks involved in the activity or situation
   - Specific risks identified and acknowledged: [LIST SPECIFIC RISKS]
   - Voluntary assumption of all risks, both known and unknown
   - Acknowledgment that risks include serious injury, disability, or death (if applicable)

7. INDEMNIFICATION AND HOLD HARMLESS
   - Releasor agrees to indemnify, defend, and hold harmless Releasee from any claims by third parties
   - Coverage of attorneys' fees, court costs, and expenses incurred in defense
   - Indemnification applies to claims arising from Releasor's actions or breach of this agreement

8. COVENANT NOT TO SUE
   - Releasor promises not to file any lawsuit or initiate any legal proceeding against Releasee
   - Covenant extends to all released claims in any jurisdiction
   - If suit is filed in breach of this covenant, Releasor shall pay all defense costs and attorneys' fees

9. REPRESENTATIONS AND ACKNOWLEDGMENTS
   - Releasor represents this agreement is executed voluntarily and without coercion
   - Releasor has had opportunity to consult with legal counsel before signing
   - Releasor has read and understands all terms of this agreement
   - Releasor is of legal age and competent to execute this agreement
   - No reliance on representations not contained in this agreement

10. SCOPE AND LIMITATIONS
    - Specific activities, incidents, or claims covered by this release
    - Exclusions: claims arising from gross negligence or intentional misconduct (if required by ${jurisdiction} law)
    - Release does not waive future claims for events occurring after the date of execution
    - Release does not affect rights that cannot be waived by law

11. CONFIDENTIALITY
    - Terms of this agreement (including any settlement amount) shall remain confidential
    - Permitted disclosures: legal counsel, tax advisors, as required by law
    - Consequences of breach of confidentiality

12. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Entire agreement — supersedes all prior discussions and agreements
    - Amendment only by written instrument signed by both parties
    - Severability — if any provision is unenforceable, remainder remains in effect
    - Binding on heirs, executors, administrators, successors, and assigns
    - Counterparts and electronic signatures

13. SIGNATURE BLOCK
    - Signature lines for Releasor and Releasee with [NAME], [DATE]
    - Witness lines (if required by ${jurisdiction} law)
    - Notarization block (if required)

${CONTENT_QUALITY_RULES}`,
    cease_desist: (situation, answers, jurisdiction) => `Draft a professional Cease and Desist Letter.

CONTEXT: ${situation}

SPECIFICATIONS:
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Cease and Desist Letter with these sections. Each section must contain SUBSTANTIAL, detailed legal prose:

1. LETTERHEAD AND DATE
   - Sender's name, title, firm name, and address with [BRACKETS]
   - Date of letter: [DATE]
   - Delivery method notation (e.g., "Via Certified Mail, Return Receipt Requested" and "Via Email to [EMAIL]")

2. RECIPIENT AND RE LINE
   - Recipient's full name and address with [BRACKETS]
   - RE: Cease and Desist — [SPECIFIC DESCRIPTION OF VIOLATION]
   - Reference numbers or case identifiers (if applicable)

3. INTRODUCTION AND IDENTIFICATION
   - Identification of the sender and their legal standing or interest
   - Identification of the client (if letter is from attorney on behalf of client)
   - Brief statement of the purpose of the letter
   - Statement that sender has retained legal counsel (or is legal counsel) regarding this matter

4. STATEMENT OF RIGHTS
   - Detailed description of sender's rights being infringed (intellectual property, contractual, statutory)
   - Registration numbers for trademarks, copyrights, patents (if applicable)
   - History of the rights and their establishment
   - Evidence of the rights' validity and enforceability

5. DETAILED STATEMENT OF FACTS
   - Chronological description of the infringing or harmful conduct
   - Specific instances with dates, locations, and descriptions
   - Evidence obtained: screenshots, correspondence, witness accounts, purchase records
   - Duration and extent of the violation
   - Harm caused by the conduct: financial losses, reputational damage, customer confusion

6. LEGAL BASIS AND ANALYSIS
   - Applicable laws, statutes, and legal principles under ${jurisdiction} law
   - How the recipient's conduct violates each applicable law or right
   - Relevant case law or precedent supporting the sender's position
   - Contractual provisions violated (if applicable, with specific clause references)
   - Potential statutory damages, penalties, or criminal liability

7. DEMAND TO CEASE
   - Clear, specific demand to immediately stop all infringing or harmful conduct
   - Itemized list of specific actions that must cease
   - Demand applies to recipient and all agents, employees, contractors, and affiliates

8. DEMAND TO DESIST
   - Demand to permanently refrain from the described conduct in the future
   - Prohibition on similar or related conduct
   - Requirement to instruct agents and employees to comply

9. REMEDIAL ACTIONS REQUIRED
   - Specific corrective actions required: removal of infringing content, recall of products, destruction of copies
   - Written confirmation of compliance required
   - Accounting of profits derived from the infringing conduct
   - Preservation of all documents and evidence related to the matter

10. COMPLIANCE DEADLINE
    - Specific deadline for compliance: [DATE] (typically 10-15 business days)
    - Deadline for written response confirming compliance
    - Request for written acknowledgment of receipt of this letter

11. CONSEQUENCES OF NON-COMPLIANCE
    - Statement that failure to comply will result in legal action without further notice
    - Types of relief that will be sought: injunctive relief, damages, statutory damages, attorneys' fees
    - Potential for preliminary and permanent injunctions
    - Reservation of all rights and remedies available at law and in equity

12. CLOSING AND RESERVATION OF RIGHTS
    - This letter does not constitute a waiver of any rights or remedies
    - All rights expressly reserved, including but not limited to claims for past damages
    - Request to direct all communications to sender's address
    - Professional closing: "Govern yourself accordingly" or similar
    - Signature block with [NAME], [TITLE], [FIRM], [CONTACT INFORMATION]

${CONTENT_QUALITY_RULES}`,
    power_of_attorney: (situation, answers, jurisdiction) => `Draft a professional Power of Attorney document.

CONTEXT: ${situation}

SPECIFICATIONS:
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a complete Power of Attorney with these sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. DECLARATION AND TITLE
   - Formal declaration: "KNOW ALL PERSONS BY THESE PRESENTS"
   - Statement that this constitutes a Power of Attorney under the laws of ${jurisdiction}
   - Type of POA: General / Limited / Durable / Springing (based on context)

2. PRINCIPAL
   - Full identification of the **Principal** (person granting power) with [BRACKETS] for full legal name, date of birth, address
   - Statement that Principal is of sound mind and acting voluntarily
   - Statement of Principal's intent to appoint an Agent

3. APPOINTMENT OF AGENT
   - Full identification of the **Agent** (Attorney-in-Fact) with [BRACKETS] for full legal name, date of birth, address
   - Statement of appointment and grant of authority
   - Relationship between Principal and Agent (if desired)

4. POWERS GRANTED
   - Comprehensive enumeration of specific powers, organized by category:
   - 4.1 Financial Powers: manage bank accounts, make deposits/withdrawals, sign checks, access safe deposit boxes
   - 4.2 Real Property: buy, sell, lease, mortgage, manage real estate
   - 4.3 Personal Property: buy, sell, manage personal property and vehicles
   - 4.4 Business Operations: manage business interests, sign contracts, make business decisions
   - 4.5 Tax Matters: prepare and file tax returns, represent before tax authorities, resolve tax disputes
   - 4.6 Legal Proceedings: initiate, defend, or settle legal actions; retain attorneys; sign legal documents
   - 4.7 Insurance: purchase, modify, cancel, or claim under insurance policies
   - 4.8 Government Benefits: apply for, manage, and receive government benefits and entitlements
   - 4.9 Digital Assets: access and manage online accounts, digital property, and electronic communications

5. LIMITATIONS AND RESTRICTIONS
   - Specific actions the Agent may NOT take without additional authorization
   - Prohibition on gifts to self (unless specifically authorized)
   - Prohibition on changing beneficiary designations (unless specifically authorized)
   - Maximum transaction value without co-signature or additional approval: [AMOUNT]
   - Geographic limitations (if applicable)

6. EFFECTIVE DATE AND DURABILITY
   - Effective immediately upon execution / effective upon incapacity of Principal (springing POA)
   - If springing: definition of incapacity and method of determination (physician's certification)
   - Statement of durability: "This Power of Attorney shall not be affected by subsequent disability or incapacity of the Principal"
   - Or non-durable: terminates upon incapacity

7. DURATION AND EXPIRATION
   - Duration: until revoked / until [DATE] / upon occurrence of [EVENT]
   - Automatic expiration provisions
   - Continuation during any period of disability

8. SUCCESSOR AGENTS
   - Appointment of successor Agent(s) with [BRACKETS] for name and contact information
   - Order of succession if primary Agent is unable or unwilling to serve
   - Same powers and limitations apply to successor Agents
   - Process for successor to assume duties

9. AGENT'S DUTIES AND STANDARD OF CARE
   - Fiduciary duty to act in Principal's best interest
   - Duty to keep accurate records of all transactions
   - Duty to keep Principal's assets separate from Agent's own assets
   - Duty to act in accordance with Principal's known wishes and best interests
   - Standard of care: reasonable prudence

10. COMPENSATION AND REIMBURSEMENT
    - Agent shall serve [WITH / WITHOUT] compensation
    - If compensated: rate of [AMOUNT] per [PERIOD] or reasonable compensation
    - Reimbursement of reasonable out-of-pocket expenses incurred in performance of duties
    - Documentation and reporting requirements for expenses

11. THIRD-PARTY RELIANCE
    - Third parties may rely on this Power of Attorney in good faith
    - Agent's authority shall be accepted by all financial institutions, government agencies, and other parties
    - Third parties not liable for acts performed in reliance on this POA
    - Indemnification of third parties acting in good faith

12. REVOCATION
    - Principal retains the right to revoke this Power of Attorney at any time while competent
    - Revocation must be in writing and delivered to the Agent
    - Revocation effective upon receipt by Agent; third parties entitled to rely until notified
    - Automatic revocation upon death of Principal

13. GOVERNING LAW AND MISCELLANEOUS
    - Governed by laws of ${jurisdiction}
    - Severability — invalid provisions do not affect remainder
    - This POA is to be construed broadly to give Agent the fullest authority permitted by law
    - Photocopy or electronic copy has same force and effect as original

14. EXECUTION AND SIGNATURES
    - Signature of Principal with [NAME], [DATE]
    - Signature of Agent acknowledging acceptance of appointment
    - Witness signatures (number required by ${jurisdiction} law) with [NAME], [ADDRESS]
    - Notarization block with notary's acknowledgment, seal, and commission expiration

${CONTENT_QUALITY_RULES}`,
    unknown: (situation, answers, jurisdiction) => `Draft a professional legal document based on the user's needs.

CONTEXT: ${situation}

ADDITIONAL DETAILS:
- Purpose: ${answers.document_purpose || 'As described above'}
- Parties: ${answers.parties || 'To be specified'}
- Key Terms: ${answers.key_terms || 'As appropriate'}
- Governing Law & Jurisdiction: ${jurisdiction} (use ONLY this jurisdiction in the document)

Create a comprehensive legal document with appropriate sections. Each section must contain SUBSTANTIAL legal prose with numbered sub-clauses:

1. PARTIES AND RECITALS
   - Full identification of all parties with [BRACKETS] for names, addresses, registration numbers
   - Background recitals explaining the context, business relationship, and purpose of this agreement
   - Statement of mutual intent to enter this agreement

2. DEFINITIONS
   - Define all key terms used throughout the document
   - Include at least 6 precisely defined terms relevant to the subject matter
   - Defined terms in **bold** on first use

3. PURPOSE AND SCOPE
   - Clear statement of the agreement's purpose based on: ${answers.document_purpose || 'the described situation'}
   - Scope of activities, obligations, or rights covered
   - Limitations on scope — what is expressly excluded

4. RIGHTS AND OBLIGATIONS OF PARTY A
   - Detailed enumeration of Party A's rights under this agreement
   - Specific obligations and performance requirements
   - Timeline and milestones for performance
   - Standards of performance and quality requirements

5. RIGHTS AND OBLIGATIONS OF PARTY B
   - Detailed enumeration of Party B's rights under this agreement
   - Specific obligations and performance requirements
   - Payment or consideration obligations
   - Cooperation and access obligations

6. TERM AND RENEWAL
   - Commencement date and initial term
   - Renewal provisions (automatic or by mutual agreement)
   - Notice requirements for non-renewal

7. COMPENSATION AND PAYMENT
   - Payment amounts, schedule, and methods
   - Late payment consequences and interest rates
   - Taxes and additional costs allocation

8. CONFIDENTIALITY
   - Definition of Confidential Information
   - Obligations of confidentiality during and after the agreement
   - Permitted disclosures and exclusions
   - Return or destruction of confidential materials

9. REPRESENTATIONS AND WARRANTIES
   - Each party's authority to enter the agreement
   - Compliance with applicable laws
   - No conflicting obligations
   - Accuracy of information provided

10. LIMITATION OF LIABILITY
    - Cap on aggregate liability
    - Exclusion of indirect and consequential damages
    - Exceptions for willful misconduct, fraud, and indemnification obligations

11. INDEMNIFICATION
    - Each party's indemnification obligations
    - Procedures for indemnification claims
    - Limitations on indemnification

12. TERMINATION
    - Termination for convenience with notice period
    - Termination for cause upon material breach
    - Effects of termination: payment, return of property, survival provisions

13. DISPUTE RESOLUTION
    - Good faith negotiation period
    - Mediation as a prerequisite to litigation
    - Jurisdiction and venue for litigation: ${jurisdiction}
    - Prevailing party entitled to recover legal fees

14. GENERAL PROVISIONS
    - Governing law: MUST state "${jurisdiction}" — write "governed by and construed in accordance with the laws of ${jurisdiction}"
    - Entire agreement — supersedes all prior agreements
    - Amendment only by written instrument signed by both parties
    - Severability, no waiver, assignment restrictions, force majeure
    - Notices — manner of delivery and addresses
    - Counterparts and electronic signatures

15. SIGNATURE BLOCK
    - Signature lines for all parties with [NAME], [TITLE], [DATE]

${CONTENT_QUALITY_RULES}`,
};
async function detectDocumentType(situation, auditContext) {
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
    if (auditContext) auditContext.setSystemPrompt(prompt.substring(0, 2000));
    try {
        const detectStart = Date.now();
        const data = await ollamaGenerate({
            model: FAST_MODEL,
            prompt: prompt,
            stream: false,
            think: false,
            options: {
                temperature: 0,
                num_predict: 256,
            },
        }, 60000);
        if (auditContext) {
            auditContext.logLLMCall({
                taskType: 'navigator_detect',
                model: FAST_MODEL,
                prompt: `Detect document type for: ${situation.substring(0, 150)}`,
                response: (data.response || '').substring(0, 500),
                durationMs: Date.now() - detectStart,
                tokens: data.eval_count || 0,
                usedFallback: false,
            });
        }
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
// Required question IDs per document type — must match the IDs used in DOCUMENT_PROMPTS templates
const REQUIRED_QUESTION_IDS = {
    nda: [
        { id: 'direction', question: 'Who needs to keep information confidential?', type: 'select', options: [{ value: 'one-way', label: 'One party only (you\'re sharing information)' }, { value: 'mutual', label: 'Both parties (mutual exchange)' }], required: true },
        { id: 'duration', question: 'How long should the confidentiality last?', type: 'select', options: [{ value: '1', label: '1 year' }, { value: '2', label: '2 years' }, { value: '3', label: '3 years' }, { value: '5', label: '5 years' }, { value: 'perpetual', label: 'Indefinitely' }], required: true },
        { id: 'purpose', question: 'What is the purpose of sharing this information?', type: 'text', required: false },
    ],
    service_agreement: [
        { id: 'service_type', question: 'What type of services will be provided?', type: 'text', required: true },
        { id: 'payment', question: 'How will payment be structured?', type: 'select', options: [{ value: 'fixed', label: 'Fixed project fee' }, { value: 'hourly', label: 'Hourly rate' }, { value: 'milestone', label: 'Milestone-based payments' }, { value: 'retainer', label: 'Monthly retainer' }], required: true },
        { id: 'duration', question: 'What is the expected duration?', type: 'select', options: [{ value: 'one-time', label: 'One-time project' }, { value: 'ongoing', label: 'Ongoing relationship' }, { value: 'fixed', label: 'Fixed term' }], required: true },
    ],
    employment_contract: [
        { id: 'employment_type', question: 'What type of employment?', type: 'select', options: [{ value: 'Full-time', label: 'Full-time' }, { value: 'Part-time', label: 'Part-time' }, { value: 'Fixed-term', label: 'Fixed-term contract' }], required: true },
        { id: 'role', question: 'What is the job title/position?', type: 'text', required: true },
        { id: 'benefits', question: 'What benefits are included?', type: 'text', required: false },
    ],
    lease_agreement: [
        { id: 'property_type', question: 'What type of property?', type: 'select', options: [{ value: 'residential', label: 'Residential' }, { value: 'commercial', label: 'Commercial' }, { value: 'industrial', label: 'Industrial' }], required: true },
        { id: 'lease_duration', question: 'What is the lease duration?', type: 'text', required: true },
        { id: 'rent_amount', question: 'What is the monthly rent amount?', type: 'text', required: false },
    ],
    sales_agreement: [
        { id: 'goods_description', question: 'What goods or products are being sold?', type: 'text', required: true },
        { id: 'payment_terms', question: 'What are the payment terms?', type: 'select', options: [{ value: 'upfront', label: 'Full payment upfront' }, { value: 'installments', label: 'Installments' }, { value: 'on_delivery', label: 'Payment on delivery' }, { value: 'net30', label: 'Net 30 days' }], required: true },
    ],
    partnership_agreement: [
        { id: 'partnership_type', question: 'What type of partnership?', type: 'select', options: [{ value: 'general', label: 'General partnership' }, { value: 'limited', label: 'Limited partnership' }, { value: 'joint_venture', label: 'Joint venture' }], required: true },
        { id: 'profit_sharing', question: 'How should profits and losses be shared?', type: 'text', required: true },
    ],
    loan_agreement: [
        { id: 'loan_amount', question: 'What is the loan amount?', type: 'text', required: true },
        { id: 'interest_rate', question: 'What is the interest rate?', type: 'text', required: true },
        { id: 'repayment_schedule', question: 'What is the repayment schedule?', type: 'select', options: [{ value: 'monthly', label: 'Monthly installments' }, { value: 'quarterly', label: 'Quarterly installments' }, { value: 'lump_sum', label: 'Lump sum at maturity' }, { value: 'custom', label: 'Custom schedule' }], required: true },
    ],
};
async function generateDynamicQuestions(documentType, situation, language, jurisdiction) {
    console.log(`[NAVIGATOR] Generating dynamic questions with ${FAST_MODEL}`);
    const docInfo = exports.DOCUMENT_TYPES[documentType];
    const documentName = docInfo?.name || 'legal document';
    const requiredQuestions = REQUIRED_QUESTION_IDS[documentType] || [];
    // For well-known document types, use the required questions directly
    // and let the LLM add 1-2 situation-specific extras
    if (requiredQuestions.length > 0) {
        const languageInstructions = {
            en: 'Write questions in English.',
            de: 'Write questions in German (Deutsch).',
            fr: 'Write questions in French (Français).',
            es: 'Write questions in Spanish (Español).',
            sk: 'Write questions in Slovak (Slovenčina).',
            ro: 'Write questions in Romanian (Română).',
        };
        const requiredIds = requiredQuestions.map(q => q.id);
        const prompt = `You are a legal document assistant. The user wants to draft a ${documentName}.

USER'S SITUATION:
${situation}

JURISDICTION: ${jurisdiction}
${languageInstructions[language] || languageInstructions.en}

Generate 1-2 ADDITIONAL questions specific to the user's situation that would help draft a better document. These should gather information NOT already covered by the standard questions (${requiredIds.join(', ')}).

Return ONLY a JSON array (no markdown):
[{"id": "unique_id", "question": "...", "type": "text", "required": false}]

If no additional questions are needed, return: []`;
        try {
            const data = await ollamaGenerate({
                model: FAST_MODEL,
                prompt: prompt,
                stream: false,
                think: false,
                options: { temperature: 0, num_predict: 512 },
            }, 30000);
            const jsonMatch = data.response.match(/\[[\s\S]*\]/);
            let extraQuestions = [];
            if (jsonMatch) {
                const sanitizedJson = sanitizeJsonString(jsonMatch[0]);
                const parsed = JSON.parse(sanitizedJson);
                extraQuestions = parsed
                    .filter(q => q.id && q.question && !requiredIds.includes(q.id))
                    .slice(0, 2)
                    .map(q => ({
                        id: String(q.id),
                        question: String(q.question),
                        type: 'text',
                        required: false,
                    }));
            }
            console.log(`[NAVIGATOR] Using ${requiredQuestions.length} required + ${extraQuestions.length} extra questions`);
            return [...requiredQuestions, ...extraQuestions];
        } catch (err) {
            console.warn('[NAVIGATOR] Extra question generation failed, using required only:', err.message);
            return requiredQuestions;
        }
    }
    // Fallback: fully dynamic questions for unknown document types
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
        const data = await ollamaGenerate({
            model: FAST_MODEL,
            prompt: prompt,
            stream: false,
            think: false,
            options: {
                temperature: 0,
                num_predict: 1024,
            },
        }, 60000);
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
const MAX_SITUATION_CHARS = 5000;
async function extractSituationFacts(situation) {
    // Chunk the situation, extract key facts from each chunk, merge
    const CHUNK_SIZE = 4000;
    const OVERLAP = 200;
    const chunks = [];
    let start = 0;
    while (start < situation.length) {
        const end = Math.min(start + CHUNK_SIZE, situation.length);
        chunks.push(situation.substring(start, end));
        start = end - OVERLAP;
        if (start >= situation.length - OVERLAP) break;
    }
    console.log(`[NAVIGATOR] Extracting facts from situation: ${situation.length} chars → ${chunks.length} chunks`);
    const allFacts = [];
    for (const chunk of chunks) {
        try {
            const data = await ollamaGenerate({
                model: FAST_MODEL,
                prompt: `Extract ALL key facts relevant for legal document drafting from this situation description. Include: parties, obligations, dates, amounts, conditions, requirements, jurisdictional details. Be concise but preserve every legally relevant detail.\n\n${chunk}`,
                stream: false,
                think: false,
                options: { num_predict: 1000, temperature: 0 },
            });
            const result = data.response || '';
            if (result.trim()) allFacts.push(result.trim());
        } catch (err) {
            console.warn('[NAVIGATOR] Situation chunk extraction failed:', err.message);
            allFacts.push(chunk); // Fallback: use raw chunk
        }
    }
    const merged = allFacts.join('\n\n');
    console.log(`[NAVIGATOR] Extracted situation facts: ${merged.length} chars (from ${situation.length})`);
    return merged;
}
async function draftDocumentStream(documentType, situation, answers, jurisdiction = 'US', language = 'en', organizationId, onChunk, thinkingBudget = 1, auditContext) {
    if (situation && situation.length > MAX_SITUATION_CHARS) {
        console.log(`[NAVIGATOR] Large situation (${situation.length} chars) — extracting key facts`);
        situation = await extractSituationFacts(situation);
    }
    console.log(`[NAVIGATOR] Drafting ${documentType} document with ${FULL_MODEL} (lang: ${language}, streaming: ${!!onChunk}, thinking: ${thinkingBudget})`);
    const languageInstructions = {
        en: 'Write the document in English. All section headings must be in English.',
        de: 'Schreibe das gesamte Dokument auf Deutsch, einschließlich aller Abschnittsüberschriften. Verwende deutsche Rechtsbegriffe. Section titles in JSON must also be in German (e.g. "VERTRAULICHKEIT" not "CONFIDENTIALITY").',
        fr: 'Rédigez le document en français, y compris tous les titres de sections. Utilisez la terminologie juridique française.',
        es: 'Redacte el documento en español, incluidos todos los títulos de secciones. Utilice la terminología jurídica española.',
        sk: 'Napíšte celý dokument v slovenčine, vrátane všetkých nadpisov sekcií. Použite slovenské právne pojmy.',
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
    // Build a flat summary of ALL user answers so the LLM always sees them,
    // even if the template prompt keys don't match the dynamic question IDs
    let userAnswersSummary = '';
    {
        const lines = [];
        lines.push(`- jurisdiction: ${jurisdiction}`);
        lines.push(`- language: ${language === 'en' ? 'English' : language === 'de' ? 'German' : language === 'sk' ? 'Slovak' : language === 'ro' ? 'Romanian' : language}`);
        if (answers && Object.keys(answers).length > 0) {
            Object.entries(answers)
                .filter(([, v]) => v !== undefined && v !== null && v !== '')
                .forEach(([k, v]) => lines.push(`- ${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}`));
        }
        userAnswersSummary = `\n\nUSER'S SELECTED OPTIONS (you MUST incorporate ALL of these into the document — do NOT ignore or override any of them):\n${lines.join('\n')}`;
    }
    const langReminder = language !== 'en' ? `\n\nREMINDER: The document title, ALL section titles, and ALL content MUST be in ${languageInstructions[language] ? language.toUpperCase() : 'the specified language'}. Translate ALL section headings — do NOT leave them in English.` : '';
    let prompt = `CRITICAL JURISDICTION REQUIREMENT: ${jurisdictionContext}
You MUST draft this document to comply ONLY with ${jurisdiction} law. Do NOT use legal concepts or requirements from other jurisdictions.
DRAFTING RULE: Do NOT cite specific statute section numbers (e.g., "§ 1121 ABGB", "Section 5 UGB") in the contract text. Real contracts state the governing law generally (e.g., "This agreement is governed by Austrian law") but do not reference individual statute sections. Use the legal knowledge to draft correct provisions without citing § numbers.
${mandatoryTermsContext}
LANGUAGE: ${langInstruction}${ragClauseContext}${firmMemoryContext}\n\n${basePrompt}${userAnswersSummary}${langReminder}`;
    if (auditContext) auditContext.setSystemPrompt(prompt.substring(0, 2000));
    const draftStart = Date.now();
    const promptTokensEst = Math.ceil(prompt.length / 3);
    if (promptTokensEst > 28000) {
        console.warn(`[NAVIGATOR] Prompt very large: ${prompt.length} chars (~${promptTokensEst} tokens) — may approach 32K context limit [streaming]`);
    }
    console.log(`[NAVIGATOR] Final prompt: ${prompt.length} chars (~${promptTokensEst} tokens) [streaming]`);
    // Helper: stream from OpenRouter SSE
    async function streamFromOpenRouter(prompt, onToken) {
        const apiKey = process.env.OPENROUTER_API_KEY;
        const orModel = process.env.OPENROUTER_MODEL || 'qwen/qwen3.5-9b';
        if (!apiKey) throw new Error('No OPENROUTER_API_KEY');
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: orModel,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0,
                max_tokens: 16384,
                stream: true,
                reasoning: { effort: 'none' },
                provider: { order: ['Together', 'Venice'], allow_fallbacks: true },
            }),
            signal: AbortSignal.timeout(300000),
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            throw new Error(`OpenRouter ${response.status}: ${errText}`);
        }
        let fullText = '';
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        if (reader) {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
                    try {
                        const data = JSON.parse(line.slice(6));
                        const token = data.choices?.[0]?.delta?.content;
                        if (token) { fullText += token; onToken(token); }
                    } catch {}
                }
            }
        }
        return fullText;
    }
    try {
        if (onChunk) {
            let fullResponse = '';
            // Try OpenRouter streaming first
            if (process.env.OPENROUTER_API_KEY) {
                try {
                    fullResponse = await streamFromOpenRouter(prompt, onChunk);
                } catch (orErr) {
                    console.warn(`[NAVIGATOR] OpenRouter stream failed (${orErr.message}), falling back to Ollama`);
                    fullResponse = '';
                }
            }
            // Fallback: Ollama streaming
            if (!fullResponse) {
                const response = await fetch(`${OLLAMA_URL}/api/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: FULL_MODEL,
                        prompt: prompt,
                        stream: true,
                        think: false,
                        options: {
                            temperature: 0,
                            num_predict: 16384,
                            num_ctx: 32768,
                            top_p: 0.9,
                        },
                    }),
                    dispatcher: llmAgent,
                });
                if (!response.ok) {
                    throw new Error(`Ollama returned ${response.status}`);
                }
                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                if (reader) {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const chunk = decoder.decode(value, { stream: true });
                        const lines = chunk.split('\n').filter(l => l.trim());
                        for (const line of lines) {
                            try {
                                const parsed = JSON.parse(line);
                                if (parsed.response) {
                                    fullResponse += parsed.response;
                                    onChunk(parsed.response);
                                }
                            } catch {}
                        }
                    }
                }
            }
            if (auditContext) {
                auditContext.logLLMCall({
                    taskType: 'navigator_draft',
                    model: FULL_MODEL,
                    prompt: `Draft ${documentType} (${jurisdiction}, streaming)`,
                    response: fullResponse.substring(0, 500),
                    durationMs: Date.now() - draftStart,
                    tokens: 0,
                    usedFallback: false,
                });
                auditContext.setRawResponse(fullResponse.substring(0, 5000));
                auditContext.setResponse(fullResponse.substring(0, 1000), []);
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
        const result = await ollamaGenerate({
            prompt: prompt,
            system: '',
            options: {
                temperature: 0,
                num_predict: 4096,
                top_p: 0.9,
            },
        }, 120000);
        const responseText = result.response || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
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
async function draftDocument(documentType, situation, answers, jurisdiction = 'US', language = 'en', organizationId, auditContext) {
    if (situation && situation.length > MAX_SITUATION_CHARS) {
        console.log(`[NAVIGATOR] Large situation (${situation.length} chars) — extracting key facts`);
        situation = await extractSituationFacts(situation);
    }
    console.log(`[NAVIGATOR] Drafting ${documentType} document with ${FULL_MODEL} (lang: ${language})`);
    const languageInstructions = {
        en: 'Write the document in English. All section headings must be in English.',
        de: 'Schreibe das gesamte Dokument auf Deutsch, einschließlich aller Abschnittsüberschriften. Verwende deutsche Rechtsbegriffe. Section titles in JSON must also be in German (e.g. "VERTRAULICHKEIT" not "CONFIDENTIALITY").',
        fr: 'Rédigez le document en français, y compris tous les titres de sections. Utilisez la terminologie juridique française.',
        es: 'Redacte el documento en español, incluidos todos los títulos de secciones. Utilice la terminología jurídica española.',
        sk: 'Napíšte celý dokument v slovenčine, vrátane všetkých nadpisov sekcií. Použite slovenské právne pojmy.',
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
    // Build a flat summary of ALL user answers so the LLM always sees them,
    // even if the template prompt keys don't match the dynamic question IDs
    let userAnswersSummary2 = '';
    if (answers && Object.keys(answers).length > 0) {
        const lines = Object.entries(answers)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => `- ${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : v}`);
        if (lines.length > 0) {
            userAnswersSummary2 = `\n\nUSER RESPONSES (incorporate ALL of these into the document):\n${lines.join('\n')}`;
        }
    }
    const langReminder2 = language !== 'en' ? `\n\nREMINDER: The document title, ALL section titles, and ALL content MUST be in ${languageInstructions[language] ? language.toUpperCase() : 'the specified language'}. Translate ALL section headings — do NOT leave them in English.` : '';
    let prompt = `CRITICAL JURISDICTION REQUIREMENT: ${jurisdictionContext}
You MUST draft this document to comply ONLY with ${jurisdiction} law. Do NOT use legal concepts or requirements from other jurisdictions.
DRAFTING RULE: Do NOT cite specific statute section numbers (e.g., "§ 1121 ABGB", "Section 5 UGB") in the contract text. Real contracts state the governing law generally (e.g., "This agreement is governed by Austrian law") but do not reference individual statute sections. Use the legal knowledge to draft correct provisions without citing § numbers.
${mandatoryTermsContext}
LANGUAGE: ${langInstruction}${ragClauseContext}${firmMemoryContext}\n\n${basePrompt}${userAnswersSummary2}${langReminder2}`;
    if (auditContext) auditContext.setSystemPrompt(prompt.substring(0, 2000));
    const draftStart2 = Date.now();
    const promptTokensEst2 = Math.ceil(prompt.length / 3);
    if (promptTokensEst2 > 28000) {
        console.warn(`[NAVIGATOR] Prompt very large: ${prompt.length} chars (~${promptTokensEst2} tokens) — may approach 32K context limit`);
    }
    console.log(`[NAVIGATOR] Final prompt: ${prompt.length} chars (~${promptTokensEst2} tokens)`);
    try {
        const result = await ollamaGenerate({
            prompt: prompt,
            system: '',
            options: {
                temperature: 0,
                num_predict: 16384,
                top_p: 0.9,
            },
        }, 180000);
        const responseText = result.response || '';
        if (auditContext) {
            auditContext.logLLMCall({
                taskType: 'navigator_draft',
                model: FULL_MODEL,
                prompt: `Draft ${documentType} (${jurisdiction})`,
                response: responseText.substring(0, 500),
                durationMs: Date.now() - draftStart2,
                tokens: 0,
                usedFallback: false,
            });
            auditContext.setRawResponse(responseText.substring(0, 5000));
            auditContext.setResponse(responseText.substring(0, 1000), []);
        }
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
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
    // Pull statute chunks relevant to this document type from the local
    // legal-text DB. The earlier disconnection was because the drafter
    // hallucinated similar-looking § numbers (e.g. ABGB §§ 1121-1135 made
    // up). We re-enable with strict citation rules added BELOW the sources
    // in the assembled context so the LLM is constrained to exact names.
    //
    // Queries are keyed to documentType + jurisdiction. Limit to 6 sources
    // per query (small enough that the LLM can keep track of them).
    try {
        const { enhancedSearch } = require('../services/rag/retrieval');
        const queryMap = {
            nda: 'confidentiality agreement non-disclosure obligations',
            service_agreement: 'service contract terms payment termination liability',
            employment_contract: 'employment contract notice period termination obligations',
            lease_agreement: 'lease tenancy rent termination notice landlord tenant',
            sales_agreement: 'sales contract warranty defect remedies delivery',
            partnership_agreement: 'partnership agreement contribution liability dissolution',
            loan_agreement: 'loan repayment interest default secured',
            release_waiver: 'release waiver indemnification limitation of liability',
            cease_desist: 'cease and desist demand letter notice',
            power_of_attorney: 'power of attorney authority revocation',
            unknown: 'contract general obligations termination',
        };
        const q = queryMap[documentType] || queryMap.unknown;
        const sources = await enhancedSearch(q, [jurisdiction], { limit: 6, rerank: true });
        if (!sources || sources.length === 0) return '';
        const xml = sources.map((s, i) => {
            const name = (s.source_name || 'Unknown').replace(/[<>&]/g, '');
            const content = (s.content || '').slice(0, 700).replace(/[<>&]/g, c => c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;');
            return `<source index="${i + 1}"><name>${name}</name><excerpt>${content}</excerpt></source>`;
        }).join('\n');
        return `\n\n## Reference statutes (for grounding only — do not cite anything not listed here)\n${xml}\n\nDRAFTING RULES FOR THESE REFERENCES:\n- Use the references above as guidance on what the law requires; do NOT mechanically copy text.\n- When citing a statute section, use the EXACT name from <name> above (e.g. "ABGB § 1093"). NEVER invent a § number that is not present.\n- If your draft would naturally reference a statute you did NOT find above, omit the specific § and use a generic clause instead.\n- A reference being absent from the list above does not mean it does not exist — it means we cannot vouch for it. Better to omit than to fabricate.\n`;
    } catch (e) {
        console.warn('[NAVIGATOR/RAG] getRAGClauseContext failed:', e.message);
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