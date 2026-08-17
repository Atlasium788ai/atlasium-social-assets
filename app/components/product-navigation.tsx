import Link from "next/link";

type ProductArea = "echo" | "flow" | "amplify";

export function ProductNavigation({ active }: { active: ProductArea }) {
  return <nav className="product-nav" aria-label="EchoFlow product areas">
    <Link className={active === "echo" ? "product-tab active" : "product-tab"} href="/echo" aria-current={active === "echo" ? "page" : undefined}>
      <strong>ECHO</strong>
      <span>Create content</span>
    </Link>
    <Link className={active === "flow" ? "product-tab active" : "product-tab"} href="/flow" aria-current={active === "flow" ? "page" : undefined}>
      <strong>FLOW</strong>
      <span>Schedule &amp; publish</span>
    </Link>
    <Link className={active === "amplify" ? "product-tab active" : "product-tab"} href="/amplify" aria-current={active === "amplify" ? "page" : undefined}>
      <strong>AMPLIFY</strong>
      <span>Run ads</span>
    </Link>
  </nav>;
}
