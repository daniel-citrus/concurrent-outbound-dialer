import type { CallAttempt, DialingContact } from "../types";

export type ReservedClaim = {
  contact: DialingContact;
  callAttempt: CallAttempt;
};

export type CreateCallResult = {
  providerCallId: string;
};

export interface CallPlacer {
  createCall(claim: ReservedClaim): Promise<CreateCallResult>;
  cancelNonWinners?(
    sessionId: string,
    winningCallAttemptId: string | null,
  ): Promise<void>;
}

/** Mock placer: invents a provider call id (browser never hits Twilio). */
export function createMockCallPlacer(): CallPlacer {
  return {
    async createCall(claim) {
      return {
        providerCallId: `mock_${claim.callAttempt.id.slice(0, 8)}_${crypto.randomUUID().slice(0, 8)}`,
      };
    },
  };
}
