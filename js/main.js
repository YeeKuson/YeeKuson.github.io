"use strict";

const header = document.querySelector("[data-header]");
const navigationLinks = Array.from(document.querySelectorAll("[data-nav-link]"));
const sections = Array.from(document.querySelectorAll("main .section-anchor"));
const yearNodes = document.querySelectorAll("[data-current-year]");

/**
 * 将页脚年份同步为访问者设备上的当前年份。
 * 输入：包含 data-current-year 的元素集合；输出：无；副作用：更新元素文本。
 */
function updateCurrentYear() {
  const currentYear = String(new Date().getFullYear());
  yearNodes.forEach((node) => {
    node.textContent = currentYear;
  });
}

/**
 * 根据滚动距离切换导航栏的可读背景。
 * 输入：浏览器当前滚动位置；输出：无；副作用：切换 header class。
 */
function updateHeaderSurface() {
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 16);
}

/**
 * 标记当前最接近视口上方参考线的页面板块。
 * 输入：页面板块位置；输出：无；副作用：更新导航 aria-current 和 class。
 */
function updateActiveNavigation() {
  if (navigationLinks.length === 0 || sections.length === 0) return;

  const referenceLine = Math.max(120, window.innerHeight * 0.3);
  let activeSectionId = sections[0].id;

  sections.forEach((section) => {
    if (section.getBoundingClientRect().top <= referenceLine) {
      activeSectionId = section.id;
    }
  });

  navigationLinks.forEach((link) => {
    const isActive = link.getAttribute("href") === `#${activeSectionId}`;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "location");
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

/**
 * 合并滚动期间的界面更新，避免同一帧重复计算布局。
 * 输入：滚动事件；输出：无；副作用：安排下一帧的导航更新。
 */
function createScrollScheduler() {
  let framePending = false;

  return function scheduleScrollUpdate() {
    if (framePending) return;
    framePending = true;
    window.requestAnimationFrame(() => {
      updateHeaderSurface();
      updateActiveNavigation();
      framePending = false;
    });
  };
}

const scheduleScrollUpdate = createScrollScheduler();

updateCurrentYear();
updateHeaderSurface();
updateActiveNavigation();

window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });
window.addEventListener("resize", scheduleScrollUpdate, { passive: true });
