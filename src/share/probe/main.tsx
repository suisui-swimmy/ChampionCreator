import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShareProbe } from "./ShareProbe";
import "../../styles.css";
import "./shareProbe.css";

// Deliberately outside the application/auth/draft/sync providers.
createRoot(document.getElementById("root")!).render(<StrictMode><ShareProbe /></StrictMode>);
