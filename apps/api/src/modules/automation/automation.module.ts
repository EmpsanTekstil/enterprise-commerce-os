import { Global, Module } from '@nestjs/common';
import { AutomationController } from './automation.controller';
import { AutomationService } from './automation.service';
import { NotificationsService } from './notifications.service';

@Global()
@Module({ controllers: [AutomationController], providers: [AutomationService, NotificationsService], exports: [AutomationService, NotificationsService] })
export class AutomationModule {}
