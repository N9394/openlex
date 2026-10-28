"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function listUsers() {
    try {
        console.log(`\n📋 Fetching all users...\n`);
        const users = await prisma.user.findMany({
            select: {
                id: true,
                email: true,
                tier: true,
                documentsThisWeek: true,
                createdAt: true,
                _count: {
                    select: {
                        documents: true,
                        vaultItems: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        if (users.length === 0) {
            console.log('❌ No users found in database');
            return;
        }
        console.log(`✅ Found ${users.length} user(s):\n`);
        users.forEach((user, index) => {
            console.log(`${index + 1}. ${user.email}`);
            console.log(`   ID: ${user.id}`);
            console.log(`   Tier: ${user.tier}`);
            console.log(`   Documents: ${user._count.documents} (${user.documentsThisWeek} this week)`);
            console.log(`   Vault Items: ${user._count.vaultItems}`);
            console.log(`   Created: ${user.createdAt.toLocaleDateString()}`);
            console.log('');
        });
    }
    catch (error) {
        console.error(`\n❌ Error listing users:`, error);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
listUsers();
//# sourceMappingURL=listUsers.js.map