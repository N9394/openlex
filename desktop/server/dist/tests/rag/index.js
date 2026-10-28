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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.performanceTests = exports.THRESHOLDS = exports.getPerformanceMetrics = exports.runQuickHealthCheck = exports.runPerformanceBenchmarks = exports.hallucinationTests = exports.CITATION_PATTERNS = exports.validateResponse = exports.runHallucinationTests = exports.detectHallucinations = exports.accuracyTests = exports.runRetrievalTests = exports.runAccuracyTests = void 0;
exports.runAllTests = runAllTests;
var accuracy_test_1 = require("./accuracy.test");
Object.defineProperty(exports, "runAccuracyTests", { enumerable: true, get: function () { return accuracy_test_1.runAccuracyTests; } });
Object.defineProperty(exports, "runRetrievalTests", { enumerable: true, get: function () { return accuracy_test_1.runRetrievalTests; } });
Object.defineProperty(exports, "accuracyTests", { enumerable: true, get: function () { return __importDefault(accuracy_test_1).default; } });
var hallucination_test_1 = require("./hallucination.test");
Object.defineProperty(exports, "detectHallucinations", { enumerable: true, get: function () { return hallucination_test_1.detectHallucinations; } });
Object.defineProperty(exports, "runHallucinationTests", { enumerable: true, get: function () { return hallucination_test_1.runHallucinationTests; } });
Object.defineProperty(exports, "validateResponse", { enumerable: true, get: function () { return hallucination_test_1.validateResponse; } });
Object.defineProperty(exports, "CITATION_PATTERNS", { enumerable: true, get: function () { return hallucination_test_1.CITATION_PATTERNS; } });
Object.defineProperty(exports, "hallucinationTests", { enumerable: true, get: function () { return __importDefault(hallucination_test_1).default; } });
var performance_test_1 = require("./performance.test");
Object.defineProperty(exports, "runPerformanceBenchmarks", { enumerable: true, get: function () { return performance_test_1.runPerformanceBenchmarks; } });
Object.defineProperty(exports, "runQuickHealthCheck", { enumerable: true, get: function () { return performance_test_1.runQuickHealthCheck; } });
Object.defineProperty(exports, "getPerformanceMetrics", { enumerable: true, get: function () { return performance_test_1.getPerformanceMetrics; } });
Object.defineProperty(exports, "THRESHOLDS", { enumerable: true, get: function () { return performance_test_1.THRESHOLDS; } });
Object.defineProperty(exports, "performanceTests", { enumerable: true, get: function () { return __importDefault(performance_test_1).default; } });
async function runAllTests() {
    const { runAccuracyTests } = await Promise.resolve().then(() => __importStar(require('./accuracy.test')));
    const { runHallucinationTests } = await Promise.resolve().then(() => __importStar(require('./hallucination.test')));
    const { runPerformanceBenchmarks } = await Promise.resolve().then(() => __importStar(require('./performance.test')));
    console.log('[Tests] Running all RAG tests...');
    const accuracy = await runAccuracyTests();
    const hallucination = await runHallucinationTests();
    const performance = await runPerformanceBenchmarks();
    console.log('[Tests] All tests complete.');
    console.log(`  Accuracy: ${accuracy.passed}/${accuracy.totalTests} passed (${accuracy.passRate.toFixed(1)}%)`);
    console.log(`  Hallucination: ${hallucination.passed}/${hallucination.totalTests} passed`);
    console.log(`  Performance: ${performance.overallHealthy ? 'Healthy' : 'Issues detected'}`);
    return {
        accuracy,
        hallucination,
        performance,
    };
}
//# sourceMappingURL=index.js.map