
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

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { ProxyModule } from './proxy/proxy.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    ProxyModule,
  ],
})
export class AppModule {}

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
import { Controller, Post, Res } from '@nestjs/common';
import { TokenService } from './token.service';
import type { Response } from 'express';
@Controller('auth')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Post('token')
  async issueWebToken(@Res() res: Response) {
    const token = await this.tokenService.getValidToken();

    res.cookie('api_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      maxAge: 3600000,
      path: '/api',
    });

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
        if (this.cachedToken && Date.now() < this.tokenExpiry) {
            return this.cachedToken;
        }
        return this.fetchNewToken();
    }

    private async fetchNewToken(): Promise<string> {
        const params = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: process.env.ORDS_CLIENT_ID!,
            client_secret: process.env.ORDS_CLIENT_SECRET!,
        });

        const { data } = await firstValueFrom(
            this.http.post(
                `${process.env.ORDS_BASE_URL}/oauth/token`,
                params.toString(),
                { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
            ),
        );

        this.cachedToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;

        if (!this.cachedToken) {
            throw new Error('Token not available');
        }
        return this.cachedToken
    }
}
```

---

### `src/main.ts`

```typescript

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  await app.listen(process.env.PORT || 3000);
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
import { Controller, All, Req, Res } from '@nestjs/common';
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
    const isMobile = req.headers['authorization']?.startsWith('Bearer ');

    const token = isMobile
      ? req.headers['authorization']!.replace('Bearer ', '')
      : await this.tokenService.getValidToken();

    const targetUrl = `${process.env.ORDS_BASE_URL}${req.url.replace('/api', '')}`;

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
      return res
        .status(err.response?.status || 500)
        .json(err.response?.data || { message: 'ORDS error' });
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

