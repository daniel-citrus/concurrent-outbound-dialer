import type { ProspectAgent, ProspectContact, ProspectList } from "../types";

type AgentDefinition = {
  id: string;
  label: string;
  listNames: string[];
};

const AGENT_DEFINITIONS: AgentDefinition[] = [
  { id: "mock-agent-1", label: "Jordan Blake", listNames: ["Warm Leads", "Referral Pipeline"] },
  { id: "mock-agent-2", label: "Casey Nguyen", listNames: ["Cold Outreach", "Event Follow-up"] },
  { id: "mock-agent-3", label: "Riley Thompson", listNames: ["Renewal Watchlist"] },
];

const FIRST_NAMES = [
  "Jamie", "Morgan", "Taylor", "Priya", "Sam", "Robin", "Alex", "Casey",
  "Drew", "Avery", "Jordan", "Riley", "Quinn", "Skyler", "Cameron", "Reese",
  "Hayden", "Peyton", "Rowan", "Elliot", "Nikhil", "Sofia", "Mateo", "Ines",
  "Lucas", "Amara", "Devon", "Noor", "Kenji", "Talia", "Marcus", "Yuki",
  "Isabela", "Owen", "Zoe", "Felix", "Priyanka", "Theo", "Willa", "Omar",
] as const;

const LAST_NAMES = [
  "Rivera", "Lee", "Chen", "Nair", "Okafor", "Fischer", "Petrov", "Moreno",
  "Larsen", "Kowalski", "Haddad", "Nakamura", "Silva", "Abbas", "Novak",
  "Beaumont", "Whitfield", "Santos", "Kim", "Dubois", "Farrell", "Osei",
  "Bergstrom", "Cortez", "Ivanov", "Mercer", "Alvarado", "Voss", "Iyer",
  "Blackwood", "Renner", "Castillo", "Okonkwo", "Lindqvist", "Park", "Moretti",
] as const;

const COMPANY_PREFIXES = [
  "Acme", "Bluebird", "Cedar", "Delta", "Everline", "Fernway", "Grandview",
  "Harborlight", "Ironclad", "Juniper", "Kestrel", "Lonewolf", "Meridian",
  "Northgate", "Oakridge", "Pinnacle", "Quarryside", "Redwood", "Silverpeak",
  "Timberline", "Union", "Vantage", "Westfield", "Yellowstone", "Zenith",
] as const;

const COMPANY_SUFFIXES = [
  "Robotics", "Logistics", "Analytics", "Freight Co.", "Manufacturing",
  "Retail Group", "Realty", "Partners", "Solutions", "Industries", "Systems",
  "Holdings", "Ventures", "Technologies", "Health Group", "Financial",
  "Media", "Foods", "Energy", "Consulting",
] as const;

const TITLES = [
  "VP of Operations", "Director of Sales", "Head of Growth", "Procurement Manager",
  "Plant Manager", "IT Director", "Broker", "Chief of Staff", "VP of Marketing",
  "Controller", "Head of People", "Account Executive", "Operations Manager",
  "Director of Engineering", "Supply Chain Lead", "General Manager",
  "VP of Finance", "Customer Success Lead", "Regional Sales Manager",
  "Facilities Director",
] as const;

const ACTIVITIES = [
  "email_opened", "call_scheduled", "none", "email_replied", "meeting_booked",
  "demo_completed", "proposal_sent", "voicemail_left", "email_bounced",
] as const;

const EMAIL_STATUS_BY_ACTIVITY: Record<string, string | null> = {
  email_opened: "opened",
  call_scheduled: "clicked",
  none: null,
  email_replied: "replied",
  meeting_booked: "clicked",
  demo_completed: "opened",
  proposal_sent: "opened",
  voicemail_left: null,
  email_bounced: "bounced",
};

const STATUSES = ["active", "active", "active", "engaged", "nurturing"] as const;

const MIN_CONTACTS_PER_LIST = 100;
const MAX_CONTACTS_PER_LIST = 200;

/** Deterministic PRNG so mock data stays stable across page loads. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20260921);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function recentTimestamp(withinDays: number): string {
  const msAgo = randomInt(1, withinDays) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - msAgo).toISOString();
}

let contactCounter = 0;

function buildContact(): ProspectContact {
  contactCounter += 1;
  const activity = pick(ACTIVITIES);
  const hasOutbound = activity !== "none" && rng() < 0.75;
  const hasInbound = activity === "email_replied" || rng() < 0.3;

  return {
    externalContactId: `mock-contact-${contactCounter}`,
    phoneNumber: `+1555555${String(1000 + contactCounter).slice(-4)}`,
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    company: `${pick(COMPANY_PREFIXES)} ${pick(COMPANY_SUFFIXES)}`,
    title: pick(TITLES),
    activity,
    status: pick(STATUSES),
    emailStatus: EMAIL_STATUS_BY_ACTIVITY[activity] ?? null,
    lastOutboundAt: hasOutbound ? recentTimestamp(21) : null,
    lastOutboundType: hasOutbound ? pick(["call", "email", "sms"]) : null,
    lastInboundAt: hasInbound ? recentTimestamp(14) : null,
    lastInboundType: hasInbound ? pick(["email_reply", "call", "form_submit"]) : null,
  };
}

type MockList = {
  id: string;
  agentId: string;
  name: string;
  contacts: ProspectContact[];
};

const MOCK_LISTS: MockList[] = AGENT_DEFINITIONS.flatMap((agent) =>
  agent.listNames.map((name, index) => {
    const contactCount = randomInt(MIN_CONTACTS_PER_LIST, MAX_CONTACTS_PER_LIST);
    return {
      id: `${agent.id}-list-${index + 1}`,
      agentId: agent.id,
      name,
      contacts: Array.from({ length: contactCount }, () => buildContact()),
    };
  }),
);

const MOCK_AGENTS: ProspectAgent[] = AGENT_DEFINITIONS.map((agent) => ({
  id: agent.id,
  label: agent.label,
}));

function formatProspectListLabel(list: {
  name: string;
  status: string;
  prospectCount: number;
}): string {
  const countLabel = list.prospectCount === 1 ? "1 contact" : `${list.prospectCount} contacts`;
  return `${list.name} (${countLabel})`;
}

export function listProspectAgents(): ProspectAgent[] {
  return MOCK_AGENTS;
}

export function listProspectListsForAgent(agentId: string): ProspectList[] {
  return MOCK_LISTS.filter((list) => list.agentId === agentId).map((list) => ({
    id: list.id,
    name: list.name,
    status: "active",
    prospectCount: list.contacts.length,
    label: formatProspectListLabel({
      name: list.name,
      status: "active",
      prospectCount: list.contacts.length,
    }),
  }));
}

export function listProspectListContacts(listId: string): {
  contacts: ProspectContact[];
  totalInList: number;
  skippedWithoutPhone: number;
} {
  const list = MOCK_LISTS.find((l) => l.id === listId);
  const contacts = list?.contacts ?? [];
  return { contacts, totalInList: contacts.length, skippedWithoutPhone: 0 };
}
