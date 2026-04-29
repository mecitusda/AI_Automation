import React, { type ReactNode } from "react";
import { Button, PageState } from "./ui";

type Props = { children: ReactNode };
type State = { hasError: boolean };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    if (import.meta.env.DEV) {
      console.error("[AppErrorBoundary]", error);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="pageLayout">
        <PageState
          title="Something went wrong"
          message="The app hit an unexpected UI error. You can reload and continue working."
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload app
            </Button>
          }
        />
      </div>
    );
  }
}
