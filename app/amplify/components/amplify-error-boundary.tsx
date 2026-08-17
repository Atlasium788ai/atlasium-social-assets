"use client";

import { Component, type ReactNode } from "react";

export class AmplifyErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch() {
    // AMPLIFY contains its own failures. Credentials and customer data are never logged here.
  }

  render() {
    if (this.state.failed) return <main className="app-shell amplify-shell"><section className="amplify-empty"><p className="eyebrow">AMPLIFY UNAVAILABLE</p><h1>Try again</h1><p>ECHO, FLOW and Buffer remain available and unchanged.</p><a className="secondary" href="/echo">Return to ECHO</a></section></main>;
    return this.props.children;
  }
}
