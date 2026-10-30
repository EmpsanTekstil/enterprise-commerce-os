import { Body, Controller, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQuery } from '../../common/pagination';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { ReviewsService } from './reviews.service';

class RQuery extends PaginationQuery { @IsOptional() @IsString() accountId?: string; @IsOptional() @IsString() productId?: string; @IsOptional() @IsString() sentiment?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) minRating?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) maxRating?: number }
class DraftDto { @IsString() @MinLength(5) @MaxLength(2000) text: string }
class SendDto { @IsString() responseId: string; @IsOptional() @IsBoolean() markOnly?: boolean }
class AnalyzeDto { @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number }

@ApiTags('reviews')
@ApiBearerAuth()
@Controller('reviews')
export class ReviewsController {
  constructor(private svc: ReviewsService) {}

  @Get() @RequirePermissions('support.read') list(@CurrentUser() u: JwtPayload, @Query() q: RQuery) { return this.svc.list(u, q); }
  @Get('insights') @RequirePermissions('support.read') insights(@CurrentUser() u: JwtPayload) { return this.svc.insights(u); }
  @Post('import/:accountId') @RequirePermissions('support.write') @ApiConsumes('multipart/form-data') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  import(@CurrentUser() u: JwtPayload, @Param('accountId') a: string, @UploadedFile() file: Express.Multer.File) { return this.svc.importSheet(u, a, file.buffer); }
  @Post('classify-by-rating') @RequirePermissions('support.write') classify(@CurrentUser() u: JwtPayload) { return this.svc.classifyByRating(u); }
  @Post('analyze') @RequirePermissions('support.write', 'ai.use') analyze(@CurrentUser() u: JwtPayload, @Body() d: AnalyzeDto) { return this.svc.analyze(u, d.limit); }
  @Post(':id/ai-draft') @RequirePermissions('support.write', 'ai.use') aiDraft(@CurrentUser() u: JwtPayload, @Param('id') id: string) { return this.svc.aiReplyDraft(u, id); }
  @Post(':id/draft') @RequirePermissions('support.write') draft(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: DraftDto) { return this.svc.draft(u, id, d.text); }
  @Post(':id/send') @RequirePermissions('support.write') send(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() d: SendDto) { return this.svc.send(u, id, d.responseId, d.markOnly ?? false); }
}
