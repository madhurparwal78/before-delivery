// Counts down a duration on the worker's own clock and answers once it has passed. A worker's
// timers keep time when the page's timers are throttled, as in a background tab.

self.onmessage = (event: MessageEvent<number>) => {
  setTimeout(() => self.postMessage("done"), event.data);
};
