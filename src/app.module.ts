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