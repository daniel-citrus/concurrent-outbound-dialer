import { describe, expect, it } from "vitest";
import { MockVoiceProvider } from "../../src/providers/mock-voice-provider.js";

describe("MockVoiceProvider", () => {
  it("creates unique provider call ids without network IO", async () => {
    const provider = new MockVoiceProvider({ delayMs: 0 });
    const a = await provider.createCall({
      sessionId: "s",
      callAttemptId: "c1",
      contactId: "k1",
      phoneNumber: "+14155550101",
      statusCallbackUrl: "http://localhost/callback",
    });
    const b = await provider.createCall({
      sessionId: "s",
      callAttemptId: "c2",
      contactId: "k2",
      phoneNumber: "+14155550102",
      statusCallbackUrl: "http://localhost/callback",
    });
    expect(a.providerCallId).not.toEqual(b.providerCallId);
    expect(provider.createdCalls).toHaveLength(2);
  });

  it("tracks cancel and disconnect requests", async () => {
    const provider = new MockVoiceProvider();
    const created = await provider.createCall({
      sessionId: "s",
      callAttemptId: "c1",
      contactId: "k1",
      phoneNumber: "+14155550101",
      statusCallbackUrl: "http://localhost/callback",
    });
    await provider.cancelCall(created.providerCallId);
    await provider.disconnectCall(created.providerCallId);
    expect(provider.cancelRequests).toContain(created.providerCallId);
    expect(provider.disconnectRequests).toContain(created.providerCallId);
  });

  it("can fail specific attempts", async () => {
    const provider = new MockVoiceProvider({
      failAttemptIds: new Set(["fail-me"]),
    });
    await expect(
      provider.createCall({
        sessionId: "s",
        callAttemptId: "fail-me",
        contactId: "k1",
        phoneNumber: "+14155550101",
        statusCallbackUrl: "http://localhost/callback",
      }),
    ).rejects.toThrow(/Mock voice provider/);
  });
});
