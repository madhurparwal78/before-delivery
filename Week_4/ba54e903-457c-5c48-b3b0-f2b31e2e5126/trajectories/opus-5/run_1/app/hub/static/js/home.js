// The marketing home: the hero video, the word strip and the rising feature blocks.

const video = document.getElementById('hero-video');
const toggle = document.getElementById('hero-toggle');
const strip = document.getElementById('word-track');
const blocks = Array.from(document.querySelectorAll('.feature-block'));
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

let pausedByVisitor = false;

function phoneLayout() {
  return !window.matchMedia('(min-width: 768px)').matches;
}

function setToggleName() {
  toggle.textContent = video.paused ? 'Play background video' : 'Pause background video';
}

function stopVideo() {
  video.pause();
  setToggleName();
}

function applyReducedMotion() {
  const still = reduced.matches;
  document.documentElement.classList.toggle('reduce-motion', still);
  if (still) {
    stopVideo();
    strip.style.animationPlayState = 'paused';
  } else {
    strip.style.animationPlayState = 'running';
  }
  placeBlocks();
}

// Each block rises and fades in as its top travels up through the lower third.
function placeBlocks() {
  const still = reduced.matches || phoneLayout();
  for (const block of blocks) {
    if (still) {
      block.style.setProperty('--rise', '0');
      block.style.setProperty('--fade', '1');
      continue;
    }
    const top = block.getBoundingClientRect().top;
    const start = window.innerHeight;
    const end = window.innerHeight * (2 / 3);
    let progress = (start - top) / Math.max(1, start - end);
    progress = Math.min(1, Math.max(0, progress));
    block.style.setProperty('--rise', String(1 - progress));
    block.style.setProperty('--fade', String(progress));
  }
}

toggle.addEventListener('click', () => {
  if (video.paused) {
    pausedByVisitor = false;
    video.play().catch(() => {});
  } else {
    pausedByVisitor = true;
    video.pause();
  }
  setToggleName();
});

video.addEventListener('play', setToggleName);
video.addEventListener('pause', setToggleName);
reduced.addEventListener('change', applyReducedMotion);
window.addEventListener('scroll', placeBlocks, { passive: true });
window.addEventListener('resize', placeBlocks);

if (reduced.matches) {
  video.autoplay = false;
  stopVideo();
} else if (!pausedByVisitor) {
  video.play().catch(() => {});
}
applyReducedMotion();
setToggleName();
