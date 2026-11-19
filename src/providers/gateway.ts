import {
  IMandateRegistrationRequest,
  IPresentationDebitRequest,
  IPresentationDebitResult,
  MandateAuthMode,
} from '../types/index.js';

export interface IEnachProvider {
  name: string;

  /**
   * Registers a new mandate request with the sponsor bank / clearing gateway
   */
  createMandate(request: IMandateRegistrationRequest): Promise<{
    mandateId: string;
    authUrl: string;
    status: string;
  }>;

  /**
   * Authorizes customer authentication (Net Banking, Debit Card, Aadhaar, UPI)
   */
  authorizeMandate(
    mandateId: string,
    authMode: MandateAuthMode,
    simulateStatus?: 'ACCEPT' | 'REJECT'
  ): Promise<{
    success: boolean;
    umrn?: string;
    error?: string;
  }>;

  /**
   * Presents a single debit to the clearing house
   */
  presentDebit(
    request: IPresentationDebitRequest,
    simulateReturnCode?: string
  ): Promise<IPresentationDebitResult>;

  /**
   * Revokes or cancels an active mandate on NPCI ONMAGS
   */
  cancelMandate(
    mandateId: string,
    umrn: string,
    reason: string
  ): Promise<{ success: boolean; message: string }>;
}
