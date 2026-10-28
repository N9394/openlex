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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlerRegistry = exports.initializeScheduler = exports.getCrawlerStats = exports.getCrawlHistory = exports.runAllCrawlers = exports.runScheduledCrawls = exports.runCrawler = exports.updateSchedule = exports.getSchedules = exports.createJustiaCrawler = exports.JustiaCrawler = exports.createCanLIICrawler = exports.CanLIICrawler = exports.createGermanLawCrawler = exports.GermanLawCrawler = exports.createEURLexCrawler = exports.EURLexCrawler = exports.createBAILIICrawler = exports.BAILIICrawler = void 0;
__exportStar(require("./types"), exports);
const bailiiCrawler_1 = require("./bailiiCrawler");
const eurlexCrawler_1 = require("./eurlexCrawler");
const germanLawCrawler_1 = require("./germanLawCrawler");
const canliiCrawler_1 = require("./canliiCrawler");
const justiaCrawler_1 = require("./justiaCrawler");
var bailiiCrawler_2 = require("./bailiiCrawler");
Object.defineProperty(exports, "BAILIICrawler", { enumerable: true, get: function () { return __importDefault(bailiiCrawler_2).default; } });
Object.defineProperty(exports, "createBAILIICrawler", { enumerable: true, get: function () { return bailiiCrawler_2.createBAILIICrawler; } });
var eurlexCrawler_2 = require("./eurlexCrawler");
Object.defineProperty(exports, "EURLexCrawler", { enumerable: true, get: function () { return __importDefault(eurlexCrawler_2).default; } });
Object.defineProperty(exports, "createEURLexCrawler", { enumerable: true, get: function () { return eurlexCrawler_2.createEURLexCrawler; } });
var germanLawCrawler_2 = require("./germanLawCrawler");
Object.defineProperty(exports, "GermanLawCrawler", { enumerable: true, get: function () { return __importDefault(germanLawCrawler_2).default; } });
Object.defineProperty(exports, "createGermanLawCrawler", { enumerable: true, get: function () { return germanLawCrawler_2.createGermanLawCrawler; } });
var canliiCrawler_2 = require("./canliiCrawler");
Object.defineProperty(exports, "CanLIICrawler", { enumerable: true, get: function () { return __importDefault(canliiCrawler_2).default; } });
Object.defineProperty(exports, "createCanLIICrawler", { enumerable: true, get: function () { return canliiCrawler_2.createCanLIICrawler; } });
var justiaCrawler_2 = require("./justiaCrawler");
Object.defineProperty(exports, "JustiaCrawler", { enumerable: true, get: function () { return __importDefault(justiaCrawler_2).default; } });
Object.defineProperty(exports, "createJustiaCrawler", { enumerable: true, get: function () { return justiaCrawler_2.createJustiaCrawler; } });
var scheduler_1 = require("./scheduler");
Object.defineProperty(exports, "getSchedules", { enumerable: true, get: function () { return scheduler_1.getSchedules; } });
Object.defineProperty(exports, "updateSchedule", { enumerable: true, get: function () { return scheduler_1.updateSchedule; } });
Object.defineProperty(exports, "runCrawler", { enumerable: true, get: function () { return scheduler_1.runCrawler; } });
Object.defineProperty(exports, "runScheduledCrawls", { enumerable: true, get: function () { return scheduler_1.runScheduledCrawls; } });
Object.defineProperty(exports, "runAllCrawlers", { enumerable: true, get: function () { return scheduler_1.runAllCrawlers; } });
Object.defineProperty(exports, "getCrawlHistory", { enumerable: true, get: function () { return scheduler_1.getCrawlHistory; } });
Object.defineProperty(exports, "getCrawlerStats", { enumerable: true, get: function () { return scheduler_1.getCrawlerStats; } });
Object.defineProperty(exports, "initializeScheduler", { enumerable: true, get: function () { return scheduler_1.initializeScheduler; } });
exports.crawlerRegistry = {
    bailii: {
        name: 'BAILII',
        description: 'British and Irish Legal Information Institute - UK/Ireland case law',
        jurisdictions: ['UK', 'IE'],
        contentTypes: ['case_law'],
        create: bailiiCrawler_1.createBAILIICrawler,
    },
    eurlex: {
        name: 'EUR-Lex',
        description: 'Official EU law database - Regulations, Directives, Treaties, CJEU cases',
        jurisdictions: ['EU'],
        contentTypes: ['regulation', 'directive', 'treaty', 'case_law'],
        create: eurlexCrawler_1.createEURLexCrawler,
    },
    germanlaw: {
        name: 'Gesetze im Internet',
        description: 'German federal law database - Bundesgesetze',
        jurisdictions: ['DE'],
        contentTypes: ['statute'],
        create: germanLawCrawler_1.createGermanLawCrawler,
    },
    canlii: {
        name: 'CanLII',
        description: 'Canadian Legal Information Institute - Federal and provincial case law and legislation',
        jurisdictions: ['CA'],
        contentTypes: ['case_law', 'statute'],
        create: canliiCrawler_1.createCanLIICrawler,
    },
    justia: {
        name: 'Justia',
        description: 'US legal database - Supreme Court and federal appellate cases',
        jurisdictions: ['US'],
        contentTypes: ['case_law'],
        create: justiaCrawler_1.createJustiaCrawler,
    },
};
//# sourceMappingURL=index.js.map