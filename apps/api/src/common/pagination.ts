import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 25;
  @IsOptional() @IsString() q?: string;
}

export function paginate<T>(items: T[], total: number, q: PaginationQuery) {
  return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) };
}
