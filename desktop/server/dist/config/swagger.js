"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.swaggerSpec = void 0;
exports.setupSwagger = setupSwagger;
const swagger_jsdoc_1 = __importDefault(require("swagger-jsdoc"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'LexVault API',
            version: '1.0.0',
            description: `
LexVault is an AI-powered legal document analysis platform. This API provides
endpoints for document upload, analysis, user management, and subscription handling.

## Authentication
Most endpoints require a Bearer token. Include it in the Authorization header:
\`\`\`
Authorization: Bearer <your-token>
\`\`\`

## Rate Limiting
- Free tier: 100 requests per 15 minutes
- Paid tiers: 1000 requests per 15 minutes

## Error Responses
All errors follow this format:
\`\`\`json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
\`\`\`
      `,
            contact: {
                name: 'LexVault Support',
                email: 'support@lexvault.com',
            },
            license: {
                name: 'MIT',
                url: 'https://opensource.org/licenses/MIT',
            },
        },
        servers: [
            {
                url: 'http://localhost:8000',
                description: 'Development server',
            },
            {
                url: 'https://api.lexvault.com',
                description: 'Production server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT token obtained from /api/auth/login',
                },
            },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: { type: 'string', description: 'Error message' },
                        code: { type: 'string', description: 'Error code' },
                    },
                },
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        email: { type: 'string', format: 'email' },
                        username: { type: 'string', nullable: true },
                        tier: { type: 'string', enum: ['free', 'plus', 'pro', 'team', 'enterprise'] },
                        createdAt: { type: 'string', format: 'date-time' },
                    },
                },
                Document: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        filename: { type: 'string' },
                        status: { type: 'string', enum: ['pending', 'processing', 'completed', 'failed'] },
                        uploadedAt: { type: 'string', format: 'date-time' },
                        analysis: { $ref: '#/components/schemas/Analysis' },
                    },
                },
                Analysis: {
                    type: 'object',
                    properties: {
                        summary: { type: 'string' },
                        clauses: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                    content: { type: 'string' },
                                    risk: { type: 'string', enum: ['low', 'medium', 'high'] },
                                },
                            },
                        },
                        riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
                        glossary: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    term: { type: 'string' },
                                    definition: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                LoginRequest: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: { type: 'string', format: 'email' },
                        password: { type: 'string', minLength: 8 },
                    },
                },
                LoginResponse: {
                    type: 'object',
                    properties: {
                        accessToken: { type: 'string' },
                        refreshToken: { type: 'string' },
                        user: { $ref: '#/components/schemas/User' },
                    },
                },
                SignupRequest: {
                    type: 'object',
                    required: ['email', 'password'],
                    properties: {
                        email: { type: 'string', format: 'email' },
                        password: { type: 'string', minLength: 8 },
                        username: { type: 'string' },
                    },
                },
                Subscription: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['individual', 'organization'] },
                        tier: { type: 'string' },
                        status: { type: 'string' },
                        currentPeriodEnd: { type: 'string', format: 'date-time', nullable: true },
                        cancelAtPeriodEnd: { type: 'boolean' },
                    },
                },
            },
        },
        tags: [
            { name: 'Authentication', description: 'User authentication and session management' },
            { name: 'Account', description: 'User account and profile management' },
            { name: 'Documents', description: 'Document upload and analysis' },
            { name: 'Billing', description: 'Subscription and payment management' },
            { name: 'Study', description: 'Study sets and flashcards' },
            { name: 'Navigator', description: 'Document drafting assistant' },
            { name: 'Research', description: 'Legal research and case law' },
        ],
        paths: {
            '/api/auth/signup': {
                post: {
                    tags: ['Authentication'],
                    summary: 'Register a new user',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/SignupRequest' },
                            },
                        },
                    },
                    responses: {
                        201: {
                            description: 'User created successfully',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/LoginResponse' },
                                },
                            },
                        },
                        400: { description: 'Invalid request' },
                        409: { description: 'Email already exists' },
                    },
                },
            },
            '/api/auth/login': {
                post: {
                    tags: ['Authentication'],
                    summary: 'Login with email and password',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/LoginRequest' },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Login successful',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/LoginResponse' },
                                },
                            },
                        },
                        401: { description: 'Invalid credentials' },
                        429: { description: 'Too many attempts' },
                    },
                },
            },
            '/api/auth/forgot-password': {
                post: {
                    tags: ['Authentication'],
                    summary: 'Request password reset email',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['email'],
                                    properties: {
                                        email: { type: 'string', format: 'email' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Reset email sent if account exists' },
                        429: { description: 'Too many requests' },
                    },
                },
            },
            '/api/auth/reset-password': {
                post: {
                    tags: ['Authentication'],
                    summary: 'Reset password with token',
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['token', 'password'],
                                    properties: {
                                        token: { type: 'string' },
                                        password: { type: 'string', minLength: 8 },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Password reset successfully' },
                        400: { description: 'Invalid or expired token' },
                    },
                },
            },
            '/api/account/me': {
                get: {
                    tags: ['Account'],
                    summary: 'Get current user profile',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        200: {
                            description: 'User profile',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/User' },
                                },
                            },
                        },
                        401: { description: 'Unauthorized' },
                    },
                },
            },
            '/api/docs': {
                get: {
                    tags: ['Documents'],
                    summary: 'List user documents',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
                        { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
                    ],
                    responses: {
                        200: {
                            description: 'List of documents',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            documents: {
                                                type: 'array',
                                                items: { $ref: '#/components/schemas/Document' },
                                            },
                                            total: { type: 'integer' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/api/docs/upload': {
                post: {
                    tags: ['Documents'],
                    summary: 'Upload a document for analysis',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'multipart/form-data': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        file: { type: 'string', format: 'binary' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        201: {
                            description: 'Document uploaded and analysis started',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Document' },
                                },
                            },
                        },
                        400: { description: 'Invalid file type or size' },
                        413: { description: 'File too large' },
                    },
                },
            },
            '/api/docs/{id}': {
                get: {
                    tags: ['Documents'],
                    summary: 'Get document details and analysis',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: {
                            description: 'Document with analysis',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Document' },
                                },
                            },
                        },
                        404: { description: 'Document not found' },
                    },
                },
                delete: {
                    tags: ['Documents'],
                    summary: 'Delete a document',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    ],
                    responses: {
                        200: { description: 'Document deleted' },
                        404: { description: 'Document not found' },
                    },
                },
            },
            '/api/billing/subscription': {
                get: {
                    tags: ['Billing'],
                    summary: 'Get current subscription details',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        200: {
                            description: 'Subscription details',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Subscription' },
                                },
                            },
                        },
                    },
                },
            },
            '/api/billing/checkout': {
                post: {
                    tags: ['Billing'],
                    summary: 'Create checkout session for upgrade',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['tierName'],
                                    properties: {
                                        tierName: { type: 'string', enum: ['plus', 'pro', 'team'] },
                                        annual: { type: 'boolean', default: false },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Checkout session created',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            sessionId: { type: 'string' },
                                            url: { type: 'string' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/api/billing/portal': {
                post: {
                    tags: ['Billing'],
                    summary: 'Create customer portal session',
                    security: [{ bearerAuth: [] }],
                    responses: {
                        200: {
                            description: 'Portal session created',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            url: { type: 'string' },
                                        },
                                    },
                                },
                            },
                        },
                        400: { description: 'No active subscription' },
                    },
                },
            },
            '/api/billing/cancel': {
                post: {
                    tags: ['Billing'],
                    summary: 'Cancel subscription',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        immediately: { type: 'boolean', default: false },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Subscription cancelled' },
                        400: { description: 'No active subscription' },
                    },
                },
            },
            '/health': {
                get: {
                    tags: ['System'],
                    summary: 'Health check endpoint',
                    responses: {
                        200: {
                            description: 'Server is healthy',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            status: { type: 'string', example: 'ok' },
                                            timestamp: { type: 'string', format: 'date-time' },
                                            llm: {
                                                type: 'object',
                                                properties: {
                                                    available: { type: 'boolean' },
                                                    provider: { type: 'string' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    },
    apis: [],
};
const swaggerSpec = (0, swagger_jsdoc_1.default)(options);
exports.swaggerSpec = swaggerSpec;
function setupSwagger(app) {
    app.use('/api/documentation', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swaggerSpec, {
        customCss: `
        .swagger-ui .topbar { display: none }
        .swagger-ui .info { margin: 20px 0 }
      `,
        customSiteTitle: 'LexVault API Documentation',
    }));
    app.get('/api/documentation.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
}
//# sourceMappingURL=swagger.js.map