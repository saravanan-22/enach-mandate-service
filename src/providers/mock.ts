import crypto from 'node:crypto';
import { IEnachProvider } from './gateway.js';
import {
  IMandateRegistrationRequest,
  IPresentationDebitRequest,
  IPresentationDebitResult,
  MandateAuthMode,
} from '../types/index.js';
import { NpciReturnManager } from '../core/npci-codes.js';

export class MockNpciGateway implements IEnachProvider {
  name = 'MOCK_NPCI_ONMAGS_GATEWAY';

  private static instance: MockNpciGateway;

  public static getInstance(): MockNpciGateway {
    if (!MockNpciGateway.instance) {
      MockNpciGateway.instance = new MockNpciGateway();
    }
    return MockNpciGateway.instance;
  }

  /**
   * Generates a standard 20-character NPCI-compliant UMRN
   * Format: "NPCI" + 16 alphanumeric characters
   */
  public generateUmrn(): string {
    const randomHex = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `NPCI${randomHex}`;
  }

  public async createMandate(request: IMandateRegistrationRequest): Promise<{
    mandateId: string;
    authUrl: string;
    status: string;
  }> {
    const mandateId = `MND_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const authUrl = `/api/v1/mock-portal/${mandateId}`;

    return {
      mandateId,
      authUrl,
      status: 'INVITATION_SENT',
    };
  }

  public async authorizeMandate(
    mandateId: string,
    authMode: MandateAuthMode,
    simulateStatus: 'ACCEPT' | 'REJECT' = 'ACCEPT'
  ): Promise<{
    success: boolean;
    umrn?: string;
    error?: string;
  }> {
    if (simulateStatus === 'REJECT') {
      return {
        success: false,
        error: `Customer declined e-mandate authentication via ${authMode} at Destination Bank portal.`,
      };
    }

    const umrn = this.generateUmrn();
    return {
      success: true,
      umrn,
    };
  }

  public async presentDebit(
    request: IPresentationDebitRequest,
    simulateReturnCode?: string
  ): Promise<IPresentationDebitResult> {
    const presentationId = `PRS_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const now = new Date().toISOString();

    if (simulateReturnCode) {
      const returnMeta = NpciReturnManager.getDetails(simulateReturnCode);
      let retryDate: string | undefined;

      if (returnMeta.retryable) {
        const retry = new Date();
        retry.setDate(retry.getDate() + 3);
        retryDate = retry.toISOString().split('T')[0];
      }

      return {
        presentationId,
        mandateId: request.mandateId,
        umrn: request.umrn,
        loanAccountId: request.loanAccountId,
        amount: request.amount,
        dueDate: request.dueDate,
        settlementStatus: 'RETURNED',
        clearingReference: `NPCI_RET_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        returnCode: simulateReturnCode,
        returnReason: returnMeta.description,
        recoveryAction: returnMeta.recommendedAction,
        settledAt: undefined,
        retryScheduledDate: retryDate,
        retryCount: 0,
      };
    }

    return {
      presentationId,
      mandateId: request.mandateId,
      umrn: request.umrn,
      loanAccountId: request.loanAccountId,
      amount: request.amount,
      dueDate: request.dueDate,
      settlementStatus: 'SUCCESS',
      clearingReference: `NPCI_CLR_${Date.now()}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      settledAt: now,
      retryCount: 0,
    };
  }

  public async cancelMandate(
    mandateId: string,
    umrn: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    return {
      success: true,
      message: `Mandate ${mandateId} (UMRN: ${umrn}) successfully revoked on NPCI central switch. Reason: ${reason}`,
    };
  }
}
