import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UsersService } from './users.service';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: 'avatarUrl must be an absolute URL' })
  @MaxLength(500)
  avatarUrl?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user profile' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.byId(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update your display name or avatar' })
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Roles('ADMIN')
  @Get()
  @ApiOperation({ summary: 'List community members (admin only)' })
  list() {
    return this.users.list();
  }
}
