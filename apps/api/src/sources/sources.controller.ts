import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SourcesService } from './sources.service';

@ApiTags('sources')
@ApiBearerAuth()
@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Resolve a citation to the source it points at' })
  byId(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.sources.byId(id);
  }
}
