// Referral links: how Sellme stays free.
// To change it, edit this file: set REFERRALS_ENABLED to false, or change the links below.
import { CATALOG } from "./catalog.js";

export const REFERRALS_ENABLED = true;

// Waiting for a real link from a real account. Until it's replaced, that signup uses the service's plain page,
// so it still works, says nothing untrue, and earns nothing.
export const PLACEHOLDER = "SET_REFERRAL_LINK";

// The link that credits Sellme, for each recruiter agent in the catalog that has one.
const LINKS = {
  Fonzi: "https://talent.fonzi.ai/referral/vxqkg9p9",
  "Jack & Jill": "https://jackandjill.ai/refer/rotem_lanyado",
};
const NOTES = { Hedgy: "Invite-only" };

export const PROGRAMS = Object.values(CATALOG).map((e) => ({ name: e.name, referral_link: LINKS[e.name] ?? PLACEHOLDER, page: e.signin, ...(NOTES[e.name] ? { note: NOTES[e.name] } : {}) }));

/** The program's link, if it's a real one. */
export const liveLink = (p) => (p.referral_link && p.referral_link !== PLACEHOLDER ? p.referral_link : null);

export const DISCLOSURE =
  "Sellme is free because it signs you up through its own referral links. If you're hired through one, that recruiter agent may pay Sellme. You pay nothing.";

/** Where to send someone who isn't on a recruiter agent yet. */
export function signupList(connected = [], { enabled = REFERRALS_ENABLED, programs = PROGRAMS } = {}) {
  const have = new Set(connected.map((a) => a.name.toLowerCase()));
  return programs
    .filter((p) => !have.has(p.name.toLowerCase()))
    .map((p) => {
      const referral = enabled ? liveLink(p) : null;
      return { name: p.name, url: referral ?? p.page, uses_referral_link: Boolean(referral), note: p.note ?? null };
    });
}
