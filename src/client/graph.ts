/**
 * The Nebulae graph island (D45) — a zero-dependency 3D canvas renderer for
 * /admin/graph. Each collection is a tilted galactic disk wrapped in its own
 * haze; intra-collection relations are short local threads; cross-collection
 * relations lift out of the plane as arcing flight paths. Working light is the
 * accent ink; pop pink is spent ONLY on the hover/selection event (the
 * Overprint ration). The plate lives in an `rm-dark-act` subtree, so every
 * token resolved here is the gig-poster dark value in BOTH admin themes —
 * colors are read once at mount, no theme observer needed.
 *
 * Interaction: drag to orbit (pointer capture), slow auto-drift when idle,
 * hover → the neighborhood inks up + labels, click → open the item, legend
 * chips toggle collections. Reduced motion (self-gated, with a change
 * listener): no auto-drift, no twinkle, no free-running rAF — one static
 * frame, re-rendered only on interaction. The server-rendered summary region
 * is the accessible equivalent; this island only ever enhances.
 */

interface GraphNode {
  readonly id: string;
  readonly collection: string;
  readonly title: string;
  readonly status: 'draft' | 'published' | 'scheduled';
}

interface GraphPayload {
  readonly nodes: GraphNode[];
  readonly links: [number, number][];
  readonly collections: { slug: string; name: string }[];
  readonly truncated: boolean;
}

type Vec3 = [number, number, number];
type Projected = [number, number, number, number]; // x, y, scale, depth

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const TAU = Math.PI * 2;

/** Deterministic PRNG — layout must be stable across visits (seeded per node
 *  id), and free of Date/random so a given site always renders the same sky. */
function makeRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gauss(rnd: () => number): number {
  return rnd() + rnd() + rnd() - 1.5;
}

/** Resolve a design token to concrete RGB. The tokens are `light-dark()`
 *  values, which `getPropertyValue` returns UNRESOLVED (a function string the
 *  canvas parser rejects) — so resolve through a probe element inside the
 *  scope: the browser computes `color` against the subtree's `color-scheme`
 *  (the rm-dark-act), giving the audited dark value in both admin themes. */
function resolveColor(scope: Element, token: string, fallback: Rgb): Rgb {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  probe.style.display = 'none';
  scope.appendChild(probe);
  const raw = getComputedStyle(probe).color;
  probe.remove();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(raw);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : fallback;
}

