"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var NotificationsScheduler_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationsScheduler = void 0;
const common_1 = require("@nestjs/common");
const notifications_service_1 = require("./notifications.service");
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
let NotificationsScheduler = NotificationsScheduler_1 = class NotificationsScheduler {
    service;
    logger = new common_1.Logger(NotificationsScheduler_1.name);
    intervalId = null;
    constructor(service) {
        this.service = service;
    }
    async onApplicationBootstrap() {
        await this.runAll('startup');
        this.intervalId = setInterval(() => this.runAll('scheduled'), TWENTY_FOUR_HOURS);
    }
    onApplicationShutdown() {
        if (this.intervalId)
            clearInterval(this.intervalId);
    }
    async runAll(trigger) {
        try {
            const [lowStock, expiry, paymentDue] = await Promise.all([
                this.service.generateLowStockAlerts(undefined),
                this.service.generateExpiryAlerts(undefined, 90),
                this.service.generatePaymentDueAlerts(undefined),
            ]);
            this.logger.log(`[${trigger}] Alerts generated — lowStock: ${lowStock.created}, expiry: ${expiry.created}, paymentDue: ${paymentDue.created}`);
        }
        catch (err) {
            this.logger.error(`[${trigger}] Failed to generate alerts`, err);
        }
    }
};
exports.NotificationsScheduler = NotificationsScheduler;
exports.NotificationsScheduler = NotificationsScheduler = NotificationsScheduler_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [notifications_service_1.NotificationsService])
], NotificationsScheduler);
//# sourceMappingURL=notifications.scheduler.js.map