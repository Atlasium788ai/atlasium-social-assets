import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

export function SearchIcon(props: IconProps) {
  return <svg {...base} {...props}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.4 15.4 4.1 4.1" /></svg>;
}

export function DocumentIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M6 2.8h8l4 4V21H6z" /><path d="M14 2.8V7h4M9 11h6M9 15h6" /></svg>;
}

export function BellIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
}

export function BriefcaseIcon(props: IconProps) {
  return <svg {...base} {...props}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2" /></svg>;
}

export function ChartIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M5 20v-7h3v7M10.5 20V8h3v12M16 20V3h3v17" /></svg>;
}

export function SlidersIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
}

export function ArrowIcon(props: IconProps) {
  return <svg {...base} {...props}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
}

export function LogoMark({ className = "" }: { className?: string }) {
  return <span className={`logo-mark ${className}`} aria-hidden="true"><i /><b /></span>;
}

/** Futuristic celebration icon, animated with surrounding CSS only. */
export function TrophyIcon(props: IconProps) {
  return <svg {...base} {...props}>
    <path d="M7 4h10v6a5 5 0 0 1-10 0V4zM7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4M12 15v4M8.5 21h7" />
    <path d="m12 1-.8 2m-7 14 2-1m11 0 2 1" />
  </svg>;
}
/** Growing connection: a sprout held by two orbital rings. */
export function NurtureIcon(props: IconProps) {
  return <svg {...base} {...props}>
    <path d="M12 20v-9M12 14c-5 0-8-2.7-8-7 5 0 8 2.7 8 7zM12 11c0-4 3-6.5 7.5-6.5 0 4.5-2.5 6.5-7.5 6.5z" />
    <path d="M4.2 18.5a10 10 0 0 0 15.6 0M5.4 4.7A10 10 0 0 1 12 2.4" />
  </svg>;
}
