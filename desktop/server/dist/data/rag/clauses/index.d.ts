import { ClauseTemplate } from '../../../services/rag/types';
import { NDA_CLAUSES } from './nda';
import { EMPLOYMENT_CLAUSES } from './employment';
import { SERVICE_CLAUSES } from './service';
import { LEASE_CLAUSES } from './lease';
import { PURCHASE_CLAUSES } from './purchase';
import { CONSULTING_CLAUSES } from './consulting';
import { PARTNERSHIP_CLAUSES } from './partnership';
import { OPERATING_CLAUSES } from './operating';
import { SHAREHOLDER_CLAUSES } from './shareholder';
import { LICENSE_CLAUSES } from './license';
import { SETTLEMENT_CLAUSES } from './settlement';
import { POA_CLAUSES } from './poa';
import { TOS_CLAUSES } from './tos';
import { PRIVACY_CLAUSES } from './privacy';
import { LOAN_CLAUSES } from './loan';
import { FRANCHISE_CLAUSES } from './franchise';
export declare const ALL_CLAUSES: ClauseTemplate[];
export { NDA_CLAUSES, EMPLOYMENT_CLAUSES, SERVICE_CLAUSES, LEASE_CLAUSES, PURCHASE_CLAUSES, CONSULTING_CLAUSES, PARTNERSHIP_CLAUSES, OPERATING_CLAUSES, SHAREHOLDER_CLAUSES, LICENSE_CLAUSES, SETTLEMENT_CLAUSES, POA_CLAUSES, TOS_CLAUSES, PRIVACY_CLAUSES, LOAN_CLAUSES, FRANCHISE_CLAUSES, };
export declare const CLAUSE_STATS: {
    total: number;
    byCategory: Record<string, number>;
    byLanguage: Record<string, number>;
    byDocumentType: Record<string, number>;
};
//# sourceMappingURL=index.d.ts.map