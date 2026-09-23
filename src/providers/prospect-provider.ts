export type ProspectAgent = {
  id: string;
  label: string;
};

export type ProspectList = {
  id: string;
  name: string;
  status: string;
  prospectCount: number;
  label: string;
};

export type ProspectContact = {
  externalContactId: string;
  phoneNumber: string;
  name: string;
  company: string;
  title: string;
  activity: string;
  status: string;
  emailStatus: string | null;
  lastOutboundAt: string | null;
  lastOutboundType: string | null;
  lastInboundAt: string | null;
  lastInboundType: string | null;
};

export type ProspectListContactsResult = {
  contacts: ProspectContact[];
  totalInList: number;
  skippedWithoutPhone: number;
};

/**
 * Source of dialable prospects. `MockProspectProvider` is the only
 * implementation today; swap in a CRM-backed implementation (e.g. Nebula)
 * by passing it to `buildApp({ prospectProvider })`.
 */
export interface ProspectProvider {
  listAgents(): Promise<ProspectAgent[]>;
  listProspectLists(agentId: string): Promise<ProspectList[]>;
  listProspectListContacts(listId: string): Promise<ProspectListContactsResult>;
}

export function formatProspectListLabel(list: {
  name: string;
  status: string;
  prospectCount: number;
}): string {
  const countLabel = list.prospectCount === 1 ? "1 contact" : `${list.prospectCount} contacts`;
  return `${list.name} (${countLabel})`;
}
