import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { MandateEngine } from '../src/core/mandate-engine.js';
import { PresentationEngine } from '../src/core/presentation-engine.js';
import { IMandateRegistrationRequest } from '../src/types/index.js';

describe('RBI & NPCI Regulatory Compliance Verification', () => {
  let mandateEngine: MandateEngine;
  let presentationEngine: PresentationEngine;

  const validRequest: IMandateRegistrationRequest = {
    loanAccountId: 'LN-CMPL-101',
    customerName: 'Meenakshi Sundaram',
    customerEmail: 'meenakshi.s@techcorp.in',
    customerMobile: '+919789012345',
    customerPan: 'ABCDE1234F',
    bankDetails: {
      bankName: 'State Bank of India',
      ifscCode: 'SBIN0000800',
      accountNumber: '20192837461',
      accountType: 'SAVINGS',
      holderName: 'Meenakshi Sundaram',
    },
    monthlyEmiAmount: 24500,
    startDate: '2026-12-05',
    endDate: '2028-11-05',
    authMode: 'NET_BANKING',
  };

  beforeEach(() => {
    mandateEngine = MandateEngine.getInstance();
    mandateEngine.clear();
    presentationEngine = PresentationEngine.getInstance(mandateEngine);
    presentationEngine.clear();
  });

  test('Enforces RBI 24h pre-debit alert: Blocks presentation if notification was not dispatched', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);

    await assert.rejects(
      async () =>
        presentationEngine.presentSingleDebit({
          mandateId: mandate.mandateId,
          umrn: mandate.umrn!,
          loanAccountId: mandate.loanAccountId,
          amount: 24500,
          dueDate: '2026-12-05',
          installmentNumber: 1,
        }),
      /RBI Compliance Violation: Pre-debit notification not dispatched at least 24 hours prior/
    );
  });

  test('Generates compliant notification content containing customer name, loan ID, amount, and UMRN', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);

    const notif = presentationEngine.sendPreDebitNotification(mandate.mandateId, 24500, '2026-12-05');

    assert.strictEqual(notif.complianceStatus, 'SENT_COMPLIANT');
    assert.ok(notif.messageText.includes('Meenakshi Sundaram'));
    assert.ok(notif.messageText.includes('LN-CMPL-101'));
    assert.ok(notif.messageText.includes(mandate.umrn!));
    assert.ok(notif.messageText.includes('24,500'));
    assert.strictEqual(presentationEngine.hasPreDebitNotification(mandate.mandateId, '2026-12-05'), true);
  });

  test('Enforces maximum retry limit of 3 attempts per bounced debit', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);

    const result = await presentationEngine.presentSingleDebit(
      {
        mandateId: mandate.mandateId,
        umrn: mandate.umrn!,
        loanAccountId: mandate.loanAccountId,
        amount: 24500,
        dueDate: '2026-12-05',
        installmentNumber: 1,
      },
      { simulateReturnCode: 'AM04', bypassNotificationCheck: true }
    );

    // Attempt 1
    presentationEngine.scheduleRetry(result.presentationId, 3);
    // Attempt 2
    presentationEngine.scheduleRetry(result.presentationId, 3);
    // Attempt 3
    presentationEngine.scheduleRetry(result.presentationId, 3);

    // Attempt 4 should fail
    assert.throws(
      () => presentationEngine.scheduleRetry(result.presentationId, 3),
      /Maximum retry limit \(3\) exceeded/
    );
  });
});
