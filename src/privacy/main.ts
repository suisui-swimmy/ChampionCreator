import "../styles.css";
import "../guide/guide.css";

const menuButton = document.querySelector<HTMLButtonElement>(".guide-menu-toggle");
const menuImage = menuButton?.querySelector<HTMLImageElement>("img");
const tocPanel = document.getElementById("privacy-toc-panel");
const mobileMenuQuery = window.matchMedia("(max-width: 720px)");

if (!menuButton || !menuImage || !tocPanel) {
  throw new Error("Privacy page menu controls were not found.");
}

const setMenuOpen = (open: boolean) => {
  const nextOpen = mobileMenuQuery.matches && open;
  document.body.classList.toggle("guide-menu-open", nextOpen);
  menuButton.setAttribute("aria-expanded", String(nextOpen));
  menuButton.setAttribute(
    "aria-label",
    nextOpen ? "プライバシーメニューを閉じる" : "プライバシーメニューを開く",
  );
  menuImage.src = `/assets/ui/${nextOpen ? "x" : "menu"}.svg`;
  tocPanel.setAttribute("aria-hidden", String(mobileMenuQuery.matches && !nextOpen));
};

menuButton.addEventListener("click", () => {
  setMenuOpen(menuButton.getAttribute("aria-expanded") !== "true");
});

tocPanel.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((link) => {
  link.addEventListener("click", () => setMenuOpen(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuButton.getAttribute("aria-expanded") === "true") {
    setMenuOpen(false);
    menuButton.focus();
  }
});

mobileMenuQuery.addEventListener("change", () => setMenuOpen(false));
setMenuOpen(false);
