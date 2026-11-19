// A small physics toy on the pinned matter-js shelf.
var engine = Matter.Engine.create();
var render = Matter.Render.create({
  element: document.body,
  engine: engine,
  options: {
    width: 640,
    height: 480,
    wireframes: false,
    background: "#efece4",
  },
});

var tones = ["#a9a294", "#8f9c7a", "#c2b8a3", "#7d8c6d"];
for (var i = 0; i < 14; i++) {
  var box = Matter.Bodies.rectangle(120 + (i % 4) * 60, 40 + i * 8, 52, 52, {
    restitution: 0.7,
    render: { fillStyle: tones[i % tones.length] },
  });
  Matter.Composite.add(engine.world, box);
}
Matter.Composite.add(engine.world, [
  Matter.Bodies.rectangle(320, 480, 660, 30, { isStatic: true, render: { fillStyle: "#b7b0a2" } }),
  Matter.Bodies.rectangle(320, 150, 220, 14, { isStatic: true, angle: 0.3, render: { fillStyle: "#b7b0a2" } }),
  Matter.Bodies.rectangle(320, 320, 220, 14, { isStatic: true, angle: -0.25, render: { fillStyle: "#b7b0a2" } }),
]);

Matter.Runner.run(Matter.Runner.create(), engine);
Matter.Render.run(render);

var mouse = Matter.Mouse.create(render.canvas);
render.mouse = mouse;
Matter.Composite.add(engine.world, Matter.MouseConstraint.create(engine, { mouse: mouse }));
