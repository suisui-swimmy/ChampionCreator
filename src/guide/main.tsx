import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GuideTutorial } from "./GuideTutorial";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";
import { getActiveGuideSectionIndex } from "./scrollSpy";
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

const tocNav = tocPanel.querySelector("nav");
const tocItems = Array.from(tocPanel.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))
  .map((link) => {
    const sectionId = decodeURIComponent(link.hash.slice(1));
    const section = document.getElementById(sectionId);
    return section ? { link, section } : null;
  })
  .filter((item): item is { link: HTMLAnchorElement; section: HTMLElement } => item !== null);

if (!tocNav || tocItems.length === 0) {
  throw new Error("Guide table of contents links were not found.");
}

let activeTocIndex = Math.max(0, tocItems.findIndex(({ link }) => link.hash === window.location.hash));

const keepActiveTocLinkVisible = (link: HTMLAnchorElement) => {
  const navRect = tocNav.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();

  if (linkRect.left < navRect.left) {
    tocNav.scrollLeft -= navRect.left - linkRect.left;
  } else if (linkRect.right > navRect.right) {
    tocNav.scrollLeft += linkRect.right - navRect.right;
  }

  const panelRect = tocPanel.getBoundingClientRect();
  if (linkRect.top < panelRect.top) {
    tocPanel.scrollTop -= panelRect.top - linkRect.top;
  } else if (linkRect.bottom > panelRect.bottom) {
    tocPanel.scrollTop += linkRect.bottom - panelRect.bottom;
  }
};

const setActiveTocItem = (nextIndex: number) => {
  if (nextIndex < 0 || nextIndex >= tocItems.length) {
    return;
  }

  activeTocIndex = nextIndex;
  tocItems.forEach(({ link }, index) => {
    const isActive = index === activeTocIndex;
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  });
  keepActiveTocLinkVisible(tocItems[activeTocIndex].link);
};

const updateActiveTocItem = () => {
  const headerBottom = document.querySelector<HTMLElement>(".guide-header")?.getBoundingClientRect().bottom ?? 0;
  const activationLine = Math.max(
    headerBottom + 16,
    Math.min(window.innerHeight * 0.35, headerBottom + 180),
  );
  const atPageEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  const nextIndex = getActiveGuideSectionIndex(
    tocItems.map(({ section }) => section.getBoundingClientRect().top),
    activationLine,
    activeTocIndex,
    atPageEnd,
  );
  setActiveTocItem(nextIndex);
};

let tocUpdateFrame = 0;
const scheduleActiveTocUpdate = () => {
  if (tocUpdateFrame !== 0) {
    return;
  }
  tocUpdateFrame = window.requestAnimationFrame(() => {
    tocUpdateFrame = 0;
    updateActiveTocItem();
  });
};

tocItems.forEach(({ link }, index) => {
  link.addEventListener("click", () => {
    setActiveTocItem(index);
    setGuideMenuOpen(false);
  });
});

window.addEventListener("scroll", scheduleActiveTocUpdate, { passive: true });
window.addEventListener("resize", scheduleActiveTocUpdate);
setActiveTocItem(activeTocIndex);
scheduleActiveTocUpdate();

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
    setGuideMenuOpen(false);
    menuButton.focus();
  }
});

mobileMenuQuery.addEventListener("change", () => {
  setGuideMenuOpen(false);
  scheduleActiveTocUpdate();
});
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
