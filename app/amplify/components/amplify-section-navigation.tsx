import Link from "next/link";

export type AmplifySection = "home" | "create" | "campaigns" | "results" | "connections";

const sections: readonly { id: Exclude<AmplifySection, "home">; label: string; href: string }[] = [
  { id: "create", label: "Create", href: "/amplify/create" },
  { id: "campaigns", label: "Campaigns", href: "/amplify/campaigns" },
  { id: "results", label: "Results", href: "/amplify/results" },
  { id: "connections", label: "Connections", href: "/amplify/connections" },
];

export function AmplifySectionNavigation({ active }: { active: AmplifySection }) {
  return <nav className="amplify-section-nav" aria-label="AMPLIFY sections">
    {sections.map((section) => <Link key={section.id} href={section.href} className={active === section.id ? "active" : ""} aria-current={active === section.id ? "page" : undefined}>{section.label}</Link>)}
  </nav>;
}
