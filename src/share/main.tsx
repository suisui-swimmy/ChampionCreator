import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SharedAdjustmentView } from "./SharedAdjustmentView";
import "../styles.css";
import "./share.css";

createRoot(document.getElementById("root")!).render(<StrictMode><SharedAdjustmentView /></StrictMode>);
