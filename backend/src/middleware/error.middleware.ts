import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

export class AppError extends Error {
    statusCode: number;
    isOperational: boolean;
    details?: any;

    constructor(message: string, statusCode: number = 500, details?: any) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

export const errorHandler = (
    err: Error | AppError,
    _req: Request,
    res: Response,
    _next: NextFunction
) => {
    if (err instanceof AppError) {
        return res.status(err.statusCode).json({
            error: err.message,
            ...(err.details && { details: err.details })
        });
    }

    // Handle Zod validation errors
    if (err.name === 'ZodError') {
        return res.status(400).json({
            error: 'Validation error',
            details: (err as any).errors
        });
    }

    // Handle database uniqueness conflicts
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res.status(409).json({
            error: 'Duplicate record',
            details: err.meta?.target
        });
    }

    // Handle Multer errors (e.g. file too large, wrong type)
    const multerErr = err as any;
    if (multerErr.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
            error: 'File too large',
            message: 'Maximum file size is 100 MB.'
        });
    }
    if (multerErr.code === 'LIMIT_UNEXPECTED_FILE' || multerErr.message?.includes('multipart')) {
        return res.status(400).json({
            error: 'Invalid upload',
            message: multerErr.message || 'Use multipart field "file" and "entity".'
        });
    }

    // Malformed JSON body (e.g. bad curl quoting on Windows)
    const parseErr = err as Error & { status?: number; type?: string; body?: unknown };
    if (
        parseErr instanceof SyntaxError &&
        (parseErr.status === 400 || parseErr.type === 'entity.parse.failed')
    ) {
        return res.status(400).json({
            error: 'Invalid JSON body',
            message:
                'Request body must be valid JSON. Example: {"to":"user@example.com"}. On PowerShell use: curl.exe ... -d \'{"to":"user@example.com"}\'',
        });
    }

    // Default error
    console.error('Unhandled error:', err);
    return res.status(500).json({
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
};
