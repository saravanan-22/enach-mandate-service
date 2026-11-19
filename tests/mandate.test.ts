import assert from 'node:assert';
import { test, describe, beforeEach } from 'node:test';
import { MandateEngine } from '../src/core/mandate-engine.js';
import { IMandateRegistrationRequest } from '../src/types/index.js';

describe('Mandate Engine - Registration, Validation & Multi-Mode Auth', () => {
  let mandateEngine: MandateEngine;

  const validRequest: IMandateRegistrationRequest = {
    loanAccountId: 'LN-IND-9021',
    customerName: 'Siddharth Varma',
    customerEmail: 'siddharth@varma-aerospace.com',
    customerMobile: '+919841029384',
    customerPan: 'ABCDE1234F',
    bankDetails: {
      bankName: 'ICICI Bank Ltd',
      ifscCode: 'ICIC0000001',
      accountNumber: '000105009823',
      accountType: 'CURRENT',
      holderName: 'Siddharth Varma',
    },
    monthlyEmiAmount: 52000,
    startDate: '2026-12-05',
    endDate: '2029-11-05',
    authMode: 'NET_BANKING',
  };

  beforeEach(() => {
    mandateEngine = MandateEngine.getInstance();
    mandateEngine.clear();
  });

  test('Initiates a mandate with valid details, calculates 1.5x max cap, and generates auth URL', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);

    assert.ok(mandate.mandateId.startsWith('MND_'));
    assert.strictEqual(mandate.status, 'INVITATION_SENT');
    assert.strictEqual(mandate.loanAccountId, 'LN-IND-9021');
    assert.strictEqual(mandate.monthlyEmiAmount, 52000);
    assert.strictEqual(mandate.maxAmount, Math.round(52000 * 1.5)); // 78,000
    assert.strictEqual(mandate.frequency, 'MNTH');
    assert.strictEqual(mandate.authMode, 'NET_BANKING');
    assert.ok(mandate.authUrl?.includes(mandate.mandateId));
  });

  test('Rejects invalid Indian IFSC code formats', async () => {
    const invalidIfscReq = {
      ...validRequest,
      bankDetails: { ...validRequest.bankDetails, ifscCode: 'INVALID_IFSC' },
    };

    await assert.rejects(
      async () => mandateEngine.initiateMandate(invalidIfscReq),
      /Invalid Indian IFSC code format/
    );
  });

  test('Rejects invalid Indian PAN formats', async () => {
    const invalidPanReq = {
      ...validRequest,
      customerPan: '12345INVALID',
    };

    await assert.rejects(
      async () => mandateEngine.initiateMandate(invalidPanReq),
      /Invalid Indian PAN format/
    );
  });

  test('Authenticates via Net Banking and generates 20-digit NPCI UMRN', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    const authResult = await mandateEngine.authenticateMandate(mandate.mandateId, 'NET_BANKING');

    assert.strictEqual(authResult.success, true);
    assert.strictEqual(authResult.mandate.status, 'ACTIVE');
    assert.ok(authResult.mandate.umrn);
    assert.strictEqual(authResult.mandate.umrn.length, 20);
    assert.ok(authResult.mandate.umrn.startsWith('NPCI'));
  });

  test('Supports UPI AutoPay, Debit Card, and Aadhaar OTP authentication modes', async () => {
    const modes = ['UPI_AUTOPAY', 'DEBIT_CARD', 'AADHAAR'] as const;

    for (const mode of modes) {
      const req = { ...validRequest, loanAccountId: `LN-${mode}` };
      const mandate = await mandateEngine.initiateMandate(req);
      const result = await mandateEngine.authenticateMandate(mandate.mandateId, mode);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.mandate.status, 'ACTIVE');
      assert.strictEqual(result.mandate.authMode, mode);
      assert.ok(result.mandate.umrn?.startsWith('NPCI'));
    }
  });

  test('Handles customer authentication rejection cleanly', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    const authResult = await mandateEngine.authenticateMandate(mandate.mandateId, 'NET_BANKING', 'REJECT');

    assert.strictEqual(authResult.success, false);
    assert.strictEqual(authResult.mandate.status, 'REJECTED');
    assert.ok(authResult.mandate.rejectedReason?.includes('declined'));
    assert.strictEqual(authResult.mandate.umrn, undefined);
  });

  test('Cancels mandate and revokes UMRN on NPCI switch', async () => {
    const mandate = await mandateEngine.initiateMandate(validRequest);
    await mandateEngine.authenticateMandate(mandate.mandateId);

    const cancelled = await mandateEngine.cancelMandate(mandate.mandateId, 'Loan foreclosure NOC issued');
    assert.strictEqual(cancelled.status, 'CANCELLED');
    assert.ok(cancelled.auditTrail.some(a => a.action === 'MANDATE_CANCELLED'));
  });
});
