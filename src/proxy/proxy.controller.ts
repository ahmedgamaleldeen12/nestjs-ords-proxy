// proxy/proxy.controller.ts
import { Controller, All, Req, Res, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { TokenService } from '../auth/token.service';
import { firstValueFrom } from 'rxjs';
import type { Request, Response } from 'express';

@Controller('api')
export class ProxyController {
  constructor(
    private readonly http: HttpService,
    private readonly tokenService: TokenService,
  ) {}

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    const authHeader = req.headers['authorization'];
    const isMobile = authHeader?.startsWith('Bearer ');

    // Web: use server-managed token from cookie
    // Mobile: use token sent in header (ORDS will reject if invalid)
    const token = isMobile
      ? authHeader!.replace('Bearer ', '')
      : (req as any).webToken;  // set by AuthMiddleware

    if (!token) throw new UnauthorizedException('No token available');

    const ordsPath = req.url.replace(/^\/api/, '');
    const targetUrl = `${process.env.ORDS_BASE_URL}${ordsPath}`;

    try {
      const response = await firstValueFrom(
        this.http.request({
          method: req.method as any,
          url: targetUrl,
          data: req.body,
          params: req.query,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': req.headers['content-type'] || 'application/json',
          },
        }),
      );
      return res.status(response.status).json(response.data);

    } catch (err: any) {
      const status = err.response?.status || 500;
      // If ORDS returns 401, token is invalid/expired
      if (status === 401) {
        return res.status(401).json({ message: 'Token expired, please re-authenticate' });
      }
      return res.status(status).json(err.response?.data || { message: 'ORDS error' });
    }
  }
}