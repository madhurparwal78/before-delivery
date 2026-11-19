/* The 3D sky dome: WebGL with three.js, a still chart when unavailable. */

const RESET = { elevation: 35, azimuth: 180, zoom: 1.0 };

export class SkyDome {
  constructor(canvas, size = 520) {
    this.canvas = canvas;
    this.size = size;
    this.camera = { ...RESET };
    this.plan = null;
    this.ok = false;
    this.renderer = null;
    this.scene = null;
    this.cameraObj = null;
    this.starField = null;
    this.targetMeshes = [];
    this.moonMesh = null;
    this.treeline = null;
  }

  init() {
    return this.initAsync();
  }

  async initAsync() {
    const THREE = await awaitImport();
    if (!THREE || !this.canvas) {
      this.ok = false;
      return false;
    }
    try {
      this.THREE = THREE;
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.scene = new THREE.Scene();
      this.cameraObj = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      this.buildStatic();
      this.ok = true;
      this.render();
      return true;
    } catch (err) {
      this.ok = false;
      return false;
    }
  }

  buildStatic() {
    const THREE = this.THREE;
    // The hemisphere rim and grid.
    const grid = new THREE.Group();
    for (let alt = 0; alt <= 60; alt += 30) {
      const geo = new THREE.RingGeometry(alt === 0 ? 0.995 : Math.cos((alt * Math.PI) / 180), Math.cos((alt * Math.PI) / 180) + 0.008, 96);
      const mat = new THREE.MeshBasicMaterial({ color: 0x8fa2c4, transparent: true, opacity: alt === 0 ? 0.6 : 0.25, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = Math.sin((alt * Math.PI) / 180);
      grid.add(ring);
    }
    this.scene.add(grid);
    // Stars: fine points fixed to sidereal time.
    const starGeo = new THREE.BufferGeometry();
    const positions = [];
    for (let i = 0; i < 800; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.95);
      const r = 30;
      positions.push(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
    }
    starGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    this.starField = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xdfe9ff, size: 0.09, sizeAttenuation: true, transparent: true, opacity: 0.8 }));
    this.scene.add(this.starField);
    // The lit Moon.
    const moonGeo = new THREE.SphereGeometry(1.1, 24, 24);
    const moonMat = new THREE.MeshStandardMaterial({ color: 0xdfe9ff, emissive: 0x223344 });
    this.moonMesh = new THREE.Mesh(moonGeo, moonMat);
    this.scene.add(this.moonMesh);
    this.scene.add(new THREE.AmbientLight(0x334466, 1.2));
    this.sunLight = new THREE.DirectionalLight(0xdfe9ff, 1.6);
    this.scene.add(this.sunLight);
  }

  setPlan(plan) {
    this.plan = plan;
    if (!this.ok) return;
    const THREE = this.THREE;
    // Remove old tracks and treeline, then rebuild.
    this.targetMeshes.forEach((m) => this.scene.remove(m));
    this.targetMeshes = [];
    if (this.treeline) this.scene.remove(this.treeline);
    // The treeline band from the 72-bin mask.
    const mask = plan._mask || [];
    const shape = new THREE.Shape();
    const radius = 1;
    mask.forEach((alt, i) => {
      const az0 = (i * 5 * Math.PI) / 180;
      const az1 = ((i + 1) * 5 * Math.PI) / 180;
      const h0 = alt / 90;
      const h1 = mask[(i + 1) % 72] / 90;
      const x0 = Math.sin(az0) * radius, z0 = -Math.cos(az0) * radius;
      const x1 = Math.sin(az1) * radius, z1 = -Math.cos(az1) * radius;
      if (i === 0) shape.moveTo(x0, h0);
      shape.lineTo(x1, h1);
    });
    let band = null;
    if (mask.length) {
      shape.closePath();
      band = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0x04060c, side: THREE.DoubleSide })
      );
      band.rotation.x = Math.PI / 2;
      this.treeline = band;
      this.scene.add(band);
    }
    // Target track tubes and dots.
    (plan.targets || []).forEach((t) => {
      const pts = (t.arc || []).map((p) => {
        const alt = (p.altitude_deg * Math.PI) / 180;
        const az = (p.azimuth_deg * Math.PI) / 180;
        return new THREE.Vector3(Math.sin(az) * Math.cos(alt) * 1.6, Math.sin(alt) * 1.6, -Math.cos(az) * Math.cos(alt) * 1.6);
      });
      if (pts.length > 1) {
        const curve = new THREE.CatmullRomCurve3(pts);
        const tube = new THREE.TubeGeometry(curve, Math.max(8, pts.length * 2), 0.012, 6, false);
        const glow = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: 0x9fe9f4, transparent: true, opacity: t.position_status === "clear" ? 0.95 : 0.3 }));
        this.scene.add(glow);
        this.targetMeshes.push(glow);
      }
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee })
      );
      const alt = (t.altitude_deg * Math.PI) / 180;
      const az = (t.azimuth_deg * Math.PI) / 180;
      dot.position.set(Math.sin(az) * Math.cos(alt) * 1.6, Math.sin(alt) * 1.6, -Math.cos(az) * Math.cos(alt) * 1.6);
      this.scene.add(dot);
      this.targetMeshes.push(dot);
    });
    if (plan.moon) {
      const alt = (plan.moon.altitude_deg * Math.PI) / 180;
      const az = (plan.moon.azimuth_deg * Math.PI) / 180;
      this.moonMesh.position.set(Math.sin(az) * Math.cos(alt) * 2.2, Math.sin(alt) * 2.2, -Math.cos(az) * Math.cos(alt) * 2.2);
      const illum = plan.moon.illumination || 0;
      this.moonMesh.material.color.setHSL(0, 0, 0.6 + illum * 0.35);
    }
    if (plan.sun && this.sunLight) {
      const alt = (plan.sun.altitude_deg * Math.PI) / 180;
      const az = (plan.sun.azimuth_deg * Math.PI) / 180;
      this.sunLight.position.set(Math.sin(az) * Math.cos(alt) * 5, Math.sin(alt) * 5, -Math.cos(az) * Math.cos(alt) * 5);
    }
    if (plan.local_sidereal_time_deg !== undefined && this.starField) {
      this.starField.rotation.y = (plan.local_sidereal_time_deg * Math.PI) / 180;
    }
    this.render();
  }

  orbit(deltaAz, deltaEl) {
    this.camera.azimuth = (this.camera.azimuth + deltaAz + 360) % 360;
    this.camera.elevation = Math.min(85, Math.max(5, this.camera.elevation + deltaEl));
    this.render();
  }

  zoomBy(delta) {
    this.camera.zoom = Math.min(2.0, Math.max(0.6, this.camera.zoom + delta));
    this.render();
  }

  reset() {
    this.camera = { ...RESET };
    this.render();
  }

  render() {
    if (!this.ok) return;
    const { elevation, azimuth, zoom } = this.camera;
    const el = (elevation * Math.PI) / 180;
    const az = (azimuth * Math.PI) / 180;
    const dist = 2.4 / zoom;
    this.cameraObj.position.set(
      Math.sin(az) * Math.cos(el) * dist,
      Math.sin(el) * dist,
      -Math.cos(az) * Math.cos(el) * dist
    );
    this.cameraObj.lookAt(0, 0.2, 0);
    this.cameraObj.aspect = 1;
    this.cameraObj.updateProjectionMatrix();
    this.renderer.render(this.scene, this.cameraObj);
  }

  name(minute) {
    return `Sky dome: camera elevation ${Math.round(this.camera.elevation)} degrees, azimuth ${Math.round(this.camera.azimuth)} degrees, zoom ${this.camera.zoom.toFixed(1)}, night minute ${minute}`;
  }
}

let threePromise = null;

function awaitImport() {
  if (!threePromise) {
    threePromise = import("/vendor/three.module.js").catch(() => null);
  }
  return threePromise;
}
