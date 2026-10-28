"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CASE_STATS = exports.CONTRACT_CASES = exports.ALL_CASES = void 0;
const contracts_1 = require("./contracts");
Object.defineProperty(exports, "CONTRACT_CASES", { enumerable: true, get: function () { return contracts_1.CONTRACT_CASES; } });
exports.ALL_CASES = [
    ...contracts_1.CONTRACT_CASES,
];
exports.CASE_STATS = {
    total: exports.ALL_CASES.length,
    byJurisdiction: exports.ALL_CASES.reduce((acc, c) => {
        const jur = c.jurisdiction.split('-')[0];
        acc[jur] = (acc[jur] || 0) + 1;
        return acc;
    }, {}),
    byTopic: exports.ALL_CASES.reduce((acc, c) => {
        c.topics.forEach((topic) => {
            acc[topic] = (acc[topic] || 0) + 1;
        });
        return acc;
    }, {}),
    bySignificance: exports.ALL_CASES.reduce((acc, c) => {
        acc[c.significance] = (acc[c.significance] || 0) + 1;
        return acc;
    }, {}),
};
//# sourceMappingURL=index.js.map