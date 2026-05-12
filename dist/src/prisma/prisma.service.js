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
var PrismaService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const RETRYABLE_PRISMA_CODES = new Set(['P1001', 'P2024']);
const RETRY_DELAYS_MS = [500, 1500, 4000];
function isRetryable(err) {
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
        RETRYABLE_PRISMA_CODES.has(err.code)) {
        return true;
    }
    if (err instanceof client_1.Prisma.PrismaClientInitializationError) {
        if (typeof err.errorCode === 'string' &&
            RETRYABLE_PRISMA_CODES.has(err.errorCode)) {
            return true;
        }
        if (/can't reach database|connection.*refused|timed out/i.test(err.message)) {
            return true;
        }
    }
    return false;
}
let PrismaService = PrismaService_1 = class PrismaService extends client_1.PrismaClient {
    logger = new common_1.Logger(PrismaService_1.name);
    constructor() {
        super();
        this.$use(async (params, next) => {
            for (let attempt = 0;; attempt++) {
                try {
                    return (await next(params));
                }
                catch (err) {
                    if (attempt < RETRY_DELAYS_MS.length && isRetryable(err)) {
                        const delay = RETRY_DELAYS_MS[attempt];
                        this.logger.warn(`Transient DB error on ${params.model ?? 'raw'}.${params.action} ` +
                            `(attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1}); ` +
                            `retrying in ${delay}ms.`);
                        await new Promise((r) => setTimeout(r, delay));
                        continue;
                    }
                    throw err;
                }
            }
        });
    }
    async onModuleInit() {
        try {
            await this.$connect();
        }
        catch (err) {
            this.logger.warn(`Eager DB connect failed at boot (${err.message}). ` +
                `Prisma will retry on first query.`);
        }
    }
    async onModuleDestroy() {
        await this.$disconnect();
    }
};
exports.PrismaService = PrismaService;
exports.PrismaService = PrismaService = PrismaService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PrismaService);
//# sourceMappingURL=prisma.service.js.map