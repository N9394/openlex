"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const client_1 = require("@prisma/client");
function errorHandler(error, req, res, next) {
    console.error('[ERROR]', {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString(),
    });
    if (error instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        return handlePrismaError(error, res);
    }
    if (error instanceof client_1.Prisma.PrismaClientValidationError) {
        res.status(400).json({
            error: 'Validation Error',
            message: 'Invalid data provided',
        });
        return;
    }
    if (error.message === 'Only PDF and TXT files are allowed') {
        res.status(400).json({
            error: 'Bad Request',
            message: error.message,
        });
        return;
    }
    const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
    res.status(statusCode).json({
        error: statusCode === 500 ? 'Internal Server Error' : 'Error',
        message: process.env.NODE_ENV === 'development'
            ? error.message
            : 'An unexpected error occurred',
        ...(process.env.NODE_ENV === 'development' && {
            stack: error.stack,
        }),
    });
}
function handlePrismaError(error, res) {
    switch (error.code) {
        case 'P2002':
            res.status(409).json({
                error: 'Conflict',
                message: 'A record with this value already exists',
            });
            break;
        case 'P2025':
            res.status(404).json({
                error: 'Not Found',
                message: 'The requested resource was not found',
            });
            break;
        case 'P2003':
            res.status(400).json({
                error: 'Bad Request',
                message: 'Invalid reference to related resource',
            });
            break;
        default:
            res.status(500).json({
                error: 'Database Error',
                message: 'A database error occurred',
                ...(process.env.NODE_ENV === 'development' && {
                    code: error.code,
                    details: error.message,
                }),
            });
    }
}
//# sourceMappingURL=errorHandler.js.map