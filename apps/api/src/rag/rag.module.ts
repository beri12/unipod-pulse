import { Global, Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { RankingService } from './ranking.service';

@Global()
@Module({
  providers: [RagService, RankingService],
  exports: [RagService, RankingService],
})
export class RagModule {}
