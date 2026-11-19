import { MandateEngine } from '../src/core/mandate-engine.js';
import { PresentationEngine } from '../src/core/presentation-engine.js';

async function runDemo() {
  console.log(`========================================================================`);
  console.log(`🏛️  eNACH & e-Mandate Lifecycle Demonstration (NPCI / RBI Compliant)`);
  console.log(`========================================================================\n`);

  const mandateEngine = MandateEngine.getInstance();
  const presentationEngine = PresentationEngine.getInstance(mandateEngine);

  // 1. Mandate Initiation
  console.log(`[Step 1] Initiating eNACH Mandate Registration...`);
  const mandate = await mandateEngine.initiateMandate({
    loanAccountId: 'LN-MUM-2026-8801',
    customerName: 'Aditya Deshmukh',
    customerEmail: 'aditya.deshmukh@apexforge.in',
    customerMobile: '+919820011223',
    customerPan: 'ABCDE1234F',
    bankDetails: {
      bankName: 'HDFC Bank Ltd',
      ifscCode: 'HDFC0000060',
      accountNumber: '50100481928371',
      accountType: 'CURRENT',
      holderName: 'Apex Forge & Metalcrafts LLP',
    },
    monthlyEmiAmount: 65000,
    startDate: '2026-12-05',
    endDate: '2029-11-05',
    authMode: 'NET_BANKING',
  });

  console.log(`✅ Mandate Created: ID = ${mandate.mandateId}`);
  console.log(`   Monthly EMI: ₹${mandate.monthlyEmiAmount.toLocaleString('en-IN')}`);
  console.log(`   Max Mandate Cap (1.5x): ₹${mandate.maxAmount.toLocaleString('en-IN')}`);
  console.log(`   Auth Portal URL: ${mandate.authUrl}\n`);

  // 2. Customer Authentication
  console.log(`[Step 2] Customer authenticates via Net Banking on Destination Bank Portal...`);
  const authResult = await mandateEngine.authenticateMandate(mandate.mandateId, 'NET_BANKING');
  console.log(`✅ Mandate Activated!`);
  console.log(`   Status: ${authResult.mandate.status}`);
  console.log(`   NPCI UMRN Issued: ${authResult.mandate.umrn}`);
  console.log(`   Activated At: ${authResult.mandate.activatedAt}\n`);

  // 3. RBI Mandatory Pre-Debit Notification
  console.log(`[Step 3] Dispatching RBI Mandatory 24-Hour Pre-Debit Notification...`);
  const notification = presentationEngine.sendPreDebitNotification(
    mandate.mandateId,
    65000,
    '2026-12-05'
  );
  console.log(`✅ Pre-Debit Notification Dispatched (SMS/Email):`);
  console.log(`   Message: "${notification.messageText}"`);
  console.log(`   Compliance Status: ${notification.complianceStatus}\n`);

  // 4. Single Presentation
  console.log(`[Step 4] Presenting EMI Installment #1 to Clearing House...`);
  const debitResult = await presentationEngine.presentSingleDebit({
    mandateId: mandate.mandateId,
    umrn: mandate.umrn!,
    loanAccountId: mandate.loanAccountId,
    amount: 65000,
    dueDate: '2026-12-05',
    installmentNumber: 1,
  });
  console.log(`✅ Clearing Settlement Status: ${debitResult.settlementStatus}`);
  console.log(`   Clearing Reference: ${debitResult.clearingReference}`);
  console.log(`   Settled At: ${debitResult.settledAt}\n`);

  // 5. Handling AM04 Bounce and Automated Retry
  console.log(`[Step 5] Simulating Installment #2 Presentation with AM04 (Insufficient Funds)...`);
  presentationEngine.sendPreDebitNotification(mandate.mandateId, 65000, '2027-01-05');
  const bounceResult = await presentationEngine.presentSingleDebit(
    {
      mandateId: mandate.mandateId,
      umrn: mandate.umrn!,
      loanAccountId: mandate.loanAccountId,
      amount: 65000,
      dueDate: '2027-01-05',
      installmentNumber: 2,
    },
    { simulateReturnCode: 'AM04' }
  );
  console.log(`⚠️ Debit Returned from Destination Bank:`);
  console.log(`   Return Code: ${bounceResult.returnCode} (${bounceResult.returnReason})`);
  console.log(`   Automated Action: ${bounceResult.recoveryAction}`);
  console.log(`   Auto-Retry Scheduled Date: ${bounceResult.retryScheduledDate}\n`);

  // 6. Batch Presentation
  console.log(`[Step 6] Running Multi-Loan Presentation Batch for 2027-02-05...`);
  const batch = presentationEngine.createBatch('2027-02-05', [
    { loanAccountId: 'LN-MUM-2026-8801', amount: 65000, installmentNumber: 3 },
  ]);
  const batchSummary = await presentationEngine.processBatch(batch.batchId);
  console.log(`✅ Batch Clearing Completed:`);
  console.log(`   Total Debits Presented: ${batchSummary.totalPresented}`);
  console.log(`   Total Amount: ₹${batchSummary.totalAmountPresented.toLocaleString('en-IN')}`);
  console.log(`   Successful: ${batchSummary.successfulDebitsCount} (₹${batchSummary.successfulAmount.toLocaleString('en-IN')})\n`);

  console.log(`🎉 Demo Completed Successfully! All operations comply with RBI/NPCI guidelines.`);
}

runDemo().catch(console.error);
