import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/auth.service';
import { PERMISSIONS } from '../auth/permissions.catalog';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list(user: JwtPayload) {
    return this.prisma.user.findMany({ where: { organizationId: user.organizationId }, select: { id: true, email: true, fullName: true, isActive: true, lastLoginAt: true, createdAt: true, userRoles: { select: { role: { select: { id: true, key: true, name: true } } } } }, orderBy: { createdAt: 'asc' } });
  }

  roles(user: JwtPayload) {
    return this.prisma.role.findMany({ where: { organizationId: user.organizationId }, include: { rolePermissions: { include: { permission: true } }, _count: { select: { userRoles: true } } }, orderBy: { name: 'asc' } });
  }

  permissions() { return Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })); }

  /** Kullanıcı oluşturur; şifre verilmezse geçici şifre üretir ve bir kez döner. */
  async create(user: JwtPayload, data: { email: string; fullName: string; roleIds: string[]; password?: string }) {
    const email = data.email.toLowerCase().trim();
    if (await this.prisma.user.findUnique({ where: { organizationId_email: { organizationId: user.organizationId, email } } })) throw new BadRequestException('Bu e-posta zaten kayıtlı');
    const roles = await this.prisma.role.findMany({ where: { id: { in: data.roleIds }, organizationId: user.organizationId } });
    if (!roles.length) throw new BadRequestException('En az bir rol seçin');
    const tempPassword = data.password ?? randomBytes(6).toString('base64url');
    if (tempPassword.length < 8) throw new BadRequestException('Şifre en az 8 karakter olmalı');
    const u = await this.prisma.user.create({ data: { organizationId: user.organizationId, email, fullName: data.fullName.trim(), passwordHash: await bcrypt.hash(tempPassword, 10), userRoles: { create: roles.map((r) => ({ roleId: r.id })) } } });
    await this.audit.log(user, 'user.create', 'User', u.id, null, { email, roles: roles.map((r) => r.key) });
    return { id: u.id, email, fullName: u.fullName, roles: roles.map((r) => r.key), tempPassword: data.password ? undefined : tempPassword };
  }

  async update(user: JwtPayload, id: string, data: { fullName?: string; isActive?: boolean; roleIds?: string[] }) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: user.organizationId }, include: { userRoles: { include: { role: true } } } });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');
    if (id === user.sub && data.isActive === false) throw new ForbiddenException('Kendi hesabınızı pasifleştiremezsiniz');
    if (data.roleIds) {
      const roles = await this.prisma.role.findMany({ where: { id: { in: data.roleIds }, organizationId: user.organizationId } });
      if (!roles.length) throw new BadRequestException('En az bir rol seçin');
      const wasAdmin = target.userRoles.some((r) => r.role.key === 'admin'); const willAdmin = roles.some((r) => r.key === 'admin');
      if (wasAdmin && !willAdmin) {
        const admins = await this.prisma.userRole.count({ where: { role: { organizationId: user.organizationId, key: 'admin' }, user: { isActive: true } } });
        if (admins <= 1) throw new ForbiddenException('Son yöneticinin rolü kaldırılamaz');
      }
      await this.prisma.$transaction([this.prisma.userRole.deleteMany({ where: { userId: id } }), this.prisma.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id })) })]);
    }
    const u = await this.prisma.user.update({ where: { id }, data: { fullName: data.fullName?.trim(), isActive: data.isActive } });
    await this.audit.log(user, 'user.update', 'User', id, { fullName: target.fullName, isActive: target.isActive }, data);
    return { id: u.id, fullName: u.fullName, isActive: u.isActive };
  }

  async resetPassword(user: JwtPayload, id: string) {
    const target = await this.prisma.user.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!target) throw new NotFoundException('Kullanıcı bulunamadı');
    const tempPassword = randomBytes(6).toString('base64url');
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(tempPassword, 10) } });
    await this.audit.log(user, 'user.reset_password', 'User', id);
    return { tempPassword };
  }

  async changeOwnPassword(user: JwtPayload, current: string, next: string) {
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    if (!(await bcrypt.compare(current, me.passwordHash))) throw new BadRequestException('Mevcut şifre hatalı');
    if (next.length < 8) throw new BadRequestException('Yeni şifre en az 8 karakter olmalı');
    await this.prisma.user.update({ where: { id: user.sub }, data: { passwordHash: await bcrypt.hash(next, 10) } });
    await this.audit.log(user, 'user.change_password', 'User', user.sub);
    return { ok: true };
  }

  /** Rol yetkilerini günceller (sistem rolü "admin" dokunulmaz). */
  async setRolePermissions(user: JwtPayload, roleId: string, keys: string[]) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, organizationId: user.organizationId } });
    if (!role) throw new NotFoundException('Rol bulunamadı');
    if (role.key === 'admin') throw new ForbiddenException('Yönetici rolü değiştirilemez');
    const perms = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    await this.prisma.$transaction([this.prisma.rolePermission.deleteMany({ where: { roleId } }), this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) })]);
    await this.audit.log(user, 'role.permissions', 'Role', roleId, null, { keys });
    return { ok: true, count: perms.length };
  }

  auditLog(user: JwtPayload, take = 200, entityType?: string) {
    return this.prisma.auditLog.findMany({ where: { organizationId: user.organizationId, entityType }, include: { user: { select: { fullName: true, email: true } } }, orderBy: { createdAt: 'desc' }, take });
  }
}
