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