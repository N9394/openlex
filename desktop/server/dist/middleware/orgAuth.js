"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireOrgRole = requireOrgRole;
exports.requireOrgOwner = requireOrgOwner;
exports.requireOrgAdmin = requireOrgAdmin;
exports.requireOrgMember = requireOrgMember;
exports.requireOrgAccess = requireOrgAccess;
exports.checkSeatPermission = checkSeatPermission;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const ROLE_HIERARCHY = {
    owner: 100,
    admin: 80,
    member: 60,
    viewer: 40,
    guest: 20,
};
function requireOrgRole(minRole) {
    return async (req, res, next) => {
        try {
            const userId = req.user?.userId;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized', message: 'Authentication required' });
                return;
            }
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    organizationId: true,
                    memberRole: true,
                    organization: {
                        select: { ownerUserId: true },
                    },
                },
            });
            if (!user?.organizationId) {
                res.status(403).json({
                    error: 'Forbidden',
                    message: 'Organization membership required',
                });
                return;
            }
            const isOwner = user.organization?.ownerUserId === userId;
            const effectiveRole = isOwner ? 'owner' : (user.memberRole || 'member');
            const userRoleLevel = ROLE_HIERARCHY[effectiveRole] || 0;
            const requiredRoleLevel = ROLE_HIERARCHY[minRole] || 0;
            if (userRoleLevel < requiredRoleLevel) {
                res.status(403).json({
                    error: 'Forbidden',
                    message: `This action requires ${minRole} role or higher`,
                    requiredRole: minRole,
                    currentRole: effectiveRole,
                });
                return;
            }
            req.orgRole = effectiveRole;
            req.organizationId = user.organizationId;
            next();
        }
        catch (error) {
            console.error('[OrgAuth] Error checking role:', error);
            res.status(500).json({ error: 'Failed to verify permissions' });
        }
    };
}
function requireOrgOwner() {
    return requireOrgRole('owner');
}
function requireOrgAdmin() {
    return requireOrgRole('admin');
}
function requireOrgMember() {
    return requireOrgRole('member');
}
function requireOrgAccess(minRole = 'member') {
    return async (req, res, next) => {
        try {
            const userId = req.user?.userId;
            const orgId = req.params.orgId || req.body.organizationId;
            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            if (!orgId) {
                res.status(400).json({ error: 'Organization ID required' });
                return;
            }
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    organizationId: true,
                    memberRole: true,
                },
            });
            if (!user || user.organizationId !== orgId) {
                res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this organization',
                });
                return;
            }
            const org = await prisma.organization.findUnique({
                where: { id: orgId },
                select: { ownerUserId: true },
            });
            const isOwner = org?.ownerUserId === userId;
            const effectiveRole = isOwner ? 'owner' : (user.memberRole || 'member');
            const userRoleLevel = ROLE_HIERARCHY[effectiveRole] || 0;
            const requiredRoleLevel = ROLE_HIERARCHY[minRole] || 0;
            if (userRoleLevel < requiredRoleLevel) {
                res.status(403).json({
                    error: 'Forbidden',
                    message: `This action requires ${minRole} role or higher`,
                });
                return;
            }
            req.orgRole = effectiveRole;
            req.organizationId = orgId;
            next();
        }
        catch (error) {
            console.error('[OrgAuth] Error checking org access:', error);
            res.status(500).json({ error: 'Failed to verify permissions' });
        }
    };
}
async function checkSeatPermission(userId, resourceType, resourceId) {
    return { allowed: true, role: 'user' };
}
//# sourceMappingURL=orgAuth.js.map