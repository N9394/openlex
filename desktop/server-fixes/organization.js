"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const orgAuth_1 = require("../middleware/orgAuth");
const crypto_1 = require("crypto");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();

const bcrypt_1 = __importDefault(require("bcrypt"));

// Helper: hash a password
async function hashPassword(password) {
    return bcrypt_1.default.hash(password, 10);
}

// ─── POST / — Create organization ──────────────────────────────────────────
router.post('/', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { name, slug } = req.body;

        if (!name || !slug) {
            return res.status(400).json({ error: 'Name and slug are required' });
        }

        // Validate slug: lowercase alphanumeric + hyphens, 3-40 chars
        const slugRegex = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
        if (!slugRegex.test(slug)) {
            return res.status(400).json({ error: 'Slug must be 3-40 chars, lowercase letters, numbers, and hyphens only' });
        }

        // Check if user already belongs to an org
        const existingUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { organizationId: true },
        });
        if (existingUser?.organizationId) {
            return res.status(409).json({ error: 'You already belong to an organization' });
        }

        // Check slug uniqueness
        const existingOrg = await prisma.organization.findUnique({ where: { slug } });
        if (existingOrg) {
            return res.status(409).json({ error: 'This slug is already taken' });
        }

        // Create org + update user + create owner seat in a transaction
        const result = await prisma.$transaction(async (tx) => {
            const org = await tx.organization.create({
                data: {
                    name,
                    slug,
                    ownerUserId: userId,
                    tier: 'team',
                },
            });

            await tx.user.update({
                where: { id: userId },
                data: {
                    organizationId: org.id,
                    memberRole: 'owner',
                },
            });

            await tx.seat.create({
                data: {
                    organizationId: org.id,
                    userId,
                    seatType: 'admin',
                    status: 'active',
                    isActive: true,
                    assignedAt: new Date(),
                },
            });

            return org;
        });

        console.log(`[ORG] Organization created: ${result.name} (${result.slug}) by user ${userId}`);

        res.status(201).json({
            organization: {
                id: result.id,
                name: result.name,
                slug: result.slug,
                isOwner: true,
            },
        });
    } catch (error) {
        next(error);
    }
});

// ─── GET / — Get my organization info ──────────────────────────────────────
router.get('/', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                organizationId: true,
                memberRole: true,
                organization: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        ownerUserId: true,
                        tier: true,
                        createdAt: true,
                        _count: { select: { members: true, seats: true } },
                    },
                },
            },
        });

        if (!user?.organizationId || !user.organization) {
            return res.json({ organization: null });
        }

        const org = user.organization;
        res.json({
            organization: {
                id: org.id,
                name: org.name,
                slug: org.slug,
                tier: org.tier,
                isOwner: org.ownerUserId === userId,
                memberCount: org._count.members,
                seatCount: org._count.seats,
                createdAt: org.createdAt,
            },
        });
    } catch (error) {
        next(error);
    }
});

// ─── GET /seats — List seats (admin+) ──────────────────────────────────────
router.get('/seats', auth_1.authenticateToken, (0, orgAuth_1.requireOrgAdmin)(), async (req, res, next) => {
    try {
        const orgId = req.organizationId;

        const seats = await prisma.seat.findMany({
            where: { organizationId: orgId },
            include: {
                // Join user data if seat is assigned
            },
            orderBy: { createdAt: 'asc' },
        });

        // Fetch user data for assigned seats
        const userIds = seats.filter(s => s.userId).map(s => s.userId);
        const users = userIds.length > 0 ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: {
                id: true,
                email: true,
                name: true,
                username: true,
                lastLoginAt: true,
                memberRole: true,
            },
        }) : [];
        const userMap = new Map(users.map(u => [u.id, u]));

        const result = seats.map(seat => {
            const user = seat.userId ? userMap.get(seat.userId) : null;
            return {
                id: seat.id,
                userId: seat.userId,
                email: user?.email || seat.email || null,
                name: user?.name || user?.username || null,
                seatType: seat.seatType,
                status: seat.status,
                isActive: seat.isActive,
                memberRole: user?.memberRole || null,
                lastActive: user?.lastLoginAt || null,
                assignedAt: seat.assignedAt,
                createdAt: seat.createdAt,
            };
        });

        res.json({ seats: result });
    } catch (error) {
        next(error);
    }
});

