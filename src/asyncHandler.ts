// asyncHandler.ts

import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * A utility function to wrap async route handlers and pass errors to Express's error handler.
 * @param fn An async function representing the route handler.
 * @returns A new function that wraps the async function.
 */
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
        fn(req, res, next).catch(next);
    };
};
