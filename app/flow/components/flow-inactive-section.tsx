import type { FlowSection } from "./flow-section-navigation";

const labels: Record<Exclude<FlowSection, "channels">, { title: string; description: string }> = {
  calendar: { title: "Publishing calendar", description: "Calendar controls are reserved for the next FLOW build phase." },
  queue: { title: "Scheduled queue", description: "Queue management is not active yet." },
  activity: { title: "Delivery activity", description: "Direct-platform delivery tracking is not active yet." },
};

export function FlowInactiveSection({ section }: { section: Exclude<FlowSection, "channels"> }) {
  const copy = labels[section];
  return <section className="flow-inactive-section"><p className="eyebrow">{section.toUpperCase()}</p><h1>{copy.title}</h1><p>{copy.description}</p><span>INACTIVE</span></section>;
}
