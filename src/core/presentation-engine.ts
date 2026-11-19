import crypto from 'node:crypto';
import {
  IPresentationDebitRequest,
  IPresentationDebitResult,
  IPreDebitNotification,
  IPresentationBatch,
  IPresentationBatchResult,
} from '../types/index.js';
import { MandateEngine } from './mandate-engine.js';
import { MockNpciGateway } from '../providers/mock.js';
import { IEnachProvider } from '../providers/gateway.js';

export class PresentationEngine {
  private static instance: PresentationEngine;
  private mandateEngine: MandateEngine;
  private provider: IEnachProvider;

  private notifications: Map<string, IPreDebitNotification> = new Map();
  private presentations: Map<string, IPresentationDebitResult> = new Map();
  private batches: Map<string, IPresentationBatch> = new Map();

  private constructor(mandateEngine?: MandateEngine, provider?: IEnachProvider) {
    this.mandateEngine = mandateEngine || MandateEngine.getInstance();
    this.provider = provider || MockNpciGateway.getInstance();
  }

  public static getInstance(mandateEngine?: MandateEngine, provider?: IEnachProvider): PresentationEngine {
    if (!PresentationEngine.instance) {
      PresentationEngine.instance = new PresentationEngine(mandateEngine, provider);
    }
    return PresentationEngine.instance;
  }

