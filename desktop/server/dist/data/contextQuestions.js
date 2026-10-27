"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextQuestions = void 0;
exports.generateContextualInstructions = generateContextualInstructions;
exports.calculateFormalityLevel = calculateFormalityLevel;
exports.contextQuestions = [
    {
        id: 'relationship',
        question: 'What is your relationship with the other party?',
        type: 'single',
        affects: ['tone', 'formality'],
        options: [
            {
                id: 'first-time',
                label: 'First-time interaction',
                description: 'Never worked with them before',
                impact: 'Document will use formal language and include comprehensive protections',
            },
            {
                id: 'established',
                label: 'Established business relationship',
                description: 'Have worked together successfully before',
                impact: 'Document will be professional but slightly less rigid, maintaining good faith provisions',
            },
            {
                id: 'long-term-partner',
                label: 'Long-term trusted partner',
                description: 'Multiple successful collaborations',
                impact: 'Document will focus on clear expectations while maintaining collaborative tone',
            },
            {
                id: 'family-friend',
                label: 'Family or close friend',
                description: 'Personal relationship',
                impact: 'Document will still be legally sound but use friendlier, more accessible language',
            },
        ],
    },
    {
        id: 'risk-level',
        question: 'What is the financial/risk level of this agreement?',
        type: 'single',
        affects: ['strictness', 'liability'],
        options: [
            {
                id: 'low',
                label: 'Under €1,000',
                description: 'Small project or transaction',
                impact: 'Document will be straightforward and concise, focusing on essential protections',
            },
            {
                id: 'medium',
                label: '€1,000 - €10,000',
                description: 'Moderate financial commitment',
                impact: 'Document will include standard protections and clear payment/termination terms',
            },
            {
                id: 'high',
                label: '€10,000 - €50,000',
                description: 'Significant financial stakes',
                impact: 'Document will include comprehensive liability clauses, detailed payment terms, and strong protections',
            },
            {
                id: 'critical',
                label: 'Over €50,000',
                description: 'Major financial commitment',
                impact: 'Document will have maximum legal protections, detailed contingencies, and strong indemnification clauses',
            },
        ],
    },
    {
        id: 'priorities',
        question: 'What matters most to you? (Select up to 3)',
        type: 'multiple',
        affects: ['tone', 'strictness'],
        options: [
            {
                id: 'payment-security',
                label: 'Getting paid on time',
                description: 'Ensure clear payment terms and late fee provisions',
                impact: 'Adds detailed payment schedules, late fees, and collection rights',
            },
            {
                id: 'flexibility',
                label: 'Flexibility and adaptability',
                description: 'Ability to modify terms if circumstances change',
                impact: 'Includes amendment procedures and change order processes',
            },
            {
                id: 'liability-protection',
                label: 'Protecting myself from liability',
                description: 'Limit my exposure to legal claims',
                impact: 'Adds liability caps, indemnification, and disclaimer clauses',
            },
            {
                id: 'ip-protection',
                label: 'Protecting my intellectual property',
                description: 'Keep ownership of my work/ideas',
                impact: 'Includes strong IP ownership clauses and usage restrictions',
            },
            {
                id: 'confidentiality',
                label: 'Maintaining confidentiality',
                description: 'Keep sensitive information private',
                impact: 'Adds comprehensive NDA provisions and data protection clauses',
            },
            {
                id: 'easy-exit',
                label: 'Easy termination',
                description: 'Ability to end agreement without penalty',
                impact: 'Includes flexible termination clauses with short notice periods',
            },
        ],
    },
    {
        id: 'experience',
        question: 'How familiar are you with this type of agreement?',
        type: 'single',
        affects: ['formality', 'tone'],
        options: [
            {
                id: 'first-time',
                label: 'First time dealing with this',
                description: 'Need extra clarity and guidance',
                impact: 'Document will include explanatory notes and plain language summaries',
            },
            {
                id: 'some-experience',
                label: 'I have some experience',
                description: 'Familiar with basic concepts',
                impact: 'Document will use standard legal terms with brief explanations where needed',
            },
            {
                id: 'experienced',
                label: 'I do this regularly',
                description: 'Know what I\'m doing',
                impact: 'Document will use professional legal terminology without extra explanations',
            },
        ],
    },
    {
        id: 'negotiation-power',
        question: 'What is your position in this negotiation?',
        type: 'single',
        affects: ['strictness', 'tone'],
        options: [
            {
                id: 'strong',
                label: 'I have leverage',
                description: 'They need me more than I need them',
                impact: 'Document will include more favorable terms and stronger protections for you',
            },
            {
                id: 'balanced',
                label: 'Equal footing',
                description: 'Fair negotiation between equals',
                impact: 'Document will have balanced terms that are fair to both parties',
            },
            {
                id: 'weak',
                label: 'They have leverage',
                description: 'I need this more than they do',
                impact: 'Document will focus on protecting your minimum requirements while being acceptable',
            },
        ],
    },
];
function generateContextualInstructions(context) {
    const instructions = [];
    switch (context.relationship) {
        case 'first-time':
            instructions.push('Use formal, professional language');
            instructions.push('Include comprehensive legal protections');
            break;
        case 'established':
            instructions.push('Use professional but approachable tone');
            instructions.push('Balance protection with good faith');
            break;
        case 'long-term-partner':
            instructions.push('Use collaborative, partnership-focused language');
            instructions.push('Emphasize mutual success');
            break;
        case 'family-friend':
            instructions.push('Use clear, friendly language while maintaining legal validity');
            instructions.push('Focus on preventing misunderstandings');
            break;
    }
    switch (context.riskLevel) {
        case 'low':
            instructions.push('Keep document concise and essential');
            break;
        case 'medium':
            instructions.push('Include standard business protections');
            instructions.push('Add clear payment and termination terms');
            break;
        case 'high':
            instructions.push('Include comprehensive liability protections');
            instructions.push('Add detailed payment terms with late fees');
            instructions.push('Include strong indemnification clauses');
            break;
        case 'critical':
            instructions.push('Maximum legal protections required');
            instructions.push('Include detailed contingency plans');
            instructions.push('Add comprehensive dispute resolution procedures');
            break;
    }
    if (context.priority) {
        if (context.priority.includes('payment-security')) {
            instructions.push('Add detailed payment schedule with milestones');
            instructions.push('Include late fee provisions and collection rights');
        }
        if (context.priority.includes('flexibility')) {
            instructions.push('Include amendment and change order procedures');
            instructions.push('Add provisions for scope changes');
        }
        if (context.priority.includes('liability-protection')) {
            instructions.push('Add liability caps and limitations');
            instructions.push('Include comprehensive indemnification clauses');
        }
        if (context.priority.includes('ip-protection')) {
            instructions.push('Include strong intellectual property ownership clauses');
            instructions.push('Add usage restrictions and licensing terms');
        }
        if (context.priority.includes('confidentiality')) {
            instructions.push('Add comprehensive NDA provisions');
            instructions.push('Include data protection and privacy clauses');
        }
        if (context.priority.includes('easy-exit')) {
            instructions.push('Include flexible termination clauses');
            instructions.push('Short notice periods (30 days or less)');
        }
    }
    switch (context.experience) {
        case 'first-time':
            instructions.push('Include plain language summaries for each section');
            instructions.push('Add explanatory notes where needed');
            break;
        case 'some-experience':
            instructions.push('Use standard legal terminology with brief explanations');
            break;
        case 'experienced':
            instructions.push('Use professional legal terminology without extra explanations');
            break;
    }
    switch (context.negotiationPower) {
        case 'strong':
            instructions.push('Include terms favorable to you');
            instructions.push('Add strong protections for your interests');
            break;
        case 'balanced':
            instructions.push('Create balanced, fair terms for both parties');
            break;
        case 'weak':
            instructions.push('Focus on protecting minimum requirements');
            instructions.push('Keep terms acceptable and reasonable');
            break;
    }
    return instructions.join('\n- ');
}
function calculateFormalityLevel(context) {
    let level = 3;
    if (context.relationship === 'family-friend')
        level -= 1;
    if (context.relationship === 'first-time')
        level += 1;
    if (context.riskLevel === 'low')
        level -= 1;
    if (context.riskLevel === 'high' || context.riskLevel === 'critical')
        level += 1;
    if (context.experience === 'first-time')
        level -= 1;
    if (context.experience === 'experienced')
        level += 1;
    return Math.max(1, Math.min(5, level));
}
//# sourceMappingURL=contextQuestions.js.map