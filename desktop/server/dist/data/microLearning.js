"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.microLearningLibrary = void 0;
exports.getMicroLearningBite = getMicroLearningBite;
exports.getMicroLearningByCategory = getMicroLearningByCategory;
exports.searchMicroLearning = searchMicroLearning;
exports.microLearningLibrary = [
    {
        id: 'salvatorische-klausel',
        title: 'What is a Salvatorische Klausel (Severability Clause)?',
        category: 'contracts',
        readTime: 2,
        summary: 'Learn why this common clause protects your entire contract if one part becomes invalid.',
        content: `A Salvatorische Klausel, or severability clause, is a safety net for your contract.

**What it does:**
If one part of your contract becomes illegal or unenforceable, this clause ensures the rest of the contract remains valid. Without it, the entire contract could be void if just one clause is problematic.

**Example:**
Imagine a rental contract with 20 clauses. If clause #15 violates local housing law, the severability clause ensures clauses 1-14 and 16-20 still apply. Otherwise, the whole contract might be invalid.

**Why it matters:**
Laws change. Courts interpret differently. A severability clause gives your agreement resilience and prevents complete collapse over a single issue.`,
        keyTakeaways: [
            'Protects the whole contract if one part fails',
            'Common in nearly all professional contracts',
            'Provides legal resilience as laws change',
        ],
        relatedBites: ['contract-basics', 'nda-essentials'],
    },
    {
        id: 'nda-essentials',
        title: 'What Makes an NDA Legally Valid?',
        category: 'contracts',
        readTime: 3,
        summary: 'Understand the key elements that make a Non-Disclosure Agreement enforceable.',
        content: `An NDA (Non-Disclosure Agreement) protects confidential information. But not all NDAs are created equal.

**Essential Elements:**

1. **Clear Definition of Confidential Information**
   What exactly is protected? "All business information" is too vague. "Customer lists, pricing strategies, and product roadmaps" is specific.

2. **Mutual vs. One-Way**
   Does only one party share secrets (one-way), or both (mutual)? This determines who owes what obligations.

3. **Time Limit**
   How long does confidentiality last? Common: 2-5 years. Perpetual confidentiality is hard to enforce except for trade secrets.

4. **Permitted Disclosures**
   When CAN you share? Usually: by law, to lawyers/accountants, if already public.

5. **Return/Destruction Clause**
   What happens to confidential materials when the agreement ends?

**Red Flags:**
- No expiration date
- Overly broad definitions
- No exceptions for legal requirements

A good NDA is balanced: strong enough to protect, reasonable enough to enforce.`,
        keyTakeaways: [
            'Specificity matters - vague NDAs are weak',
            'Time limits make NDAs more enforceable',
            'Must allow disclosure when legally required',
        ],
        relatedBites: ['salvatorische-klausel', 'contract-basics'],
    },
    {
        id: 'gewahrleistung',
        title: 'How Does Gewährleistung Work in Contracts?',
        category: 'consumer',
        readTime: 2,
        summary: 'Learn about warranty obligations and your rights when something goes wrong.',
        content: `Gewährleistung (warranty/guarantee) is the seller's legal obligation when what you bought has defects.

**Two Types:**

**Mangel bei Übergabe (Defect at Delivery)**
The item was already broken when you got it. You have rights immediately.

**Rights Hierarchy:**
1. **Nacherfüllung** (Cure): Demand repair or replacement
2. **Minderung** (Price reduction): Pay less for the flawed item
3. **Rücktritt** (Cancel): Return it and get your money back

**Time Limits:**
- **Notice:** Report defects promptly (immediately for obvious defects)
- **Claims:** Usually 2 years for new goods, 1 year for used goods

**Burden of Proof:**
- First 6 months: Seller must prove item was fine at delivery
- After 6 months: You must prove defect existed at delivery

**Important:**
Gewährleistung is automatic by law. A "Garantie" (guarantee) is an additional, voluntary promise by the seller.`,
        keyTakeaways: [
            'Gewährleistung is automatic legal protection',
            'You have multiple remedy options',
            'Report defects quickly to preserve rights',
        ],
        relatedBites: ['consumer-rights', 'contract-basics'],
    },
    {
        id: 'contract-basics',
        title: 'The Anatomy of a Valid Contract',
        category: 'basics',
        readTime: 3,
        summary: 'Every contract needs these core elements to be legally binding.',
        content: `Not every agreement is a contract. Here's what makes one legally binding:

**1. Offer and Acceptance**
One party proposes terms. The other accepts exactly those terms. "I'll pay you €500 to fix my roof" + "I accept" = contract.

**2. Consideration**
Both sides must give something of value. Money for services, promise for promise. Pure gifts aren't contracts.

**3. Intention to Create Legal Relations**
Casual agreements between friends ("I'll buy you coffee") usually aren't contracts. Business deals usually are.

**4. Capacity**
Both parties must be legally able to contract. Minors, mentally incapacitated persons, or drunk people often can't form valid contracts.

**5. Legality**
The contract's purpose must be legal. A contract to do something illegal is void.

**Writing Requirements:**
Most contracts DON'T need to be written. But some do by law:
- Real estate sales
- Long-term leases
- Certain credit agreements

**Verbal Contracts:**
"But we shook hands!" Verbal contracts ARE valid in most cases. The problem? Proving what was agreed.

**Best Practice:**
Put important agreements in writing, even if not legally required. It prevents disputes.`,
        keyTakeaways: [
            'Five elements: offer, acceptance, consideration, capacity, legality',
            'Most contracts don\'t legally require writing',
            'Write it anyway to avoid disputes',
        ],
        relatedBites: ['nda-essentials', 'salvatorische-klausel'],
    },
    {
        id: 'notice-periods',
        title: 'Understanding Notice Periods and Termination',
        category: 'contracts',
        readTime: 2,
        summary: 'How and when you can end a contract - and what happens if you don\'t follow the rules.',
        content: `Notice periods protect both parties from sudden termination. Here's how they work:

**Why Notice Periods Exist:**
They give both sides time to prepare. An employee can find a new job. An employer can hire a replacement.

**Common Types:**

**1. Ordentliche Kündigung (Regular Termination)**
Normal ending with notice. Must follow agreed timeframes.

**2. Außerordentliche Kündigung (Extraordinary Termination)**
Immediate termination for serious reasons (severe breach, fraud, etc.). Much harder to justify.

**Calculating Notice:**
"30 days notice" usually means from the end of the current month, not from today. Read carefully.

**What If You Don't Give Notice?**
- May owe damages
- Forfeit certain rights or deposits
- Still bound by contract during notice period

**Automatic Renewal:**
Many contracts auto-renew if you don't cancel. Miss the deadline? You're locked in for another term.

**Pro Tip:**
Set calendar reminders for important contract dates. Missing a cancellation deadline can be expensive.`,
        keyTakeaways: [
            'Notice periods protect both parties',
            'Calculate carefully - often month-end based',
            'Track renewal dates to avoid auto-renewal',
        ],
        relatedBites: ['contract-basics'],
    },
];
function getMicroLearningBite(id) {
    return exports.microLearningLibrary.find(bite => bite.id === id);
}
function getMicroLearningByCategory(category) {
    return exports.microLearningLibrary.filter(bite => bite.category === category);
}
function searchMicroLearning(query) {
    const lowerQuery = query.toLowerCase();
    return exports.microLearningLibrary.filter(bite => bite.title.toLowerCase().includes(lowerQuery) ||
        bite.summary.toLowerCase().includes(lowerQuery) ||
        bite.content.toLowerCase().includes(lowerQuery));
}
//# sourceMappingURL=microLearning.js.map