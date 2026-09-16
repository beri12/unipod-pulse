import { Module } from '@nestjs/common';
import { CatchUpController } from './catch-up.controller';
import { CatchUpService } from './catch-up.service';

@Module({
  controllers: [CatchUpController],
  providers: [CatchUpService],
  exports: [CatchUpService],
})
export class CatchUpModule {}
