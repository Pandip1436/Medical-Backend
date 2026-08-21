import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { PaymentsService } from '../payments/payments.service';
import { ReconciliationService } from '../payments/reconciliation.service';
import { DispatchNotificationService } from '../dispatch/dispatch-notification.service';

// Wiring smoke test. Every constructor dependency is supplied as an empty
// stub — the point is to prove the controller's DI graph is satisfiable, not
// to exercise its handlers, so instantiating the real services (which would
// pull in Prisma, Razorpay and a headless browser) is exactly what we want to
// avoid here.
describe('BillingController', () => {
  let controller: BillingController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [
        { provide: BillingService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: ReconciliationService, useValue: {} },
        { provide: DispatchNotificationService, useValue: {} },
      ],
    }).compile();

    controller = module.get<BillingController>(BillingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
