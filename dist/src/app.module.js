"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const core_1 = require("@nestjs/core");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./auth/auth.module");
const prisma_module_1 = require("./prisma/prisma.module");
const users_module_1 = require("./users/users.module");
const customers_module_1 = require("./customers/customers.module");
const suppliers_module_1 = require("./suppliers/suppliers.module");
const products_module_1 = require("./products/products.module");
const billing_module_1 = require("./billing/billing.module");
const purchase_orders_module_1 = require("./purchase-orders/purchase-orders.module");
const grn_module_1 = require("./grn/grn.module");
const reports_module_1 = require("./reports/reports.module");
const credit_notes_module_1 = require("./credit-notes/credit-notes.module");
const purchase_returns_module_1 = require("./purchase-returns/purchase-returns.module");
const audit_logs_module_1 = require("./audit-logs/audit-logs.module");
const audit_log_interceptor_1 = require("./common/interceptors/audit-log.interceptor");
const prescriptions_module_1 = require("./prescriptions/prescriptions.module");
const expenses_module_1 = require("./expenses/expenses.module");
const doctors_module_1 = require("./doctors/doctors.module");
const branches_module_1 = require("./branches/branches.module");
const salespersons_module_1 = require("./salespersons/salespersons.module");
const settings_module_1 = require("./settings/settings.module");
const quotations_module_1 = require("./quotations/quotations.module");
const serve_static_1 = require("@nestjs/serve-static");
const path_1 = require("path");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({ isGlobal: true }),
            serve_static_1.ServeStaticModule.forRoot({
                rootPath: (0, path_1.join)(process.cwd(), 'uploads'),
                serveRoot: '/uploads',
            }),
            auth_module_1.AuthModule,
            prisma_module_1.PrismaModule,
            users_module_1.UsersModule,
            customers_module_1.CustomersModule,
            suppliers_module_1.SuppliersModule,
            products_module_1.ProductsModule,
            billing_module_1.BillingModule,
            purchase_orders_module_1.PurchaseOrdersModule,
            grn_module_1.GrnModule,
            reports_module_1.ReportsModule,
            credit_notes_module_1.CreditNotesModule,
            purchase_returns_module_1.PurchaseReturnsModule,
            audit_logs_module_1.AuditLogsModule,
            prescriptions_module_1.PrescriptionsModule,
            expenses_module_1.ExpensesModule,
            doctors_module_1.DoctorsModule,
            branches_module_1.BranchesModule,
            salespersons_module_1.SalespersonsModule,
            settings_module_1.SettingsModule,
            quotations_module_1.QuotationsModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            app_service_1.AppService,
            {
                provide: core_1.APP_INTERCEPTOR,
                useClass: audit_log_interceptor_1.AuditLogInterceptor,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map