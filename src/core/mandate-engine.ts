import {
  IMandateRegistrationRequest,
  IMandateRecord,
  MandateAuthMode,
} from '../types/index.js';
import { MockNpciGateway } from '../providers/mock.js';
import { IEnachProvider } from '../providers/gateway.js';

export class MandateEngine {
  private static instance: MandateEngine;
  private mandates: Map<string, IMandateRecord> = new Map();
  private provider: IEnachProvider;

  private constructor(provider?: IEnachProvider) {
    this.provider = provider || MockNpciGateway.getInstance();
  }

  public static getInstance(provider?: IEnachProvider): MandateEngine {
    if (!MandateEngine.instance) {
      MandateEngine.instance = new MandateEngine(provider);
    }
    return MandateEngine.instance;
  }

  /**
   * Initiates a new eNACH Mandate Registration workflow
   */
  public async initiateMandate(request: IMandateRegistrationRequest): Promise<IMandateRecord> {
    // 1. IFSC validation (4 letters, 0, 6 alphanumeric)
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(request.bankDetails.ifscCode)) {
      throw new Error(
        `Invalid Indian IFSC code format: '${request.bankDetails.ifscCode}'. Must strictly match ^[A-Z]{4}0[A-Z0-9]{6}$`
      );
    }

    // 2. Account number length check
    if (!request.bankDetails.accountNumber || request.bankDetails.accountNumber.length < 8) {
      throw new Error('Bank account number must be at least 8 digits long');
    }

    // 3. PAN validation if provided
    if (request.customerPan) {
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(request.customerPan.toUpperCase())) {
        throw new Error(`Invalid Indian PAN format: '${request.customerPan}'. Must match ^[A-Z]{5}[0-9]{4}[A-Z]{1}$`);
      }
    }

    // 4. Default max mandate amount to 1.5x monthly EMI if omitted
    const maxAmount = request.maxMandateAmount || Math.round(request.monthlyEmiAmount * 1.5);
    const authMode = request.authMode || 'NET_BANKING';
    const frequency = request.frequency || 'MNTH';

    const providerResult = await this.provider.createMandate(request);

    const mandate: IMandateRecord = {
      mandateId: providerResult.mandateId,
      loanAccountId: request.loanAccountId,
      customerName: request.customerName,
      customerEmail: request.customerEmail,
      customerMobile: request.customerMobile,
      customerPan: request.customerPan.toUpperCase(),
      status: 'INVITATION_SENT',
      authMode,
      authUrl: providerResult.authUrl,
      maxAmount,
      monthlyEmiAmount: request.monthlyEmiAmount,
      frequency,
      bankDetails: request.bankDetails,
      startDate: request.startDate,
      endDate: request.endDate,
      createdAt: new Date().toISOString(),
      auditTrail: [
        {
          timestamp: new Date().toISOString(),
          action: 'MANDATE_INITIATED',
          details: {
            authMode,
            maxAmount,
            monthlyEmiAmount: request.monthlyEmiAmount,
            bankName: request.bankDetails.bankName,
          },
        },
        {
          timestamp: new Date().toISOString(),
          action: 'INVITATION_DISPATCHED',
          details: {
            authUrl: providerResult.authUrl,
            customerMobile: request.customerMobile,
          },
        },
      ],
    };

    this.mandates.set(mandate.mandateId, mandate);
    return mandate;
  }

  /**
   * Retrieves a mandate record by mandate ID
   */
  public getMandate(mandateId: string): IMandateRecord | undefined {
    return this.mandates.get(mandateId);
  }

  /**
   * Retrieves the active mandate for a given loan account ID
   */
  public getActiveMandateByLoanAccount(loanAccountId: string): IMandateRecord | undefined {
    return Array.from(this.mandates.values()).find(
      m => m.loanAccountId === loanAccountId && m.status === 'ACTIVE'
    );
  }

  /**
   * Authenticates or approves a customer mandate
   */
  public async authenticateMandate(
    mandateId: string,
    authMode?: MandateAuthMode,
    simulateStatus: 'ACCEPT' | 'REJECT' = 'ACCEPT'
  ): Promise<{ success: boolean; mandate: IMandateRecord; error?: string }> {
    const mandate = this.mandates.get(mandateId);
    if (!mandate) {
      throw new Error(`Mandate ${mandateId} not found`);
    }

    if (mandate.status === 'ACTIVE') {
      return { success: true, mandate };
    }

    const selectedAuthMode = authMode || mandate.authMode;
    mandate.authMode = selectedAuthMode;

    const authResult = await this.provider.authorizeMandate(mandateId, selectedAuthMode, simulateStatus);

    if (authResult.success && authResult.umrn) {
      mandate.status = 'ACTIVE';
      mandate.umrn = authResult.umrn;
      mandate.activatedAt = new Date().toISOString();
      mandate.auditTrail.push({
        timestamp: mandate.activatedAt,
        action: 'MANDATE_ACTIVATED',
        details: {
          umrn: authResult.umrn,
          authMode: selectedAuthMode,
        },
      });

      return { success: true, mandate };
    } else {
      mandate.status = 'REJECTED';
      mandate.rejectedReason = authResult.error || 'Authentication declined by customer or Destination Bank';
      mandate.auditTrail.push({
        timestamp: new Date().toISOString(),
        action: 'MANDATE_REJECTED',
        details: {
          reason: mandate.rejectedReason,
          authMode: selectedAuthMode,
        },
      });

      return { success: false, mandate, error: mandate.rejectedReason };
    }
  }

  /**
   * Revokes or cancels an active mandate
   */
  public async cancelMandate(mandateId: string, reason: string): Promise<IMandateRecord> {
    const mandate = this.mandates.get(mandateId);
    if (!mandate) {
      throw new Error(`Mandate ${mandateId} not found`);
    }

    if (mandate.status === 'CANCELLED') {
      return mandate;
    }

    if (mandate.umrn) {
      await this.provider.cancelMandate(mandateId, mandate.umrn, reason);
    }

    mandate.status = 'CANCELLED';
    mandate.auditTrail.push({
      timestamp: new Date().toISOString(),
      action: 'MANDATE_CANCELLED',
      details: { reason },
    });

    return mandate;
  }

  public listMandates(): IMandateRecord[] {
    return Array.from(this.mandates.values());
  }

  public clear(): void {
    this.mandates.clear();
  }
}
