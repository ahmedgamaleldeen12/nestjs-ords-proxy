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