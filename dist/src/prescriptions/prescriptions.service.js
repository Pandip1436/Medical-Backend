"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrescriptionsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let PrescriptionsService = class PrescriptionsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(customerId, doctorName, notes, validUntil, file, branchId) {
        const customer = await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
        if (branchId && customer.branchId && customer.branchId !== branchId) {
            throw new common_1.NotFoundException('Customer not found');
        }
        const imageUrl = `/uploads/prescriptions/${file.filename}`;
        return this.prisma.prescription.create({
            data: {
                customerId,
                branchId: branchId ?? customer.branchId ?? null,
                doctorName,
                notes,
                validUntil: validUntil ? new Date(validUntil) : null,
                imageUrl,
                isActive: true,
            },
        });
    }
    async findByCustomer(customerId, branchId) {
        const where = { customerId };
        if (branchId)
            where.branchId = branchId;
        return this.prisma.prescription.findMany({
            where,
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(id, branchId) {
        const p = await this.prisma.prescription.findUnique({ where: { id } });
        if (!p)
            throw new common_1.NotFoundException('Prescription not found');
        if (branchId && p.branchId && p.branchId !== branchId) {
            throw new common_1.NotFoundException('Prescription not found');
        }
        return p;
    }
    async remove(id, branchId) {
        const p = await this.findOne(id, branchId);
        if (p.imageUrl) {
            const filePath = path.join(process.cwd(), p.imageUrl);
            if (fs.existsSync(filePath))
                fs.unlinkSync(filePath);
        }
        return this.prisma.prescription.delete({ where: { id } });
    }
};
exports.PrescriptionsService = PrescriptionsService;
exports.PrescriptionsService = PrescriptionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PrescriptionsService);
//# sourceMappingURL=prescriptions.service.js.map