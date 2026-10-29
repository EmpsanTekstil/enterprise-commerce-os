import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  organizationId: string;
  email: string;
  permissions: string[];
  roles: string[];
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findFirst({
      where: { email: email.toLowerCase(), isActive: true },
      include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('E-posta veya şifre hatalı');
    }
    const permissions = new Set<string>();
    const roles: string[] = [];
    for (const ur of user.userRoles) {
      roles.push(ur.role.key);
      for (const rp of ur.role.rolePermissions) permissions.add(rp.permission.key);
    }
    const payload: JwtPayload = {
      sub: user.id,
      organizationId: user.organizationId,
      email: user.email,
      permissions: [...permissions],
      roles,
    };
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return {
      accessToken: await this.jwt.signAsync(payload),
      user: { id: user.id, email: user.email, fullName: user.fullName, roles, permissions: [...permissions] },
    };
  }

  static async hashPassword(plain: string) {
    return bcrypt.hash(plain, 10);
  }
}
