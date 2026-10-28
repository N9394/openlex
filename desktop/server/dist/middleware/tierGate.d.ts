import { Request, Response, NextFunction } from 'express';
import { TIERS, TierName, TierFeatures } from '../config/tiers';
declare global {
    namespace Express {
        interface Request {
            effectiveTier?: string;
            tierConfig?: typeof TIERS[TierName];
        }
    }
}
export declare function requireTier(...allowedTiers: TierName[]): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function requireFeature(feature: keyof TierFeatures): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function requireMinTier(minTier: TierName): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function attachTier(req: Request, _res: Response, next: NextFunction): void;
export declare function tierRequiresAuth(tierName: string): boolean;
//# sourceMappingURL=tierGate.d.ts.map