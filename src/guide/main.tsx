import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GuideTutorial } from "./GuideTutorial";
import "../styles.css";
import "./guide.css";

const tutorialRoot = document.getElementById("guide-tutorial-root");
if (!tutorialRoot) {
  throw new Error("Guide tutorial root was not found.");
}

createRoot(tutorialRoot).render(
  <StrictMode>
    <GuideTutorial />
  </StrictMode>,
);
