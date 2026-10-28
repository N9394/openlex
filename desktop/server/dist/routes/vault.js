"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const docParser_1 = require("../services/docParser");
const entityLinkService_1 = require("../services/entityLinkService");
const router = express_1.default.Router();
const prisma = new client_1.PrismaClient();
const storage = multer_1.default.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../../uploads');
        await promises_1.default.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}_${file.originalname}`;
        cb(null, uniqueName);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = [
            'application/pdf',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/msword'
        ];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PDF, DOCX, DOC, and TXT files are allowed'));
        }
    },
});
router.get('/', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { type, category, search } = req.query;
        const where = { userId };
        if (type && typeof type === 'string' && type !== 'document') {
            where.type = type;
        }
        if (category && typeof category === 'string') {
            where.category = category;
        }
        if (search && typeof search === 'string') {
            where.OR = [
                { title: { contains: search } },
                { content: { contains: search } },
                { notes: { contains: search } },
            ];
        }
        let vaultItems = [];
        if (!type || type !== 'document') {
            vaultItems = await prisma.vaultItem.findMany({
                where,
                orderBy: [
                    { isFavorite: 'desc' },
                    { createdAt: 'desc' },
                ],
                select: {
                    id: true,
                    type: true,
                    title: true,
                    content: true,
                    category: true,
                    tags: true,
                    notes: true,
                    isFavorite: true,
                    sourceDocumentId: true,
                    sourceType: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        }
        let documents = [];
        if (!type || type === 'document') {
            const docWhere = { userId, status: { in: ['completed', 'processing'] } };
            if (search && typeof search === 'string') {
                docWhere.OR = [
                    { filename: { contains: search } },
                    { summary: { contains: search } },
                ];
            }
            documents = await prisma.document.findMany({
                where: docWhere,
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    filename: true,
                    status: true,
                    summary: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        }
        const itemsWithParsedTags = vaultItems.map(item => ({
            ...item,
            tags: item.tags ? JSON.parse(item.tags) : [],
        }));
        const documentItems = documents.map(doc => ({
            id: `doc-${doc.id}`,
            type: 'document',
            title: doc.filename,
            content: doc.summary || '',
            category: 'Analysis',
            tags: [],
            notes: null,
            isFavorite: false,
            sourceDocumentId: doc.id,
            sourceType: 'analysis',
            status: doc.status,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            href: `/documents/${doc.id}`,
        }));
        const allItems = [...itemsWithParsedTags, ...documentItems].sort((a, b) => {
            if (a.isFavorite && !b.isFavorite)
                return -1;
            if (!a.isFavorite && b.isFavorite)
                return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
        console.log(`[VAULT] Retrieved ${vaultItems.length} vault items + ${documents.length} documents for user ${userId}`);
        res.status(200).json({
            items: allItems,
            total: allItems.length,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const itemId = req.params.id;
        if (itemId.startsWith('doc-')) {
            const docId = itemId.replace('doc-', '');
            const document = await prisma.document.findUnique({
                where: { id: docId },
            });
            if (!document) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Document not found',
                });
            }
            if (document.userId !== userId) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this document',
                });
            }
            return res.status(200).json({
                id: `doc-${document.id}`,
                type: 'document',
                title: document.filename,
                content: document.summary || '',
                category: 'Analysis',
                tags: [],
                notes: null,
                isFavorite: false,
                sourceDocumentId: document.id,
                sourceType: 'analysis',
                status: document.status,
                createdAt: document.createdAt,
                updatedAt: document.updatedAt,
                href: `/documents/${document.id}`,
            });
        }
        const vaultItem = await prisma.vaultItem.findUnique({
            where: { id: itemId },
        });
        if (!vaultItem) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Vault item not found',
            });
        }
        if (vaultItem.userId !== userId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have access to this vault item',
            });
        }
        res.status(200).json({
            ...vaultItem,
            tags: vaultItem.tags ? JSON.parse(vaultItem.tags) : [],
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { type, title, content, category, tags, notes, sourceDocumentId, sourceType } = req.body;
        if (!title || !content) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'title and content are required',
            });
        }
        const validTypes = ['clause', 'template', 'draft'];
        if (type && !validTypes.includes(type)) {
            return res.status(400).json({
                error: 'Bad Request',
                message: `type must be one of: ${validTypes.join(', ')}`,
            });
        }
        const vaultItem = await prisma.vaultItem.create({
            data: {
                userId,
                type: type || 'clause',
                title,
                content,
                category: category || null,
                tags: tags ? JSON.stringify(tags) : null,
                notes: notes || null,
                sourceDocumentId: sourceDocumentId || null,
                sourceType: sourceType || null,
            },
        });
        if (sourceDocumentId) {
            try {
                await (0, entityLinkService_1.linkVaultItemToSource)(userId, vaultItem.id, sourceDocumentId);
                console.log(`[VAULT] Created entity link: vault_item ${vaultItem.id} -> document ${sourceDocumentId}`);
            }
            catch (linkError) {
                console.warn('[VAULT] Failed to create entity link:', linkError);
            }
        }
        console.log(`[VAULT] Item created: ${vaultItem.id} by user ${userId}`);
        res.status(201).json({
            ...vaultItem,
            tags: vaultItem.tags ? JSON.parse(vaultItem.tags) : [],
        });
    }
    catch (error) {
        next(error);
    }
});
router.post('/upload', auth_1.authenticateToken, upload.single('file'), async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { title, category, tags, notes } = req.body;
        if (!req.file) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'No file uploaded',
            });
        }
        if (!title) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'Title is required',
            });
        }
        console.log(`[VAULT] Processing upload: ${req.file.filename} for user ${userId}`);
        let documentContent = '';
        try {
            documentContent = await (0, docParser_1.parseDocument)(req.file.path);
        }
        catch (parseError) {
            console.error('[VAULT] Failed to parse document:', parseError);
            documentContent = `[Uploaded file: ${req.file.originalname}]\n\nContent could not be extracted. File is stored as reference.`;
        }
        let parsedTags = [];
        try {
            parsedTags = tags ? JSON.parse(tags) : [];
        }
        catch (e) {
            parsedTags = [];
        }
        const vaultItem = await prisma.vaultItem.create({
            data: {
                userId,
                type: 'draft',
                title,
                content: documentContent,
                category: category || null,
                tags: parsedTags.length > 0 ? JSON.stringify(parsedTags) : null,
                notes: notes || null,
                sourceType: 'upload',
            },
        });
        console.log(`[VAULT] Uploaded document saved to vault: ${vaultItem.id}`);
        res.status(201).json({
            ...vaultItem,
            tags: vaultItem.tags ? JSON.parse(vaultItem.tags) : [],
        });
    }
    catch (error) {
        console.error('[VAULT] Upload error:', error);
        next(error);
    }
});
router.put('/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const itemId = req.params.id;
        const { type, title, content, category, tags, notes, isFavorite } = req.body;
        const existingItem = await prisma.vaultItem.findUnique({
            where: { id: itemId },
        });
        if (!existingItem) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Vault item not found',
            });
        }
        if (existingItem.userId !== userId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have access to this vault item',
            });
        }
        const updateData = {};
        if (type !== undefined)
            updateData.type = type;
        if (title !== undefined)
            updateData.title = title;
        if (content !== undefined)
            updateData.content = content;
        if (category !== undefined)
            updateData.category = category;
        if (tags !== undefined)
            updateData.tags = JSON.stringify(tags);
        if (notes !== undefined)
            updateData.notes = notes;
        if (isFavorite !== undefined)
            updateData.isFavorite = isFavorite;
        const updatedItem = await prisma.vaultItem.update({
            where: { id: itemId },
            data: updateData,
        });
        console.log(`[VAULT] Item updated: ${itemId} by user ${userId}`);
        res.status(200).json({
            ...updatedItem,
            tags: updatedItem.tags ? JSON.parse(updatedItem.tags) : [],
        });
    }
    catch (error) {
        next(error);
    }
});
router.delete('/:id', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const itemId = req.params.id;
        if (itemId.startsWith('doc-')) {
            const docId = itemId.replace('doc-', '');
            const document = await prisma.document.findUnique({
                where: { id: docId },
            });
            if (!document) {
                return res.status(404).json({
                    error: 'Not Found',
                    message: 'Document not found',
                });
            }
            if (document.userId !== userId) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'You do not have access to this document',
                });
            }
            await prisma.document.delete({
                where: { id: docId },
            });
            console.log(`[VAULT] Document deleted: ${docId} by user ${userId}`);
            return res.status(200).json({
                message: 'Document deleted successfully',
            });
        }
        const vaultItem = await prisma.vaultItem.findUnique({
            where: { id: itemId },
        });
        if (!vaultItem) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Vault item not found',
            });
        }
        if (vaultItem.userId !== userId) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have access to this vault item',
            });
        }
        await prisma.vaultItem.delete({
            where: { id: itemId },
        });
        console.log(`[VAULT] Item deleted: ${itemId} by user ${userId}`);
        res.status(200).json({
            message: 'Vault item deleted successfully',
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/stats/summary', auth_1.authenticateToken, async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const [vaultItems, clauses, templates, drafts, favorites] = await Promise.all([
            prisma.vaultItem.count({ where: { userId } }),
            prisma.vaultItem.count({ where: { userId, type: 'clause' } }),
            prisma.vaultItem.count({ where: { userId, type: 'template' } }),
            prisma.vaultItem.count({ where: { userId, type: 'draft' } }),
            prisma.vaultItem.count({ where: { userId, isFavorite: true } }),
        ]);
        const allDocuments = await prisma.document.findMany({
            where: {
                userId,
                status: { in: ['completed', 'processing'] },
            },
            orderBy: { createdAt: 'desc' },
            select: { filename: true },
        });
        const seenFilenames = new Set();
        allDocuments.forEach(doc => seenFilenames.add(doc.filename));
        const documents = seenFilenames.size;
        const userStudyProgress = await prisma.studyProgress.findMany({
            where: { userId },
            select: { cardId: true },
        });
        const studiedCardIds = userStudyProgress.map(p => p.cardId);
        const uniqueSetIds = new Set();
        if (studiedCardIds.length > 0) {
            const studiedCards = await prisma.studyCard.findMany({
                where: { id: { in: studiedCardIds } },
                select: { setId: true },
            });
            studiedCards.forEach(card => uniqueSetIds.add(card.setId));
        }
        const studySets = uniqueSetIds.size;
        const total = vaultItems + documents;
        console.log(`[VAULT STATS] User ${userId}: vaultItems=${vaultItems}, documents=${documents}, total=${total}, studySets=${studySets}`);
        res.status(200).json({
            total,
            byType: {
                clauses,
                templates,
                drafts,
            },
            favorites,
            documents,
            studySets,
        });
    }
    catch (error) {
        next(error);
    }
});
router.get('/folders', auth_1.authenticateToken, async (req, res) => {
    res.status(200).json({ folders: [] });
});
exports.default = router;
//# sourceMappingURL=vault.js.map