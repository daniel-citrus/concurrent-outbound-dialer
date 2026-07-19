export type CreateCallInput = {
  sessionId: string;
  callAttemptId: string;
  contactId: string;
  phoneNumber: string;
  statusCallbackUrl: string;
};

export type CreateCallResult = {
  providerCallId: string;
  status: "queued";
};

export interface VoiceProvider {
  createCall(input: CreateCallInput): Promise<CreateCallResult>;
  cancelCall(providerCallId: string): Promise<void>;
  disconnectCall(providerCallId: string): Promise<void>;
}
