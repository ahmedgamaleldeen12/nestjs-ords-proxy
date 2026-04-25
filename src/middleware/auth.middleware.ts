import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const isMobile = authHeader?.startsWith('Bearer ');

    if (isMobile) return next();

    if (req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      throw new ForbiddenException('CSRF check failed');
    }

    const cookieToken = req.cookies?.api_token;
    if (!cookieToken) {
      throw new ForbiddenException('No session token');
    }

    (req as any).webToken = cookieToken;
    next();
  }
}