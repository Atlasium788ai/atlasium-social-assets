import { AmplifyErrorBoundary } from "./amplify-error-boundary";
import { AmplifyWorkspace } from "./amplify-workspace";
import type { AmplifySection } from "./amplify-section-navigation";

export function AmplifyRoute({ section }: { section: AmplifySection }) {
  return <AmplifyErrorBoundary><AmplifyWorkspace activeSection={section} /></AmplifyErrorBoundary>;
}
