import { INpciReturnCodeDetails } from '../types/index.js';

export const NPCI_RETURN_CODES: Record<string, INpciReturnCodeDetails> = {
  AM04: {
    code: 'AM04',
    description: 'Insufficient Balance / Funds in Account',
    category: 'FUNDS',
    retryable: true,
    recommendedAction: 'Notify borrower via SMS/WhatsApp. Auto-schedule representation after 3 days on salary cycle.',
  },
  AC01: {
    code: 'AC01',
    description: 'Account Closed / Transferred',
    category: 'ACCOUNT_STATUS',
    retryable: false,
    recommendedAction: 'Stop presentation. Request updated bank account details and re-register new eNACH mandate.',
  },
  AC04: {
    code: 'AC04',
    description: 'Account Blocked / Frozen by Regulatory Order',
    category: 'ACCOUNT_STATUS',
    retryable: false,
    recommendedAction: 'Escalate to credit risk team. Issue legal recovery notice under Section 25 of PASA Act.',
  },
  MD01: {
    code: 'MD01',
    description: 'Mandate Cancelled / Revoked by Customer',
    category: 'MANDATE_STATUS',
    retryable: false,
    recommendedAction: 'Customer revoked auto-debit consent on bank app. Initiate default collection process.',
  },
  MD02: {
    code: 'MD02',
    description: 'Stop Payment Instructions by Customer for this Installment',
    category: 'MANDATE_STATUS',
    retryable: false,
    recommendedAction: 'Customer placed stop payment with Destination Bank. Engage relationship manager.',
  },
  MD07: {
    code: 'MD07',
    description: 'Mandate End Date Expired',
    category: 'MANDATE_STATUS',
    retryable: false,
    recommendedAction: 'Mandate validity tenure reached. Obtain mandate renewal for remaining loan balance.',
  },
  AM05: {
    code: 'AM05',
    description: 'Transaction Amount Exceeds Maximum Limit Set in Mandate',
    category: 'TECHNICAL',
    retryable: false,
    recommendedAction: 'Adjust presentation amount to match authorized maxMandateAmount or modify mandate.',
  },
  MD17: {
    code: 'MD17',
    description: 'Account Number or Customer Name Mismatch with Core Banking System',
    category: 'ACCOUNT_STATUS',
    retryable: false,
    recommendedAction: 'Re-verify bank penny drop details and initiate fresh mandate with corrected bank details.',
  },
};

export class NpciReturnManager {
  public static getDetails(code: string): INpciReturnCodeDetails {
    return (
      NPCI_RETURN_CODES[code] || {
        code,
        description: 'Unspecified NPCI Clearing Return Code',
        category: 'TECHNICAL',
        retryable: false,
        recommendedAction: 'Review transaction logs and consult Sponsor Bank clearing team.',
      }
    );
  }

  public static isRetryable(code: string): boolean {
    return NPCI_RETURN_CODES[code]?.retryable || false;
  }
}
