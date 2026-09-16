import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchQueryDto } from './dto/search.dto';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Hybrid search across documents, meetings and messages',
    description: 'Uses the same retrieval pipeline as the assistant, without the answering step.',
  })
  run(@Query() query: SearchQueryDto) {
    return this.search.search(query.q, {
      limit: query.limit,
      ...(query.types?.length ? { types: query.types } : {}),
    });
  }
}
