// Hover the courses to see the grid breathe.
var blocks = document.querySelectorAll(".block");
var step = 0;
setInterval(function () {
  step = (step + 1) % blocks.length;
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    if (i === step) {
      b.style.background = "#8f9c7a";
    } else {
      b.style.background = "";
    }
  }
}, 420);
