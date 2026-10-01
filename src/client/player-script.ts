// Plain browser JS, served as-is via GET /player.js (see src/index.ts).
// Deliberately not bundled/transpiled — this is a small spike, and keeping
// it as a template string avoids needing a separate client build step.
export const PLAYER_SCRIPT = `
(function () {
  "use strict";

  var PROGRESS_INTERVAL_MS = 30000;

  var player = null;
  var playerReady = false;
  var pendingLoad = null; // { videoId, startSeconds, playlistId } queued before the player is ready
  var currentVideoId = null;
  var currentPlaylistId = null;
  var progressTimer = null;

  function loadVideo(videoId, startSeconds, playlistId) {
    if (!playerReady) {
      pendingLoad = { videoId: videoId, startSeconds: startSeconds, playlistId: playlistId };
      return;
    }
    currentVideoId = videoId;
    currentPlaylistId = playlistId || null;
    player.loadVideoById({ videoId: videoId, startSeconds: startSeconds || 0 });
  }

  // Finds a random not-yet-done video from the oldest week bucket that still
  // has incomplete videos, preferring one from a different playlist than
  // what's currently playing so we don't just binge one show back-to-back.
  function pickNextVideo() {
    var buckets = {};
    var elements = document.querySelectorAll(".video[data-video-id]");
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var glyph = el.querySelector(".video-glyph");
      if (glyph && glyph.classList.contains("done")) continue;
      var week = el.getAttribute("data-week");
      if (!week) continue;
      var entry = {
        videoId: el.getAttribute("data-video-id"),
        playlistId: el.getAttribute("data-playlist-id"),
        startSeconds: parseFloat(el.getAttribute("data-progress-seconds") || "0"),
      };
      if (!buckets[week]) buckets[week] = [];
      buckets[week].push(entry);
    }

    var weeks = Object.keys(buckets).sort();
    if (weeks.length === 0) return null;

    var candidates = buckets[weeks[0]];
    var otherPlaylists = candidates.filter(function (entry) {
      return entry.playlistId !== currentPlaylistId;
    });
    var pool = otherPlaylists.length > 0 ? otherPlaylists : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function playNext() {
    var next = pickNextVideo();
    if (!next) return;
    loadVideo(next.videoId, next.startSeconds, next.playlistId);
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
      if (event.data === 0) {
        playNext();
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
            loadVideo(pendingLoad.videoId, pendingLoad.startSeconds, pendingLoad.playlistId);
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
    var playlistId = target.getAttribute("data-playlist-id");
    loadVideo(videoId, startSeconds, playlistId);
  });

  function isTypingTarget(element) {
    if (!element) return false;
    var tag = element.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || element.isContentEditable;
  }

  document.addEventListener("keydown", function (event) {
    if (event.code !== "Space" && event.key !== " ") return;
    if (isTypingTarget(document.activeElement)) return;
    if (event.repeat) return;
    if (!player || typeof player.getPlayerState !== "function") return;
    event.preventDefault();
    if (player.getPlayerState() === 1) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  });

  var iframeApiTag = document.createElement("script");
  iframeApiTag.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(iframeApiTag);
})();
`;
