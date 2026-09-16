import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ListQuestionLogsQueryDto,
  ListUnansweredQueryDto,
  UpdateQuestionStatusDto,
} from './dto/questions.dto';
import { QuestionsService } from './questions.service';

@ApiTags('questions')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questions: QuestionsService) {}

  @Get('unanswered')
  @ApiOperation({ summary: 'Information gaps: questions the knowledge base could not answer' })
  unanswered(@Query() query: ListUnansweredQueryDto) {
    return this.questions.listUnanswered({
      page: query.page,
      limit: query.limit,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { search: query.search } : {}),
    });
  }

  @Get('logs')
  @ApiOperation({ summary: 'Every question asked, newest first' })
  logs(@Query() query: ListQuestionLogsQueryDto) {
    return this.questions.listLogs({
      page: query.page,
      limit: query.limit,
      ...(query.answered !== undefined ? { answered: query.answered } : {}),
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Question analytics totals' })
  stats() {
    return this.questions.stats();
  }

  @Patch('unanswered/:id')
  @ApiOperation({ summary: 'Mark an information gap as answered or ignored' })
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateQuestionStatusDto,
  ) {
    return this.questions.updateStatus(id, dto.status, dto.resolutionNote);
  }
}
