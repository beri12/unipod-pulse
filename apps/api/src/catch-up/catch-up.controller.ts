import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CatchUpService, resolveRange } from './catch-up.service';
import { CatchUpQueryDto } from './dto/catch-up.dto';

@ApiTags('catch-up')
@ApiBearerAuth()
@Controller('catch-up')
export class CatchUpController {
  constructor(private readonly catchUp: CatchUpService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get()
  @ApiOperation({
    summary: 'What did I miss?',
    description:
      'Summarises announcements, meetings, documents and discussions from a day or a custom range, each linked to its source.',
  })
  get(@Query() query: CatchUpQueryDto) {
    return this.catchUp.generate(
      resolveRange({
        ...(query.date ? { date: query.date } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
      }),
    );
  }
}
