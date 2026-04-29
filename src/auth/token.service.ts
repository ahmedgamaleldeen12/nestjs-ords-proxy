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