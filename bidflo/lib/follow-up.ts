export type FollowUpRules = {
  firstReminderDays?: number;
  secondReminderDays?: number;
  staleAfterDays?: number;
};

export type FollowUpState = {
  ageDays: number;
  due: boolean;
  level: "upcoming" | "first" | "second" | "stale";
  label: string;
};

export function getFollowUpState(updatedAt: string, rules: FollowUpRules, now = new Date()): FollowUpState {
  const updated = new Date(updatedAt);
  const elapsed = Number.isFinite(updated.getTime()) ? Math.max(0, now.getTime() - updated.getTime()) : 0;
  const ageDays = Math.floor(elapsed / 86_400_000);
  const first = Math.max(1, Number(rules.firstReminderDays ?? 3));
  const second = Math.max(first, Number(rules.secondReminderDays ?? 7));
  const stale = Math.max(second, Number(rules.staleAfterDays ?? 14));

  if (ageDays >= stale) return { ageDays, due: true, level: "stale", label: `Stale · ${ageDays}d without movement` };
  if (ageDays >= second) return { ageDays, due: true, level: "second", label: `Second follow-up due · ${ageDays}d` };
  if (ageDays >= first) return { ageDays, due: true, level: "first", label: `Follow-up due · ${ageDays}d` };
  return { ageDays, due: false, level: "upcoming", label: `Next reminder in ${first - ageDays}d` };
}
