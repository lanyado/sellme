// Where Sellme can work the other side for the candidate. That's the whole product: one bot for the candidate,
// talking to the recruiters' side. A platform belongs if it matches or searches by algorithm, even with people
// behind it, and chat is best, because Sellme can keep nudging. Classic job boards and scrapers don't belong.
// A recruiter with no platform is added by the user, as a person, under "Your recruiters".
// Each link is the service's own plain page, with no referral code: those live in referrals.js.
// The order never depends on what a service pays.
const MESSAGES_MCP = { name: "messages", command: ["uvx", "mac-messages-mcp==1.1.0"], note: "This is a third-party server that can read and send your Messages. It needs uv installed and Full Disk Access." };

const ENTRIES = [
  { name: "Fonzi", channel: "mcp", signin: "https://talent.fonzi.ai/login", about: "AI and engineering roles at startups", mcp: { name: "fonzi", url: "https://talent.fonzi.ai/mcp" } },
  { name: "Standout", channel: "imessage", signin: "https://standout.work", about: "Represents you to VC-backed startups", mcp: MESSAGES_MCP },
  { name: "Boardy", channel: "email", signin: "https://boardy.ai", about: "Warm intros to founders and managers" },
  { name: "Jack & Jill", channel: "browser", signin: "https://app.jackandjill.ai", about: "Jack talks to you, Jill to employers" },
  { name: "Hedgy", channel: "browser", signin: "https://www.hedgy.works", about: "Invite-only recruiters for startups", noChat: true },
  { name: "Clera", channel: "imessage", signin: "https://www.getclera.com/chat", about: "AI agent you text, then startup intros", mcp: MESSAGES_MCP },
  { name: "Dex", channel: "browser", signin: "https://app.meetdex.ai", about: "Talent agent for senior engineers, chat" },
  { name: "hackajob", channel: "browser", signin: "https://hackajob.com", about: "Its agent Archer matches you to roles" },
  { name: "Simplify", channel: "browser", signin: "https://simplify.jobs/ai-talent-agent", about: "AI talent agent, makes recruiter intros" },
  { name: "micro1", channel: "browser", signin: "https://www.micro1.ai", about: "AI interviewer, then AI-training work" },
  { name: "Mercor", channel: "browser", signin: "https://www.mercor.com", about: "AI interviewer, then AI-training gigs" },
  { name: "Paraform", channel: "browser", signin: "https://www.paraform.com", about: "Recruiters submit you; intros by email", noChat: true },
  { name: "Wellfound", channel: "browser", signin: "https://wellfound.com", about: "AI matching; companies message first" },
  { name: "Jobright", channel: "browser", signin: "https://jobright.ai", about: "AI agent Orion matches and applies" },
  { name: "Arc.dev", channel: "browser", signin: "https://arc.dev", about: "Matches you, then direct chats" },
  { name: "Braintrust", channel: "browser", signin: "https://app.usebraintrust.com", about: "AI-powered talent matching" },
  { name: "Lemon.io", channel: "browser", signin: "https://lemon.io", about: "Matches developers to startups" },
  { name: "Revelo", channel: "browser", signin: "https://www.revelo.com", about: "LatAm engineers; now mostly AI-data work" },
  { name: "Terminal", channel: "browser", signin: "https://www.terminal.io", about: "Matches devs: Canada, LatAm, Europe" },
];

export const CATALOG = Object.fromEntries(ENTRIES.map((e) => [e.name.toLowerCase(), e]));
