import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { AuthModule } from '../auth/auth.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule, AuthModule],
  controllers: [ProxyController],
})
export class ProxyModule {}