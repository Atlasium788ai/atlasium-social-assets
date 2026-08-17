import type { AmplifyBrand } from "../types";

const sampleMetrics = [
  ["Spend", "$248.00"], ["Impressions", "31,240"], ["Clicks", "742"], ["CTR", "2.38%"], ["Leads", "28"], ["Cost per lead", "$8.86"],
];

export function AmplifyResults({ brand, previewMode }: { brand: AmplifyBrand; previewMode: boolean }) {
  return <section className="amplify-page">
    <header className="amplify-page-heading"><div><p className="eyebrow">RESULTS · {brand.name}</p><h1>Results</h1><p>Combined and per-platform reporting will appear only when real advertising connections return it.</p></div></header>
    {previewMode ? <>
      <p className="amplify-safety-banner mock">SAMPLE DATA — NOT LIVE RESULTS</p>
      <div className="amplify-result-filters"><label>Date range<select aria-label="Sample date range"><option>Last 30 days</option></select></label><label>Campaign<select aria-label="Sample campaign"><option>Sample campaign</option></select></label><span>CAD</span></div>
      <div className="amplify-metric-grid">{sampleMetrics.map(([label, metric]) => <article key={label}><span>{label}</span><strong>{metric}</strong><small>SAMPLE</small></article>)}</div>
    </> : <div className="amplify-empty"><span>NO LIVE REPORTING</span><h2>Results will stay factual</h2><p>No advertising platform is connected, so EchoFlow has no real metrics to display.</p></div>}
  </section>;
}
