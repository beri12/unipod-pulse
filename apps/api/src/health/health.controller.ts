import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Overall service status, dependencies and queue depths' })
  @ApiOkResponse({ description: 'Aggregated health report' })
  overall() {
    return this.health.status();
  }

  @Public()
  @Get('database')
  @ApiOperation({ summary: 'PostgreSQL connectivity' })
  database() {
    return this.health.database();
  }

  @Public()
  @Get('redis')
  @ApiOperation({ summary: 'Redis connectivity' })
  redis() {
    return this.health.redis();
  }

  @Public()
  @Get('storage')
  @ApiOperation({ summary: 'Object storage connectivity' })
  storage() {
    return this.health.storageStatus();
  }
}
