"use strict";

const yearNodes = document.querySelectorAll("[data-current-year]");
const tocContainers = Array.from(document.querySelectorAll("[data-auto-toc]"));
const generatedHeadings = Array.from(
  document.querySelectorAll(".course-article [data-toc-heading][id]"),
);

if (tocContainers.length > 0 && generatedHeadings.length > 0) {
  tocContainers.forEach((container) => {
    const list = container.querySelector("ol");
    if (!list) return;

    const items = generatedHeadings.map((heading) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      item.className = `toc-level-${heading.tagName.toLowerCase()}`;
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent.trim();
      item.append(link);
      return item;
    });
    list.replaceChildren(...items);
  });
}

const tocLinks = Array.from(document.querySelectorAll("[data-course-toc] a"));
const courseSections =
  generatedHeadings.length > 0
    ? generatedHeadings
    : Array.from(document.querySelectorAll("[data-course-section]"));

yearNodes.forEach((node) => {
  node.textContent = String(new Date().getFullYear());
});

function updateActiveToc() {
  if (courseSections.length === 0 || tocLinks.length === 0) return;

  const referenceLine = Math.max(120, window.innerHeight * 0.25);
  let activeId = courseSections[0].id;
  courseSections.forEach((section) => {
    if (section.getBoundingClientRect().top <= referenceLine) activeId = section.id;
  });

  tocLinks.forEach((link) => {
    const isActive = link.getAttribute("href") === `#${activeId}`;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}

let framePending = false;
function scheduleTocUpdate() {
  if (framePending) return;
  framePending = true;
  window.requestAnimationFrame(() => {
    updateActiveToc();
    framePending = false;
  });
}

updateActiveToc();
window.addEventListener("scroll", scheduleTocUpdate, { passive: true });
window.addEventListener("resize", scheduleTocUpdate, { passive: true });