// ─── POST /seats — Invite member by email (admin+) ──────────────────────
router.post('/seats', auth_1.authenticateToken, (0, orgAuth_1.requireOrgAdmin)(), async (req, res, next) => {
    try {
        const orgId = req.organizationId;
        const adminUserId = req.user.userId;
        const { email, role } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const validRoles = ['admin', 'member'];
        const seatRole = validRoles.includes(role) ? role : 'member';

        // Check if seat already exists for this email in this org
        const existingSeat = await prisma.seat.findFirst({
            where: { organizationId: orgId, email },
        });
        if (existingSeat) {
            return res.status(409).json({ error: 'This email has already been invited' });
        }

        // Check if already invited (pending invitation)
        const existingInvite = await prisma.organizationInvitation.findFirst({
            where: { organizationId: orgId, email, status: 'pending' },
        });
        if (existingInvite) {
            return res.status(409).json({ error: 'A pending invitation already exists for this email' });
        }

        // Clean up old (non-pending) invitations for this email in this org
        await prisma.organizationInvitation.deleteMany({
            where: { organizationId: orgId, email, status: { not: 'pending' } },
        });

        // Create seat (pending) + invitation in transaction
        const result = await prisma.$transaction(async (tx) => {
            const seat = await tx.seat.create({
                data: {
                    organizationId: orgId,
                    email,
                    seatType: seatRole,
                    status: 'pending',
                    isActive: false,
                    assignedBy: adminUserId,
                },
            });

            const invitation = await tx.organizationInvitation.create({
                data: {
                    organizationId: orgId,
                    email,
                    role: seatRole,
                    invitedBy: adminUserId,
                    status: 'pending',
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                },
            });

            return { seat, invitation };
        });

        console.log(`[ORG] Invitation sent to ${email} (role: ${seatRole}) by admin ${adminUserId}`);

        res.status(201).json({
            seat: {
                id: result.seat.id,
                email,
                seatType: seatRole,
                status: 'pending',
            },
            invitation: {
                id: result.invitation.id,
            },
        });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(409).json({ error: 'This email is already in use' });
        }
        next(error);
    }
});

// ─── PATCH /seats/:id — Update seat role (admin+) ─────────────────────────
router.patch('/seats/:id', auth_1.authenticateToken, (0, orgAuth_1.requireOrgAdmin)(), async (req, res, next) => {
    try {
        const orgId = req.organizationId;
        const seatId = req.params.id;
        const { role } = req.body;

        const validRoles = ['admin', 'member'];
        if (!role || !validRoles.includes(role)) {
            return res.status(400).json({ error: 'Valid role required (admin or member)' });
        }

        const seat = await prisma.seat.findFirst({
            where: { id: seatId, organizationId: orgId },
        });
        if (!seat) {
            return res.status(404).json({ error: 'Seat not found' });
        }

        // Cannot change owner's role
        const org = await prisma.organization.findUnique({
            where: { id: orgId },
            select: { ownerUserId: true },
        });
        if (seat.userId && seat.userId === org?.ownerUserId) {
            return res.status(403).json({ error: 'Cannot change the owner\'s role' });
        }

        await prisma.$transaction(async (tx) => {
            await tx.seat.update({
                where: { id: seatId },
                data: { seatType: role },
            });

            if (seat.userId) {
                await tx.user.update({
                    where: { id: seat.userId },
                    data: { memberRole: role },
                });
            }
        });

        res.json({ message: 'Role updated', seatType: role });
    } catch (error) {
        next(error);
    }
});

// ─── DELETE /seats/:id — Remove seat (admin+) ─────────────────────────────
router.delete('/seats/:id', auth_1.authenticateToken, (0, orgAuth_1.requireOrgAdmin)(), async (req, res, next) => {
    try {
        const orgId = req.organizationId;
        const seatId = req.params.id;

        const seat = await prisma.seat.findFirst({
            where: { id: seatId, organizationId: orgId },
        });
        if (!seat) {
            return res.status(404).json({ error: 'Seat not found' });
        }

        // Cannot remove owner's seat
        const org = await prisma.organization.findUnique({
            where: { id: orgId },
            select: { ownerUserId: true },
        });
        if (seat.userId && seat.userId === org?.ownerUserId) {
            return res.status(403).json({ error: 'Cannot remove the owner\'s seat' });
        }

        await prisma.$transaction(async (tx) => {
            // Clear user's org membership
            if (seat.userId) {
                await tx.user.update({
                    where: { id: seat.userId },
                    data: {
                        organizationId: null,
                        memberRole: null,
                    },
                });
            }

            await tx.seat.delete({ where: { id: seatId } });
        });

        console.log(`[ORG] Seat ${seatId} removed from org ${orgId}`);
        res.json({ message: 'Seat removed' });
    } catch (error) {
        next(error);
    }
});

