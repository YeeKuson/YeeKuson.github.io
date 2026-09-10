"use strict";

const header = document.querySelector("[data-header]");
const navigationLinks = Array.from(document.querySelectorAll("[data-nav-link]"));
const sections = Array.from(document.querySelectorAll("main .section-anchor"));
const yearNodes = document.querySelectorAll("[data-current-year]");
let activeDialog = null;
let dialogTrigger = null;

const qrProfiles = {
  wechat: {
    label: "微信公众号",
    title: "扫码关注海绵朋克",
    src: "assets/qrcodes/wechat-official.jpg",
    alt: "海绵朋克微信公众号二维码",
    description: "长篇实践记录、方法总结和阶段性思考。",
  },
  xiaohongshu: {
    label: "小红书",
    title: "扫码找到朋克海绵",
    src: "assets/qrcodes/xiaohongshu.jpg",
    alt: "朋克海绵的小红书账号卡片和二维码，小红书号 95571840715",
    description: "朋克海绵 · 小红书号 95571840715",
  },
};

function updateCurrentYear() {
  const currentYear = String(new Date().getFullYear());
  yearNodes.forEach((node) => {
    node.textContent = currentYear;
  });
}

function updatePageState() {
  if (header) header.classList.toggle("is-scrolled", window.scrollY > 12);
  if (navigationLinks.length === 0 || sections.length === 0) return;

  const referenceLine = Math.max(100, window.innerHeight * 0.28);
  let activeId = sections[0].id;
  sections.forEach((section) => {
    if (section.getBoundingClientRect().top <= referenceLine) activeId = section.id;
  });

  navigationLinks.forEach((link) => {
    const isActive = link.getAttribute("href") === `#${activeId}`;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  });
}

function getFocusableElements(dialog) {
  return Array.from(
    dialog.querySelectorAll('a[href], button:not([disabled]):not([data-dialog-backdrop]), [tabindex]:not([tabindex="-1"])'),
  ).filter((element) => !element.hasAttribute("hidden"));
}

function closeDialog(dialog = activeDialog) {
  if (!dialog) return;
  dialog.classList.remove("is-open");
  dialog.hidden = true;
  activeDialog = null;
  const trigger = dialogTrigger;
  dialogTrigger = null;
  if (trigger) trigger.focus({ preventScroll: true });
}

function openDialog(dialog, trigger) {
  if (!dialog) return;
  if (activeDialog) closeDialog(activeDialog);
  dialogTrigger = trigger;
  activeDialog = dialog;
  dialog.hidden = false;
  window.requestAnimationFrame(() => {
    dialog.classList.add("is-open");
    const focusable = getFocusableElements(dialog);
    (focusable[0] || dialog.querySelector("[role='dialog']"))?.focus({ preventScroll: true });
  });
}

function configureQrDialog(profileName) {
  const profile = qrProfiles[profileName];
  const dialog = document.getElementById("qr-dialog");
  if (!profile || !dialog) return dialog;
  dialog.querySelector("[data-qr-label]").textContent = profile.label;
  dialog.querySelector("[data-qr-title]").textContent = profile.title;
  const image = dialog.querySelector("[data-qr-image]");
  image.src = profile.src;
  image.alt = profile.alt;
  dialog.querySelector("[data-qr-description]").textContent = profile.description;
  return dialog;
}

document.addEventListener("click", (event) => {
  const dialogButton = event.target.closest("[data-open-dialog]");
  if (dialogButton) {
    openDialog(document.getElementById(dialogButton.dataset.openDialog), dialogButton);
    return;
  }

  const qrButton = event.target.closest("[data-open-qr]");
  if (qrButton) {
    openDialog(configureQrDialog(qrButton.dataset.openQr), qrButton);
    return;
  }

  if (event.target.closest("[data-close-dialog]")) closeDialog();
});

document.addEventListener("keydown", (event) => {
  if (!activeDialog) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeDialog();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = getFocusableElements(activeDialog);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

let framePending = false;
function schedulePageUpdate() {
  if (framePending) return;
  framePending = true;
  window.requestAnimationFrame(() => {
    updatePageState();
    framePending = false;
  });
}

updateCurrentYear();
updatePageState();
window.addEventListener("scroll", schedulePageUpdate, { passive: true });
window.addEventListener("resize", schedulePageUpdate, { passive: true });
