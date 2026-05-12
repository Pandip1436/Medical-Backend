"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DocumentNumberingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentNumberingService = void 0;
const common_1 = require("@nestjs/common");
let DocumentNumberingService = DocumentNumberingService_1 = class DocumentNumberingService {
    static getFinancialYear(date = new Date()) {
        const month = date.getMonth();
        const year = date.getFullYear();
        const fyStart = month >= 3 ? year : year - 1;
        const fyEnd = fyStart + 1;
        const yy = (n) => String(n % 100).padStart(2, '0');
        return `${yy(fyStart)}-${yy(fyEnd)}`;
    }
    async nextNumber(tx, docType, branchId) {
        const fy = DocumentNumberingService_1.getFinancialYear();
        const scope = branchId ?? 'GLOBAL';
        const key = `${docType}:${scope}:${fy}`;
        const seq = await tx.documentSequence.upsert({
            where: { key },
            update: { counter: { increment: 1 } },
            create: {
                key,
                docType,
                branchId: branchId ?? null,
                financialYear: fy,
                counter: 1,
            },
        });
        return `${docType}/${fy}/${String(seq.counter).padStart(5, '0')}`;
    }
};
exports.DocumentNumberingService = DocumentNumberingService;
exports.DocumentNumberingService = DocumentNumberingService = DocumentNumberingService_1 = __decorate([
    (0, common_1.Injectable)()
], DocumentNumberingService);
//# sourceMappingURL=document-numbering.service.js.map