// ─── PATCH /seats/:id/status — Suspend/reactivate seat (admin+) ───────────
router.patch('/seats/:id/status', auth_1.authenticateToken, (0, orgAuth_1.requireOrgAdmin)(), async (req, res, next) => {
    try {
        const orgId = req.organizationId;
        const seatId = req.params.id;
        const { status } = req.body;

        if (!['active', 'suspended'].includes(status)) {
            return res.status(400).json({ error: 'Status must be "active" or "suspended"' });
        }

        const seat = await prisma.seat.findFirst({
            where: { id: seatId, organizationId: orgId },
        });
        if (!seat) {
            return res.status(404).json({ error: 'Seat not found' });
        }

        // Cannot suspend owner
        const org = await prisma.organization.findUnique({
            where: { id: orgId },
            select: { ownerUserId: true },
        });
        if (seat.userId && seat.userId === org?.ownerUserId) {
            return res.status(403).json({ error: 'Cannot suspend the owner' });
        }

        await prisma.seat.update({
            where: { id: seatId },
            data: {
                status,
                isActive: status === 'active',
            },
        });

        console.log(`[ORG] Seat ${seatId} status changed to ${status}`);
        res.json({ message: `Seat ${status === 'active' ? 'reactivated' : 'suspended'}`, status });
    } catch (error) {
        next(error);
    }
});

// ─── POST /seats/:id/reset-password — Admin sets new password for member ──
router.post('/seats/:id/reset-password', auth_1.authenticateToken, (0, orgAuth_1.requireOrgAdmin)(), async (req, res, next) => {
    try {
        const orgId = req.organizationId;
        const seatId = req.params.id;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password is required (min 8 characters)' });
        }
        if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
            return res.status(400).json({ error: 'Password must contain uppercase, lowercase, and a number' });
        }

        const seat = await prisma.seat.findFirst({
            where: { id: seatId, organizationId: orgId },
        });
        if (!seat) {
            return res.status(404).json({ error: 'Seat not found' });
        }

        if (!seat.userId) {
            return res.status(400).json({ error: 'Seat is not assigned to a user' });
        }

        // Cannot reset owner's password
        const org = await prisma.organization.findUnique({
            where: { id: orgId },
            select: { ownerUserId: true },
        });
        if (seat.userId === org?.ownerUserId) {
            return res.status(403).json({ error: 'Cannot reset the owner\'s password from here' });
        }

        const hashedPassword = await hashPassword(newPassword);
        await prisma.user.update({
            where: { id: seat.userId },
            data: { passwordHash: hashedPassword },
        });

        console.log(`[ORG] Password changed for seat ${seatId} by admin`);
        res.json({ message: 'Password updated' });
    } catch (error) {
        next(error);
    }
});

// ─── GET /stats — Per-member usage stats (admin+) ─────────────────────────
router.get('/stats', auth_1.authenticateToken, (0, orgAuth_1.requireOrgAdmin)(), async (req, res, next) => {
    try {
        const orgId = req.organizationId;

        // Get all members of this org
        const members = await prisma.user.findMany({
            where: { organizationId: orgId },
            select: {
                id: true,
                email: true,
                name: true,
                username: true,
                lastLoginAt: true,
                memberRole: true,
            },
        });

        // Count documents and research queries per member
        const memberStats = await Promise.all(members.map(async (member) => {
            let documentCount = 0;
            let queryCount = 0;

            try {
                documentCount = await prisma.vaultItem.count({
                    where: { userId: member.id },
                });
            } catch { /* table may not exist */ }

            try {
                queryCount = await prisma.aIAuditLog.count({
                    where: { userId: member.id },
                });
            } catch { /* table may not exist */ }

            return {
                id: member.id,
                email: member.email,
                name: member.name || member.username || null,
                role: member.memberRole,
                lastActive: member.lastLoginAt,
                documentCount,
                queryCount,
            };
        }));

        res.json({ stats: memberStats });
    } catch (error) {
        next(error);
    }
});

// ─── GET /invites/mine — Get pending invitations for current user ────────
router.get('/invites/mine', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, organizationId: true },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // If already in an org, no invites to show
        if (user.organizationId) {
            return res.json({ invitations: [] });
        }

        const invitations = await prisma.organizationInvitation.findMany({
            where: {
                email: user.email.toLowerCase(),
                status: 'pending',
                expiresAt: { gt: new Date() },
            },
            include: {
                organization: { select: { name: true, slug: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json({
            invitations: invitations.map(inv => ({
                id: inv.id,
                orgName: inv.organization.name,
                orgSlug: inv.organization.slug,
                role: inv.role,
                createdAt: inv.createdAt,
                expiresAt: inv.expiresAt,
            })),
        });
    } catch (error) {
        next(error);
    }
});

// ─── POST /leave — Leave organization (non-owner) ───────────────────────
router.post('/leave', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { organizationId: true },
        });

        if (!user?.organizationId) {
            return res.status(400).json({ error: 'You are not in an organization' });
        }

        const org = await prisma.organization.findUnique({
            where: { id: user.organizationId },
            select: { ownerUserId: true },
        });

        if (org?.ownerUserId === userId) {
            return res.status(403).json({ error: 'The owner cannot leave. Delete the team instead.' });
        }

        await prisma.$transaction(async (tx) => {
            // Remove seat
            await tx.seat.deleteMany({
                where: { organizationId: user.organizationId, userId },
            });

            // Clear org from user
            await tx.user.update({
                where: { id: userId },
                data: { organizationId: null, memberRole: null },
            });
        });

        console.log(`[ORG] User ${userId} left org ${user.organizationId}`);
        res.json({ message: 'You have left the team' });
    } catch (error) {
        next(error);
    }
});

