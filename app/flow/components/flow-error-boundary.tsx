"use client";

import { Component, type ReactNode } from "react";

export class FlowErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // FLOW intentionally contains its own errors; no credentials or customer data are logged.
  }

  render() {
    if (this.state.failed) return <main className="app-shell flow-shell"><section className="flow-access-card"><p className="eyebrow">FLOW UNAVAILABLE</p><h1>Try again</h1><p>ECHO and Buffer remain available.</p></section></main>;
    return this.props.children;
  }
}
