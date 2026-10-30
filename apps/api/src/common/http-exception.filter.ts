import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { UnsupportedOperationError } from '../integrations/adapter.interface';

/**
 * Tüm hataları Türkçe ve tutarlı JSON'a çevirir; iç hatalar gizlenmez, loglanır ve kullanıcıya özet gider.
 * UnsupportedOperationError → 400 (kanal desteklemiyor); Prisma benzersizlik → 409; bilinmeyen → 500 (metin + istek kimliği).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('HTTP');
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR; let message: string | string[] = 'Beklenmeyen bir hata oluştu';
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as string | { message?: string | string[] };
      message = typeof r === 'string' ? r : r.message ?? exception.message;
    } else if (exception instanceof UnsupportedOperationError) {
      status = HttpStatus.BAD_REQUEST; message = exception.message;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') { status = HttpStatus.CONFLICT; message = 'Bu kayıt zaten var (benzersizlik kısıtı)'; }
      else if (exception.code === 'P2025') { status = HttpStatus.NOT_FOUND; message = 'Kayıt bulunamadı'; }
      else { message = `Veritabanı hatası (${exception.code})`; }
    } else if (exception instanceof Error) {
      message = exception.message || message;
    }
    if (status >= 500) this.log.error(exception instanceof Error ? exception.stack ?? exception.message : String(exception));
    res.status(status).json({ statusCode: status, message, time: new Date().toISOString() });
  }
}