function rgba(c: Rgb, a: number): string {
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

/** Soft radial glow sprite for a tint — drawn additively for the nebula look. */
function makeSprite(tint: Rgb): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.22, rgba(tint, 0.65));
    grad.addColorStop(0.6, rgba(tint, 0.14));
    grad.addColorStop(1, rgba(tint, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return c;
}

/** Orthonormal basis perpendicular to a cluster normal — the disk plane. */
function tangentBasis(n: Vec3): [Vec3, Vec3] {
  const up: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u: Vec3 = [
    n[1] * up[2] - n[2] * up[1],
    n[2] * up[0] - n[0] * up[2],
    n[0] * up[1] - n[1] * up[0],
  ];
  const lu = Math.hypot(u[0], u[1], u[2]) || 1;
  const un: Vec3 = [u[0] / lu, u[1] / lu, u[2] / lu];
  const v: Vec3 = [
    n[1] * un[2] - n[2] * un[1],
    n[2] * un[0] - n[0] * un[2],
    n[0] * un[1] - n[1] * un[0],
  ];
  return [un, v];
}

function mount(wrapper: HTMLElement): void {
  if (wrapper.dataset.graphMounted) return;
  const canvas = wrapper.querySelector<HTMLCanvasElement>('canvas');
  const dataEl = document.getElementById('rm-graph-data');
  if (!canvas || !dataEl?.textContent) return;
  wrapper.dataset.graphMounted = '1';

  let data: GraphPayload;
  try {
    data = JSON.parse(dataEl.textContent) as GraphPayload;
  } catch {
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx || !data.nodes.length) return;

  // ── palette (resolved once — the dark act makes these theme-invariant) ──
  const ink = resolveColor(wrapper, '--color-ink', { r: 242, g: 236, b: 221 });
  const pop = resolveColor(wrapper, '--color-pop', { r: 255, g: 72, b: 176 });
  const tintTokens = [
    '--color-accent',
    '--color-overlap',
    '--color-info',
    '--color-warning',
    '--color-ink',
  ];
  const collectionTint = new Map<string, Rgb>();
  data.collections.forEach((col, i) => {
    collectionTint.set(
      col.slug,
      resolveColor(wrapper, tintTokens[i % tintTokens.length], { r: 77, g: 216, b: 230 }),
    );
  });
  const sprites = new Map<string, HTMLCanvasElement>();
  const spriteFor = (tint: Rgb): HTMLCanvasElement => {
    const key = `${tint.r},${tint.g},${tint.b}`;
    let s = sprites.get(key);
    if (!s) {
      s = makeSprite(tint);
      sprites.set(key, s);
    }
    return s;
  };
  const popSprite = spriteFor(pop);

  // ── world build: cluster centroids on a sphere (golden spiral), disks ──
  const K = Math.max(data.collections.length, 1);
  const centroids = new Map<string, Vec3>();
  const normals = new Map<string, Vec3>();
  data.collections.forEach((col, i) => {
    const y = K === 1 ? 0 : 1 - (2 * (i + 0.5)) / K;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.399963; // golden angle
    const dir: Vec3 = [r * Math.cos(a), y * 0.72, r * Math.sin(a)];
    normals.set(col.slug, dir);
    centroids.set(col.slug, [dir[0] * 175, dir[1] * 175, dir[2] * 175]);
  });

  const byCollection = new Map<string, number>();
  data.nodes.forEach((n) => byCollection.set(n.collection, (byCollection.get(n.collection) ?? 0) + 1));
  const clusterSigma = new Map<string, number>();
  byCollection.forEach((count, slug) => {
    clusterSigma.set(slug, Math.min(84, 30 + Math.sqrt(count) * 7));
  });

  const deg = new Array<number>(data.nodes.length).fill(0);
  const adjacency = new Map<number, Set<number>>();
  for (const [a, b] of data.links) {
    deg[a]++;
    deg[b]++;
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  }

  const pts: Vec3[] = data.nodes.map((n) => {
    const rnd = makeRand(hashString(n.id));
    const c = centroids.get(n.collection) ?? [0, 0, 0];
    const dir = normals.get(n.collection) ?? [0, 1, 0];
    const [u, v] = tangentBasis(dir);
    const sigma = clusterSigma.get(n.collection) ?? 46;
    const a = gauss(rnd) * sigma;
    const b = gauss(rnd) * sigma;
    const w = gauss(rnd) * sigma * 0.28;
    return [
      c[0] + u[0] * a + v[0] * b + dir[0] * w,
      c[1] + u[1] * a + v[1] * b + dir[1] * w,
      c[2] + u[2] * a + v[2] * b + dir[2] * w,
    ];
  });

  // Cross-collection arcs: lifted quadratic beziers, sampled once in world space.
  const arcs = new Map<number, Vec3[]>();
  data.links.forEach(([a, b], i) => {
    if (data.nodes[a].collection === data.nodes[b].collection) return;
    const pa = pts[a];
    const pb = pts[b];
    const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
    const ml = Math.hypot(mid[0], mid[1], mid[2]) || 1;
    const lift = 1 + 110 / ml;
    const cp: Vec3 = [mid[0] * lift, mid[1] * lift, mid[2] * lift];
    const samples: Vec3[] = [];
    for (let s = 0; s <= 22; s++) {
      const t = s / 22;
      const it = 1 - t;
      samples.push([
        it * it * pa[0] + 2 * it * t * cp[0] + t * t * pb[0],
        it * it * pa[1] + 2 * it * t * cp[1] + t * t * pb[1],
        it * it * pa[2] + 2 * it * t * cp[2] + t * t * pb[2],
      ]);
    }
    arcs.set(i, samples);
  });

  // Background starfield on a far shell.
  const stars: { p: Vec3; tw: number }[] = [];
  {
    const rnd = makeRand(424242);
    for (let i = 0; i < 200; i++) {
      const u = rnd() * 2 - 1;
      const a = rnd() * TAU;
      const r = 620 + rnd() * 320;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      stars.push({ p: [r * s * Math.cos(a), r * u * 0.72, r * s * Math.sin(a)], tw: rnd() });
    }
  }

  // ── view state ──
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceQuery.matches;
  let theta = 0.55;
  let phi = -0.24;
  const F = 780;
  let dragging = false;
  let dragMoved = 0;
  let lastX = 0;
  let lastY = 0;
  let mouse: [number, number] | null = null;
  let focus = -1;
  let running = true;
  let needsFrame = true;
  const hidden = new Set<string>();

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let W = 0;
  let H = 0;
  let cx = 0;
  let cy = 0;
  function resize(): void {
    const w = canvas!.clientWidth;
    const h = canvas!.clientHeight;
    if (w === W && h === H) return;
    W = w;
    H = h;
    cx = w / 2;
    cy = h / 2;
    canvas!.width = Math.round(w * dpr);
    canvas!.height = Math.round(h * dpr);
    needsFrame = true;
  }

  const P = { ct: 1, st: 0, cp: 1, sp: 0 };
  function setAngles(): void {
    P.ct = Math.cos(theta);
    P.st = Math.sin(theta);
    P.cp = Math.cos(phi);
    P.sp = Math.sin(phi);
  }
  function project(p: Vec3, out: Projected): Projected {
    const X = p[0] * P.ct + p[2] * P.st;
    const Z = -p[0] * P.st + p[2] * P.ct;
    const Y = p[1] * P.cp + Z * P.sp;
    const Z2 = -p[1] * P.sp + Z * P.cp;
    const s = F / (F + Z2);
    out[0] = cx + X * s;
    out[1] = cy + Y * s;
    out[2] = s;
    out[3] = Z2;
    return out;
  }

  const np: Projected[] = data.nodes.map(() => [0, 0, 0, 0]);
  const tmp: Projected = [0, 0, 0, 0];
  const depthAlpha = (s: number): number => Math.max(0.14, Math.min(1, (s - 0.62) * 1.9));
  const visible = (i: number): boolean => !hidden.has(data.nodes[i].collection);

  function render(t: number): void {
    if (!ctx) return;
    resize();
    setAngles();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // stars
    for (const st of stars) {
      project(st.p, tmp);
      if (tmp[3] < -F * 0.6) continue;
      const twinkle = reduced ? 0.6 : 0.45 + 0.35 * Math.sin(t * 0.0011 + st.tw * 40);
      ctx.fillStyle = rgba(ink, 0.05 + 0.14 * twinkle);
      ctx.fillRect(tmp[0], tmp[1], 1.1, 1.1);
    }

    // nebula haze per visible cluster
    ctx.globalCompositeOperation = 'lighter';
    for (const col of data.collections) {
      if (hidden.has(col.slug)) continue;
      const c = centroids.get(col.slug);
      const tint = collectionTint.get(col.slug);
      if (!c || !tint) continue;
      project(c, tmp);
      const r = ((clusterSigma.get(col.slug) ?? 46) + 44) * tmp[2];
      ctx.globalAlpha = 0.32;
      ctx.drawImage(spriteFor(tint), tmp[0] - r, tmp[1] - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // project nodes + hover pick
    for (let i = 0; i < pts.length; i++) project(pts[i], np[i]);
    let newFocus = -1;
    if (mouse) {
      let best = 676; // 26px pick radius — generous enough for sparse skies
      for (let i = 0; i < np.length; i++) {
        if (!visible(i)) continue;
        const dx = np[i][0] - mouse[0];
        const dy = np[i][1] - mouse[1];
        const d2 = dx * dx + dy * dy;
        if (d2 < best) {
          best = d2;
          newFocus = i;
        }
      }
    }
    focus = newFocus;
    const hasFocus = focus >= 0;
    const near = hasFocus ? adjacency.get(focus) : undefined;
    canvas!.style.cursor = hasFocus ? 'pointer' : dragging ? 'grabbing' : 'grab';

    // edges (hot ones drawn after nodes, on top)
    ctx.lineWidth = 1;
    data.links.forEach(([a, b], i) => {
      if (!visible(a) || !visible(b)) return;
      const hot = hasFocus && (a === focus || b === focus);
      if (hot) return;
      const arc = arcs.get(i);
      const baseAlpha = (arc ? 0.16 : 0.1) * ((np[a][2] + np[b][2]) / 2) * (hasFocus ? 0.35 : 1);
      const tint = arc ? collectionTint.get(data.nodes[a].collection) : undefined;
      ctx.strokeStyle = rgba(tint ?? { r: 120, g: 190, b: 215 }, baseAlpha);
      ctx.beginPath();
      if (arc) {
        for (let s = 0; s < arc.length; s++) {
          project(arc[s], tmp);
          if (s === 0) ctx.moveTo(tmp[0], tmp[1]);
          else ctx.lineTo(tmp[0], tmp[1]);
        }
      } else {
        ctx.moveTo(np[a][0], np[a][1]);
        ctx.lineTo(np[b][0], np[b][1]);
      }
      ctx.stroke();
    });

    // nodes back-to-front, additive glow
    const order = data.nodes.map((_, i) => i).filter(visible);
    order.sort((x, y) => np[y][3] - np[x][3]);
    ctx.globalCompositeOperation = 'lighter';
    for (const i of order) {
      const p = np[i];
      const isFocus = i === focus;
      const isHot = !!near?.has(i);
      const r = (2.1 + Math.min(deg[i], 9) * 0.5) * p[2];
      const alpha = depthAlpha(p[2]) * (hasFocus && !isFocus && !isHot ? 0.22 : 1);
      const sprite = isFocus || isHot ? popSprite : spriteFor(collectionTint.get(data.nodes[i].collection) ?? ink);
      const glowR = r * (isFocus ? 5.2 : isHot ? 4.4 : 3.1);
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, p[0] - glowR, p[1] - glowR, glowR * 2, glowR * 2);
      ctx.fillStyle = isFocus ? 'rgba(255,255,255,0.98)' : rgba(ink, 0.9);
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(0.8, r * 0.55), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // hot edges on top
    if (hasFocus) {
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = rgba(pop, 0.85);
      data.links.forEach(([a, b], i) => {
        if (a !== focus && b !== focus) return;
        if (!visible(a) || !visible(b)) return;
        const arc = arcs.get(i);
        ctx.beginPath();
        if (arc) {
          for (let s = 0; s < arc.length; s++) {
            project(arc[s], tmp);
            if (s === 0) ctx.moveTo(tmp[0], tmp[1]);
            else ctx.lineTo(tmp[0], tmp[1]);
          }
        } else {
          ctx.moveTo(np[a][0], np[a][1]);
          ctx.lineTo(np[b][0], np[b][1]);
        }
        ctx.stroke();
      });
    }

    // labels: the focused neighborhood, else high-degree foreground stars
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = '10px ui-monospace, "SF Mono", Menlo, monospace';
    ctx.textAlign = 'center';
    const label = (i: number, strong: boolean): void => {
      const p = np[i];
      const text =
        data.nodes[i].title.length > 26 ? `${data.nodes[i].title.slice(0, 25)}…` : data.nodes[i].title;
      ctx.fillStyle = rgba(ink, strong ? 0.95 : 0.5 * depthAlpha(p[2]));
      ctx.fillText(text, p[0], p[1] - 10 - (2.1 + Math.min(deg[i], 9) * 0.5) * p[2]);
    };
    if (hasFocus) {
      near?.forEach((i) => {
        if (visible(i)) label(i, false);
      });
      label(focus, true);
    } else {
      for (let i = 0; i < np.length; i++) {
        if (visible(i) && deg[i] >= 5 && np[i][2] > 1.02) label(i, false);
      }
    }
  }

  function frame(t: number): void {
    if (running) {
      const animating = !reduced && !dragging && !mouse;
      if (animating) theta += 0.0016;
      if (animating || needsFrame || mouse || dragging) {
        needsFrame = false;
        render(t);
      }
    }
    requestAnimationFrame(frame);
  }

  // ── interaction ──
  canvas.addEventListener('pointerdown', (ev) => {
    dragging = true;
    dragMoved = 0;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener('pointermove', (ev) => {
    const rect = canvas.getBoundingClientRect();
    mouse = [ev.clientX - rect.left, ev.clientY - rect.top];
    if (dragging) {
      dragMoved += Math.abs(ev.clientX - lastX) + Math.abs(ev.clientY - lastY);
      theta += (ev.clientX - lastX) * 0.005;
      phi = Math.max(-1.2, Math.min(1.2, phi + (ev.clientY - lastY) * 0.004));
      lastX = ev.clientX;
      lastY = ev.clientY;
    }
    needsFrame = true;
  });
  canvas.addEventListener('pointerup', () => {
    if (dragging && dragMoved < 6 && focus >= 0) {
      const n = data.nodes[focus];
      window.location.assign(`/admin/c/${n.collection}/${n.id}`);
    }
    dragging = false;
    needsFrame = true;
  });
  canvas.addEventListener('pointercancel', () => {
    dragging = false;
  });
  canvas.addEventListener('pointerleave', () => {
    mouse = null;
    if (!dragging) focus = -1;
    needsFrame = true;
  });

  // Legend chips toggle collection visibility; swatches take the real tints.
  wrapper.querySelectorAll<HTMLButtonElement>('[data-graph-toggle]').forEach((btn) => {
    const slug = btn.dataset.graphToggle ?? '';
    const swatch = btn.querySelector<HTMLElement>('[data-graph-swatch]');
    const tint = collectionTint.get(slug);
    if (swatch && tint) swatch.style.backgroundColor = rgba(tint, 1);
    btn.addEventListener('click', () => {
      const off = hidden.has(slug);
      if (off) hidden.delete(slug);
      else hidden.add(slug);
      btn.setAttribute('aria-pressed', off ? 'true' : 'false');
      needsFrame = true;
    });
  });

  const onReduceChange = (): void => {
    reduced = reduceQuery.matches;
    needsFrame = true;
  };
  if (typeof reduceQuery.addEventListener === 'function') {
    reduceQuery.addEventListener('change', onReduceChange);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(
      (entries) => {
        running = entries[0].isIntersecting;
        needsFrame = true;
      },
      { rootMargin: '80px' },
    ).observe(canvas);
  }
  window.addEventListener('resize', () => {
    needsFrame = true;
  });

  requestAnimationFrame(frame);
}

document.querySelectorAll<HTMLElement>('[data-graph]').forEach(mount);
