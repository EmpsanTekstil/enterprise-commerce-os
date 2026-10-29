import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChannelAccountDto {
  @IsString() channelCode: string;              // trendyol, shopify...
  @IsString() @MaxLength(100) label: string;    // "Trendyol - Ana Mağaza"
  @IsOptional() @IsString() externalSellerId?: string;
  @IsObject() credentials: Record<string, string>; // {apiKey, apiSecret, ...} — yalnızca HTTPS üzerinden, şifreli saklanır
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isDemo?: boolean;
}

export class UpdateChannelAccountDto {
  @IsOptional() @IsString() @MaxLength(100) label?: string;
  @IsOptional() @IsString() externalSellerId?: string;
  @IsOptional() @IsObject() credentials?: Record<string, string>;
  @IsOptional() @IsObject() settings?: Record<string, unknown>;
}
