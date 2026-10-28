export * from './types';
import { createBAILIICrawler } from './bailiiCrawler';
import { createEURLexCrawler } from './eurlexCrawler';
import { createGermanLawCrawler } from './germanLawCrawler';
import { createCanLIICrawler } from './canliiCrawler';
import { createJustiaCrawler } from './justiaCrawler';
export { default as BAILIICrawler, createBAILIICrawler } from './bailiiCrawler';
export { default as EURLexCrawler, createEURLexCrawler } from './eurlexCrawler';
export { default as GermanLawCrawler, createGermanLawCrawler } from './germanLawCrawler';
export { default as CanLIICrawler, createCanLIICrawler } from './canliiCrawler';
export { default as JustiaCrawler, createJustiaCrawler } from './justiaCrawler';
export { getSchedules, updateSchedule, runCrawler, runScheduledCrawls, runAllCrawlers, getCrawlHistory, getCrawlerStats, initializeScheduler, } from './scheduler';
export declare const crawlerRegistry: {
    readonly bailii: {
        readonly name: "BAILII";
        readonly description: "British and Irish Legal Information Institute - UK/Ireland case law";
        readonly jurisdictions: readonly ["UK", "IE"];
        readonly contentTypes: readonly ["case_law"];
        readonly create: typeof createBAILIICrawler;
    };
    readonly eurlex: {
        readonly name: "EUR-Lex";
        readonly description: "Official EU law database - Regulations, Directives, Treaties, CJEU cases";
        readonly jurisdictions: readonly ["EU"];
        readonly contentTypes: readonly ["regulation", "directive", "treaty", "case_law"];
        readonly create: typeof createEURLexCrawler;
    };
    readonly germanlaw: {
        readonly name: "Gesetze im Internet";
        readonly description: "German federal law database - Bundesgesetze";
        readonly jurisdictions: readonly ["DE"];
        readonly contentTypes: readonly ["statute"];
        readonly create: typeof createGermanLawCrawler;
    };
    readonly canlii: {
        readonly name: "CanLII";
        readonly description: "Canadian Legal Information Institute - Federal and provincial case law and legislation";
        readonly jurisdictions: readonly ["CA"];
        readonly contentTypes: readonly ["case_law", "statute"];
        readonly create: typeof createCanLIICrawler;
    };
    readonly justia: {
        readonly name: "Justia";
        readonly description: "US legal database - Supreme Court and federal appellate cases";
        readonly jurisdictions: readonly ["US"];
        readonly contentTypes: readonly ["case_law"];
        readonly create: typeof createJustiaCrawler;
    };
};
export type CrawlerName = keyof typeof crawlerRegistry;
//# sourceMappingURL=index.d.ts.map