import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../App";

/** Build-only entry: no browser storage, auth providers, effects, or network. */
export const renderInitialApp = (): string => renderToStaticMarkup(
  <App staticPreview />,
);
export { renderGuideExample } from "./guideExample";
