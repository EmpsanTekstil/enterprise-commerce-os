import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { UsersService } from './users.service';

class CreateDto { @IsEmail() email: string; @IsString() @MaxLength(100) fullName: string; @IsArray() @ArrayMinSize(1) @IsString({ each: true }) roleIds: string[]; @IsOptional() @IsString() @MinLength(8) password?: string }
class UpdateDto { @IsOptional() @IsString() @MaxLength(100) fullName?: string; @IsOptional() @IsBoolean() isActive?: boolean; @IsOptional() @IsArray() @IsString({ each: true }) roleIds?: string[] }
class PasswordDto { @IsString() current: string; @IsString() @MinLength(8) next: string }
class PermsDto { @IsArray() @IsString({ each: true }) keys: string[] }

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersController {
  constructor(private svc: UsersService) {}
  @Get('users') @RequirePermissions('users.write') list(@CurrentUser() u: JwtPayload) { return this.svc.list(u); }
  @Post('users') @RequirePermissions('users.write') create(@CurrentUser() u: JwtPayload, @Body() d: CreateDto) { return this.svc.create(u, d); }
  @Patch('users/:id') @RequirePermissions('users.write') update(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: UpdateDto) { return this.svc.update(u, id, d); }
  @Post('users/:id/reset-password') @RequirePermissions('users.write') reset(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.resetPassword(u, id); }
  @Post('users/me/password') changePassword(@CurrentUser() u: JwtPayload, @Body() d: PasswordDto) { return this.svc.changeOwnPassword(u, d.current, d.next); }
  @Get('roles') @RequirePermissions('users.write') roles(@CurrentUser() u: JwtPayload) { return this.svc.roles(u); }
  @Get('permissions') @RequirePermissions('users.write') permissions() { return this.svc.permissions(); }
  @Put('roles/:id/permissions') @RequirePermissions('users.write') perms(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: PermsDto) { return this.svc.setRolePermissions(u, id, d.keys); }
  @Get('audit-log') @RequirePermissions('settings.write') audit(@CurrentUser() u: JwtPayload, @Query('entityType') t?: string) { return this.svc.auditLog(u, 200, t || undefined); }
}
