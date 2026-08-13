(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;
  const body = document.body;
  const stage = $("stage");
  const coin = $("coin");
  const coinHit = $("coin-hit");
  const shadow = $("coin-shadow");
  const hint = $("hint");
  const charge = $("charge");
  const chargeBar = charge.querySelector("i");
  const slingSvg = $("sling-svg");
  const slingBand = $("sling-band");
  const titlecard = $("titlecard");
  const titleKicker = $("title-kicker");
  const titleMark = $("title-mark");
  const titleLine = $("title-line");
  const comboEl = $("combo");
  const seal = $("seal");
  const historyEl = $("history");
  const statTotal = $("stat-total");
  const statRatio = $("stat-ratio");
  const fxCanvas = $("fx");
  const fx = fxCanvas.getContext("2d");
  const bgm = $("bgm");
  const menuFab = $("menu-fab");
  const sheet = $("sheet");
  const sheetMask = $("sheet-mask");
  const cursorDot = $("cursor-dot");
  const cursorRing = $("cursor-ring");
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = matchMedia("(pointer: coarse)").matches;

  const HINT = {
    sling: "按住拉开 · 松手抛出",
    slap: "按住蓄力 · 松手弹起",
    fling: "抓住甩出 · 松手飞出",
  };
  const LINES = {
    heads: [
      "所念之事，正向高处生长。",
      "先迈一步，答案会在路上出现。",
      "抛起见顶。此刻适合出发。",
      "星芒朝上，好运已经接住了你。",
    ],
    tails: [
      "且慢，且看，且留白。",
      "安静也是一种答案。",
      "月相落定，先听清楚，再作回答。",
      "换个方向，也会看见光。",
    ],
  };
  const KICKER = { heads: "HEADS · LUCKY SIDE", tails: "TAILS · QUIET SIDE" };
  const MARK = { heads: "TOP", tails: "月" };

  const SKINS = ["stage", "arcade", "crystal", "paper"];
  const THROWS = ["sling", "slap", "fling"];

  let state = "idle";
  let pose = { x: 0, y: 0, rx: 8, ry: -6, rz: 0, scale: 1 };
  let face = "heads";
  let flight = null;
  let pointer = null;
  let samples = [];
  let particles = [];
  let rings = [];
  let stats = { total: 0, heads: 0, tails: 0 };
  let history = [];
  let streak = 0;
  let lastSide = null;
  let soundOn = true;
  let musicWanted = false;
  let audio = null;
  let tension = null;
  let tracks = [];
  let trackIndex = 0;
  let cursor = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };
  let lastTs = performance.now();

  try {
    soundOn = localStorage.getItem("pyb-v2-sound") !== "0";
    musicWanted = localStorage.getItem("pyb-v2-music") === "1";
    const saved = JSON.parse(localStorage.getItem("pyb-v2-history") || "[]");
    if (Array.isArray(saved)) history = saved.slice(0, 8);
  } catch (_) {}

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const hang = (t) => {
    const k = .72;
    return t < .5 ? Math.pow(2 * t, k) / 2 : 1 - Math.pow(2 - 2 * t, k) / 2;
  };
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const hypot = Math.hypot;

  function currentSkin() { return root.dataset.skin || "stage"; }
  function currentThrow() { return root.dataset.throw || "sling"; }

  function restCenter() {
    const r = stage.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function stageXY(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function applyPose(now) {
    const idle = state === "idle";
    const bob = idle && !reduced ? Math.sin(now * .00155) * 8 : 0;
    const swayY = idle && !reduced ? Math.sin(now * .00105) * 6 : 0;
    const rx = idle && !reduced ? 8 + Math.sin(now * .0009) * 2 : pose.rx;
    const ry = pose.ry + swayY;
    coin.style.transform = `translate3d(${pose.x}px,${pose.y + bob}px,0) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${pose.rz}deg) scale(${pose.scale})`;
    const lift = Math.max(0, -pose.y + bob);
    const wide = 168 * (0.88 + Math.min(lift, 240) / 420);
    shadow.style.width = `${wide}px`;
    shadow.style.opacity = String(clamp(0.5 - lift / 720, .1, .55));
    shadow.style.transform = `translateX(calc(-50% + ${pose.x * .35}px)) scaleY(${clamp(1 - lift / 500, .45, 1)})`;
  }

  function setButtons(attr, value) {
    document.querySelectorAll(`button[${attr}]`).forEach((btn) => {
      btn.setAttribute("aria-checked", btn.getAttribute(attr) === value ? "true" : "false");
    });
  }

  function setSkin(name) {
    if (!SKINS.includes(name)) return;
    root.dataset.skin = name;
    try { localStorage.setItem("pyb-v2-skin", name); } catch (_) {}
    setButtons("data-skin", name);
    const theme = getComputedStyle(root).getPropertyValue("--theme").trim();
    if (themeMeta && theme) themeMeta.content = theme;
    syncCursor();
  }

  function setThrow(name) {
    if (!THROWS.includes(name)) return;
    root.dataset.throw = name;
    try { localStorage.setItem("pyb-v2-throw", name); } catch (_) {}
    setButtons("data-throw", name);
    hint.textContent = HINT[name];
  }

  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem("pyb-v2-sound", on ? "1" : "0"); } catch (_) {}
    $("sound-btn").setAttribute("aria-pressed", on ? "true" : "false");
    $("sound-btn-m").setAttribute("aria-pressed", on ? "true" : "false");
    if (!on) stopTension();
  }

  function setMusic(on) {
    musicWanted = on;
    try { localStorage.setItem("pyb-v2-music", on ? "1" : "0"); } catch (_) {}
    $("music-btn").setAttribute("aria-pressed", on ? "true" : "false");
    $("music-btn-m").setAttribute("aria-pressed", on ? "true" : "false");
    if (on) playBgm();
    else { bgm.pause(); }
  }

  function formatNum(n) {
    return Number(n).toLocaleString("zh-CN");
  }

  function renderStats() {
    statTotal.textContent = stats.total ? formatNum(stats.total) : "—";
    const ratio = stats.total ? Math.round((stats.heads / stats.total) * 100) : 0;
    statRatio.textContent = stats.total ? `${ratio}%` : "—";
  }

  function renderHistory() {
    historyEl.replaceChildren(...history.map((side) => {
      const i = document.createElement("i");
      i.className = side;
      i.title = side === "heads" ? "TOP" : "月";
      return i;
    }));
  }

  function applyStats(data) {
    stats = {
      total: Number(data.total) || 0,
      heads: Number(data.heads) || 0,
      tails: Number(data.tails) || 0,
    };
    renderStats();
  }

  async function saveResult(side) {
    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side }),
      });
      const payload = await res.json();
      if (payload && payload.ok && payload.data) applyStats(payload.data);
      else throw new Error("bad");
    } catch (_) {
      applyStats({ ...stats, total: stats.total + 1, [side]: (stats[side] || 0) + 1 });
    }
  }

  function pushHistory(side) {
    history.push(side);
    if (history.length > 8) history.shift();
    try { localStorage.setItem("pyb-v2-history", JSON.stringify(history)); } catch (_) {}
    renderHistory();
  }

  function targetRy(side, from, spins, dir) {
    const want = side === "heads" ? 0 : 180;
    const sign = dir >= 0 ? 1 : -1;
    const travel = Math.abs(spins) * 360 * sign;
    let end = from + travel;
    const mod = ((end % 360) + 360) % 360;
    let fix = want - mod;
    if (sign > 0 && fix < 0) fix += 360;
    if (sign < 0 && fix > 0) fix -= 360;
    return end + fix;
  }

  function chooseSide() {
    return Math.random() < .5 ? "heads" : "tails";
  }

  function showTitle(side, combo) {
    titleKicker.textContent = combo >= 3 ? `COMBO ${combo}` : KICKER[side];
    titleMark.textContent = MARK[side];
    titleLine.textContent = pick(LINES[side]);
    titlecard.classList.remove("show");
    void titlecard.offsetWidth;
    titlecard.classList.add("show");
    if (combo >= 3) {
      comboEl.innerHTML = `COMBO <b>${combo}</b>`;
      comboEl.classList.remove("show");
      void comboEl.offsetWidth;
      comboEl.classList.add("show");
    }
    if (currentSkin() === "arcade") {
      seal.textContent = side === "heads" ? "顶" : "月";
      seal.classList.remove("show");
      void seal.offsetWidth;
      seal.classList.add("show");
    }
  }

  function burst(side) {
    const rect = coin.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const skin = currentSkin();
    const n = skin === "crystal" ? 34 : 26;
    const palette = {
      stage: side === "heads" ? ["#f6e7b0", "#e2b94d", "#fff6d0", "#8a6414"] : ["#c8d4f8", "#8da4e0", "#e8eefc", "#4a5888"],
      arcade: ["#f0c040", "#e04030", "#ffe08a", "#ff8060"],
      crystal: ["#9ad8ff", "#c090ff", "#6ae0d0", "#ffffff"],
      paper: ["#2a2014", "#8a3020", "#b8860b", "#5a4a30"],
    }[skin];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 280;
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: 1,
        decay: .008 + Math.random() * .016,
        r: skin === "paper" ? 1.2 + Math.random() * 2.4 : 1 + Math.random() * 2.8,
        color: palette[(Math.random() * palette.length) | 0],
        kind: skin === "crystal" ? "shard" : skin === "paper" ? "ink" : "spark",
        rot: Math.random() * Math.PI,
        spin: (Math.random() - .5) * 8,
      });
    }
    rings.push({ x, y, r: 12, max: 160, life: 1, color: palette[0] });
    if (skin === "crystal") rings.push({ x, y, r: 8, max: 240, life: 1, color: palette[2] });
  }

  function drawFx(dt) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (fxCanvas.width !== innerWidth * dpr || fxCanvas.height !== innerHeight * dpr) {
      fxCanvas.width = innerWidth * dpr;
      fxCanvas.height = innerHeight * dpr;
      fxCanvas.style.width = innerWidth + "px";
      fxCanvas.style.height = innerHeight + "px";
      fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    fx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = rings.length - 1; i >= 0; i--) {
      const g = rings[i];
      g.life -= dt * 1.4;
      g.r += (g.max - g.r) * (1 - Math.exp(-dt * 6));
      if (g.life <= 0) { rings.splice(i, 1); continue; }
      fx.beginPath();
      fx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      fx.strokeStyle = g.color;
      fx.globalAlpha = Math.max(0, g.life) * .45;
      fx.lineWidth = 1.4;
      fx.stroke();
    }
    fx.globalAlpha = 1;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 520 * dt;
      p.vx *= .985;
      p.vy *= .985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.life -= p.decay + dt * .35;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      fx.save();
      fx.translate(p.x, p.y);
      fx.rotate(p.rot);
      fx.globalAlpha = Math.max(0, p.life);
      fx.fillStyle = p.color;
      if (p.kind === "shard") {
        fx.beginPath();
        fx.moveTo(0, -p.r * 2.4);
        fx.lineTo(p.r, p.r * 1.4);
        fx.lineTo(-p.r, p.r * 1.4);
        fx.closePath();
        fx.fill();
      } else if (p.kind === "ink") {
        fx.beginPath();
        fx.ellipse(0, 0, p.r * 1.6, p.r * (0.7 + (1 - p.life)), 0, 0, Math.PI * 2);
        fx.fill();
      } else {
        fx.beginPath();
        fx.arc(0, 0, p.r, 0, Math.PI * 2);
        fx.fill();
      }
      fx.restore();
    }
    fx.globalAlpha = 1;
  }

  function ensureAudio() {
    if (audio) {
      if (audio.ctx.state === "suspended") audio.ctx.resume();
      return audio;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = .72;
    const delay = ctx.createDelay();
    delay.delayTime.value = .09;
    const fb = ctx.createGain();
    fb.gain.value = .16;
    const wet = ctx.createGain();
    wet.gain.value = .14;
    delay.connect(fb);
    fb.connect(delay);
    master.connect(ctx.destination);
    master.connect(delay);
    delay.connect(wet);
    wet.connect(ctx.destination);
    const n = ctx.createBuffer(1, ctx.sampleRate * .4, ctx.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    audio = { ctx, master, noise: n };
    return audio;
  }

  function tone(freq, dur, type, gain, atk, dest) {
    const a = ensureAudio();
    if (!a || !soundOn) return;
    const t = a.ctx.currentTime;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + atk);
    g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    o.connect(g);
    g.connect(dest || a.master);
    o.start(t);
    o.stop(t + dur + .02);
    return o;
  }

  function noiseBurst(dur, gain, hp, lp) {
    const a = ensureAudio();
    if (!a || !soundOn) return;
    const t = a.ctx.currentTime;
    const src = a.ctx.createBufferSource();
    src.buffer = a.noise;
    const filter = a.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = hp;
    filter.Q.value = .7;
    const g = a.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(.0008, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(a.master);
    src.start(t);
    src.stop(t + dur);
  }

  function playLaunch(strength) {
    tone(180 + strength * 80, .18, "sine", .05, .01);
    noiseBurst(.22, .09 + strength * .06, 900 + strength * 400, 2000);
  }

  function playLand(side) {
    const base = side === "heads" ? 320 : 260;
    tone(base, .28, "triangle", .11, .005);
    tone(base * 1.52, .22, "sine", .05, .005);
    tone(base * .5, .18, "sine", .04, .005);
    noiseBurst(.12, .08, 1800, 4000);
    const skin = currentSkin();
    if (skin === "arcade") {
      tone(140, .16, "square", .04, .002);
      noiseBurst(.08, .07, 600, 1200);
    } else if (skin === "crystal") {
      tone(880, .35, "sine", .05, .002);
      tone(1320, .28, "sine", .03, .002);
    } else if (skin === "paper") {
      noiseBurst(.1, .06, 400, 900);
    }
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function startTension() {
    const a = ensureAudio();
    if (!a || !soundOn || tension) return;
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 140;
    g.gain.value = .03;
    o.connect(g);
    g.connect(a.master);
    o.start();
    tension = { o, g };
  }

  function updateTension(pull) {
    if (!tension) return;
    const t = audio.ctx.currentTime;
    tension.o.frequency.setTargetAtTime(140 + pull * 220, t, .04);
    tension.g.gain.setTargetAtTime(.018 + pull * .04, t, .04);
  }

  function stopTension() {
    if (!tension) return;
    try {
      const t = audio.ctx.currentTime;
      tension.g.gain.exponentialRampToValueAtTime(.0008, t + .08);
      tension.o.stop(t + .1);
    } catch (_) {}
    tension = null;
  }

  function playBgm() {
    if (!musicWanted || !tracks.length) return;
    ensureAudio();
    const item = tracks[trackIndex % tracks.length];
    if (!item || !item.url) return;
    if (bgm.src && !bgm.ended && !bgm.paused && bgm.dataset.url === item.url) {
      bgm.play().catch(() => {});
      return;
    }
    bgm.src = item.url;
    bgm.dataset.url = item.url;
    bgm.volume = .28;
    bgm.play().catch(() => {});
  }

  function drawSling(px, py) {
    const rest = restCenter();
    const origin = stageXY(rest.x, rest.y);
    const span = coinHit.getBoundingClientRect().width * .46;
    const left = { x: origin.x - span, y: origin.y + span * .38 };
    const right = { x: origin.x + span, y: origin.y + span * .38 };
    const c = stageXY(px, py);
    slingBand.setAttribute("d", `M ${left.x} ${left.y} Q ${c.x} ${c.y} ${right.x} ${right.y}`);
  }

  function clearSling() {
    slingBand.setAttribute("d", "");
  }

  function beginAim(e) {
    if (state !== "idle" && state !== "settled") return;
    if (e.button != null && e.button !== 0) return;
    const mode = currentThrow();
    const rest = restCenter();
    const near = hypot(e.clientX - rest.x, e.clientY - rest.y) < (coinHit.getBoundingClientRect().width * .72);
    if (mode !== "slap" && !near) return;
    ensureAudio();
    e.preventDefault();
    pointer = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      t0: performance.now(),
    };
    samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    state = "aiming";
    body.classList.add("is-aiming");
    coin.classList.add("live");
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    if (mode === "sling") startTension();
    if (mode === "slap") {
      charge.hidden = false;
      chargeBar.style.width = "0%";
    }
  }

  function moveAim(e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (samples.length > 6) samples.shift();
    const mode = currentThrow();
    const rest = restCenter();
    if (mode === "sling") {
      let dx = e.clientX - rest.x;
      let dy = e.clientY - rest.y;
      const mag = hypot(dx, dy);
      const max = 168;
      if (mag > max) {
        dx *= max / mag;
        dy *= max / mag;
      }
      pose.x = dx;
      pose.y = dy;
      pose.rx = 12 + dy * .04;
      pose.rz = dx * .04;
      pose.scale = 1;
      drawSling(rest.x + dx, rest.y + dy);
      updateTension(hypot(dx, dy) / max);
    } else if (mode === "fling") {
      pose.x = e.clientX - rest.x;
      pose.y = e.clientY - rest.y;
      pose.rx = 10;
    } else {
      const hold = clamp((performance.now() - pointer.t0) / 780, 0, 1);
      pose.scale = 1 - hold * .08;
      pose.y = hold * 10;
      pose.rx = 14;
      chargeBar.style.width = `${hold * 100}%`;
    }
  }

  function endAim(e) {
    if (!pointer || (e && e.pointerId !== pointer.id)) return;
    const mode = currentThrow();
    const rest = restCenter();
    const held = performance.now() - pointer.t0;
    body.classList.remove("is-aiming");
    charge.hidden = true;
    stopTension();
    clearSling();

    if (mode === "sling") {
      const dx = pose.x;
      const dy = pose.y;
      const mag = hypot(dx, dy);
      if (mag < 18 && held < 180) {
        launchSlap(.48);
      } else {
        launchSling(dx, dy, clamp(mag / 168, .28, 1));
      }
    } else if (mode === "fling") {
      let vx = 0, vy = 0;
      if (samples.length >= 2) {
        const a = samples[0];
        const b = samples[samples.length - 1];
        const dt = Math.max(8, b.t - a.t);
        vx = (b.x - a.x) / dt;
        vy = (b.y - a.y) / dt;
      }
      if (hypot(vx, vy) < .12) launchSlap(.42);
      else launchFling(vx, vy);
    } else {
      launchSlap(clamp(held / 780, .28, 1));
    }
    pointer = null;
  }

  function launchSling(dx, dy, strength) {
    const side = chooseSide();
    const start = { x: dx, y: dy, ry: pose.ry, rx: pose.rx, rz: pose.rz };
    const apexY = Math.min(dy, 0) - (150 + strength * 240);
    const apexX = dx * .35;
    const spins = 2 + Math.round(strength * 5);
    const endRy = targetRy(side, pose.ry, spins, dx <= 0 ? 1 : -1);
    startFlight({
      side, kind: "sling", strength, start,
      apex: { x: apexX, y: apexY },
      endRy,
      dur: 880 + strength * 720,
    });
  }

  function launchSlap(strength) {
    const side = chooseSide();
    const start = { x: pose.x, y: pose.y, ry: pose.ry, rx: pose.rx, rz: 0 };
    const apexY = -(150 + strength * 260);
    const apexX = (Math.random() - .5) * 36;
    const spins = 3 + Math.round(strength * 4);
    const endRy = targetRy(side, pose.ry, spins, 1);
    startFlight({
      side, kind: "slap", strength, start,
      apex: { x: apexX, y: apexY },
      endRy,
      dur: 760 + strength * 480,
    });
  }

  function launchFling(vx, vy) {
    const side = chooseSide();
    const speed = hypot(vx, vy);
    const strength = clamp(speed / 1.6, .3, 1);
    const spins = 2 + Math.round(strength * 6);
    const dir = vx >= 0 ? 1 : -1;
    startFlight({
      side, kind: "fling", strength,
      start: { x: pose.x, y: pose.y, ry: pose.ry, rx: 10, rz: 0 },
      vel: { x: vx * 920, y: vy * 920 },
      endRy: targetRy(side, pose.ry, spins, dir),
      startRy: pose.ry,
      bounces: 0,
      dur: 1500,
    });
  }

  function startFlight(cfg) {
    if (reduced) {
      land(cfg.side, cfg.strength || .5);
      pose.ry = cfg.side === "heads" ? 0 : 180;
      pose.x = 0; pose.y = 0; pose.rx = 8; pose.rz = 0; pose.scale = 1;
      return;
    }
    face = cfg.side;
    flight = { ...cfg, t0: performance.now() };
    state = "flying";
    body.classList.add("is-busy");
    coin.classList.add("live");
    playLaunch(cfg.strength || .5);
  }

  function releaseIdle() {
    coin.classList.remove("live");
  }

  function land(side, strength) {
    pose.x = 0;
    pose.y = 0;
    pose.rx = 8;
    pose.rz = 0;
    pose.scale = 1;
    pose.ry = side === "heads" ? 0 : 180;
    face = side;
    flight = null;
    state = "settled";
    body.classList.remove("is-busy", "is-aiming");
    body.classList.add("is-impact");
    root.classList.add("is-flash");
    setTimeout(() => {
      body.classList.remove("is-impact");
      root.classList.remove("is-flash");
    }, 420);
    if (lastSide === side) streak += 1;
    else streak = 1;
    lastSide = side;
    showTitle(side, streak);
    burst(side);
    playLand(side);
    pushHistory(side);
    saveResult(side);
    setTimeout(() => {
      if (state === "settled") {
        state = "idle";
        releaseIdle();
      }
    }, 420);
  }

  function stepFlight(now, dt) {
    if (!flight) return;
    const f = flight;
    const t = (now - f.t0) / f.dur;

    if (f.kind === "fling") {
      f.vel.y += 1860 * dt;
      f.vel.x *= Math.pow(.78, dt * 4);
      f.vel.y *= Math.pow(.9, dt * 2);
      pose.x += f.vel.x * dt;
      pose.y += f.vel.y * dt;
      const boundX = Math.min(innerWidth, 720) * .36;
      if (pose.x > boundX) { pose.x = boundX; f.vel.x *= -.42; f.bounces += 1; }
      if (pose.x < -boundX) { pose.x = -boundX; f.vel.x *= -.42; f.bounces += 1; }
      if (pose.y > 48) { pose.y = 48; f.vel.y *= -.38; f.vel.x *= .72; f.bounces += 1; }
      const p = clamp(t, 0, 1);
      pose.ry = lerp(f.startRy, f.endRy, easeOut(Math.min(1, t * 1.15)));
      pose.rx = 16 + Math.sin(t * Math.PI * 3) * 10;
      pose.rz = pose.x * .03;
      const pull = t > .42 || f.bounces >= 2 ? clamp((t - .42) / .4, 0, 1) : 0;
      if (pull) {
        pose.x = lerp(pose.x, 0, easeOut(pull) * .18);
        pose.y = lerp(pose.y, 0, easeOut(pull) * .18);
        f.vel.x *= 1 - pull * .08;
        f.vel.y *= 1 - pull * .06;
      }
      const parked = hypot(pose.x, pose.y) < 10 && hypot(f.vel.x, f.vel.y) < 90 && t > .35;
      if (t >= 1 || parked) land(f.side, f.strength);
      return;
    }

    const u = hang(clamp(t, 0, 1));
    const omt = 1 - u;
    pose.x = omt * omt * f.start.x + 2 * omt * u * f.apex.x;
    pose.y = omt * omt * f.start.y + 2 * omt * u * f.apex.y;
    pose.ry = lerp(f.start.ry, f.endRy, easeInOut(clamp(t, 0, 1)));
    pose.rx = lerp(f.start.rx, 8, u) + Math.sin(t * Math.PI * 2.2) * (1 - t) * 14;
    pose.rz = lerp(f.start.rz || 0, 0, u);
    pose.scale = 1;
    if (t >= 1) land(f.side, f.strength);
  }

  function loop(now) {
    const dt = clamp((now - lastTs) / 1000, 0, .04);
    lastTs = now;
    if (state === "flying") stepFlight(now, dt);
    else if (state === "aiming" && currentThrow() === "slap" && pointer) {
      const hold = clamp((now - pointer.t0) / 780, 0, 1);
      pose.scale = 1 - hold * .08;
      pose.y = hold * 10;
      chargeBar.style.width = `${hold * 100}%`;
    }
    applyPose(now);
    drawFx(dt);
    if (root.classList.contains("has-cursor")) {
      cursor.x = lerp(cursor.x, cursor.tx, .28);
      cursor.y = lerp(cursor.y, cursor.ty, .28);
      cursorDot.style.transform = `translate3d(${cursor.x}px,${cursor.y}px,0)`;
      cursorRing.style.transform = `translate3d(${cursor.x}px,${cursor.y}px,0)`;
    }
    requestAnimationFrame(loop);
  }

  function autoThrow() {
    if (state !== "idle" && state !== "settled") return;
    const mode = currentThrow();
    pose.x = 0; pose.y = 0;
    if (mode === "sling") launchSling(0, 92, .62);
    else if (mode === "fling") launchFling((Math.random() - .5) * .8, -1.1);
    else launchSlap(.62);
  }

  function syncCursor() {
    const skin = currentSkin();
    const allow = !coarse && (skin === "stage" || skin === "crystal");
    root.classList.toggle("has-cursor", allow);
  }

  function openSheet(open) {
    sheet.hidden = !open;
    sheetMask.hidden = !open;
    menuFab.setAttribute("aria-expanded", open ? "true" : "false");
  }

  document.querySelectorAll("button[data-skin]").forEach((btn) => {
    btn.addEventListener("click", () => setSkin(btn.dataset.skin));
  });
  document.querySelectorAll("button[data-throw]").forEach((btn) => {
    btn.addEventListener("click", () => { setThrow(btn.dataset.throw); openSheet(false); });
  });
  $("sound-btn").addEventListener("click", () => setSound(!soundOn));
  $("sound-btn-m").addEventListener("click", () => setSound(!soundOn));
  $("music-btn").addEventListener("click", () => setMusic(!musicWanted));
  $("music-btn-m").addEventListener("click", () => setMusic(!musicWanted));
  menuFab.addEventListener("click", () => openSheet(sheet.hidden));
  sheetMask.addEventListener("click", () => openSheet(false));

  stage.addEventListener("pointerdown", beginAim);
  stage.addEventListener("pointermove", moveAim);
  stage.addEventListener("pointerup", endAim);
  stage.addEventListener("pointercancel", endAim);
  coinHit.addEventListener("click", (e) => {
    if (e.detail === 0) autoThrow();
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat) {
      e.preventDefault();
      autoThrow();
    }
    if (e.key === "1") setSkin("stage");
    if (e.key === "2") setSkin("arcade");
    if (e.key === "3") setSkin("crystal");
    if (e.key === "4") setSkin("paper");
    if (e.key === "q") setThrow("sling");
    if (e.key === "w") setThrow("slap");
    if (e.key === "e") setThrow("fling");
  });

  window.addEventListener("pointermove", (e) => {
    cursor.tx = e.clientX;
    cursor.ty = e.clientY;
    if (!root.classList.contains("cursor-on")) root.classList.add("cursor-on");
    const hot = e.target.closest("button, a");
    root.classList.toggle("cursor-hot", Boolean(hot));
  });
  window.addEventListener("pointerdown", () => {
    ensureAudio();
    if (musicWanted) playBgm();
  });

  bgm.addEventListener("ended", () => {
    if (!tracks.length) return;
    trackIndex = (trackIndex + 1) % tracks.length;
    playBgm();
  });

  setSkin(currentSkin());
  setThrow(currentThrow());
  setSound(soundOn);
  setMusic(musicWanted);
  renderHistory();
  requestAnimationFrame(loop);

  fetch("/api/stats")
    .then((r) => r.json())
    .then((p) => { if (p && p.ok && p.data) applyStats(p.data); })
    .catch(() => {});

  fetch("/api/site-config")
    .then((r) => r.json())
    .then((cfg) => {
      if (Array.isArray(cfg.music) && cfg.music.length) {
        tracks = cfg.music.filter((m) => m && m.url);
        if (cfg.music_mode === "shuffle") trackIndex = (Math.random() * tracks.length) | 0;
        if (musicWanted) playBgm();
      }
    })
    .catch(() => {});
})();
