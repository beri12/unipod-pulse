import { Injectable } from '@nestjs/common';
import type { PublicUser } from '@unipods/types';
import { AppException } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { toPublicUser } from '../auth/auth.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async byId(id: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw AppException.notFound('That user');
    return toPublicUser(user);
  }

  async updateProfile(
    id: string,
    data: { name?: string; avatarUrl?: string },
  ): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
      },
    });
    return toPublicUser(user);
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toPublicUser);
  }
}
