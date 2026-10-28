import { Request, Response, NextFunction } from 'express';
declare const ROLE_HIERARCHY: Record<string, number>;
export type OrgRole = keyof typeof ROLE_HIERARCHY;
export declare function requireOrgRole(minRole: OrgRole): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function requireOrgOwner(): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function requireOrgAdmin(): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function requireOrgMember(): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function requireOrgAccess(minRole?: OrgRole): (req: Request, res: Response, next: NextFunction) => Promise<void>;
export declare function checkSeatPermission(userId: string, resourceType: 'client' | 'case', resourceId: string): Promise<{
    allowed: boolean;
    role?: string;
}>;
declare global {
    namespace Express {
        interface Request {
            orgRole?: OrgRole;
            organizationId?: string;
        }
    }
}
export {};
//# sourceMappingURL=orgAuth.d.ts.map