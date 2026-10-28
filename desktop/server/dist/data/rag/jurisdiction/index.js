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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JURISDICTION_STATS = exports.CONSUMER_PROTECTION_KB = exports.CONTRACT_FORMATION_KB = exports.LIMITATIONS_KB = exports.EMPLOYMENT_KB = exports.NON_COMPETE_KB = exports.ALL_JURISDICTION_ENTRIES = void 0;
const non_compete_1 = require("./non-compete");
Object.defineProperty(exports, "NON_COMPETE_KB", { enumerable: true, get: function () { return non_compete_1.NON_COMPETE_KB; } });
const employment_1 = require("./employment");
Object.defineProperty(exports, "EMPLOYMENT_KB", { enumerable: true, get: function () { return employment_1.EMPLOYMENT_KB; } });
const limitations_1 = require("./limitations");
Object.defineProperty(exports, "LIMITATIONS_KB", { enumerable: true, get: function () { return limitations_1.LIMITATIONS_KB; } });
const contract_formation_1 = require("./contract-formation");
Object.defineProperty(exports, "CONTRACT_FORMATION_KB", { enumerable: true, get: function () { return contract_formation_1.CONTRACT_FORMATION_KB; } });
const consumer_protection_1 = require("./consumer-protection");
Object.defineProperty(exports, "CONSUMER_PROTECTION_KB", { enumerable: true, get: function () { return consumer_protection_1.CONSUMER_PROTECTION_KB; } });
exports.ALL_JURISDICTION_ENTRIES = [
    ...non_compete_1.NON_COMPETE_KB,
    ...employment_1.EMPLOYMENT_KB,
    ...limitations_1.LIMITATIONS_KB,
    ...contract_formation_1.CONTRACT_FORMATION_KB,
    ...consumer_protection_1.CONSUMER_PROTECTION_KB,
];
__exportStar(require("./types"), exports);
exports.JURISDICTION_STATS = {
    total: exports.ALL_JURISDICTION_ENTRIES.length,
    byJurisdiction: exports.ALL_JURISDICTION_ENTRIES.reduce((acc, e) => {
        acc[e.jurisdiction] = (acc[e.jurisdiction] || 0) + 1;
        return acc;
    }, {}),
    byTopic: exports.ALL_JURISDICTION_ENTRIES.reduce((acc, e) => {
        acc[e.topic] = (acc[e.topic] || 0) + 1;
        return acc;
    }, {}),
    byLanguage: exports.ALL_JURISDICTION_ENTRIES.reduce((acc, e) => {
        acc[e.language] = (acc[e.language] || 0) + 1;
        return acc;
    }, {}),
};
//# sourceMappingURL=index.js.map