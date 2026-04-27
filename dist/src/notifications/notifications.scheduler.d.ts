import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
export declare class NotificationsScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
    private readonly service;
    private readonly logger;
    private intervalId;
    constructor(service: NotificationsService);
    onApplicationBootstrap(): Promise<void>;
    onApplicationShutdown(): void;
    private runAll;
}
