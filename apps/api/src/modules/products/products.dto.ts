import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString,
  MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../common/pagination';

export class VariantDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @MaxLength(100) sku: string;
  @IsOptional() @IsString() @MaxLength(64) barcode?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() dimensions?: string;
  @IsOptional() @IsInt() @Min(0) weightGrams?: number;
  @IsOptional() @IsString() material?: string;
  @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @IsOptional() @IsNumber() @Min(0) listPrice?: number;
  @IsOptional() @IsInt() @Min(0) initialStock?: number; // varsayılan depoya açılış stoğu
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateProductDto {
  @IsString() @MaxLength(250) name: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @MaxLength(500) shortDescription?: string;
  @IsOptional() @IsObject() specs?: Record<string, string>;
  @IsOptional() @IsString() packageContent?: string;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  @IsOptional() @IsString() originCountry?: string;
  @IsOptional() @IsNumber() @Min(0) vatRate?: number;
  @IsOptional() @IsEnum(['DRAFT', 'ACTIVE', 'ARCHIVED']) status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(250) name?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() categoryId?: string | null;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() @MaxLength(500) shortDescription?: string;
  @IsOptional() @IsObject() specs?: Record<string, string>;
  @IsOptional() @IsString() packageContent?: string;
  @IsOptional() @IsInt() @Min(0) warrantyMonths?: number;
  @IsOptional() @IsString() originCountry?: string;
  @IsOptional() @IsNumber() @Min(0) vatRate?: number;
  @IsOptional() @IsEnum(['DRAFT', 'ACTIVE', 'ARCHIVED']) status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => VariantDto) variants?: VariantDto[];
}

export class ProductListQuery extends PaginationQuery {
  @IsOptional() @IsEnum(['DRAFT', 'ACTIVE', 'ARCHIVED']) status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() categoryId?: string;
}
