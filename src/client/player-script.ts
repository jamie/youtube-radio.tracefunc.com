// Plain browser JS, served as-is via GET /player.js (see src/index.ts).
// Deliberately not bundled/transpiled — this is a small spike, and keeping
// it as a template string avoids needing a separate client build step.
export const PLAYER_SCRIPT = `
(function () {
  "use strict";

  var PROGRESS_INTERVAL_MS = 30000;

  var player = null;
  var playerReady = false;
  var pendingLoad = null; // { videoId, startSeconds } queued before the player is ready
  var currentVideoId = null;
  var progressTimer = null;

  function loadVideo(videoId, startSeconds) {
    if (!playerReady) {
      pendingLoad = { videoId: videoId, startSeconds: startSeconds };
      return;
    }
    currentVideoId = videoId;
    player.loadVideoById({ videoId: videoId, startSeconds: startSeconds || 0 });
  }

  function reportProgress(isFinal) {
    if (!currentVideoId || !player || typeof player.getDuration !== "function") return;
    var duration = player.getDuration();
    var currentTime = player.getCurrentTime();
    if (!duration) return; // duration is 0 for a moment right after loadVideoById
    fetch("/api/progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId: currentVideoId, currentTime: currentTime, duration: duration }),
      keepalive: !!isFinal,
    }).catch(function () {
      // Best-effort; the next 30s tick (or the next page load) will retry.
    });
  }

  function stopProgressTimer() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function onPlayerStateChange(event) {
    // YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (event.data === 1) {
      stopProgressTimer();
      progressTimer = setInterval(function () {
        reportProgress(false);
      }, PROGRESS_INTERVAL_MS);
    } else {
      stopProgressTimer();
      if (event.data === 0 || event.data === 2) {
        // Flush a report on end/pause so progress isn't missed by up to
        // PROGRESS_INTERVAL_MS if the tab closes shortly after.
        reportProgress(true);
      }
    }
  }

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("player", {
      height: "390",
      width: "640",
      events: {
        onReady: function () {
          playerReady = true;
          if (pendingLoad) {
            loadVideo(pendingLoad.videoId, pendingLoad.startSeconds);
            pendingLoad = null;
          }
        },
        onStateChange: onPlayerStateChange,
      },
    });
  };

  document.addEventListener("click", function (event) {
    var target = event.target.closest("[data-video-id]");
    if (!target) return;
    event.preventDefault();
    var videoId = target.getAttribute("data-video-id");
    var startSeconds = parseFloat(target.getAttribute("data-progress-seconds") || "0");
    loadVideo(videoId, startSeconds);
  });

  var iframeApiTag = document.createElement("script");
  iframeApiTag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(iframeApiTag);
})();
`;
