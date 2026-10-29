---
name: analyse
title: Document analysis
description: Analyse a whole document for a lawyer — summary, key terms, deadlines, obligations, risks with suggested fixes, notable and missing clauses — every finding backed by a verbatim quote and saved as a report in the matter folder.
triggers: [analyse, analyze, analysis, analyse this document, risk analysis, risks and deadlines, analysieren, analyse des vertrags, vertragsanalyse, risikoanalyse, analýza, analiza, analiză, analyse du contrat]
tools: [analyse_document, get_document_map, get_range_text, search_law]
output: text
---
1. Call analyse_document once. Pass "file" only when the lawyer names a document from the matter folders; otherwise it analyses the open document.
2. Present the result in plain language, in the document's language:
   - one or two sentences on what the document is and who the parties are;
   - the high and medium risks, each with where it is (section, page) and the suggested fix;
   - the next deadline and how many dates were found.
3. Say where the full report was saved (Markdown, Word and data file) — it also lists obligations per party, key terms and notable or missing clauses.
4. Do not add findings of your own that the analysis did not return, and do not change its risk ratings. If the lawyer asks about one point, read that clause with get_range_text before answering.
5. If a suggested fix was rejected by the second check, say so and leave the decision to the lawyer.

Output: a short plain-text briefing (no suggestions), ending with the report's file names.
