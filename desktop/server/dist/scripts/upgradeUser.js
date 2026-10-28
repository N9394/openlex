"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function upgradeUser(email) {
    try {
        console.log(`\n🔍 Looking for user: ${email}...`);
        const user = await prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                email: true,
                tier: true,
                documentsThisWeek: true,
            },
        });
        if (!user) {
            console.error(`❌ User not found: ${email}`);
            process.exit(1);
        }
        console.log(`\n📋 Current Status:`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Tier: ${user.tier}`);
        console.log(`   Documents this week: ${user.documentsThisWeek}`);
        if (user.tier === 'annual') {
            console.log(`\n✅ User is already on annual tier!`);
            process.exit(0);
        }
        console.log(`\n⬆️  Upgrading to annual tier...`);
        const updated = await prisma.user.update({
            where: { email },
            data: {
                tier: 'annual',
            },
        });
        console.log(`\n✅ SUCCESS! User upgraded to annual tier`);
        console.log(`\n📋 New Status:`);
        console.log(`   Email: ${updated.email}`);
        console.log(`   Tier: ${updated.tier}`);
        console.log(`   Benefits: Unlimited document uploads`);
    }
    catch (error) {
        console.error(`\n❌ Error upgrading user:`, error);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
const email = process.argv[2];
if (!email) {
    console.error('❌ Error: Please provide an email address');
    console.log('\nUsage: npx tsx src/scripts/upgradeUser.ts <email>');
    console.log('Example: npx tsx src/scripts/upgradeUser.ts user@example.com');
    process.exit(1);
}
upgradeUser(email);
//# sourceMappingURL=upgradeUser.js.map