  /**
   * Dispatches mandatory RBI 24-hour pre-debit alert
   */
  public sendPreDebitNotification(
    mandateId: string,
    amount: number,
    debitDate: string
  ): IPreDebitNotification {
    const mandate = this.mandateEngine.getMandate(mandateId);
    if (!mandate) {
      throw new Error(`Mandate ${mandateId} not found`);
    }

    if (mandate.status !== 'ACTIVE' || !mandate.umrn) {
      throw new Error(`Mandate ${mandateId} is not ACTIVE or missing UMRN. Current status: ${mandate.status}`);
    }

    const notificationId = `NOTIF_${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const formattedAmount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);

    const messageText = `Dear ${mandate.customerName}, your loan EMI of ${formattedAmount} for Loan A/C ${mandate.loanAccountId} is scheduled for auto-debit on ${debitDate} via eNACH (UMRN: ${mandate.umrn}). Please ensure sufficient balance.`;

    const notification: IPreDebitNotification = {
      notificationId,
      mandateId: mandate.mandateId,
      loanAccountId: mandate.loanAccountId,
      customerMobile: mandate.customerMobile,
      customerEmail: mandate.customerEmail,
      umrn: mandate.umrn,
      amount,
      debitDate,
      sentAt: new Date().toISOString(),
      complianceStatus: 'SENT_COMPLIANT',
      channel: 'SMS_AND_EMAIL',
      messageText,
    };

    this.notifications.set(notificationId, notification);
    return notification;
  }

  /**
   * Checks whether a compliant pre-debit notification was sent
   */
  public hasPreDebitNotification(mandateId: string, debitDate: string): boolean {
    return Array.from(this.notifications.values()).some(
      n => n.mandateId === mandateId && n.debitDate === debitDate && n.complianceStatus === 'SENT_COMPLIANT'
    );
  }

  /**
   * Presents a single installment debit to the clearing switch
   */
  public async presentSingleDebit(
    request: IPresentationDebitRequest,
    options?: { simulateReturnCode?: string; bypassNotificationCheck?: boolean }
  ): Promise<IPresentationDebitResult> {
    const mandate = this.mandateEngine.getMandate(request.mandateId);
    if (!mandate) {
      throw new Error(`Mandate ${request.mandateId} not found`);
    }

    if (mandate.status !== 'ACTIVE') {
      throw new Error(`Mandate ${request.mandateId} is ${mandate.status}. Cannot present debit.`);
    }

    if (request.amount > mandate.maxAmount) {
      throw new Error(
        `Debit amount ₹${request.amount} exceeds authorized mandate maximum limit of ₹${mandate.maxAmount}`
      );
    }

    if (!options?.bypassNotificationCheck) {
      const hasNotice = this.hasPreDebitNotification(request.mandateId, request.dueDate);
      if (!hasNotice) {
        throw new Error(
          `RBI Compliance Violation: Pre-debit notification not dispatched at least 24 hours prior for mandate ${request.mandateId} due on ${request.dueDate}. Send pre-debit notification first or set bypassNotificationCheck: true.`
        );
      }
    }

    const result = await this.provider.presentDebit(request, options?.simulateReturnCode);
    this.presentations.set(result.presentationId, result);

    mandate.auditTrail.push({
      timestamp: new Date().toISOString(),
      action: 'EMI_DEBIT_PRESENTED',
      details: {
        presentationId: result.presentationId,
        amount: request.amount,
        status: result.settlementStatus,
        returnCode: result.returnCode,
      },
    });

    return result;
  }

  /**
   * Assembles a presentation clearing batch for a specific due date
   */
  public createBatch(
    presentationDate: string,
    items: Array<{ loanAccountId: string; amount: number; installmentNumber: number }>
  ): IPresentationBatch {
    const batchId = `BATCH_${presentationDate.replace(/-/g, '')}_${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const debitRequests: IPresentationDebitRequest[] = [];

    for (const item of items) {
      const mandate = this.mandateEngine.getActiveMandateByLoanAccount(item.loanAccountId);
      if (!mandate || !mandate.umrn) {
        throw new Error(`No active eNACH mandate with UMRN found for loan account: ${item.loanAccountId}`);
      }

      debitRequests.push({
        mandateId: mandate.mandateId,
        umrn: mandate.umrn,
        loanAccountId: item.loanAccountId,
        amount: item.amount,
        dueDate: presentationDate,
        installmentNumber: item.installmentNumber,
      });
    }

    const totalAmount = debitRequests.reduce((sum, item) => sum + item.amount, 0);

    const batch: IPresentationBatch = {
      batchId,
      presentationDate,
      totalDebits: debitRequests.length,
      totalAmount,
      items: debitRequests,
      createdAt: new Date().toISOString(),
      status: 'GENERATED',
    };

    this.batches.set(batchId, batch);
    return batch;
  }

  /**
   * Executes a batch presentation against the clearing house
   */
  public async processBatch(
    batchId: string,
    simulateReturns?: Record<string, string>,
    bypassNotificationCheck: boolean = true
  ): Promise<IPresentationBatchResult> {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error(`Presentation Batch ${batchId} not found`);
    }

    batch.status = 'PROCESSING';
    const results: IPresentationDebitResult[] = [];

    let successfulAmount = 0;
    let bouncedAmount = 0;
    let successfulCount = 0;
    let bouncedCount = 0;

    for (const item of batch.items) {
      const simulateCode = simulateReturns?.[item.loanAccountId] || simulateReturns?.[item.mandateId];
      const result = await this.presentSingleDebit(item, {
        simulateReturnCode: simulateCode,
        bypassNotificationCheck,
      });

      results.push(result);

      if (result.settlementStatus === 'SUCCESS') {
        successfulCount++;
        successfulAmount += item.amount;
      } else {
        bouncedCount++;
        bouncedAmount += item.amount;
      }
    }

    batch.status = 'PROCESSED';

    return {
      batchId,
      presentationDate: batch.presentationDate,
      totalPresented: batch.totalDebits,
      totalAmountPresented: batch.totalAmount,
      successfulDebitsCount: successfulCount,
      successfulAmount,
      bouncedDebitsCount: bouncedCount,
      bouncedAmount,
      results,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Schedules automated retry representation for a bounced presentation
   */
  public scheduleRetry(presentationId: string, daysAhead: number = 3): IPresentationDebitResult {
    const presentation = this.presentations.get(presentationId);
    if (!presentation) {
      throw new Error(`Presentation record ${presentationId} not found`);
    }

    if (presentation.settlementStatus !== 'RETURNED') {
      throw new Error(`Presentation ${presentationId} is not in RETURNED status (current: ${presentation.settlementStatus})`);
    }

    if (presentation.retryCount >= 3) {
      throw new Error(`Maximum retry limit (3) exceeded for presentation ${presentationId}. Escalate to collection.`);
    }

    const retryDate = new Date();
    retryDate.setDate(retryDate.getDate() + daysAhead);
    presentation.retryScheduledDate = retryDate.toISOString().split('T')[0];
    presentation.retryCount++;

    return presentation;
  }

  public getPresentation(presentationId: string): IPresentationDebitResult | undefined {
    return this.presentations.get(presentationId);
  }

  public listNotifications(): IPreDebitNotification[] {
    return Array.from(this.notifications.values());
  }

  public clear(): void {
    this.notifications.clear();
    this.presentations.clear();
    this.batches.clear();
  }
}
