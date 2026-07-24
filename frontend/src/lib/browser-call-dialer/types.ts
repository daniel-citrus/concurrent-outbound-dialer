export interface CallStatus {
	callSid: string;
	status:
		| "initiated"
		| "ringing"
		| "answered"
		| "connected"
		| "completed"
		| "failed"
		| "busy"
		| "no-answer"
		| "canceled";
	startTime: number;
	duration?: number;
	contact: {
		name: string;
		company: string;
		phone: string;
		email: string;
		contact_key?: string;
	};
	answeredBy?: string | null;
	pstnJoined?: boolean;
	pstnJoinedAt?: string | null;
	amdMode?: string | null;
	device?: any;
	connection?: any;
	callLogId?: string | null;
}

export type BrowserCallDialerEvents = {
	endCall: { callSid: string };
	cancelCall: { callSid: string };
	openContact: { contactKey: string; callSid: string };
};
