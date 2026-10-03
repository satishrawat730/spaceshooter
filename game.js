(() => {
  'use strict';
  const canvas = document.querySelector('#game');
  const ctx = canvas.getContext('2d');
  const overlay = document.querySelector('#overlay');
  const startButton = document.querySelector('#startButton');
  const keys = new Set();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let w = 0, h = 0, dpr = 1, state = 'title', last = 0, clock = 0, score = 0, wave = 0, best = +(localStorage.getItem('starfallBest') || 0);
  let player, enemies = [], shots = [], enemyShots = [], asteroids = [], asteroidTimer = 25, particles = [], stars = [], formation = { direction: 1, offset: 0, y: 0, drop: 0 }, spawnQueue = [], spawnTimer = 0, musicTimer = 0, audio = null, firing = false, waveMessageTimer;
  const scoreEl = document.querySelector('#score'), livesEl = document.querySelector('#lives'), healthEl = document.querySelector('#healthFill'), healthText = document.querySelector('#healthText');
  document.querySelector('#bestScore').textContent = String(best).padStart(6, '0');
  function resize() {
    const box = canvas.getBoundingClientRect(); dpr = Math.min(devicePixelRatio || 1, 2); w = box.width; h = box.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (player) player.x = clamp(player.x, 20, w - 20);
    stars = Array.from({ length: Math.max(65, Math.round(w * h / 4200)) }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.35 + .25, speed: Math.random() * 13 + 5, alpha: Math.random() * .65 + .2, phase: Math.random() * 7 }));
  }
  new ResizeObserver(resize).observe(canvas); resize();
  function initAudio() {
    if (!audio) { const AudioCtx = window.AudioContext || window.webkitAudioContext; if (!AudioCtx) return; audio = new AudioCtx(); }
    if (audio.state === 'suspended') audio.resume();
  }
  function tone(freq, duration, type = 'sine', volume = .045, endFreq = freq, delay = 0) {
    if (!audio) return;
    const osc = audio.createOscillator(), gain = audio.createGain(); osc.type = type; osc.frequency.setValueAtTime(freq, audio.currentTime + delay); osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), audio.currentTime + delay + duration);
    gain.gain.setValueAtTime(.0001, audio.currentTime + delay); gain.gain.exponentialRampToValueAtTime(volume, audio.currentTime + delay + .012); gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + delay + duration);
    osc.connect(gain); gain.connect(audio.destination); osc.start(audio.currentTime + delay); osc.stop(audio.currentTime + delay + duration + .03);
  }
  function sfx(kind) { if (!audio) return; if (kind === 'shoot') tone(760, .12, 'sawtooth', .018, 270); if (kind === 'enemy') tone(190, .3, 'square', .013, 90); if (kind === 'hit') tone(240, .13, 'triangle', .04, 95); if (kind === 'boom') { tone(120, .45, 'sawtooth', .06, 40); tone(73, .55, 'triangle', .06, 32, .04); } }
  const melody = [392, 523.25, 659.25, 523.25, 440, 587.33, 698.46, 587.33, 349.23, 466.16, 587.33, 466.16, 392, 523.25, 659.25, 784];
  function music(dt) { if (!audio || state !== 'playing') return; musicTimer -= dt; if (musicTimer <= 0) { const i = Math.floor(clock * 2) % melody.length; tone(melody[i], .17, 'triangle', .012, melody[i] * .99); if (i % 4 === 0) tone(98, .23, 'sine', .018, 70); musicTimer = .24; } }
  function startGame() {
    initAudio(); score = 0; wave = 0; shots = []; enemyShots = []; asteroids = []; asteroidTimer = 25; particles = []; enemies = []; player = { x: w / 2, y: h - 61, health: 50, lives: 3, cooldown: 0, invuln: 1.2, speed: 330 }; formation = { direction: 1, offset: 0, y: 0, drop: 0 };
    updateHud(); state = 'playing'; overlay.classList.add('hidden'); startWave(); last = performance.now();
  }
  function startWave() {
    wave++; const rows = Math.min(3 + Math.floor(wave / 3), 5), cols = clamp(Math.floor(w / 68), 5, 10); enemies = []; spawnQueue = [];
    const spacing = Math.min(61, (w - 65) / Math.max(cols, 1));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) spawnQueue.push({ col: c, row: r, spacing, cols, rows });
    spawnTimer = .1; formation.offset = 0; formation.direction = 1; formation.y = 0; formation.drop = 0;
    const banner = document.querySelector('#waveBanner'); banner.textContent = `WAVE ${String(wave).padStart(2, '0')}`; banner.classList.add('show'); clearTimeout(waveMessageTimer); waveMessageTimer = setTimeout(() => banner.classList.remove('show'), 1250);
  }
  function launchAttackers(count = 5) {
    const reserves = enemies.filter(e => e.mode === 'formation');
    // Select a spread of ships so each attack wave fans out across the formation.
    const selected = reserves.length <= count ? reserves : Array.from({ length: count }, (_, i) => reserves[Math.floor((i + .5) * reserves.length / count)]);
    for (const e of selected) {
      e.mode = 'attacking'; e.diver = true; e.attackY = e.y; e.attackX = e.homeX + formation.offset; e.phase = Math.random() * Math.PI * 2;
      e.fire = 1.4 + Math.random() * 1.6;
    }
  }
  function refillAttackers() {
    const attacking = enemies.filter(e => e.mode === 'attacking').length;
    const reserves = enemies.filter(e => e.mode === 'formation').length;
    if (reserves && attacking < 5) launchAttackers(1);
  }
  function updateHud() {
    scoreEl.textContent = String(score).padStart(6, '0'); if (!player) return;
    livesEl.innerHTML = Array.from({ length: 3 }, (_, i) => `<span style="opacity:${i < player.lives ? 1 : .19}">♥</span>`).join(' ');
    healthEl.style.width = `${player.health * 2}%`; healthText.textContent = `${player.health} / 50`;
  }
  function overlayState(gameOver = false) {
    state = gameOver ? 'over' : 'title'; overlay.classList.remove('hidden');
    document.querySelector('#overlayTitle').innerHTML = gameOver ? 'GAME<span>OVER</span>' : 'STAR<span>FALL</span>';
    document.querySelector('#overlayCopy').innerHTML = gameOver ? `Mission ended at wave ${String(wave).padStart(2, '0')}.<br>The outer rim will remember your fight.` : 'The outer rim is under attack.<br>Hold the line, pilot.';
    document.querySelector('#buttonLabel').textContent = gameOver ? 'PLAY AGAIN' : 'START MISSION';
    document.querySelector('#bestScore').textContent = String(best).padStart(6, '0');
  }
  startButton.addEventListener('click', startGame);
  window.addEventListener('keydown', e => { if (['ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); keys.add(e.code); if (e.code === 'Space') firing = true; if ((e.code === 'Enter' || e.code === 'Space') && state !== 'playing') startGame(); }, { passive: false });
  window.addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'Space') firing = false; });
  canvas.addEventListener('pointerdown', e => { if (e.button === 0) { firing = true; initAudio(); } });
  window.addEventListener('pointerup', () => firing = false); window.addEventListener('blur', () => { firing = false; keys.clear(); });
  function burst(x, y, color, n = 12) { for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, speed = 30 + Math.random() * 145; particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: .28 + Math.random() * .52, max: .8, size: 1 + Math.random() * 2.6, color }); } }
  function shootPlayer() { shots.push({ x: player.x, y: player.y - 19, vy: -490 }); player.cooldown = .27; sfx('shoot'); }
  function enemyShoot(enemy) {
    const n = (wave >= 3 && Math.random() < .32) ? 2 : 1;
    for (let i = 0; i < n; i++) enemyShots.push({ x: enemy.x + (n === 2 ? (i ? 8 : -8) : 0), y: enemy.y + 10, vx: n === 2 ? (i ? 30 : -30) : 0, vy: 145 + Math.min(wave * 8, 95) });
    sfx('enemy');
  }
  function spawnAsteroid() {
    const radius = 9 + Math.random() * 7;
    asteroids.push({ x: radius + Math.random() * Math.max(1, w - radius * 2), y: -radius, r: radius, speed: 20 + Math.random() * 15, drift: (Math.random() - .5) * 14, angle: Math.random() * Math.PI * 2, spin: (Math.random() - .5) * .65, shape: Array.from({ length: 9 }, () => .76 + Math.random() * .36) });
  }
  function damagePlayer() {
    if (player.invuln > 0) return; player.health -= 10; player.invuln = .9; burst(player.x, player.y, '#ff778c', 11); sfx('hit');
    if (player.health <= 0) { player.lives--; if (player.lives <= 0) { player.lives = 0; updateHud(); burst(player.x, player.y, '#69eee5', 36); sfx('boom'); best = Math.max(best, score); localStorage.setItem('starfallBest', best); setTimeout(() => overlayState(true), 550); state = 'dying'; return; } player.health = 50; player.x = w / 2; player.invuln = 1.6; sfx('boom'); }
    updateHud();
  }
  function update(dt) {
    clock += dt;
    for (const s of stars) { s.y += s.speed * dt; s.phase += dt * 1.5; if (s.y > h + 3) { s.y = -3; s.x = Math.random() * w; } }
    if (state !== 'playing') return;
    music(dt); player.invuln = Math.max(0, player.invuln - dt); player.cooldown -= dt;
    asteroidTimer -= dt;
    if (asteroidTimer <= 0) { spawnAsteroid(); asteroidTimer = 25; }
    if (keys.has('ArrowLeft')) player.x -= player.speed * dt; if (keys.has('ArrowRight')) player.x += player.speed * dt;
    player.x = clamp(player.x, 25, w - 25); if (firing && player.cooldown <= 0) shootPlayer();
    spawnTimer -= dt; if (spawnQueue.length && spawnTimer <= 0) { const d = spawnQueue.shift(); const x = (w - (d.cols - 1) * d.spacing) / 2 + d.col * d.spacing; const homeY = 62 + d.row * 36; enemies.push({ x, y: -35, homeX: x, homeY, row: d.row, mode: 'formation', diver: false, phase: Math.random() * 6, fire: 0, hp: 20 }); spawnTimer = Math.max(.035, .1 - wave * .003); }
    // The intact formation slides side to side like a broad sine wave.
    const formationSpan = Math.min(61, (w - 65) / 5) * (Math.max(5, Math.min(10, Math.floor(w / 68))) - 1);
    const formationRange = Math.max(0, Math.min(w * .23, 150, (w - formationSpan) / 2 - 24));
    formation.offset = Math.sin(clock * (1.15 + Math.min(wave, 8) * .035)) * formationRange;
    formation.y = Math.sin(clock * 2.3) * 5;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]; e.phase += dt; e.fire -= dt;
      if (e.mode === 'attacking') {
        e.y += (48 + wave * 3.5) * dt;
        e.x = e.attackX + formation.offset * .25 + Math.sin(e.phase + clock * (2.4 + wave * .06)) * Math.min(92, w * .17);
        if (e.fire <= 0 && e.y > 28) { enemyShoot(e); e.fire = 5; }
      } else {
        e.x = e.homeX + formation.offset;
        e.y += (e.y < e.homeY + formation.y ? 72 : 0) * dt;
        if (e.y >= e.homeY + formation.y) e.y = e.homeY + formation.y;
      }
      if (e.mode === 'attacking' && e.y > h - 88) { enemies.splice(i, 1); damagePlayer(); refillAttackers(); continue; }
      if (e.mode === 'attacking' && Math.abs(e.x - player.x) < 20 && Math.abs(e.y - player.y) < 20) { enemies.splice(i, 1); burst(e.x, e.y, '#ffb966', 12); damagePlayer(); refillAttackers(); }
    }
    for (let i = shots.length - 1; i >= 0; i--) { const b = shots[i]; b.y += b.vy * dt; if (b.y < -12) { shots.splice(i, 1); continue; } for (let j = enemies.length - 1; j >= 0; j--) { const e = enemies[j]; if (Math.abs(b.x - e.x) < 17 && Math.abs(b.y - e.y) < 14) { shots.splice(i, 1); e.hp = (e.hp || 20) - 10; burst(b.x, b.y, '#91fff1', 4); if (e.hp <= 0) { const wasAttacking = e.mode === 'attacking'; enemies.splice(j, 1); score += 100 + (wasAttacking ? 50 : 0); burst(e.x, e.y, '#ffb966', 15); sfx('boom'); updateHud(); if (wasAttacking) refillAttackers(); } else sfx('hit'); break; } } }
    for (let i = enemyShots.length - 1; i >= 0; i--) { const b = enemyShots[i]; b.x += b.vx * dt; b.y += b.vy * dt; if (b.y > h + 10) { enemyShots.splice(i, 1); continue; } if (Math.abs(b.x - player.x) < 13 && Math.abs(b.y - player.y) < 19) { enemyShots.splice(i, 1); damagePlayer(); } }
    for (let i = asteroids.length - 1; i >= 0; i--) {
      const rock = asteroids[i]; rock.y += rock.speed * dt; rock.x = clamp(rock.x + rock.drift * dt, rock.r, w - rock.r); rock.angle += rock.spin * dt;
      if (rock.y > h + rock.r) { asteroids.splice(i, 1); continue; }
      if (Math.hypot(rock.x - player.x, rock.y - player.y) < rock.r + 13) { asteroids.splice(i, 1); burst(rock.x, rock.y, '#b9c4d3', 10); damagePlayer(); }
    }
    for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .985; p.vy *= .985; p.life -= dt; if (p.life <= 0) particles.splice(i, 1); }
    if (spawnQueue.length === 0 && enemies.length && !enemies.some(e => e.mode === 'attacking')) launchAttackers(5);
    if (enemies.length === 0 && spawnQueue.length === 0) { enemyShots = []; startWave(); }
  }
  function drawShip(x, y, scale, color, enemy = false) {
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale); ctx.shadowBlur = 15; ctx.shadowColor = color;
    ctx.beginPath();
    if (!enemy) { ctx.moveTo(0, -19); ctx.lineTo(14, 13); ctx.lineTo(5, 10); ctx.lineTo(0, 16); ctx.lineTo(-5, 10); ctx.lineTo(-14, 13); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.fillStyle = '#eaffff'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.fill(); }
    else {
      // Broad central hull with twin swept wings: a small drone / interceptor silhouette.
      ctx.moveTo(0, -17); ctx.lineTo(5, -9); ctx.lineTo(24, 1); ctx.lineTo(19, 10); ctx.lineTo(7, 6); ctx.lineTo(4, 15); ctx.lineTo(-4, 15); ctx.lineTo(-7, 6); ctx.lineTo(-19, 10); ctx.lineTo(-24, 1); ctx.lineTo(-5, -9); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      ctx.fillStyle = '#ffdca7'; ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(4, 3); ctx.lineTo(0, 7); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffdf9e'; ctx.fillRect(-21, 1, 4, 3); ctx.fillRect(17, 1, 4, 3);
    }
    ctx.restore();
  }
  function render() {
    ctx.clearRect(0, 0, w, h); const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0b1122'); bg.addColorStop(.52, '#10172a'); bg.addColorStop(1, '#111627'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * .51, h * .57, 0, w * .51, h * .57, w * .52); glow.addColorStop(0, '#21344b42'); glow.addColorStop(1, '#11162700'); ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    for (const s of stars) { ctx.globalAlpha = s.alpha * (.64 + Math.sin(s.phase) * .26); ctx.fillStyle = '#ecf6ff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
    for (const b of shots) { ctx.shadowBlur = 12; ctx.shadowColor = '#70fff0'; ctx.fillStyle = '#c5fff6'; ctx.fillRect(b.x - 1.5, b.y - 9, 3, 13); }
    ctx.shadowBlur = 0;
    for (const b of enemyShots) { ctx.shadowBlur = 9; ctx.shadowColor = '#ff8090'; ctx.fillStyle = '#ff9aa1'; ctx.beginPath(); ctx.arc(b.x, b.y, 3.2, 0, 7); ctx.fill(); }
    for (const rock of asteroids) {
      ctx.save(); ctx.translate(rock.x, rock.y); ctx.rotate(rock.angle); ctx.shadowBlur = 7; ctx.shadowColor = '#92a2b888';
      ctx.beginPath(); for (let i = 0; i < rock.shape.length; i++) { const a = i / rock.shape.length * Math.PI * 2; const rr = rock.r * rock.shape[i]; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.closePath();
      ctx.fillStyle = '#778397'; ctx.fill(); ctx.strokeStyle = '#c1cad5'; ctx.lineWidth = 1; ctx.stroke(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#596779'; ctx.beginPath(); ctx.ellipse(-rock.r * .2, -rock.r * .12, rock.r * .21, rock.r * .13, -.3, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(rock.r * .28, rock.r * .24, rock.r * .13, rock.r * .09, .2, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    for (const e of enemies) { drawShip(e.x, e.y, .78, e.diver ? '#ffbd75' : '#ff7f89', true); if (e.hp === 10) { ctx.fillStyle = '#ffdc9d'; ctx.fillRect(e.x - 3, e.y + 17, 6, 2); } }
    if (player && state !== 'title' && state !== 'over') { if (player.invuln <= 0 || Math.floor(clock * 15) % 2 === 0) drawShip(player.x, player.y, 1, '#72f5e3'); ctx.globalAlpha = .7; ctx.fillStyle = '#ffbd75'; ctx.beginPath(); ctx.moveTo(player.x - 4, player.y + 10); ctx.lineTo(player.x, player.y + 17 + Math.random() * 9); ctx.lineTo(player.x + 4, player.y + 10); ctx.fill(); ctx.globalAlpha = 1; }
    for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.size, p.size); } ctx.globalAlpha = 1; ctx.shadowBlur = 0;
    if (state === 'title') { ctx.globalAlpha = .035; ctx.strokeStyle = '#a6d5ff'; ctx.lineWidth = 1; for (let y = 0; y < h; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); } ctx.globalAlpha = 1; }
  }
  function frame(now) { const dt = Math.min((now - last) / 1000 || 0, .033); last = now; update(dt); render(); requestAnimationFrame(frame); }
  requestAnimationFrame(now => { last = now; requestAnimationFrame(frame); });
})();
