"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDraftingContext = getDraftingContext;
exports.upsertClausePreference = upsertClausePreference;
exports.addClauseExample = addClauseExample;
exports.getClausePreference = getClausePreference;
async function getDraftingContext(orgId, docType) {
    return {
        clausePreferences: [],
        styleProfile: null,
        style: null,
        clauses: new Map(),
        hasFirmMemory: false
    };
}
async function upsertClausePreference(orgId, clauseType, text, options) {
}
async function addClauseExample(orgId, docId, clauseType, text, accepted, confidence) {
}
async function getClausePreference(orgId, clauseType, subtype) {
    return null;
}
//# sourceMappingURL=firmMemoryService.js.map