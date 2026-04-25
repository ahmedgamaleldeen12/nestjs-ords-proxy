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