// ─── DELETE / — Delete organization (owner only) ────────────────────────
router.delete('/', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { organizationId: true, memberRole: true },
        });

        if (!user?.organizationId) {
            return res.status(400).json({ error: 'You are not in an organization' });
        }

        const org = await prisma.organization.findUnique({
            where: { id: user.organizationId },
            select: { id: true, name: true, ownerUserId: true },
        });

        if (!org) {
            return res.status(404).json({ error: 'Organization not found' });
        }

        // Only owner can delete
        if (org.ownerUserId !== userId) {
            return res.status(403).json({ error: 'Only the team owner can delete the team' });
        }

        await prisma.$transaction(async (tx) => {
            // Clear all members' org references
            await tx.user.updateMany({
                where: { organizationId: org.id },
                data: { organizationId: null, memberRole: null },
            });

            // Delete all seats
            await tx.seat.deleteMany({
                where: { organizationId: org.id },
            });

            // Delete all invitations
            await tx.organizationInvitation.deleteMany({
                where: { organizationId: org.id },
            });

            // Delete the organization
            await tx.organization.delete({
                where: { id: org.id },
            });
        });

        console.log(`[ORG] Organization "${org.name}" (${org.id}) deleted by owner ${userId}`);
        res.json({ message: 'Team deleted' });
    } catch (error) {
        next(error);
    }
});

// ─── GET /invite/:id — Invite lookup (auth required, email redacted) ─────
router.get('/invite/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const invitationId = req.params.id;

        const invitation = await prisma.organizationInvitation.findUnique({
            where: { id: invitationId },
            include: {
                organization: {
                    select: { name: true, slug: true },
                },
            },
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        const expired = invitation.expiresAt < new Date();

        // Only show full email to the invited user themselves
        const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { email: true } });
        const isRecipient = user && user.email.toLowerCase() === invitation.email.toLowerCase();

        res.json({
            invitation: {
                id: invitation.id,
                email: isRecipient ? invitation.email : invitation.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'),
                role: invitation.role,
                status: expired && invitation.status === 'pending' ? 'expired' : invitation.status,
                orgName: invitation.organization.name,
                orgSlug: invitation.organization.slug,
                expired,
            },
        });
    } catch (error) {
        next(error);
    }
});

// ─── POST /invite/:id/accept — Accept invite (token required) ────────────
router.post('/invite/:id/accept', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const invitationId = req.params.id;

        const invitation = await prisma.organizationInvitation.findUnique({
            where: { id: invitationId },
        });

        if (!invitation) {
            return res.status(404).json({ error: 'Invitation not found' });
        }

        if (invitation.status !== 'pending') {
            return res.status(400).json({ error: `Invitation already ${invitation.status}` });
        }

        if (invitation.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Invitation has expired' });
        }

        // Verify email matches
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, organizationId: true },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
            return res.status(403).json({ error: 'This invitation was sent to a different email address' });
        }

        if (user.organizationId) {
            return res.status(409).json({ error: 'You already belong to an organization' });
        }

        // Accept: join org, activate seat, update invitation
        await prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: {
                    organizationId: invitation.organizationId,
                    memberRole: invitation.role,
                },
            });

            // Find and activate the pending seat for this email
            const seat = await tx.seat.findFirst({
                where: {
                    organizationId: invitation.organizationId,
                    email: invitation.email,
                    status: 'pending',
                },
            });

            if (seat) {
                await tx.seat.update({
                    where: { id: seat.id },
                    data: {
                        userId,
                        status: 'active',
                        isActive: true,
                        assignedAt: new Date(),
                    },
                });
            } else {
                // Create a seat if none exists
                await tx.seat.create({
                    data: {
                        organizationId: invitation.organizationId,
                        userId,
                        email: invitation.email,
                        seatType: invitation.role,
                        status: 'active',
                        isActive: true,
                        assignedAt: new Date(),
                    },
                });
            }

            await tx.organizationInvitation.update({
                where: { id: invitationId },
                data: { status: 'accepted' },
            });
        });

        console.log(`[ORG] User ${userId} accepted invite ${invitationId}`);

        res.json({ message: 'Invitation accepted. Welcome to the team!' });
    } catch (error) {
        next(error);
    }
});

exports.default = router;
