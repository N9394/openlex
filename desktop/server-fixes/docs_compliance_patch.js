// Updated compliance endpoint with audit logging
router.post('/:id/compliance', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const documentId = req.params.id;
        console.log('[Compliance] Starting check for document:', documentId);

        const { AIAuditContext, saveAIAudit, isAuditEnabled } = require('../services/aiAuditService');
        const auditContext = new AIAuditContext(userId, 'compliance_check', `Compliance check for document ${documentId}`);
        auditContext.setRequestMetadata(req.ip, req.headers['user-agent']);

        const document = await prisma.document.findUnique({
            where: { id: documentId },
        });

        if (!document) {
            return res.status(404).json({ error: 'Document not found' });
        }
        if (document.userId !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        let keyClauses = [];
        try {
            keyClauses = document.keyClauses ? JSON.parse(document.keyClauses) : [];
            console.log('[Compliance] Parsed', keyClauses.length, 'clauses');
        } catch (e) {
            console.error('[Compliance] Failed to parse keyClauses:', e.message);
            keyClauses = [];
        }

        if (keyClauses.length === 0) {
            return res.json({ results: [], message: 'No clauses found to check' });
        }

        const { enhancedSearch } = require('../services/rag/retrieval');
        const { callLLM } = require('../services/llmAdapter');

        const results = [];
        const clausesToCheck = keyClauses.slice(0, 5);

        for (const clause of clausesToCheck) {
            const clauseText = clause.content || clause.clause || clause.title || '';
            const clauseTitle = clause.title || clause.category || 'Clause';
            console.log('[Compliance] Checking clause:', clauseTitle);

            if (!clauseText || clauseText.length < 20) {
                console.log('[Compliance] Skipping clause (too short):', clauseTitle);
                continue;
            }

            const searchQuery = clauseTitle + ' legal requirements ' + clauseText.slice(0, 100);
            let sources = [];
            try {
                sources = await enhancedSearch(searchQuery, { jurisdiction: 'AT', limit: 3 });
                console.log('[Compliance] Found', sources.length, 'sources for', clauseTitle);
                auditContext.logRAGSearch({
                    query: searchQuery,
                    jurisdiction: 'AT',
                    resultsCount: sources.length,
                    results: sources.slice(0, 3).map(s => ({
                        id: s.id || '',
                        sourceName: s.source_name || 'Legal Source',
                        relevanceScore: s.score || 0,
                    })),
                });
            } catch (e) {
                console.error('[Compliance] Search failed:', e.message);
                continue;
            }

            if (sources.length === 0) {
                console.log('[Compliance] No sources for clause:', clauseTitle);
                continue;
            }

            const sourceContext = sources.map(s =>
                (s.source_name || 'Legal Source') + ': ' + (s.text || '').slice(0, 500)
            ).join('\n\n');

            const prompt = 'You are a legal compliance checker. Compare this contract clause against the relevant legal provisions.\n\nCONTRACT CLAUSE (' + clauseTitle + '):\n' + clauseText.slice(0, 500) + '\n\nRELEVANT LEGAL PROVISIONS:\n' + sourceContext + '\n\nRespond in this exact JSON format only:\n{"status": "compliant" or "violation" or "review", "statute": "Name of relevant law/section", "explanation": "Brief explanation"}';

            try {
                const clauseStart = Date.now();
                const llmResponse = await callLLM(
                    [{ role: 'user', content: prompt }],
                    { taskType: 'compliance_check', maxTokens: 200, temperature: 0 }
                );

                const responseText = llmResponse.content || llmResponse.response || (typeof llmResponse === 'string' ? llmResponse : JSON.stringify(llmResponse));
                console.log('[Compliance] LLM response:', responseText.slice(0, 300));

                auditContext.logLLMCall({
                    taskType: 'compliance_check',
                    prompt: `Check clause: ${clauseTitle}`,
                    response: responseText.substring(0, 500),
                    durationMs: Date.now() - clauseStart,
                });

                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    console.log('[Compliance] Parsed result:', parsed.status, parsed.statute);
                    results.push({
                        status: parsed.status || 'review',
                        statute: parsed.statute || sources[0]?.source_name || 'Unknown statute',
                        explanation: parsed.explanation || 'Unable to determine compliance',
                        clause: clauseTitle
                    });
                } else {
                    console.log('[Compliance] No JSON found in response');
                }
            } catch (e) {
                console.error('[Compliance] LLM check failed:', e.message);
            }
        }

        if (results.length === 0) {
            results.push({
                status: 'review',
                statute: 'General Review',
                explanation: 'No specific compliance issues identified. Manual review recommended.',
                clause: 'Document'
            });
        }

        // Save audit log
        try {
            auditContext.setResponse(JSON.stringify(results), []);
            const auditOn = await isAuditEnabled(null);
            if (auditOn) await saveAIAudit(auditContext.finalize());
        } catch (_e) { /* non-critical */ }

        console.log('[Compliance] Returning', results.length, 'results');
        res.json({ results });
    } catch (error) {
        console.error('[Compliance] Error:', error);
        next(error);
    }
});
