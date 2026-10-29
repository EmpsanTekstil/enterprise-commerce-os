import { Body, Controller, Delete, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsString } from 'class-validator';
import { JwtPayload } from '../auth/auth.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { MAX_IMAGE_BYTES, MediaService } from './media.service';

class ReorderDto { @IsArray() @ArrayMinSize(1) @IsString({ each: true }) imageIds: string[] }

@ApiTags('media')
@ApiBearerAuth()
@Controller('products/:productId/images')
export class MediaController {
  constructor(private svc: MediaService) {}

  @Post() @RequirePermissions('products.write')
  @ApiConsumes('multipart/form-data') @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES } }))
  upload(@CurrentUser() u: JwtPayload, @Param('productId') productId: string, @UploadedFile() file: Express.Multer.File, @Query('variantId') variantId?: string) {
    return this.svc.uploadProductImage(u, productId, file, variantId || undefined);
  }

  @Patch('order') @RequirePermissions('products.write')
  reorder(@CurrentUser() u: JwtPayload, @Param('productId') productId: string, @Body() dto: ReorderDto) { return this.svc.reorder(u, productId, dto.imageIds); }

  @Delete(':imageId') @RequirePermissions('products.write')
  remove(@CurrentUser() u: JwtPayload, @Param('imageId') imageId: string) { return this.svc.remove(u, imageId); }
}
