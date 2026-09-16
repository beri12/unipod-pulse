import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SOURCE_KINDS, type SourceKind } from '@unipods/types';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { AdminService } from './admin.service';

export class KnowledgeQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(SOURCE_KINDS)
  type?: SourceKind;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard counters' })
  stats() {
    return this.admin.stats();
  }

  @Get('status')
  @ApiOperation({ summary: 'Dependency health, queue depths and the active AI provider' })
  status() {
    return this.admin.status();
  }

  @Get('knowledge')
  @ApiOperation({ summary: 'Everything the assistant can cite, searchable' })
  knowledge(@Query() query: KnowledgeQueryDto) {
    return this.admin.knowledge({
      page: query.page,
      limit: query.limit,
      ...(query.search ? { search: query.search } : {}),
      ...(query.type ? { type: query.type } : {}),
    });
  }
}
