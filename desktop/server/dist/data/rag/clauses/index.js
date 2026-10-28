"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLAUSE_STATS = exports.FRANCHISE_CLAUSES = exports.LOAN_CLAUSES = exports.PRIVACY_CLAUSES = exports.TOS_CLAUSES = exports.POA_CLAUSES = exports.SETTLEMENT_CLAUSES = exports.LICENSE_CLAUSES = exports.SHAREHOLDER_CLAUSES = exports.OPERATING_CLAUSES = exports.PARTNERSHIP_CLAUSES = exports.CONSULTING_CLAUSES = exports.PURCHASE_CLAUSES = exports.LEASE_CLAUSES = exports.SERVICE_CLAUSES = exports.EMPLOYMENT_CLAUSES = exports.NDA_CLAUSES = exports.ALL_CLAUSES = void 0;
const nda_1 = require("./nda");
Object.defineProperty(exports, "NDA_CLAUSES", { enumerable: true, get: function () { return nda_1.NDA_CLAUSES; } });
const employment_1 = require("./employment");
Object.defineProperty(exports, "EMPLOYMENT_CLAUSES", { enumerable: true, get: function () { return employment_1.EMPLOYMENT_CLAUSES; } });
const service_1 = require("./service");
Object.defineProperty(exports, "SERVICE_CLAUSES", { enumerable: true, get: function () { return service_1.SERVICE_CLAUSES; } });
const lease_1 = require("./lease");
Object.defineProperty(exports, "LEASE_CLAUSES", { enumerable: true, get: function () { return lease_1.LEASE_CLAUSES; } });
const purchase_1 = require("./purchase");
Object.defineProperty(exports, "PURCHASE_CLAUSES", { enumerable: true, get: function () { return purchase_1.PURCHASE_CLAUSES; } });
const consulting_1 = require("./consulting");
Object.defineProperty(exports, "CONSULTING_CLAUSES", { enumerable: true, get: function () { return consulting_1.CONSULTING_CLAUSES; } });
const partnership_1 = require("./partnership");
Object.defineProperty(exports, "PARTNERSHIP_CLAUSES", { enumerable: true, get: function () { return partnership_1.PARTNERSHIP_CLAUSES; } });
const operating_1 = require("./operating");
Object.defineProperty(exports, "OPERATING_CLAUSES", { enumerable: true, get: function () { return operating_1.OPERATING_CLAUSES; } });
const shareholder_1 = require("./shareholder");
Object.defineProperty(exports, "SHAREHOLDER_CLAUSES", { enumerable: true, get: function () { return shareholder_1.SHAREHOLDER_CLAUSES; } });
const license_1 = require("./license");
Object.defineProperty(exports, "LICENSE_CLAUSES", { enumerable: true, get: function () { return license_1.LICENSE_CLAUSES; } });
const settlement_1 = require("./settlement");
Object.defineProperty(exports, "SETTLEMENT_CLAUSES", { enumerable: true, get: function () { return settlement_1.SETTLEMENT_CLAUSES; } });
const poa_1 = require("./poa");
Object.defineProperty(exports, "POA_CLAUSES", { enumerable: true, get: function () { return poa_1.POA_CLAUSES; } });
const tos_1 = require("./tos");
Object.defineProperty(exports, "TOS_CLAUSES", { enumerable: true, get: function () { return tos_1.TOS_CLAUSES; } });
const privacy_1 = require("./privacy");
Object.defineProperty(exports, "PRIVACY_CLAUSES", { enumerable: true, get: function () { return privacy_1.PRIVACY_CLAUSES; } });
const loan_1 = require("./loan");
Object.defineProperty(exports, "LOAN_CLAUSES", { enumerable: true, get: function () { return loan_1.LOAN_CLAUSES; } });
const franchise_1 = require("./franchise");
Object.defineProperty(exports, "FRANCHISE_CLAUSES", { enumerable: true, get: function () { return franchise_1.FRANCHISE_CLAUSES; } });
exports.ALL_CLAUSES = [
    ...nda_1.NDA_CLAUSES,
    ...employment_1.EMPLOYMENT_CLAUSES,
    ...service_1.SERVICE_CLAUSES,
    ...lease_1.LEASE_CLAUSES,
    ...purchase_1.PURCHASE_CLAUSES,
    ...consulting_1.CONSULTING_CLAUSES,
    ...partnership_1.PARTNERSHIP_CLAUSES,
    ...operating_1.OPERATING_CLAUSES,
    ...shareholder_1.SHAREHOLDER_CLAUSES,
    ...license_1.LICENSE_CLAUSES,
    ...settlement_1.SETTLEMENT_CLAUSES,
    ...poa_1.POA_CLAUSES,
    ...tos_1.TOS_CLAUSES,
    ...privacy_1.PRIVACY_CLAUSES,
    ...loan_1.LOAN_CLAUSES,
    ...franchise_1.FRANCHISE_CLAUSES,
];
exports.CLAUSE_STATS = {
    total: exports.ALL_CLAUSES.length,
    byCategory: exports.ALL_CLAUSES.reduce((acc, c) => {
        acc[c.category] = (acc[c.category] || 0) + 1;
        return acc;
    }, {}),
    byLanguage: exports.ALL_CLAUSES.reduce((acc, c) => {
        acc[c.language] = (acc[c.language] || 0) + 1;
        return acc;
    }, {}),
    byDocumentType: exports.ALL_CLAUSES.reduce((acc, c) => {
        c.documentTypes.forEach((dt) => {
            acc[dt] = (acc[dt] || 0) + 1;
        });
        return acc;
    }, {}),
};
//# sourceMappingURL=index.js.map