/* Booth-only cash-register chime. The core package does not import this
   module. build.mjs copies cha-ching.mp3 into public/ and leaves it out of
   public-core/. Playback fails soft if the file or the audio API is missing. */

const SRC = "cha-ching.mp3";
const VOLUME = 0.62;

let clip = null;
let primed = false;
let priming = false;

function getClip() {
  if (clip) return clip;
  if (typeof Audio !== "function") return null;
  try {
    clip = new Audio(SRC);
    clip.preload = "auto";
    clip.loop = false;
    clip.volume = VOLUME;
    return clip;
  } catch (e) {
    clip = null;
    return null;
  }
}

/* Call from a tap so a later success chime is allowed to play. The unlock
   itself is silent. */
export function primeChaChing() {
  if (primed || priming) return;
  let audio;
  try {
    audio = getClip();
    if (!audio) return;
    priming = true;
    audio.volume = 0;
    const play = audio.play();
    const finish = function () {
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = VOLUME;
      } catch (e2) {
        /* ignore */
      }
      primed = true;
      priming = false;
    };
    const giveUp = function () {
      priming = false;
      try {
        audio.volume = VOLUME;
      } catch (e3) {
        /* ignore */
      }
    };
    if (play && typeof play.then === "function") play.then(finish, giveUp);
    else finish();
  } catch (e) {
    priming = false;
  }
}

export function playChaChing() {
  try {
    const audio = getClip();
    if (!audio) return;
    audio.loop = false;
    audio.volume = VOLUME;
    try {
      audio.currentTime = 0;
    } catch (e2) {
      /* not seekable yet */
    }
    const play = audio.play();
    if (play && typeof play.catch === "function") play.catch(function () {});
  } catch (e) {
    /* sound is optional */
  }
}
