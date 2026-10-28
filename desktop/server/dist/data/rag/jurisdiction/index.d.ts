import { JurisdictionEntry } from './types';
import { NON_COMPETE_KB } from './non-compete';
import { EMPLOYMENT_KB } from './employment';
import { LIMITATIONS_KB } from './limitations';
import { CONTRACT_FORMATION_KB } from './contract-formation';
import { CONSUMER_PROTECTION_KB } from './consumer-protection';
export declare const ALL_JURISDICTION_ENTRIES: JurisdictionEntry[];
export { NON_COMPETE_KB, EMPLOYMENT_KB, LIMITATIONS_KB, CONTRACT_FORMATION_KB, CONSUMER_PROTECTION_KB, };
export * from './types';
export declare const JURISDICTION_STATS: {
    total: number;
    byJurisdiction: Record<string, number>;
    byTopic: Record<string, number>;
    byLanguage: Record<string, number>;
};
//# sourceMappingURL=index.d.ts.map