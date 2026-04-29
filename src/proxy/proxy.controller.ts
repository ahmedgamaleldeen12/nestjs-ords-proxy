// proxy/proxy.controller.ts
import { Controller, All, Req, Res, UnauthorizedException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { TokenService } from '../auth/token.service';
import { firstValueFrom } from 'rxjs';
import type { Request, Response } from 'express';

@Controller('api')
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(
    private readonly http: HttpService,
    private readonly tokenService: TokenService,
  ) { }

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    const requestId = Math.random().toString(36).substring(2, 8);

    try {
      // =============================
      // 1. Incoming Request
      // =============================
      this.logger.log(`[${requestId}] Incoming Request`);
      this.logger.debug({
        method: req.method,
        url: req.originalUrl,
        headers: req.headers,
        body: req.body,
        query: req.query,
      });

      // =============================
      // 2. Token Handling
      // =============================
      const authHeader = req.headers['authorization'];
      const isMobile = authHeader?.startsWith('Bearer ');

      const token = isMobile
        ? authHeader!.replace('Bearer ', '')
        : (req as any).webToken;

      if (!token) {
        this.logger.warn(`[${requestId}] No token found`);
        throw new UnauthorizedException('No token available');
      }

      this.logger.log(`[${requestId}] Token resolved (${isMobile ? 'mobile' : 'web'})`);

      // =============================
      // 3. Build Target URL
      // =============================
      const ordsPath = req.url.replace(/^\/api/, '');
      const targetUrl = `${process.env.ORDS_BASE_URL}${ordsPath}`;

      this.logger.log(`[${requestId}] Target URL: ${targetUrl}`);

      // =============================
      // 4. Outgoing Request Config
      // =============================
      const config = {
        method: req.method as any,
        url: targetUrl,
        data: req.body,
        params: req.query,
        maxRedirects: 0, // 👈 capture redirects manually
        validateStatus: () => true, // don't throw automatically
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': req.headers['content-type'] || 'application/json',
        },
      };

      this.logger.debug(`[${requestId}] Outgoing Request`, config);

      // =============================
      // 5. Handle Redirects Manually
      // =============================
      let currentUrl = targetUrl;
      let response;

      for (let i = 0; i < 5; i++) {
        this.logger.log(`[${requestId}] Requesting: ${currentUrl}`);

        response = await firstValueFrom(
          this.http.request({
            ...config,
            url: currentUrl,
          }),
        );

        // Log response at each step
        this.logger.debug(`[${requestId}] Response Step ${i}`, {
          status: response.status,
          headers: response.headers,
        });

        // Check redirect
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers['location'];

          if (!location) break;

          this.logger.warn(`[${requestId}] Redirect detected → ${location}`);

          currentUrl = location;
          continue;
        }

        // Final response reached
        break;
      }

      // =============================
      // 6. Final Response Logging
      // =============================
      this.logger.log(`[${requestId}] Final Response`);
      this.logger.debug({
        status: response.status,
        data: response.data,
      });

      // =============================
      // 7. Return Response
      // =============================
      return res.status(response.status).json(response.data);

    } catch (err: any) {
      // =============================
      // 8. Error Handling
      // =============================
      this.logger.error(`[${requestId}] ERROR`);

      if (err.response) {
        this.logger.error({
          status: err.response.status,
          headers: err.response.headers,
          data: err.response.data,
        });
      } else {
        this.logger.error(err.message);
      }

      const status = err.response?.status || 500;

      if (status === 401) {
        return res.status(401).json({
          message: 'Token expired, please re-authenticate',
        });
      }

      return res.status(status).json(
        err.response?.data || { message: 'ORDS error' },
      );
    }
  }
}