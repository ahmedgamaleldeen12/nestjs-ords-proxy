
# 📁 NestJS Project Structure (src/)

## Folder Tree
```bash
src/
├── app.controller.spec.ts
├── app.controller.ts
├── app.module.ts
├── app.service.ts
├── auth/     # Authentication module (token + login logic)
│   ├── auth.module.ts
│   ├── token.controller.ts
│   └── token.service.ts
├── guards/
│   └── api-key.guard.ts
├── main.ts
├── middleware/     # Request guards / CSRF protection
│   └── auth.middleware.ts
└── proxy/     # ORDS API proxy layer
    ├── proxy.controller.ts
    └── proxy.module.ts

```

---

# 📄 File Contents

### `src/app.controller.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});

```

---

### `src/app.controller.ts`

```typescript
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}

```

---

### `src/app.module.ts`

```typescript
// app.module.ts
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ProxyModule } from './proxy/proxy.module';
import { AuthMiddleware } from './middleware/auth.middleware';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
@Module({
  imports: [
    ThrottlerModule.forRoot([{
      ttl:   60000,  // 1 minute window
      limit: 10,     // max 10 requests per IP per minute
    }]),
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ProxyModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,   
    },
  ],
})

export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes('api/*'); 
  }
}
```

---

### `src/app.service.ts`

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}

```

---

### `src/auth/auth.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TokenService } from './token.service';
import { TokenController } from './token.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  providers: [TokenService],
  controllers: [TokenController],
  exports: [TokenService], // IMPORTANT for proxy
})
export class AuthModule {}
```

---

### `src/auth/token.controller.ts`

```typescript
import { Controller, Post, Res, UseGuards } from '@nestjs/common';
import { TokenService } from './token.service';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from 'src/guards/api-key.guard';

@Controller('auth')
export class TokenController {
    constructor(private readonly tokenService: TokenService) { }

    /**
     * Web: sets token as HttpOnly cookie — JS never sees the token value
     */
    @Post('token')
    @Throttle({ default: { ttl: 60000, limit: 5 } })
    async issueWebToken(@Res() res: Response) {
        const token = await this.tokenService.getValidToken();

        res.cookie('api_token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'strict',
            maxAge: 3_600_000, // 1 hour
            path: '/api',
        });

        return res.json({ ok: true });
    }

    /**
     * Mobile: returns token in body so Angular can store in Keychain/Keystore
     * This endpoint should be called only from native apps (Capacitor)
     */
    @Post('mobile-token')
    @UseGuards(ApiKeyGuard)          // ← only requests with correct x-api-key pass
    async issueMobileToken(@Res() res: Response) {
        const token = await this.tokenService.getValidToken();
        return res.json({ access_token: token });
    }

    /**
     * Logout: clears HttpOnly cookie (web) — mobile clears its own Secure Storage
     */
    @Post('logout')
    async logout(@Res() res: Response) {
        res.clearCookie('api_token', { path: '/api' });
        return res.json({ ok: true });
    }
}
```

---

### `src/auth/token.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class TokenService {
    private cachedToken: string | null = null;
    private tokenExpiry = 0;
    private readonly logger = new Logger(TokenService.name);

    constructor(private readonly http: HttpService) { }

    async getValidToken(): Promise<string> {
        // Refresh if within 2 minutes of expiry
        const twoMinutes = 2 * 60 * 1000;
        if (this.cachedToken && Date.now() < this.tokenExpiry - twoMinutes) {
            return this.cachedToken;
        }
        return this.fetchNewToken();
    }


    private async fetchNewToken(): Promise<string> {
        const { data } = await firstValueFrom(
            this.http.post(
                `${process.env.ORDS_BASE_URL}/oauth/token`,
                'grant_type=client_credentials',
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    auth: {
                        username: process.env.ORDS_CLIENT_ID!,
                        password: process.env.ORDS_CLIENT_SECRET!,
                    },
                },
            ),
        );

        this.cachedToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

        if (!this.cachedToken) {
            throw new Error('Token not available');
        }
        return this.cachedToken;
    }

}
```

---

### `src/guards/api-key.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || apiKey !== process.env.MOBILE_API_KEY) {
      throw new UnauthorizedException('Invalid API key');
    }
    return true;
  }
}
```

---

### `src/main.ts`

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  app.enableCors({
    origin: [
      'https://your-weblogic-domain.company.com',
      'capacitor://localhost',                     
      'http://localhost:4200',                     
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();


```

---

### `src/middleware/auth.middleware.ts`

```typescript
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
```

---

### `src/proxy/proxy.controller.ts`

```typescript
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
```

---

### `src/proxy/proxy.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { AuthModule } from '../auth/auth.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule, AuthModule],
  controllers: [ProxyController],
})
export class ProxyModule {}
```

