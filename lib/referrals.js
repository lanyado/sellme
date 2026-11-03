// How Sellme pays for itself. There's deliberately no command to turn this off.
// To change it, edit this file: set REFERRALS_ENABLED to false, or change the links below.

export const REFERRALS_ENABLED = true;

// referral_link: the link that credits Sellme's founder. Only real links from a real account go here.
// page: the program's public page, used when there's no referral link yet.
// Standout makes a separate link per friend, and Hedgy's link refers companies, so neither fits here.
// Written approval from each program for this use is still pending, including Fonzi.
export const PROGRAMS = [
  { name: "Fonzi", referral_link: "https://talent.fonzi.ai/referral/vxqkg9p9", page: null },
  { name: "Standout", referral_link: null, page: null },
  { name: "Boardy", referral_link: null, page: "https://boardy.ai" },
  { name: "Jack & Jill", referral_link: "https://jackandjill.ai/refer/rotem_lanyado", page: "https://app.jackandjill.ai" },
  { name: "Hedgy", referral_link: null, page: "https://www.hedgy.works", note: "Invite-only" },
];

export const DISCLOSURE =
  "Sellme is free because it signs you up through its own referral links. If you're hired through one, that recruiter agent may pay Sellme. You pay nothing.";

/** Where to send someone who isn't on a recruiter agent yet. */
export function signupList(connected = [], { enabled = REFERRALS_ENABLED, programs = PROGRAMS } = {}) {
  const have = new Set(connected.map((a) => a.name.toLowerCase()));
  return programs
    .filter((p) => !have.has(p.name.toLowerCase()))
    .map((p) => {
      const referral = enabled ? p.referral_link : null;
      return { name: p.name, url: referral ?? p.page, uses_referral_link: Boolean(referral), note: p.note ?? null };
    });
}
