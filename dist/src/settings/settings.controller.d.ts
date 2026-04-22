import { SettingsService } from './settings.service';
export declare class SettingsController {
    private readonly settingsService;
    constructor(settingsService: SettingsService);
    getBusinessProfile(branchId: string): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string | null;
        isActive: boolean;
        createdAt: Date;
        code: string;
        address: string | null;
        gstin: string | null;
        drugLicense: string | null;
        isDefault: boolean;
    } | null>;
    updateBusinessProfile(branchId: string, data: any): Promise<{
        id: string;
        email: string | null;
        name: string;
        phone: string | null;
        isActive: boolean;
        createdAt: Date;
        code: string;
        address: string | null;
        gstin: string | null;
        drugLicense: string | null;
        isDefault: boolean;
    }>;
    getDiscountRules(branchId: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.DiscountType;
        value: import("@prisma/client/runtime/library").Decimal;
        updatedAt: Date;
        applicableTo: string | null;
        validFrom: Date | null;
        validTo: Date | null;
    }[]>;
    createDiscountRule(branchId: string, data: any): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.DiscountType;
        value: import("@prisma/client/runtime/library").Decimal;
        updatedAt: Date;
        applicableTo: string | null;
        validFrom: Date | null;
        validTo: Date | null;
    }>;
    updateDiscountRule(id: string, data: any): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.DiscountType;
        value: import("@prisma/client/runtime/library").Decimal;
        updatedAt: Date;
        applicableTo: string | null;
        validFrom: Date | null;
        validTo: Date | null;
    }>;
    deleteDiscountRule(id: string): Promise<{
        id: string;
        name: string;
        isActive: boolean;
        branchId: string | null;
        createdAt: Date;
        type: import(".prisma/client").$Enums.DiscountType;
        value: import("@prisma/client/runtime/library").Decimal;
        updatedAt: Date;
        applicableTo: string | null;
        validFrom: Date | null;
        validTo: Date | null;
    }>;
    getSetting(key: string): Promise<string | number | true | import("@prisma/client/runtime/library").JsonObject | import("@prisma/client/runtime/library").JsonArray>;
    updateSetting(key: string, value: any): Promise<{
        id: string;
        value: import("@prisma/client/runtime/library").JsonValue;
        key: string;
        updatedAt: Date;
    }>;
}
