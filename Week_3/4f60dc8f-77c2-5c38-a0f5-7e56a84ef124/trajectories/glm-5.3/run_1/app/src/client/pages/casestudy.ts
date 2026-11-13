import * as THREE from 'three';
import { hasWebGL, createScene, fit, addStudioLights, buildSubject, animateLoop, IDLE_TURN_SECONDS, EMBER, COBALT, VIOLET } from '../scenes';
import { api, el, isApiError } from '../shell';
import type { CaseStudy } from './home';

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountCaseStudy(path: string): void {
  const slug = path.split('/')[2] ?? '';
  const main = document.querySelector('main') as HTMLElement;
  main.innerHTML = '';
  main.id = 'main';
  const section = el('section', 'page-section');
  const grid = el('div', 'section-grid');
  const head = el('div', 'section-head');
  const clientLine = el('p', 'section-label');
  const title = el('h1', 'display-1');
  const summary = el('p', 'lede');
  const switchRow = el('p');
  const claySwitch = el('button', 'button secondary');
  claySwitch.setAttribute('role', 'switch');
  claySwitch.setAttribute('aria-checked', 'false');
  claySwitch.textContent = 'Clay view';
  switchRow.appendChild(claySwitch);
  head.append(clientLine, title, summary, switchRow);
  const stageCol = el('div', 'section-body');
  const figure = el('figure', 'scene-panel');
  figure.setAttribute('data-morph', '0.000');
  figure.setAttribute('data-idle', 'turning');
  figure.setAttribute('data-transition', 'done');
  figure.setAttribute('data-webgl', hasWebGL() ? 'on' : 'off');
  figure.style.height = '520px';
  stageCol.appendChild(figure);
  grid.append(head, stageCol);
  section.appendChild(grid);
  main.appendChild(section);

  void api<CaseStudy>('GET', `/api/work/${encodeURIComponent(slug)}`).then(({ status, json }) => {
    if (status !== 200 || isApiError(json)) {
      void import('./notfound').then(m => {
        main.innerHTML = '';
        m.mountNotFound();
      });
      return;
    }
    const study = json as CaseStudy;
    document.title = `${study.title} — Gloamwork`;
    title.textContent = study.title;
    clientLine.textContent = study.client;
    summary.textContent = study.summary;
    figure.setAttribute('aria-label', `${study.title} in 3D`);
    mountSubjectScene(figure, study, claySwitch);
  });
}

interface MorphMaterials {
  mesh: THREE.Mesh;
  base: { color: THREE.Color; roughness: number; metalness: number };
}

function mountSubjectScene(figure: HTMLElement, study: CaseStudy, claySwitch: HTMLElement): void {
  const handle = createScene(figure);
  if (!handle) {
    figure.setAttribute('data-webgl', 'off');
    return;
  }
  fit(handle, figure);
  const accent = study.scene.accent === 'violet' ? VIOLET : study.scene.accent === 'cobalt' ? COBALT : EMBER;
  const subject = buildSubject(study.scene.primitives, accent, false);
  handle.scene.add(subject);
  handle.camera.position.set(0, 0.8, 3.4);
  handle.camera.lookAt(0, 0.3, 0);
  addStudioLights(handle.scene);
  const materials: MorphMaterials[] = [];
  handle.scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.material instanceof THREE.MeshStandardMaterial) {
      materials.push({
        mesh,
        base: {
          color: mesh.material.color.clone(),
          roughness: mesh.material.roughness,
          metalness: mesh.material.metalness,
        },
      });
    }
  });
  let morph = 0;
  claySwitch.addEventListener('click', () => {
    const clay = claySwitch.getAttribute('aria-checked') !== 'true';
    claySwitch.setAttribute('aria-checked', String(clay));
    const target = clay ? 1 : 0;
    if (reducedMotion()) {
      morph = target;
      applyMorph(figure, materials, morph);
      handle.render();
      return;
    }
    const start = morph;
    const startTime = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - startTime) / 600);
      const eased = 1 - Math.pow(1 - t, 3);
      morph = start + (target - start) * eased;
      applyMorph(figure, materials, morph);
      if (t < 1) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  if (reducedMotion()) {
    figure.setAttribute('data-idle', 'still');
    handle.render();
  } else {
    animateLoop(() => {
      const time = performance.now() / 1000;
      subject.rotation.y = (time / IDLE_TURN_SECONDS) * Math.PI * 2;
      handle.render();
    });
  }
}

function applyMorph(figure: HTMLElement, materials: MorphMaterials[], t: number): void {
  figure.setAttribute('data-morph', t.toFixed(3));
  const clayColor = new THREE.Color(0x9a958c);
  for (const { mesh, base } of materials) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.copy(base.color).lerp(clayColor, t);
    material.roughness = base.roughness + (0.95 - base.roughness) * t;
    material.metalness = base.metalness * (1 - t);
    material.flatShading = t > 0.5;
    material.needsUpdate = true;
  }
}
