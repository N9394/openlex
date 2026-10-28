"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
exports.getPrisma = getPrisma;
exports.disconnectPrisma = disconnectPrisma;
const client_1 = require("@prisma/client");
let prismaInstance = null;
function getPrisma() {
    if (!prismaInstance) {
        prismaInstance = new client_1.PrismaClient({
            log: process.env.NODE_ENV === 'development'
                ? ['query', 'error', 'warn']
                : ['error'],
        });
    }
    return prismaInstance;
}
async function disconnectPrisma() {
    if (prismaInstance) {
        await prismaInstance.$disconnect();
        prismaInstance = null;
    }
}
exports.prisma = getPrisma();
exports.default = exports.prisma;
//# sourceMappingURL=prisma.js.map