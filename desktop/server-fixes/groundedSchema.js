// Generates a constrained JSON schema that only allows citing provided sources
function generateGroundedSchema(sources) {
    const sourceNames = sources.map(s => s.title || s.source_name || 'Unknown Source');
    
    return {
        type: 'object',
        properties: {
            summary: {
                type: 'string',
                description: 'Brief 1-2 sentence answer to the question'
            },
            grounded_claims: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        source_name: {
                            type: 'string',
                            enum: sourceNames  // CRITICAL: Only allow provided source names
                        },
                        quote: {
                            type: 'string',
                            description: 'Exact text from the source'
                        },
                        claim: {
                            type: 'string', 
                            description: 'What this quote means for the question'
                        }
                    },
                    required: ['source_name', 'quote', 'claim']
                }
            },
            limitations: {
                type: 'string',
                description: 'What the sources do not cover'
            }
        },
        required: ['summary', 'grounded_claims', 'limitations']
    };
}

// Convert structured response back to readable markdown
function formatGroundedResponse(jsonResponse) {
    const data = typeof jsonResponse === 'string' ? JSON.parse(jsonResponse) : jsonResponse;
    
    let markdown = '## Summary\n\n' + data.summary + '\n\n';
    
    if (data.grounded_claims && data.grounded_claims.length > 0) {
        markdown += '## Legal Basis\n\n';
        for (const claim of data.grounded_claims) {
            markdown += '**' + claim.source_name + '**\n';
            markdown += '> "' + claim.quote + '"\n\n';
            markdown += claim.claim + '\n\n';
        }
    }
    
    if (data.limitations) {
        markdown += '---\n\n**Note:** ' + data.limitations;
    }
    
    return markdown;
}

module.exports = { generateGroundedSchema, formatGroundedResponse };
