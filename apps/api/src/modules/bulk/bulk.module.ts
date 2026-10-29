import { Module } from '@nestjs/common';
import { BulkController } from './bulk.controller';
import { BulkService } from './bulk.service';

@Module({ controllers: [BulkController], providers: [BulkService] })
export class BulkModule {}
