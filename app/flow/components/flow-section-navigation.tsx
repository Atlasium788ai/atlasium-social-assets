export type FlowSection = "channels" | "calendar" | "queue" | "activity";

const sections: readonly { id: FlowSection; label: string; href: string }[] = [
  { id: "channels", label: "Channels", href: "/flow/channels" },
  { id: "calendar", label: "Calendar", href: "/flow/calendar" },
  { id: "queue", label: "Queue", href: "/flow/queue" },
  { id: "activity", label: "Activity", href: "/flow/activity" },
];

export function FlowSectionNavigation({ active }: { active: FlowSection }) {
  return <nav className="flow-section-nav" aria-label="FLOW sections">
    {sections.map((section) => <a key={section.id} href={section.href} className={section.id === active ? "active" : ""} aria-current={section.id === active ? "page" : undefined}>{section.label}</a>)}
  </nav>;
}
