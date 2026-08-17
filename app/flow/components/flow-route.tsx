import { FlowErrorBoundary } from "./flow-error-boundary";
import { FlowWorkspace } from "./flow-workspace";
import type { FlowSection } from "./flow-section-navigation";

export function FlowRoute({ section }: { section: FlowSection }) {
  return <FlowErrorBoundary><FlowWorkspace activeSection={section} /></FlowErrorBoundary>;
}
