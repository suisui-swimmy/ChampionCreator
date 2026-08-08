import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GuideTutorial } from "./GuideTutorial";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";
import "../styles.css";
import "./guide.css";

const menuButton = document.querySelector<HTMLButtonElement>(".guide-menu-toggle");
const menuImage = menuButton?.querySelector<HTMLImageElement>("img");
const tocPanel = document.getElementById("guide-toc-panel");
const mobileMenuQuery = window.matchMedia("(max-width: 720px)");

if (!menuButton || !menuImage || !tocPanel) {
  throw new Error("Guide mobile menu controls were not found.");
}

const setGuideMenuOpen = (open: boolean) => {
  const nextOpen = mobileMenuQuery.matches && open;
  document.body.classList.toggle("guide-menu-open", nextOpen);
  menuButton.setAttribute("aria-expanded", String(nextOpen));
  menuButton.setAttribute("aria-label", nextOpen ? "ガイドメニューを閉じる" : "ガイドメニューを開く");
  menuImage.src = getPublicAssetUrl(nextOpen ? "assets/ui/x.svg" : "assets/ui/menu.svg");
  tocPanel.setAttribute("aria-hidden", String(mobileMenuQuery.matches && !nextOpen));
};

menuButton.addEventListener("click", () => {
  setGuideMenuOpen(menuButton.getAttribute("aria-expanded") !== "true");
});

tocPanel.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => setGuideMenuOpen(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
    setGuideMenuOpen(false);
    menuButton.focus();
  }
});

mobileMenuQuery.addEventListener("change", () => setGuideMenuOpen(false));
setGuideMenuOpen(false);

const tutorialRoot = document.getElementById("guide-tutorial-root");
if (!tutorialRoot) {
  throw new Error("Guide tutorial root was not found.");
}

createRoot(tutorialRoot).render(
  <StrictMode>
    <GuideTutorial />
  </StrictMode>,
);
