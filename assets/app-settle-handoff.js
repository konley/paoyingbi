(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const root = document.documentElement;
  const stage = byId("coin-stage");
  const coin = byId("coin");
  const coinControl = byId("coin-control");
  const coinShadow = document.querySelector(".coin-shadow");
  const coinStatus = byId("coin-status");
  const result = byId("result");
  const flipButtons = [byId("flip-btn"), byId("flip-btn-2")].filter(Boolean);
  const themeToggle = byId("theme-toggle");
  const soundToggle = byId("sound-toggle");
  const musicToggle = byId("music-toggle");
  const bgm = byId("bgm");
  const sceneImages = [byId("scene-image-a"), byId("scene-image-b")];
  const toast = byId("toast");
  const celebration = byId("celebration");
  const celebrationMark = byId("celebration-mark");
  const fateLine = byId("fate-line");
  const historyElement = byId("history");
  const fxCanvas = byId("fx-canvas");
  const fx = fxCanvas.getContext("2d");
  const ambientCanvas = byId("ambient-canvas");
  const ambient = ambientCanvas.getContext("2d");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!window.Matter) {
    coinStatus.textContent = "物理引擎加载失败 · 请刷新";
    return;
  }

  const { Engine, Bodies, Body, Composite, Events, Sleeping } = Matter;
  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.6;

  const messages = {
    heads: [
      "TOP 朝上。所念之事，正向高处生长。",
      "正面落定。先迈一步，答案会在路上出现。",
      "抛起见顶。此刻适合出发。",
      "星芒朝上，好运已经接住了你。",
    ],
    tails: [
      "月面朝上。且慢，且看，且留白。",
      "反面有光。安静也是一种答案。",
      "月相落定，先听清楚，再作回答。",
      "换个方向，也会看见光。",
    ],
  };

  let state = "idle";
  let coinBody;
  let ground;
  let leftWall;
  let rightWall;
  let baseX = 0;
  let baseY = 0;
  let coinRadius = 120;
  let pointer = null;
  let chosenSide = "heads";
  let launchStrength = .65;
  let launchedAt = 0;
  let lastFrame = performance.now();
  let bounceCount = 0;
  let coinOrientation = { x: 0, y: 0, z: 0, w: 1 };
  let spinAxis = { x: 1, y: 1, z: 0 };
  let spinSpeed = 0;
  let totalSpinAngle = 0;
  let precessionPhase = 0;
  let dragTarget = { x: 0, y: 0 };
  let dragPosition = { x: 0, y: 0 };
  let dragVelocity = { x: 0, y: 0 };
  let dragBaseOrientation = { x: 0, y: 0, z: 0, w: 1 };
  let collisionsArmed = true;
  let homeImpactPlayed = false;
  let homeImpactCount = 0;
  let lastImpact = null;
  let groundContactAt = 0;
  let peakAltitude = 0;
  let firstImpactAt = 0;
  let lastRevealDuration = 0;
  let reveal = null;
  let idleStartedAt = performance.now();
  let audioContext = null;
  let audioBus = null;
  let room = null;
  let noiseBuffer = null;
  let soundOn = true;
  let musicWanted = true;
  let stats = { total: 0, heads: 0, tails: 0, days: 412 };
  let history = [];
  let particles = [];
  let rings = [];
  let ambientMotes = [];
  let backgroundItems = [{ name: "林间晴光", url: "/assets/landscape.webp" }];
  let backgroundMode = "single";
  let backgroundIndex = 0;
  let backgroundTimer = null;
  let backgroundSwapToken = 0;
  let musicTracks = [{ name: "推动摇篮的手", url: "/assets/audio/bgm.mp3" }];
  let musicMode = "sequence";
  let musicIndex = 0;
  let musicErrorSkips = 0;
  let mediaReady;

  try {
    soundOn = localStorage.getItem("pyb-sound") !== "0";
    musicWanted = localStorage.getItem("pyb-music") !== "0";
    const savedHistory = JSON.parse(localStorage.getItem("pyb-history") || "[]");
    if (Array.isArray(savedHistory)) history = savedHistory.slice(0, 12);
  } catch (_) {}

  function applyStats(nextStats) {
    if (!nextStats || Number(nextStats.total) < Number(stats.total)) return;
    stats = nextStats;
    paintStats(stats);
  }

  sceneImages[0].dataset.url = "/assets/landscape.webp";

  function waitForImage(image) {
    if (image.complete && image.naturalWidth) return image.decode ? image.decode().catch(() => {}) : Promise.resolve();
    return new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", reject, { once: true });
    }).then(() => image.decode ? image.decode().catch(() => {}) : undefined);
  }

  async function showBackground(index) {
    if (!backgroundItems.length) return;
    const normalizedIndex = ((index % backgroundItems.length) + backgroundItems.length) % backgroundItems.length;
    const item = backgroundItems[normalizedIndex];
    const active = sceneImages.find((image) => image.classList.contains("active")) || sceneImages[0];
    if (active.dataset.url === item.url) {
      backgroundIndex = normalizedIndex;
      return;
    }
    const incoming = sceneImages.find((image) => image !== active);
    const token = ++backgroundSwapToken;
    incoming.classList.remove("active", "incoming");
    incoming.src = item.url;
    incoming.dataset.url = item.url;
    try {
      await waitForImage(incoming);
    } catch (_) {
      incoming.removeAttribute("src");
      incoming.dataset.url = "";
      return;
    }
    if (token !== backgroundSwapToken) return;
    backgroundIndex = normalizedIndex;
    incoming.classList.add("active", "incoming");
    setTimeout(() => {
      if (incoming.classList.contains("active")) {
        active.classList.remove("active", "incoming");
        incoming.classList.remove("incoming");
      }
    }, reducedMotion ? 20 : 1900);
  }

  function nextBackground() {
    if (backgroundItems.length < 2) return;
    let next = backgroundIndex + 1;
    if (backgroundMode === "shuffle") {
      do { next = Math.floor(Math.random() * backgroundItems.length); } while (next === backgroundIndex && backgroundItems.length > 1);
    }
    showBackground(next);
  }

  function selectMusic(index) {
    if (!musicTracks.length) {
      bgm.pause();
      bgm.removeAttribute("src");
      bgm.replaceChildren();
      bgm.load();
      bgm.loop = false;
      musicToggle.title = "暂无背景音乐";
      updateMusicUi(false, false);
      return;
    }
    musicIndex = ((index % musicTracks.length) + musicTracks.length) % musicTracks.length;
    const track = musicTracks[musicIndex];
    const absoluteUrl = new URL(track.url, location.href).href;
    if (bgm.src !== absoluteUrl) {
      bgm.src = track.url;
      bgm.load();
    }
    bgm.loop = musicMode === "single" || musicTracks.length === 1;
    musicToggle.title = `背景音乐 · ${track.name}`;
  }

  async function initializeManagedMedia() {
    try {
      const response = await fetch("/api/site-config", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("media_config_failed");
      const config = await response.json();
      if (Array.isArray(config.backgrounds) && config.backgrounds.length) backgroundItems = config.backgrounds;
      if (Array.isArray(config.music)) musicTracks = config.music;
      backgroundMode = ["single", "rotate", "shuffle"].includes(config.background_mode) ? config.background_mode : "single";
      musicMode = ["single", "sequence", "shuffle"].includes(config.music_mode) ? config.music_mode : "sequence";
      await showBackground(0);
      clearInterval(backgroundTimer);
      if (backgroundMode !== "single" && backgroundItems.length > 1) {
        const interval = Math.max(6, Math.min(300, Number(config.background_interval) || 18));
        backgroundTimer = setInterval(nextBackground, interval * 1000);
      }
      selectMusic(0);
    } catch (_) {
      selectMusic(0);
    }
  }

  mediaReady = initializeManagedMedia();

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("zh-CN");
  }

  function paintStats(data) {
    const total = Number(data.total) || 0;
    const heads = Number(data.heads) || 0;
    const tails = Number(data.tails) || 0;
    const ratio = total ? Math.round(heads / total * 100) : 50;
    byId("flip-count").textContent = formatNumber(total);
    byId("uptime-days").textContent = formatNumber(Number(data.days) || 412);
    byId("heads-ratio").textContent = ratio;
    byId("heads-count").textContent = formatNumber(heads);
    byId("tails-count").textContent = formatNumber(tails);
    byId("bar-heads").style.width = (total ? heads / total * 100 : 50).toFixed(1) + "%";
    byId("bar-tails").style.width = (total ? tails / total * 100 : 50).toFixed(1) + "%";
  }

  function renderHistory() {
    historyElement.replaceChildren();
    history.forEach((side) => {
      const item = document.createElement("span");
      item.className = side;
      item.textContent = side === "heads" ? "TOP" : "月";
      historyElement.appendChild(item);
    });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2500);
  }

  function setBusy(busy) {
    flipButtons.forEach((button) => { button.disabled = busy; });
    coinControl.disabled = busy;
  }

  function buildPhysics() {
    const rect = stage.getBoundingClientRect();
    const controlRect = coinControl.getBoundingClientRect();
    baseX = rect.width / 2;
    baseY = rect.height / 2;
    coinRadius = controlRect.width / 2;

    Composite.clear(engine.world, false, true);
    coinBody = Bodies.circle(baseX, baseY, coinRadius * .9, {
      restitution: .16,
      friction: .35,
      frictionAir: .002,
      density: .006,
      sleepThreshold: 20,
      label: "coin",
    });
    ground = Bodies.rectangle(baseX, baseY + coinRadius * .9 + 24, Math.max(rect.width * 4, 1600), 48, { isStatic: true, label: "ground", friction: .42, restitution: .07 });
    const wallOffset = coinRadius * 1.25 + 32;
    const sidePad = Math.max(wallOffset, coinRadius * 2.2);
    leftWall = Bodies.rectangle(-sidePad, baseY, 64, rect.height * 4, { isStatic: true, label: "wall" });
    rightWall = Bodies.rectangle(rect.width + sidePad, baseY, 64, rect.height * 4, { isStatic: true, label: "wall" });
    Composite.add(engine.world, [coinBody, ground, leftWall, rightWall]);
    Body.setStatic(coinBody, true);
    Body.setPosition(coinBody, { x: baseX, y: baseY });
  }

  function resizeFx() {
    const width = document.documentElement.clientWidth;
    const height = Math.max(document.documentElement.scrollHeight, innerHeight);
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    fxCanvas.width = Math.round(width * ratio);
    fxCanvas.height = Math.round(height * ratio);
    fxCanvas.style.width = width + "px";
    fxCanvas.style.height = height + "px";
    fx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const sceneRect = document.querySelector(".scene").getBoundingClientRect();
    ambientCanvas.width = Math.round(sceneRect.width * ratio);
    ambientCanvas.height = Math.round(sceneRect.height * ratio);
    ambientCanvas.style.width = sceneRect.width + "px";
    ambientCanvas.style.height = sceneRect.height + "px";
    ambient.setTransform(ratio, 0, 0, ratio, 0, 0);
    const count = reducedMotion ? 20 : Math.round(Math.min(68, Math.max(34, sceneRect.width / 24)));
    ambientMotes = Array.from({ length: count }, () => ({
      x: Math.random() * sceneRect.width,
      y: Math.random() * sceneRect.height,
      depth: .25 + Math.random() * .75,
      phase: Math.random() * Math.PI * 2,
      drift: .05 + Math.random() * .19,
    }));
  }

  function coinScreenCenter() {
    const rect = coinControl.getBoundingClientRect();
    const dx = state === "dragging" ? dragPosition.x : (coinBody ? coinBody.position.x - baseX : 0);
    const dy = state === "dragging" ? dragPosition.y : (coinBody ? coinBody.position.y - baseY : 0);
    return { x: rect.left + rect.width / 2 + dx, y: rect.top + scrollY + rect.height / 2 + dy };
  }

  function emitTrail(count) {
    if (reducedMotion) return;
    const center = coinScreenCenter();
    for (let i = 0; i < count; i++) {
      particles.push({
        x: center.x + (Math.random() - .5) * 38,
        y: center.y + (Math.random() - .5) * 22,
        vx: (Math.random() - .5) * 1.2,
        vy: .8 + Math.random() * 1.8,
        life: 1,
        decay: .028 + Math.random() * .025,
        size: 1 + Math.random() * 2.8,
        color: Math.random() > .35 ? "227,179,57" : (Math.random() > .5 ? "91,171,194" : "224,139,180"),
      });
    }
  }

  function impactFx(power) {
    if (reducedMotion) return;
    const center = coinScreenCenter();
    const particleCount = Math.round(7 + 10 * power);
    for (let i = 0; i < particleCount; i++) {
      const direction = Math.random() > .5 ? 1 : -1;
      const speed = (1.2 + Math.random() * 3.2) * power;
      particles.push({
        x: center.x,
        y: center.y + coinRadius * .55,
        vx: direction * speed,
        vy: -(.45 + Math.random() * 1.3) * power,
        life: 1,
        decay: .035 + Math.random() * .028,
        size: .7 + Math.random() * 1.5,
        color: Math.random() > .4 ? "196,134,0" : "49,84,155",
      });
    }
    rings.push({ x: center.x, y: center.y + coinRadius * .64, radius: 14, life: 1 });
  }

  function celebrateResult(side) {
    if (reducedMotion) return;
    const center = coinScreenCenter();
    const colors = side === "heads" ? ["196,134,0", "8,123,82"] : ["49,84,155", "90,139,183"];
    for (let i = 0; i < 18; i++) {
      const direction = Math.random() > .5 ? 1 : -1;
      particles.push({
        x: center.x + (Math.random() - .5) * coinRadius * .7,
        y: center.y + coinRadius * .36,
        vx: direction * (.7 + Math.random() * 2.5),
        vy: -(.4 + Math.random() * 1.6),
        life: 1,
        decay: .035 + Math.random() * .024,
        size: .6 + Math.random() * 1.5,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  function drawFx() {
    fx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    fx.save();
    fx.globalCompositeOperation = "lighter";
    particles = particles.filter((particle) => {
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= .985;
       particle.vy = particle.vy * .985 + .028;
      particle.life -= particle.decay;
      if (particle.life <= 0) return false;
       fx.fillStyle = `rgba(${particle.color},${particle.life * .66})`;
      fx.beginPath();
      fx.arc(particle.x, particle.y, Math.max(.3, particle.size * particle.life), 0, Math.PI * 2);
      fx.fill();
      return true;
    });
    rings = rings.filter((ring) => {
       ring.radius += 3.4;
       ring.life -= .06;
      if (ring.life <= 0) return false;
       fx.strokeStyle = `rgba(155,112,26,${ring.life * .34})`;
       fx.lineWidth = 1;
      fx.beginPath();
      fx.ellipse(ring.x, ring.y, ring.radius * 1.9, ring.radius * .28, 0, 0, Math.PI * 2);
      fx.stroke();
      return true;
    });
    fx.restore();
    requestAnimationFrame(drawFx);
  }

  function drawAmbient(now) {
    const width = ambientCanvas.clientWidth;
    const height = ambientCanvas.clientHeight;
    ambient.clearRect(0, 0, width, height);
    const dark = root.dataset.theme === "dark";
    for (const mote of ambientMotes) {
      const time = now * .00018 + mote.phase;
      mote.x += Math.sin(time * 1.2) * mote.drift;
      mote.y += Math.cos(time * .7) * mote.drift * .35;
      if (mote.x < -8) mote.x = width + 8;
      if (mote.x > width + 8) mote.x = -8;
      if (mote.y < -8) mote.y = height + 8;
      if (mote.y > height + 8) mote.y = -8;
      const shimmer = .35 + Math.sin(time * 2.2) * .18;
      const radius = dark ? (.45 + mote.depth * .9) : (.55 + mote.depth * 1.35);
      const alpha = (dark ? .17 : .11) * mote.depth * shimmer;
      ambient.fillStyle = dark ? `rgba(157,190,235,${alpha})` : `rgba(187,130,25,${alpha})`;
      ambient.beginPath();
      ambient.arc(mote.x, mote.y, radius, 0, Math.PI * 2);
      ambient.fill();
    }
    requestAnimationFrame(drawAmbient);
  }

  function ensureAudio() {
    if (!soundOn) return null;
    if (audioContext) {
      if (audioContext.state === "suspended") audioContext.resume();
      return audioContext;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    audioContext = new AudioContext();
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.ratio.value = 3;
    compressor.connect(audioContext.destination);
    audioBus = audioContext.createGain();
    audioBus.gain.value = .66;
    audioBus.connect(compressor);
    room = audioContext.createConvolver();
    const roomGain = audioContext.createGain();
    roomGain.gain.value = .14;
    room.connect(roomGain).connect(compressor);
    const impulse = audioContext.createBuffer(2, audioContext.sampleRate * .42, audioContext.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 4.5);
    }
    room.buffer = impulse;
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
    return audioContext;
  }

  function connectSound(node, reverb) {
    node.connect(audioBus);
    if (reverb) node.connect(room);
  }

  function playLaunch(strength) {
    const context = ensureAudio();
    if (!context || !noiseBuffer) return;
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = "bandpass";
    filter.Q.value = .7;
    filter.frequency.setValueAtTime(440, now);
    filter.frequency.exponentialRampToValueAtTime(2600 + strength * 1600, now + .18);
    filter.frequency.exponentialRampToValueAtTime(720, now + .5);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.085 + strength * .045, now + .05);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .54);
    source.connect(filter).connect(gain);
    connectSound(gain, true);
    source.start(now, 0, .58);
  }

  function playLanding(heads, power) {
    const context = ensureAudio();
    if (!context) return;
    const now = context.currentTime;
    const base = heads ? 1720 : 1380;
    [1, 1.47, 2.1, 2.85].forEach((ratio, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = index < 2 ? "sine" : "triangle";
      oscillator.frequency.value = base * ratio;
      gain.gain.setValueAtTime(.074 * Math.pow(.55, index) * power, now);
      gain.gain.exponentialRampToValueAtTime(.0001, now + .48 * Math.pow(.72, index));
      oscillator.connect(gain);
      connectSound(gain, index < 3);
      oscillator.start(now);
      oscillator.stop(now + .52);
    });
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function normalizeVector(vector) {
    const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
    return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
  }

  function normalizeQuaternion(quaternion) {
    const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) || 1;
    return { x: quaternion.x / length, y: quaternion.y / length, z: quaternion.z / length, w: quaternion.w / length };
  }

  function quaternionFromAxisAngle(axis, angle) {
    const normalized = normalizeVector(axis);
    const half = angle / 2;
    const sine = Math.sin(half);
    return { x: normalized.x * sine, y: normalized.y * sine, z: normalized.z * sine, w: Math.cos(half) };
  }

  function multiplyQuaternions(left, right) {
    return {
      x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
      y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
      z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
      w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
    };
  }

  function quaternionFromEuler(xDegrees, yDegrees, zDegrees) {
    const radians = Math.PI / 180;
    const x = quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, xDegrees * radians);
    const y = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, yDegrees * radians);
    const z = quaternionFromAxisAngle({ x: 0, y: 0, z: 1 }, zDegrees * radians);
    return normalizeQuaternion(multiplyQuaternions(z, multiplyQuaternions(y, x)));
  }

  function orientationForSide(side) {
    return side === "tails" ? quaternionFromEuler(8, 180, 0) : quaternionFromEuler(8, 0, 0);
  }

  function visibleSide(orientation) {
    const normalized = normalizeQuaternion(orientation);
    return 1 - 2 * (normalized.x * normalized.x + normalized.y * normalized.y) >= 0 ? "heads" : "tails";
  }

  function quaternionDistance(from, to) {
    const dot = Math.abs(from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w);
    return 2 * Math.acos(clamp(dot, -1, 1));
  }

  function slerpQuaternion(from, to, progress) {
    let target = to;
    let dot = from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w;
    if (dot < 0) {
      dot = -dot;
      target = { x: -to.x, y: -to.y, z: -to.z, w: -to.w };
    }
    if (dot > .9995) {
      return normalizeQuaternion({
        x: from.x + (target.x - from.x) * progress,
        y: from.y + (target.y - from.y) * progress,
        z: from.z + (target.z - from.z) * progress,
        w: from.w + (target.w - from.w) * progress,
      });
    }
    const theta = Math.acos(clamp(dot, -1, 1));
    const sine = Math.sin(theta);
    const fromWeight = Math.sin((1 - progress) * theta) / sine;
    const toWeight = Math.sin(progress * theta) / sine;
    return normalizeQuaternion({
      x: from.x * fromWeight + target.x * toWeight,
      y: from.y * fromWeight + target.y * toWeight,
      z: from.z * fromWeight + target.z * toWeight,
      w: from.w * fromWeight + target.w * toWeight,
    });
  }

  function quaternionMatrix(quaternion) {
    const { x, y, z, w } = normalizeQuaternion(quaternion);
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const xz = x * z;
    const yz = y * z;
    const wx = w * x;
    const wy = w * y;
    const wz = w * z;
    return [
      1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
      2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
      2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
      0, 0, 0, 1,
    ].map((value) => Math.abs(value) < .000001 ? 0 : Number(value.toFixed(6))).join(",");
  }

  function setCoinTransform(x, y, orientation) {
    coin.style.transform = `translate3d(${x}px,${y}px,0) matrix3d(${quaternionMatrix(orientation)})`;
  }

  function updateShadow(altitude, horizontal) {
    const ratio = Math.max(0, Math.min(1, altitude / 180));
    const width = 145 * (1 - ratio * .38);
    coinShadow.style.width = width + "px";
    coinShadow.style.opacity = String(.72 - ratio * .46);
    coinShadow.style.transform = `translateX(calc(-50% + ${horizontal * .7}px)) scaleY(${1 - ratio * .28})`;
  }

  function launch(strength = .55, horizontal = 0, options = {}) {
    if (state !== "idle" && state !== "settled" && state !== "dragging") return;
    state = "flying";
    launchStrength = Math.max(.35, Math.min(1, strength));
    chosenSide = Math.random() < .5 ? "heads" : "tails";
    bounceCount = 0;
    launchedAt = performance.now();
    peakAltitude = 0;
    firstImpactAt = 0;
    homeImpactPlayed = false;
    homeImpactCount = 0;
    lastImpact = null;
    groundContactAt = 0;
    lastRevealDuration = 0;
    reveal = null;
    totalSpinAngle = 0;
    spinAxis = normalizeVector({
      x: (Math.random() > .5 ? 1 : -1) * (.55 + Math.random() * .35),
      y: (Math.random() > .5 ? 1 : -1) * (.5 + Math.random() * .38),
      z: horizontal * .2 + (Math.random() - .5) * .28,
    });
    spinSpeed = 9.2 + launchStrength * 3 + Math.random() * 1.4;
    precessionPhase = Math.random() * Math.PI * 2;
    result.classList.remove("show");
    stage.classList.remove("aiming", "impact");
    stage.classList.add("airborne");
    coin.classList.remove("settled", "dragging");
    coin.classList.add("flipping");
    coinStatus.textContent = "IN THE AIR · 向上";
    setBusy(true);

    const startX = Number(options.x) || 0;
    const startY = Number(options.y) || 0;
    Body.setStatic(coinBody, false);
    Body.setPosition(coinBody, { x: baseX + startX, y: baseY + startY });
    const viewportScale = innerWidth < 600 ? .95 : 1;
    Body.setVelocity(coinBody, {
      x: Number.isFinite(options.vx) ? options.vx : horizontal * (1.4 + launchStrength * 1.1),
      y: Number.isFinite(options.vy) ? options.vy : (-10.2 - launchStrength * 3.1) * viewportScale,
    });
    collisionsArmed = !(options.fromDrag && startY > -coinRadius * .08);
    coinBody.collisionFilter.mask = collisionsArmed ? 0xFFFFFFFF : 0;
    Body.setAngularVelocity(coinBody, 0);
    Body.setAngle(coinBody, 0);
    Sleeping.set(coinBody, false);
    playLaunch(launchStrength);
    emitTrail(options.fromDrag ? 5 : 6);
  }

  function beginReveal() {
    if (state !== "flying") return;
    state = "revealing";
    Body.setStatic(coinBody, true);
    // The fair result is chosen at launch. Rotation is visual physics, not the randomizer.
    const targetOrientation = orientationForSide(chosenSide);
    const remainingAngle = quaternionDistance(coinOrientation, targetOrientation);
    const fromX = coinBody.position.x - baseX;
    const fromY = coinBody.position.y - baseY;
    const travel = Math.hypot(fromX, fromY);
    const duration = reducedMotion
      ? 220
      : clamp(650 + remainingAngle / Math.PI * 280 + travel * .7 + spinSpeed * 11, 820, 1250);
    lastRevealDuration = Math.round(duration);
    reveal = {
      start: performance.now(),
      duration,
      fromX,
      fromY,
      fromOrientation: { ...coinOrientation },
      toOrientation: targetOrientation,
      wobbleAxis: normalizeVector({ x: .75 + Math.random() * .2, y: (Math.random() - .5) * .2, z: .2 + Math.random() * .2 }),
    };
    coinStatus.textContent = "SETTLING · 落定";
  }

  async function saveResult(side) {
    try {
      const response = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side }),
      });
      const payload = await response.json();
      if (!payload || !payload.ok || !payload.data) throw new Error("Invalid stats response");
      applyStats(payload.data);
    } catch (_) {
      const fallback = { ...stats, total: stats.total + 1, [side]: stats[side] + 1 };
      applyStats(fallback);
    }
  }

  function finishReveal() {
    state = "settled";
    const heads = chosenSide === "heads";
    coinOrientation = orientationForSide(chosenSide);
    dragTarget = { x: 0, y: 0 };
    dragPosition = { x: 0, y: 0 };
    dragVelocity = { x: 0, y: 0 };
    Body.setPosition(coinBody, { x: baseX, y: baseY });
    Body.setVelocity(coinBody, { x: 0, y: 0 });
    coinBody.collisionFilter.mask = 0xFFFFFFFF;
    collisionsArmed = true;
    idleStartedAt = performance.now();
    setCoinTransform(0, 0, coinOrientation);
    coin.classList.remove("flipping");
    coin.classList.add("settled");
    stage.classList.remove("airborne");
    coinStatus.textContent = heads ? "TOP · 正面朝上" : "MOON · 反面朝上";
    result.textContent = heads ? "✦ TOP · 正面" : "☾ 月 · 反面";
    result.className = "result show " + chosenSide;
    const list = messages[chosenSide];
    const message = list[Math.floor(Math.random() * list.length)];
    fateLine.textContent = "「" + message + "」";
    if (!homeImpactPlayed) {
      // A wide throw returns through the settling animation, so the final impact belongs at home.
      playLanding(heads, .72);
      impactFx(.62);
      homeImpactCount += 1;
      lastImpact = { x: 0, y: 0, source: "settle" };
    }
    celebrateResult(chosenSide);
    showToast(message);
    history.unshift(chosenSide);
    history = history.slice(0, 12);
    try { localStorage.setItem("pyb-history", JSON.stringify(history)); } catch (_) {}
    renderHistory();
    saveResult(chosenSide);
    setBusy(false);
    if (navigator.vibrate) {
      try { navigator.vibrate([16, 25, 10]); } catch (_) {}
    }
  }

  Events.on(engine, "collisionStart", (event) => {
    if (state !== "flying") return;
    const hitGround = event.pairs.some((pair) => pair.bodyA.label === "ground" || pair.bodyB.label === "ground");
    if (!hitGround) return;
    const x = coinBody.position.x - baseX;
    const y = coinBody.position.y - baseY;
    if (!groundContactAt) groundContactAt = performance.now() - launchedAt;
    const atHome = Math.abs(x) <= Math.max(18, coinRadius * .25) && Math.abs(y) <= Math.max(16, coinRadius * .18);
    // A wide throw starts returning as soon as it touches the plane, but stays silent until home.
    if (!atHome) {
      beginReveal();
      return;
    }
    // A physical bounce may report multiple contacts; one final home impact is enough.
    if (homeImpactPlayed) return;
    bounceCount += 1;
    homeImpactPlayed = true;
    homeImpactCount += 1;
    lastImpact = { x, y, source: "ground" };
    if (!firstImpactAt) firstImpactAt = performance.now() - launchedAt;
    spinSpeed *= bounceCount === 1 ? .62 : .48;
    stage.classList.remove("impact");
    void stage.offsetWidth;
    stage.classList.add("impact");
    impactFx(Math.max(.35, 1 - bounceCount * .18));
    playLanding(chosenSide === "heads", Math.max(.24, .62 - bounceCount * .1));
  });

  function tick(now) {
    requestAnimationFrame(tick);
    const deltaMs = Math.min(32, now - lastFrame || 16.7);
    const deltaSeconds = deltaMs / 1000;
    lastFrame = now;

    if (state === "dragging") {
      const follow = reducedMotion ? 1 : 1 - Math.exp(-deltaSeconds * 26);
      const previousX = dragPosition.x;
      const previousY = dragPosition.y;
      dragPosition.x += (dragTarget.x - dragPosition.x) * follow;
      dragPosition.y += (dragTarget.y - dragPosition.y) * follow;
      const safeDelta = Math.max(.008, deltaSeconds);
      dragVelocity.x = (dragPosition.x - previousX) / safeDelta;
      dragVelocity.y = (dragPosition.y - previousY) / safeDelta;
      const tiltX = clamp(-dragVelocity.y * .025 - dragPosition.y * .06, -22, 22);
      const tiltY = clamp(dragVelocity.x * .028 - dragPosition.x * .06, -24, 24);
      const tiltZ = clamp(dragPosition.x * .07, -11, 11);
      // Drag is a local tilt applied to the face already showing, never a reset to heads.
      const dragOrientation = multiplyQuaternions(quaternionFromEuler(tiltX, tiltY, tiltZ), dragBaseOrientation);
      coinOrientation = slerpQuaternion(coinOrientation, dragOrientation, Math.min(1, follow * 1.15));
      setCoinTransform(dragPosition.x, dragPosition.y, coinOrientation);
      updateShadow(Math.max(0, -dragPosition.y), dragPosition.x);
      if (Math.hypot(dragVelocity.x, dragVelocity.y) > 260 && Math.random() < .16) emitTrail(1);
    } else if (state === "flying") {
      Engine.update(engine, deltaMs);
      const x = coinBody.position.x - baseX;
      const y = coinBody.position.y - baseY;
      const altitude = Math.max(0, -y);
      const age = now - launchedAt;
      if (!collisionsArmed && (y < -coinRadius * .1 || age > 500)) {
        coinBody.collisionFilter.mask = 0xFFFFFFFF;
        collisionsArmed = true;
      }
      const movingAxis = normalizeVector({
        x: spinAxis.x + Math.sin(age * .0022 + precessionPhase) * .07,
        y: spinAxis.y + Math.cos(age * .0019 + precessionPhase) * .07,
        z: spinAxis.z + Math.sin(age * .0015 + precessionPhase) * .045,
      });
      const spinDelta = spinSpeed * deltaSeconds;
      coinOrientation = normalizeQuaternion(multiplyQuaternions(quaternionFromAxisAngle(movingAxis, spinDelta), coinOrientation));
      totalSpinAngle += Math.abs(spinDelta);
      spinSpeed *= Math.pow(.997, deltaMs / 16.7);
      peakAltitude = Math.max(peakAltitude, altitude);
      setCoinTransform(x, y, coinOrientation);
      updateShadow(altitude, x);
      if (Math.random() < .12) emitTrail(1);
      if ((groundContactAt && age - groundContactAt > 420) || age > 2200) beginReveal();
    } else if (state === "revealing" && reveal) {
      const progress = Math.min(1, (now - reveal.start) / reveal.duration);
      // slow-in / slow-out, no snap back
      const eased = 1 - Math.pow(1 - progress, 3.2);
      const settle = Math.sin(progress * Math.PI) * (1 - progress);
      const driftX = reveal.fromX * (1 - eased) + Math.sin(progress * Math.PI * 1.15) * reveal.fromX * .04 * (1 - progress);
      const driftY = reveal.fromY * (1 - eased) - settle * Math.min(18, 8 + Math.abs(reveal.fromY) * .03);
      const settledOrientation = slerpQuaternion(reveal.fromOrientation, reveal.toOrientation, eased);
      const wobble = Math.sin(progress * Math.PI * 2.2) * Math.pow(1 - progress, 2.1) * .05;
      coinOrientation = normalizeQuaternion(multiplyQuaternions(quaternionFromAxisAngle(reveal.wobbleAxis, wobble), settledOrientation));
      setCoinTransform(driftX, driftY, coinOrientation);
      updateShadow(Math.max(0, -driftY), driftX);
      if (progress >= 1) finishReveal();
    } else if (state === "idle" || state === "settled") {
      // A low-amplitude, non-physical rest motion keeps the coin present without changing its result.
      const elapsed = Math.max(0, now - idleStartedAt);
      const handoff = reducedMotion ? 1 : Math.min(1, elapsed / 540);
      const phase = elapsed * .00078;
      const driftX = (Math.sin(phase * .83) * 5.2 + Math.sin(phase * 1.71) * 1.25) * handoff;
      const driftY = (Math.cos(phase * 1.07) * 8.2 - 1.7) * handoff;
      const tilt = quaternionFromEuler(Math.sin(phase * .94) * 5.6 * handoff, Math.cos(phase * .76) * 7.8 * handoff, Math.sin(phase * 1.4) * 1.8 * handoff);
      setCoinTransform(driftX, driftY, normalizeQuaternion(multiplyQuaternions(tilt, coinOrientation)));
      updateShadow(Math.max(0, -driftY), driftX);
    }
  }

  function pointerDown(event) {
    if (state !== "idle" && state !== "settled") return;
    event.preventDefault();
    const now = performance.now();
    const rect = stage.getBoundingClientRect();
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      at: now,
      lastX: event.clientX,
      lastY: event.clientY,
      previousState: state,
      maxDistance: 0,
      maxX: Math.max(120, rect.width * .58 + coinRadius * .15),
      maxY: Math.max(140, rect.height * .62 + coinRadius * .2),
      samples: [{ x: event.clientX, y: event.clientY, at: now }],
    };
    state = "dragging";
    dragTarget = { x: 0, y: 0 };
    dragPosition = { x: 0, y: 0 };
    dragVelocity = { x: 0, y: 0 };
    dragBaseOrientation = { ...coinOrientation };
    coin.classList.remove("settled", "flipping");
    coin.classList.add("dragging");
    stage.classList.add("aiming");
    result.classList.remove("show");
    coinStatus.textContent = "DRAG · 拖动硬币";
    flipButtons.forEach((button) => { button.disabled = true; });
    coinControl.setAttribute("aria-grabbed", "true");
    try { coinControl.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function pointerMove(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    event.preventDefault();
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    pointer.maxDistance = Math.max(pointer.maxDistance, Math.hypot(dx, dy));
    dragTarget.x = clamp(dx, -pointer.maxX, pointer.maxX);
    dragTarget.y = clamp(dy, -pointer.maxY, pointer.maxY);
    const now = performance.now();
    pointer.samples.push({ x: event.clientX, y: event.clientY, at: now });
    pointer.samples = pointer.samples.filter((sample) => now - sample.at <= 140);
    if (pointer.maxDistance > 8) coinStatus.textContent = "AIM · 松手弹射";
  }

  function pointerUp(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const activePointer = pointer;
    const now = performance.now();
    activePointer.samples.push({ x: event.clientX, y: event.clientY, at: now });
    const recentSamples = activePointer.samples.filter((sample) => now - sample.at <= 120);
    const firstSample = recentSamples[0] || activePointer.samples[0];
    const lastSample = recentSamples[recentSamples.length - 1] || firstSample;
    const sampleTime = Math.max(16, lastSample.at - firstSample.at);
    const pointerVx = (lastSample.x - firstSample.x) / sampleTime;
    const pointerVy = (lastSample.y - firstSample.y) / sampleTime;
    const startX = dragPosition.x;
    const startY = dragPosition.y;
    const distance = Math.hypot(startX, startY);
    pointer = null;
    stage.classList.remove("aiming");
    coin.classList.remove("dragging");
    coinControl.setAttribute("aria-grabbed", "false");
    try { coinControl.releasePointerCapture(event.pointerId); } catch (_) {}

    if (activePointer.maxDistance < 8 && distance < 6) {
      launch(.5, 0);
      return;
    }

    const gestureSpeed = Math.hypot(pointerVx, pointerVy);
    const strength = clamp(.42 + Math.min(distance, 220) / 420 + Math.min(gestureSpeed, 1.5) * .2, .42, 1);
    const velocityX = clamp(pointerVx * 16.667 * .46 - startX * .012, -6.2, 6.2);
    const velocityY = clamp(
      -9.2 - strength * 2.4 + clamp(pointerVy * 16.667 * .34, -3.6, 2.1) + Math.max(0, -startY) * .02 - Math.max(0, startY) * .02,
      -16.5,
      -4.6,
    );
    launch(strength, clamp(velocityX / 4.2, -1, 1), { x: startX, y: startY, vx: velocityX, vy: velocityY, fromDrag: true });
  }

  function pointerCancel() {
    if (!pointer) return;
    const previousState = pointer.previousState;
    try { coinControl.releasePointerCapture(pointer.id); } catch (_) {}
    pointer = null;
    stage.classList.remove("aiming");
    state = previousState;
    dragTarget = { x: 0, y: 0 };
    dragPosition = { x: 0, y: 0 };
    coin.classList.remove("dragging");
    coinControl.setAttribute("aria-grabbed", "false");
    flipButtons.forEach((button) => { button.disabled = false; });
    if (state === "settled") {
      coin.classList.add("settled");
      coinOrientation = orientationForSide(chosenSide);
      idleStartedAt = performance.now();
      setCoinTransform(0, 0, coinOrientation);
      coinStatus.textContent = chosenSide === "heads" ? "TOP · 正面朝上" : "MOON · 反面朝上";
    } else {
      coin.style.transform = "";
      coinStatus.textContent = "READY · 按住硬币";
    }
  }

  coinControl.addEventListener("pointerdown", pointerDown);
  coinControl.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp, true);
  window.addEventListener("pointercancel", pointerCancel, true);
  coinControl.addEventListener("click", (event) => { if (event.detail === 0) launch(.5, 0); });
  flipButtons.forEach((button) => button.addEventListener("click", () => launch(.55, 0)));

  function updateThemeUi(theme) {
    const dark = theme === "dark";
    themeToggle.setAttribute("aria-pressed", dark ? "true" : "false");
    themeToggle.setAttribute("aria-label", dark ? "切换到浅色主题" : "切换到深色主题");
  }

  updateThemeUi(root.dataset.theme);
  themeToggle.addEventListener("click", () => {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = theme;
    updateThemeUi(theme);
    try { localStorage.setItem("pyb-theme", theme); } catch (_) {}
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0b100e" : "#eef3f0";
  });

  soundToggle.setAttribute("aria-pressed", soundOn ? "true" : "false");
  soundToggle.setAttribute("aria-label", soundOn ? "关闭音效" : "开启音效");
  soundToggle.addEventListener("click", () => {
    soundOn = !soundOn;
    soundToggle.setAttribute("aria-pressed", soundOn ? "true" : "false");
    soundToggle.setAttribute("aria-label", soundOn ? "关闭音效" : "开启音效");
    try { localStorage.setItem("pyb-sound", soundOn ? "1" : "0"); } catch (_) {}
    showToast(soundOn ? "音效已开启" : "音效已关闭");
  });

  function updateMusicUi(playing, awaiting) {
    const enabled = musicWanted && (playing || awaiting);
    musicToggle.setAttribute("aria-pressed", enabled ? "true" : "false");
    musicToggle.classList.toggle("awaiting", !!awaiting);
    musicToggle.setAttribute("aria-label", playing || awaiting ? "关闭背景音乐" : "播放背景音乐");
    musicToggle.title = awaiting ? "背景音乐已开启，等待浏览器允许播放" : (playing ? "关闭背景音乐" : "播放背景音乐");
  }

  async function attemptMusic() {
    await mediaReady;
    if (!musicTracks.length) {
      updateMusicUi(false, false);
      return;
    }
    if (!musicWanted) {
      bgm.pause();
      updateMusicUi(false, false);
      return;
    }
    bgm.volume = .24;
    const promise = bgm.play();
    if (promise) promise.then(() => updateMusicUi(true, false)).catch(() => updateMusicUi(false, true));
  }

  function advanceMusic() {
    if (musicTracks.length < 2 || musicMode === "single") return;
    let next = musicIndex + 1;
    if (musicMode === "shuffle") {
      do { next = Math.floor(Math.random() * musicTracks.length); } while (next === musicIndex && musicTracks.length > 1);
    }
    selectMusic(next);
    if (musicWanted) attemptMusic();
  }

  bgm.addEventListener("playing", () => {
    musicErrorSkips = 0;
    updateMusicUi(true, false);
  });
  bgm.addEventListener("pause", () => updateMusicUi(false, false));
  bgm.addEventListener("ended", advanceMusic);
  bgm.addEventListener("error", () => {
    if (musicTracks.length > 1 && musicErrorSkips < musicTracks.length - 1) {
      musicErrorSkips += 1;
      advanceMusic();
    } else {
      updateMusicUi(false, false);
    }
  });
  musicToggle.addEventListener("click", () => {
    if (!musicTracks.length) {
      showToast("暂未配置背景音乐");
      return;
    }
    if (!bgm.paused && musicWanted) {
      musicWanted = false;
      bgm.pause();
    } else {
      musicWanted = true;
      attemptMusic();
    }
    try { localStorage.setItem("pyb-music", musicWanted ? "1" : "0"); } catch (_) {}
  });
  attemptMusic();

  const unlockMusic = (event) => {
    if (event.target.closest && event.target.closest("#music-toggle")) return;
    ensureAudio();
    if (musicWanted && bgm.paused) attemptMusic();
    document.removeEventListener("pointerdown", unlockMusic, true);
    document.removeEventListener("keydown", unlockMusic, true);
    document.removeEventListener("touchstart", unlockMusic, true);
  };
  document.addEventListener("pointerdown", unlockMusic, true);
  document.addEventListener("keydown", unlockMusic, true);
  document.addEventListener("touchstart", unlockMusic, true);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && musicWanted && bgm.paused) attemptMusic();
  });

  function updateClock() {
    const now = new Date();
    const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now).map((part) => [part.type, part.value]));
    const clock = byId("clock");
    clock.textContent = `${parts.year}.${parts.month}.${parts.day} · ${parts.hour}:${parts.minute}`;
    clock.dateTime = now.toISOString();
  }

  function handleResize() {
    if (state === "dragging" || state === "flying" || state === "revealing") return;
    buildPhysics();
    resizeFx();
    if (state === "settled") {
      coinOrientation = orientationForSide(chosenSide);
      idleStartedAt = performance.now();
      setCoinTransform(0, 0, coinOrientation);
    } else {
      coin.style.transform = "";
    }
    coinShadow.style.cssText = "";
  }

  coinOrientation = orientationForSide("heads");
  buildPhysics();
  resizeFx();
  renderHistory();
  paintStats(stats);
  updateClock();
  setInterval(updateClock, 30000);
  addEventListener("resize", handleResize, { passive: true });
  fetch("/api/stats").then((response) => response.json()).then((payload) => {
    if (payload && payload.ok && payload.data) {
      applyStats(payload.data);
    }
  }).catch(() => {});
  requestAnimationFrame(tick);
  requestAnimationFrame(drawFx);
  requestAnimationFrame(drawAmbient);
  window.PYB_GAME = {
    launch,
    getState: () => state,
    getSnapshot: () => ({
      state,
      bounceCount,
      speed: coinBody ? coinBody.speed : 0,
      x: coinBody ? coinBody.position.x - baseX : 0,
      y: coinBody ? coinBody.position.y - baseY : 0,
      peakAltitude,
      firstImpactAt: Math.round(firstImpactAt),
      revealDuration: lastRevealDuration,
      rotations: Number((totalSpinAngle / (Math.PI * 2)).toFixed(2)),
      dragX: Number(dragPosition.x.toFixed(2)),
      dragY: Number(dragPosition.y.toFixed(2)),
      collisionsArmed,
      visibleSide: visibleSide(coinOrientation),
      chosenSide,
      spinSpeed: Number(spinSpeed.toFixed(3)),
      homeImpactCount,
      lastImpact,
      groundContactAt: Math.round(groundContactAt),
    }),
  };
})();
