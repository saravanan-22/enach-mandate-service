import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { MandateEngine } from '../src/core/mandate-engine.js';
import { PresentationEngine } from '../src/core/presentation-engine.js';
import { IMandateRegistrationRequest } from '../src/types/index.js';

describe('Presentation Engine - Clearing Batches, Settlement & Return Codes', () => {
  let mandateEngine: MandateEngine;
  let presentationEngine: PresentationEngine;

  const validRequest: IMandateRegistrationRequest = {
    loanAccountId: 'LN-PRS-5501',
    customerName: 'Pooja Hegde',
    customerEmail: 'pooja.hegde@solaris.in',
    customerMobile: '+919988776655',
    customerPan: 'ABCDE1234F',
    bankDetails: {
      bankName: 'Axis Bank Ltd',
      ifscCode: 'UTIB0000004',
      accountNumber: '915010048192837',
      accountType: 'SAVINGS',
      holderName: 'Pooja Hegde',
    },
    monthlyEmiAmount: 38000,
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

  test('Presents single debit successfully and returns NPCI clearing reference', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);
    presentationEngine.sendPreDebitNotification(mandate.mandateId, 38000, '2026-12-05');

    const result = await presentationEngine.presentSingleDebit({
      mandateId: mandate.mandateId,
      umrn: mandate.umrn!,
      loanAccountId: mandate.loanAccountId,
      amount: 38000,
      dueDate: '2026-12-05',
      installmentNumber: 1,
    });

    assert.strictEqual(result.settlementStatus, 'SUCCESS');
    assert.ok(result.clearingReference?.startsWith('NPCI_CLR_'));
    assert.strictEqual(result.retryCount, 0);
  });

  test('Blocks debit presentation if amount exceeds mandate max limit cap', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);
    presentationEngine.sendPreDebitNotification(mandate.mandateId, 65000, '2026-12-05');

    await assert.rejects(
      async () =>
        presentationEngine.presentSingleDebit({
          mandateId: mandate.mandateId,
          umrn: mandate.umrn!,
          loanAccountId: mandate.loanAccountId,
          amount: 65000, // Exceeds 1.5x cap (57,000)
          dueDate: '2026-12-05',
          installmentNumber: 1,
        }),
      /exceeds authorized mandate maximum limit/
    );
  });

  test('Handles AM04 (Insufficient Funds) return code and schedules 3-day retry', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);

    const result = await presentationEngine.presentSingleDebit(
      {
        mandateId: mandate.mandateId,
        umrn: mandate.umrn!,
        loanAccountId: mandate.loanAccountId,
        amount: 38000,
        dueDate: '2026-12-05',
        installmentNumber: 1,
      },
      { simulateReturnCode: 'AM04', bypassNotificationCheck: true }
    );

    assert.strictEqual(result.settlementStatus, 'RETURNED');
    assert.strictEqual(result.returnCode, 'AM04');
    assert.ok(result.returnReason?.includes('Insufficient Balance'));
    assert.ok(result.recoveryAction?.includes('Auto-schedule representation after 3 days'));
    assert.ok(result.retryScheduledDate);

    // Schedule retry representation
    const retry = presentationEngine.scheduleRetry(result.presentationId, 3);
    assert.strictEqual(retry.retryCount, 1);
  });

  test('Handles AC01 (Account Closed) as non-retryable bounce', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);

    const result = await presentationEngine.presentSingleDebit(
      {
        mandateId: mandate.mandateId,
        umrn: mandate.umrn!,
        loanAccountId: mandate.loanAccountId,
        amount: 38000,
        dueDate: '2026-12-05',
        installmentNumber: 1,
      },
      { simulateReturnCode: 'AC01', bypassNotificationCheck: true }
    );

    assert.strictEqual(result.settlementStatus, 'RETURNED');
    assert.strictEqual(result.returnCode, 'AC01');
    assert.strictEqual(result.retryScheduledDate, undefined);
    assert.ok(result.recoveryAction?.includes('Request updated bank account details'));
  });

  test('Executes batch presentation across multiple loan accounts', async () => {
    const loans = [
      { id: 'LN-BATCH-A', emi: 20000 },
      { id: 'LN-BATCH-B', emi: 30000 },
      { id: 'LN-BATCH-C', emi: 40000 },
    ];

    for (const l of loans) {
      const m = await mandateEngine.initiateMandate({
        ...validRequest,
        loanAccountId: l.id,
        monthlyEmiAmount: l.emi,
      });
      await mandateEngine.authenticateMandate(m.mandateId);
    }

    const batch = presentationEngine.createBatch('2026-12-05', [
      { loanAccountId: 'LN-BATCH-A', amount: 20000, installmentNumber: 1 },
      { loanAccountId: 'LN-BATCH-B', amount: 30000, installmentNumber: 1 },
      { loanAccountId: 'LN-BATCH-C', amount: 40000, installmentNumber: 1 },
    ]);

    assert.strictEqual(batch.totalDebits, 3);
    assert.strictEqual(batch.totalAmount, 90000);

    const summary = await presentationEngine.processBatch(batch.batchId, {
      'LN-BATCH-B': 'AM04',
    });

    assert.strictEqual(summary.totalPresented, 3);
    assert.strictEqual(summary.successfulDebitsCount, 2);
    assert.strictEqual(summary.bouncedDebitsCount, 1);
    assert.strictEqual(summary.successfulAmount, 60000); // 20k + 40k
    assert.strictEqual(summary.bouncedAmount, 30000); // 30k
  });
});
