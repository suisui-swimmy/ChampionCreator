import { Fragment, type ReactNode } from "react";

/** Keep the storage-free preview's form protection separate from its readable footer. */
export function AppWorkspace({ children, tutorial, staticPreview }: {
  children: ReactNode;
  tutorial: boolean;
  staticPreview: boolean;
}) {
  if (tutorial) return <Fragment>{children}</Fragment>;
  if (staticPreview) return <fieldset disabled aria-busy="true" className="app-workspace">{children}</fieldset>;
  return <div className="app-workspace">{children}</div>;
}
