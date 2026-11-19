// Stone courses settling into place.
var canvas = document.getElementById("courses");
var ctx = canvas.getContext("2d");
var W = canvas.width;
var H = canvas.height;

var stones = [];
var courses = 9;
var bandHeight = H / courses;
var seed = 7;

function rand() {
  seed = (seed * 9301 + 49297) % 233280;
  return seed / 233280;
}

for (var course = 0; course < courses; course++) {
  var x = -rand() * 60;
  while (x < W) {
    var w = 50 + rand() * 110;
    var h = bandHeight - 6 - rand() * 4;
    stones.push({
      x: x,
      y: course * bandHeight + 3,
      w: w,
      h: h,
      tone: rand(),
      offset: rand() * 40,
      settled: false,
    });
    x += w + 4;
  }
}

var start = null;
function frame(now) {
  if (start === null) start = now;
  var t = Math.min((now - start) / 1200, 1);
  var ease = 1 - Math.pow(1 - t, 3);
  ctx.fillStyle = "#26241f";
  ctx.fillRect(0, 0, W, H);
  for (var i = 0; i < stones.length; i++) {
    var s = stones[i];
    var drop = (1 - ease) * (s.offset + 120);
    var tone = Math.floor(120 + s.tone * 90);
    ctx.fillStyle = "hsl(36, 8%, " + tone + "%)";
    ctx.beginPath();
    ctx.roundRect(s.x, s.y - drop, s.w, s.h, 4);
    ctx.fill();
  }
  if (t < 1) requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
