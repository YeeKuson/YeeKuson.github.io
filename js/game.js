"use strict";

const gameFrame = document.querySelector(".game-frame");
const fullscreenButton = document.querySelector("[data-game-fullscreen]");
const fullscreenStatus = document.querySelector("[data-fullscreen-status]");

if (document.fullscreenEnabled && gameFrame?.requestFullscreen && fullscreenButton) {
  fullscreenButton.hidden = false;
  fullscreenButton.addEventListener("click", async () => {
    try {
      await gameFrame.requestFullscreen();
      fullscreenStatus.hidden = true;
    } catch {
      fullscreenStatus.textContent = "当前浏览器无法进入全屏，可使用“独立打开游戏”继续游玩。";
      fullscreenStatus.hidden = false;
    }
  });
}
