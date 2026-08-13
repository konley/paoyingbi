(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const root = document.documentElement;
  const stage = byId("coin-stage");
  const coin = byId("coin");
  const coinControl = byId("coin-control");
  const coinShadow = document.querySelector(".coin-shadow");
  const coinStatus = byId("coin-status");
  const coinStatusLabel = byId("coin-status-label");
  const coinStatusTitle = byId("coin-status-title");
  const coinStatusCopy = byId("coin-status-copy");
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
  const titlecard = byId("titlecard");
  const titlecardKicker = byId("titlecard-kicker");
  const titlecardMark = byId("titlecard-mark");
  const titlecardLine = byId("titlecard-line");
  const fateLine = byId("fate-line");
  const historyElement = byId("history");
  const fxCanvas = byId("fx-canvas");
  const fx = fxCanvas.getContext("2d");
  const ambientCanvas = byId("ambient-canvas");
  const ambient = ambientCanvas.getContext("2d");
  const cursorDot = byId("cursor-dot");
  const cursorRing = byId("cursor-ring");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (!window.Matter) {
    setCoinStatus("ERROR", "物理引擎加载失败 · 请刷新");
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
  const statusCopy = {
    ready: "犹豫也可以被抛向空中。按住硬币，开始这一次。",
    drag: "先抓住它。方向还没写完，答案仍在掌心里。",
    aim: "再拉开一点。松手的瞬间，就是它自己的路。",
    air: "它在空中自己旋转。这一秒，不必替它决定。",
    return: "正在回落。让重力把最后一笔写完。",
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
  let stats = { total: 0, heads: 0, tails: 0, days: 0 };
  let statsReady = false;
  let history = [];
  let particles = [];
  let rings = [];
  let ambientMotes = [];
  let ambientRibbons = [];
  let ambientWorldHeight = 0;
  let backgroundItems = [{ name: "林间晴光", url: "/assets/landscape.webp" }];
  let backgroundMode = "single";
  let backgroundIndex = 0;
  let backgroundTimer = null;
  let backgroundSwapToken = 0;
  let musicTracks = [];
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
    if (!nextStats) return;
    if (statsReady && Number(nextStats.total) < Number(stats.total)) return;
    stats = nextStats;
    statsReady = true;
    paintStats(stats);
  }

  function setCoinStatus(label, title, copy = statusCopy.ready, side = "", isResult = false) {
    const nextCopy = copy || statusCopy.ready;
    const copyChanged = coinStatusCopy.textContent !== nextCopy;
    coinStatusLabel.textContent = label;
    coinStatusTitle.textContent = title;
    coinStatusCopy.textContent = nextCopy;
    coinStatus.dataset.side = side;
    coinStatus.classList.toggle("is-result", isResult);
    if (copyChanged && !reducedMotion) {
      coinStatus.classList.remove("tick");
      void coinStatus.offsetWidth;
      coinStatus.classList.add("tick");
    }
    if (isResult && !reducedMotion) {
      coinStatus.classList.remove("show-result", "fate-glow");
      void coinStatus.offsetWidth;
      coinStatus.classList.add("show-result", "fate-glow");
      clearTimeout(setCoinStatus.glowTimer);
      setCoinStatus.glowTimer = setTimeout(() => coinStatus.classList.remove("fate-glow"), 1400);
    } else {
      coinStatus.classList.remove("show-result", "fate-glow");
    }
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
      if (Array.isArray(config.music) && config.music.length) musicTracks = config.music;
      backgroundMode = ["single", "rotate", "shuffle"].includes(config.background_mode) ? config.background_mode : "single";
      musicMode = ["single", "sequence", "shuffle"].includes(config.music_mode) ? config.music_mode : "sequence";
      await showBackground(0);
      clearInterval(backgroundTimer);
      if (backgroundMode !== "single" && backgroundItems.length > 1) {
        const interval = Math.max(6, Math.min(300, Number(config.background_interval) || 18));
        backgroundTimer = setInterval(nextBackground, interval * 1000);
      }
      if (!musicTracks.length) musicTracks = [{ name: "推动摇篮的手", url: "/assets/audio/bgm.mp3" }];
      selectMusic(0);
    } catch (_) {
      if (!musicTracks.length) musicTracks = [{ name: "推动摇篮的手", url: "/assets/audio/bgm.mp3" }];
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
    const days = Number(data.days) || 0;
    const ratio = total ? Math.round(heads / total * 100) : 0;
    const statsRoot = document.querySelector(".stats");
    byId("flip-count").textContent = formatNumber(total);
    byId("uptime-days").textContent = formatNumber(days);
    byId("heads-ratio").textContent = ratio;
    byId("heads-count").textContent = formatNumber(heads);
    byId("tails-count").textContent = formatNumber(tails);
    byId("bar-heads").style.width = (total ? heads / total * 100 : 0).toFixed(1) + "%";
    byId("bar-tails").style.width = (total ? tails / total * 100 : 0).toFixed(1) + "%";
    if (statsRoot) {
      statsRoot.classList.toggle("is-loading", !statsReady);
      statsRoot.setAttribute("aria-busy", statsReady ? "false" : "true");
    }
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

  function stageOrigin() {
    const rect = stage.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  }

  function flightLimits() {
    const origin = stageOrigin();
    const margin = Math.max(18, coinRadius * .55);
    return {
      minX: margin - origin.x,
      maxX: innerWidth - margin - origin.x,
      minY: margin - origin.y,
      maxY: innerHeight - margin - origin.y,
      origin,
    };
  }

  function buildPhysics() {
    const rect = stage.getBoundingClientRect();
    const controlRect = coinControl.getBoundingClientRect();
    baseX = rect.width / 2;
    baseY = rect.height / 2;
    coinRadius = controlRect.width / 2;
    const limits = flightLimits();

    Composite.clear(engine.world, false, true);
    coinBody = Bodies.circle(baseX, baseY, coinRadius * .9, {
      restitution: .18,
      friction: .28,
      frictionAir: .00115,
      density: .0055,
      sleepThreshold: 22,
      label: "coin",
    });
    // Ground sits near the lower viewport edge so the coin may settle almost anywhere on screen.
    const groundY = baseY + limits.maxY + coinRadius * .55;
    ground = Bodies.rectangle(baseX, groundY, Math.max(innerWidth * 3, 2400), 64, { isStatic: true, label: "ground", friction: .48, restitution: .05 });
    const leftX = baseX + limits.minX - 36;
    const rightX = baseX + limits.maxX + 36;
    leftWall = Bodies.rectangle(leftX, baseY, 72, Math.max(innerHeight * 3, 2200), { isStatic: true, label: "wall", friction: .12, restitution: .22 });
    rightWall = Bodies.rectangle(rightX, baseY, 72, Math.max(innerHeight * 3, 2200), { isStatic: true, label: "wall", friction: .12, restitution: .22 });
    const ceiling = Bodies.rectangle(baseX, baseY + limits.minY - 40, Math.max(innerWidth * 3, 2400), 64, { isStatic: true, label: "ceiling", friction: .05, restitution: .12 });
    Composite.add(engine.world, [coinBody, ground, leftWall, rightWall, ceiling]);
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
    ambientCanvas.width = Math.round(width * ratio);
    ambientCanvas.height = Math.round(innerHeight * ratio);
    ambientCanvas.style.width = width + "px";
    ambientCanvas.style.height = innerHeight + "px";
    ambient.setTransform(ratio, 0, 0, ratio, 0, 0);
    ambientWorldHeight = height;
    const count = reducedMotion ? 36 : Math.round(Math.min(118, Math.max(64, width / 15)));
    ambientMotes = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      worldY: Math.random() * ambientWorldHeight,
      depth: .25 + Math.random() * .75,
      phase: Math.random() * Math.PI * 2,
      drift: .025 + Math.random() * .12,
      shape: Math.random() > .82 ? "diamond" : "dot",
    }));
    ambientRibbons = [
      { x: width * .09, worldY: height * .27, width: width * .23, turn: -1.2 },
      { x: width * .76, worldY: height * .46, width: width * .2, turn: .9 },
      { x: width * .16, worldY: height * .7, width: width * .26, turn: 1.1 },
      { x: width * .8, worldY: height * .86, width: width * .17, turn: -1 },
    ];
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

  function showTitlecard(side, message) {
    if (!titlecard || !titlecardMark) return;
    const heads = side === "heads";
    titlecard.dataset.side = side;
    titlecardKicker.textContent = heads ? "TOP · 正面" : "MOON · 反面";
    titlecardMark.textContent = heads ? "TOP" : "月";
    titlecardLine.textContent = message;
    titlecard.classList.remove("show");
    void titlecard.offsetWidth;
    titlecard.classList.add("show");
    clearTimeout(showTitlecard.timer);
    showTitlecard.timer = setTimeout(() => titlecard.classList.remove("show"), 2400);
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
    const scroll = scrollY;
    const motion = reducedMotion ? 0 : 1;
    ambient.save();
    for (const ribbon of ambientRibbons) {
      const y = ribbon.worldY - scroll;
      if (y < -220 || y > height + 220) continue;
      ambient.strokeStyle = dark ? "rgba(125,160,205,.11)" : "rgba(121,105,49,.1)";
      ambient.lineWidth = 1;
      ambient.beginPath();
      ambient.moveTo(ribbon.x - ribbon.width, y + 45);
      ambient.bezierCurveTo(ribbon.x - ribbon.width * .32, y - 50 * ribbon.turn, ribbon.x + ribbon.width * .26, y + 54 * ribbon.turn, ribbon.x + ribbon.width, y - 28);
      ambient.stroke();
      if (dark) {
        ambient.strokeStyle = "rgba(226,186,93,.08)";
        ambient.beginPath();
        ambient.ellipse(ribbon.x, y, ribbon.width * .32, ribbon.width * .1, ribbon.turn * .45, .2, Math.PI * 1.78);
        ambient.stroke();
      }
    }
    for (const mote of ambientMotes) {
      const time = now * .00018 + mote.phase;
      mote.x += Math.sin(time * 1.2) * mote.drift * motion;
      mote.worldY += Math.cos(time * .7) * mote.drift * .35 * motion;
      if (mote.x < -8) mote.x = width + 8;
      if (mote.x > width + 8) mote.x = -8;
      if (mote.worldY < 0) mote.worldY = ambientWorldHeight;
      if (mote.worldY > ambientWorldHeight) mote.worldY = 0;
      const y = mote.worldY - scroll;
      if (y < -12 || y > height + 12) continue;
      const progress = mote.worldY / Math.max(1, ambientWorldHeight);
      const shimmer = .46 + Math.sin(time * 2.2) * .28;
      const radius = dark ? (.45 + mote.depth * .9) : (.55 + mote.depth * 1.35);
      const alpha = (dark ? .26 : .17) * mote.depth * shimmer * (.6 + progress * .4);
      ambient.fillStyle = dark ? `rgba(161,194,235,${alpha})` : `rgba(178,130,38,${alpha})`;
      ambient.beginPath();
      if (mote.shape === "diamond" && !dark) {
        ambient.moveTo(mote.x, y - radius * 1.6);
        ambient.lineTo(mote.x + radius, y);
        ambient.lineTo(mote.x, y + radius * 1.6);
        ambient.lineTo(mote.x - radius, y);
        ambient.closePath();
      } else {
        ambient.arc(mote.x, y, radius, 0, Math.PI * 2);
      }
      ambient.fill();
    }
    ambient.restore();
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
    roomGain.gain.value = .07;
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
    filter.type = "highpass";
    filter.frequency.value = 1400;
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.045 + strength * .03, now + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .07);
    source.connect(filter).connect(gain);
    connectSound(gain, false);
    source.start(now, 0, .08);
  }

  function playLanding(heads, power) {
    const context = ensureAudio();
    if (!context || !noiseBuffer) return;
    const now = context.currentTime;
    const click = context.createBufferSource();
    const clickFilter = context.createBiquadFilter();
    const clickGain = context.createGain();
    click.buffer = noiseBuffer;
    clickFilter.type = "bandpass";
    clickFilter.frequency.value = heads ? 2400 : 1700;
    clickFilter.Q.value = 1.4;
    clickGain.gain.setValueAtTime(.0001, now);
    clickGain.gain.exponentialRampToValueAtTime(.16 * power, now + .003);
    clickGain.gain.exponentialRampToValueAtTime(.0001, now + .045);
    click.connect(clickFilter).connect(clickGain);
    connectSound(clickGain, false);
    click.start(now, 0, .05);

    const base = heads ? 620 : 470;
    const partials = [1, 1.51, 2.14, 2.76, 3.42, 4.08];
    partials.forEach((ratio, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(base * ratio * (1 + (Math.random() - .5) * .012), now);
      oscillator.frequency.exponentialRampToValueAtTime(base * ratio * .97, now + .09);
      const peak = .042 * Math.pow(.62, index) * power;
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + .004);
      gain.gain.exponentialRampToValueAtTime(.0001, now + (.09 + index * .012));
      oscillator.connect(gain);
      connectSound(gain, index < 2);
      oscillator.start(now);
      oscillator.stop(now + .14);
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
    launchStrength = Math.max(.35, Math.min(1, Number(strength) || .55));
    horizontal = Number(horizontal) || 0;
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
    spinSpeed = 16.4 + launchStrength * 7 + Math.random() * 2;
    precessionPhase = Math.random() * Math.PI * 2;
    result.classList.remove("show");
    if (titlecard) titlecard.classList.remove("show");
    stage.classList.remove("aiming", "impact");
    stage.classList.add("airborne");
    coin.classList.remove("settled", "dragging");
    coin.classList.add("flipping");
    setCoinStatus("IN THE AIR", "向上", statusCopy.air);
    setBusy(true);

    const startX = Number.isFinite(Number(options.x)) ? Number(options.x) : 0;
    const startY = Number.isFinite(Number(options.y)) ? Number(options.y) : 0;
    Body.setStatic(coinBody, false);
    Body.setPosition(coinBody, { x: baseX + startX, y: baseY + startY });
    const mobile = innerWidth < 600;
    const viewportScale = mobile ? 1.18 : 1.12;
    Body.setVelocity(coinBody, {
      x: Number.isFinite(options.vx) ? options.vx : horizontal * (2.6 + launchStrength * 2.8) * viewportScale,
      y: Number.isFinite(options.vy) ? options.vy : (-12.2 - launchStrength * (mobile ? 5.1 : 4.2)) * viewportScale,
    });
    if (mobile) coinBody.frictionAir = .0011;
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
    // Homecoming length follows distance: near tosses settle quickly, long flights glide home.
    const duration = reducedMotion
      ? 260
      : clamp(560 + travel * 1.55 + Math.pow(travel / 320, 1.15) * 420 + remainingAngle / Math.PI * 200 + spinSpeed * 6, 640, 3200);
    lastRevealDuration = Math.round(duration);
    const lateral = Math.abs(fromX) > 8 ? Math.sign(fromX) : (Math.random() > .5 ? 1 : -1);
    reveal = {
      start: performance.now(),
      duration,
      fromX,
      fromY,
      travel,
      arcLift: clamp(22 + travel * .12, 18, 96),
      arcBias: lateral * clamp(14 + travel * .04, 12, 48),
      fromOrientation: { ...coinOrientation },
      toOrientation: targetOrientation,
      wobbleAxis: normalizeVector({ x: .75 + Math.random() * .2, y: (Math.random() - .5) * .2, z: .2 + Math.random() * .2 }),
    };
    setCoinStatus("RETURNING", "优雅回位", statusCopy.return);
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
    const list = messages[chosenSide];
    const message = list[Math.floor(Math.random() * list.length)];
    setCoinStatus(heads ? "TOP · 正面" : "MOON · 反面", heads ? "正面朝上" : "反面朝上", message, chosenSide, true);
    showTitlecard(chosenSide, message);
    result.textContent = heads ? "✦ TOP · 正面" : "☾ 月 · 反面";
    result.className = "result show " + chosenSide;
    fateLine.textContent = "「" + message + "」";
    if (!homeImpactPlayed) {
      // A wide throw returns through the settling animation, so the final impact belongs at home.
      playLanding(heads, .72);
      impactFx(.62);
      homeImpactCount += 1;
      lastImpact = { x: 0, y: 0, source: "settle" };
    }
    celebrateResult(chosenSide);
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
      spinSpeed *= Math.pow(.9982, deltaMs / 16.7);
      peakAltitude = Math.max(peakAltitude, altitude);
      setCoinTransform(x, y, coinOrientation);
      updateShadow(altitude, x);
      if (Math.random() < .12) emitTrail(1);
      // Soft clamp inside the live viewport so free flight never leaves the screen.
      const limits = flightLimits();
      const px = coinBody.position.x;
      const py = coinBody.position.y;
      const minPX = baseX + limits.minX;
      const maxPX = baseX + limits.maxX;
      const minPY = baseY + limits.minY;
      const maxPY = baseY + limits.maxY;
      if (px < minPX || px > maxPX || py < minPY || py > maxPY) {
        Body.setPosition(coinBody, {
          x: clamp(px, minPX, maxPX),
          y: clamp(py, minPY, maxPY),
        });
        const vx = coinBody.velocity.x * (px < minPX || px > maxPX ? -.55 : .92);
        const vy = coinBody.velocity.y * (py < minPY || py > maxPY ? -.4 : .92);
        Body.setVelocity(coinBody, { x: vx, y: vy });
      }
      const settled = groundContactAt && age - groundContactAt > 520 && coinBody.speed < 1.15;
      if (settled || age > 5200) beginReveal();
    } else if (state === "revealing" && reveal) {
      const progress = Math.min(1, (now - reveal.start) / reveal.duration);
      // smoothstep ease-in-out: long flights feel like a deliberate glide, never a hard yank
      const eased = progress * progress * (3 - 2 * progress);
      const soft = eased * eased * (3 - 2 * eased);
      const lift = Math.sin(progress * Math.PI) * (reveal.arcLift || 24) * (1 - soft * .35);
      const sway = Math.sin(progress * Math.PI) * (reveal.arcBias || 0) * (1 - soft);
      const driftX = reveal.fromX * (1 - soft) + sway * .35;
      const driftY = reveal.fromY * (1 - soft) - lift;
      const orientMix = soft * soft * (3 - 2 * soft);
      const settledOrientation = slerpQuaternion(reveal.fromOrientation, reveal.toOrientation, orientMix);
      const wobble = Math.sin(progress * Math.PI * 1.8) * Math.pow(1 - progress, 1.8) * (.035 + Math.min(.04, (reveal.travel || 0) * .00004));
      coinOrientation = normalizeQuaternion(multiplyQuaternions(quaternionFromAxisAngle(reveal.wobbleAxis, wobble), settledOrientation));
      setCoinTransform(driftX, driftY, coinOrientation);
      updateShadow(Math.max(0, -driftY + lift * .2), driftX);
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
      maxX: 0,
      maxY: 0,
      samples: [{ x: event.clientX, y: event.clientY, at: now }],
    };
    const limits = flightLimits();
    pointer.maxX = Math.max(Math.abs(limits.minX), Math.abs(limits.maxX));
    pointer.maxYUp = Math.abs(limits.minY);
    pointer.maxYDown = Math.abs(limits.maxY);
    state = "dragging";
    dragTarget = { x: 0, y: 0 };
    dragPosition = { x: 0, y: 0 };
    dragVelocity = { x: 0, y: 0 };
    dragBaseOrientation = { ...coinOrientation };
    coin.classList.remove("settled", "flipping");
    coin.classList.add("dragging");
    stage.classList.add("aiming");
    result.classList.remove("show");
    setCoinStatus("DRAG", "拖动硬币", statusCopy.drag);
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
    dragTarget.y = clamp(dy, -pointer.maxYUp, pointer.maxYDown);
    const now = performance.now();
    pointer.samples.push({ x: event.clientX, y: event.clientY, at: now });
    pointer.samples = pointer.samples.filter((sample) => now - sample.at <= 140);
    if (pointer.maxDistance > 8) setCoinStatus("AIM", "松手抛出", statusCopy.aim);
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
    const strength = clamp(.4 + Math.min(distance, 420) / 520 + Math.min(gestureSpeed, 2.4) * .22, .4, 1);
    const velocityX = clamp(pointerVx * 16.667 * .72 - startX * .018, -14.5, 14.5);
    const velocityY = clamp(
      -8.6 - strength * 3.4 + clamp(pointerVy * 16.667 * .55, -8.5, 4.5) + Math.max(0, -startY) * .015 - Math.max(0, startY) * .03,
      -22,
      2.8,
    );
    launch(strength, clamp(velocityX / 8, -1, 1), { x: startX, y: startY, vx: velocityX, vy: velocityY, fromDrag: true });
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
      setCoinStatus(chosenSide === "heads" ? "TOP · 正面" : "MOON · 反面", chosenSide === "heads" ? "正面朝上" : "反面朝上", "答案已经落在掌心。想再问一次，就再抛一次。", chosenSide, true);
    } else {
      coin.style.transform = "";
      setCoinStatus("READY", "按住硬币", statusCopy.ready);
    }
  }

  coinControl.addEventListener("pointerdown", pointerDown);
  coinControl.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp, true);
  window.addEventListener("pointercancel", pointerCancel, true);
  coinControl.addEventListener("click", (event) => { if (event.detail === 0) launch(.5, 0); });
  flipButtons.forEach((button) => button.addEventListener("click", () => launch(.55, 0)));

  function automaticTheme() {
    const hour = new Date().getHours();
    return hour >= 7 && hour < 19 ? "light" : "dark";
  }

  function applyTheme(theme, animate = true) {
    if (root.dataset.theme === theme) return;
    if (animate && !reducedMotion) root.classList.add("theme-shifting");
    root.dataset.theme = theme;
    updateThemeUi(theme);
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#0b1816" : "#edf3ef";
    clearTimeout(applyTheme.timer);
    applyTheme.timer = setTimeout(() => root.classList.remove("theme-shifting"), 760);
  }

  function updateThemeUi(theme) {
    const dark = theme === "dark";
    themeToggle.setAttribute("aria-pressed", dark ? "true" : "false");
    themeToggle.setAttribute("aria-label", dark ? "切换到浅色主题" : "切换到深色主题");
  }

  updateThemeUi(root.dataset.theme);
  themeToggle.addEventListener("click", () => {
    const theme = root.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(theme);
    try {
      localStorage.setItem("pyb-theme", theme);
      localStorage.setItem("pyb-theme-mode", "manual");
    } catch (_) {}
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

  if (matchMedia("(pointer: fine)").matches) {
    root.classList.add("cursor-enabled");
    let ringX = innerWidth / 2;
    let ringY = innerHeight / 2;
    let targetX = ringX;
    let targetY = ringY;
    addEventListener("pointermove", (event) => {
      targetX = event.clientX;
      targetY = event.clientY;
      cursorDot.style.transform = `translate3d(${event.clientX}px,${event.clientY}px,0)`;
      const interactive = event.target.closest && event.target.closest("a, button, input, select, label");
      root.classList.toggle("cursor-active", !!interactive);
      root.classList.toggle("cursor-grab", !!(event.target.closest && event.target.closest("#coin-control")));
      root.classList.add("cursor-visible");
    }, { passive: true });
    const followRing = () => {
      ringX += (targetX - ringX) * .22;
      ringY += (targetY - ringY) * .22;
      cursorRing.style.transform = `translate3d(${ringX}px,${ringY}px,0)`;
      requestAnimationFrame(followRing);
    };
    requestAnimationFrame(followRing);
    addEventListener("blur", () => root.classList.remove("cursor-visible"));
    document.addEventListener("mouseleave", () => root.classList.remove("cursor-visible"));
  }

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
  updateClock();
  setInterval(() => {
    updateClock();
    try {
      if (localStorage.getItem("pyb-theme-mode") !== "manual") applyTheme(automaticTheme());
    } catch (_) { applyTheme(automaticTheme()); }
  }, 30000);
  addEventListener("resize", handleResize, { passive: true });
  fetch("/api/stats").then((response) => response.json()).then((payload) => {
    if (payload && payload.ok && payload.data) applyStats(payload.data);
  }).catch(() => {});
  requestAnimationFrame(tick);
  requestAnimationFrame(drawFx);
  requestAnimationFrame(drawAmbient);
  window.PYB_GAME = {
    launch,
    getState: () => state,
    getFlightLimits: () => flightLimits(),
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
      travel: reveal ? Math.round(reveal.travel || 0) : 0,
    }),
  };
})();
