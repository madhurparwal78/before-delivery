if (typeof window === 'undefined') {
  const fs = require('node:fs');
  const evidence = '/judge-workspace/evidence';
  const contexts = new WeakSet();

  const webglProbe = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) throw new Error('Software WebGL context unavailable');
    gl.clearColor(0.25, 0.5, 0.75, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return JSON.stringify({ pixel: Array.from(pixel), renderer });
  };

  exports.default = async ({ page }) => {
    const context = page.context();
    if (contexts.has(context)) return;
    contexts.add(context);
    const origins = (process.env.JUDGE_ORIGINS || process.env.JUDGE_APP_ORIGIN).split(' ');
    const mode = process.env.JUDGE_BROWSER_MODE;
    page.on('domcontentloaded', async () => {
      let result;
      try {
        result = await page.evaluate(webglProbe);
      } catch (error) {
        result = JSON.stringify({ error: String(error) });
      }
      fs.writeFileSync(`${evidence}/webgl-${mode}.json`, result);
    });
    await context.route('**/*', route =>
      origins.includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  };
} else {
  (() => {
    const contexts = [], gains = [], sources = [], decoded = new WeakSet(), media = new Map();
    const projections = new Set(), links = new Map(), matrices = [], models = [];
    let resumes = 0, oscillatorStarts = 0, decodes = 0, draws = 0, offscreen = 0, uploaded = 0;

    const MODEL = /\.(glb|gltf|obj|fbx|usdz|drc|ply|stl)(\?|#|$)/i;
    const fetchOriginal = window.fetch;
    if (fetchOriginal) window.fetch = function(input, ...rest) {
      const url = String(input && input.url || input);
      if (MODEL.test(url)) models.push(url);
      return fetchOriginal.call(this, input, ...rest);
    };
    const openOriginal = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      if (MODEL.test(String(url))) models.push(String(url));
      return openOriginal.call(this, method, url, ...rest);
    };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      const ctx = original.call(this, kind, ...args);
      if (ctx && /webgl/.test(kind) && !contexts.includes(ctx)) {
        contexts.push(ctx);
        const matrix = ctx.uniformMatrix4fv.bind(ctx);
        ctx.uniformMatrix4fv = (location, transpose, values) => {
          if (values.length === 16 && Math.abs(values[11] + 1) < 0.001 && Math.abs(values[15]) < 0.001)
            projections.add(2 * Math.atan(1 / values[5]) * 180 / Math.PI);
          else if (values.length >= 16) {
            matrices.push(Array.from(values.slice(0, 16), v => Math.round(v * 1e4) / 1e4));
            if (matrices.length > 8) matrices.shift();
          }
          return matrix(location, transpose, values);
        };
        const bufferData = ctx.bufferData.bind(ctx);
        ctx.bufferData = (target, data, ...rest) => {
          if (target === ctx.ARRAY_BUFFER) uploaded += typeof data === 'number' ? data : (data?.byteLength || 0);
          return bufferData(target, data, ...rest);
        };
        for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
          if (!ctx[name]) continue;
          const draw = ctx[name].bind(ctx);
          ctx[name] = (...values) => { draws++; return draw(...values); };
        }
        const clear = ctx.clear.bind(ctx);
        ctx.clear = (...values) => {
          if (ctx.getParameter(ctx.FRAMEBUFFER_BINDING) !== null) offscreen++;
          return clear(...values);
        };
      }
      return ctx;
    };
    const Base = window.BaseAudioContext || window.AudioContext;
    if (Base) {
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function(destination, ...args) {
        if (!links.has(this)) links.set(this, []);
        links.get(this).push(destination);
        return connect.call(this, destination, ...args);
      };
      const resume = Base.prototype.resume;
      Base.prototype.resume = function(...args) { resumes++; return resume.apply(this, args); };
      const gain = Base.prototype.createGain;
      Base.prototype.createGain = function(...args) { const node = gain.apply(this, args); gains.push(node); return node; };
      window.GainNode = new Proxy(window.GainNode, {construct(target, args, kind) { const node = Reflect.construct(target, args, kind); gains.push(node); return node; }});

      const decode = Base.prototype.decodeAudioData;
      Base.prototype.decodeAudioData = function(data, success, failure) {
        decodes++;
        const bytes = data?.byteLength || 0;
        const mark = buffer => { if (buffer && bytes > 0) decoded.add(buffer); return buffer; };
        const result = decode.call(this, data, success && (buffer => success(mark(buffer))), failure);
        return result && result.then ? result.then(mark) : result;
      };
      const bufferStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...values) {
        sources.push({node: this, kind: 'buffer', loop: !!this.loop, duration: this.buffer ? this.buffer.duration : null, decoded: !!this.buffer && decoded.has(this.buffer)});
        return bufferStart.apply(this, values);
      };
      const oscillatorStart = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function(...values) { oscillatorStarts++; return oscillatorStart.apply(this, values); };
      const elementSource = Base.prototype.createMediaElementSource;
      if (elementSource) Base.prototype.createMediaElementSource = function(element) {
        const node = elementSource.call(this, element); media.set(element, node); return node;
      };
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...values) {
      sources.push({element: this, kind: 'media', loop: !!this.loop});
      return play.apply(this, values);
    };
    const isOutput = node => !!window.AudioDestinationNode && node instanceof AudioDestinationNode;
    const reaches = (node, test, seen = new Set()) => {
      if (seen.has(node)) return false;
      seen.add(node);
      return (links.get(node) || []).some(next => test(next) || reaches(next, test, seen));
    };

    const masters = () => gains.filter(node => reaches(node, isOutput) && !reaches(node, next => gains.includes(next)));
    const bypasses = (node, outputs, seen = new Set()) => {
      if (outputs.includes(node) || seen.has(node)) return false;
      seen.add(node);
      return (links.get(node) || []).some(next => isOutput(next) || bypasses(next, outputs, seen));
    };
    const viaMaster = node => {
      if (!node) return false;
      const outputs = masters();
      return outputs.some(gain => reaches(node, next => next === gain)) && !bypasses(node, outputs);
    };
    Object.defineProperty(window, '__VERIFIER_OBSERVE__', {value: () => ({
      contexts: contexts.length, draws, offscreen, resumes, oscillatorStarts, decodes,
      starts: sources.length + oscillatorStarts,
      sources: sources.map(item => item.kind === 'buffer'
        ? {kind: 'buffer', loop: item.loop, duration: item.duration, decoded: item.decoded, src: null, viaMaster: viaMaster(item.node)}
        : {kind: 'media', loop: item.loop, duration: Number.isFinite(item.element.duration) ? item.element.duration : null,
           decoded: true, src: item.element.currentSrc || item.element.src || null, viaMaster: viaMaster(media.get(item.element))}),
      outputGains: masters().map(node => node.gain.value),
      projections: [...projections],
      matrices: [...matrices], uploaded, models: [...models],
      gpu: contexts.filter(ctx => !ctx.isContextLost()).map(ctx => ({depth: !!ctx.getContextAttributes()?.depth,
        program: !!ctx.getParameter(ctx.CURRENT_PROGRAM),
        width: ctx.drawingBufferWidth, height: ctx.drawingBufferHeight}))
    })});
  })();
}
