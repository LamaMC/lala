'use strict';
const mineflayer = require('mineflayer');
const Vec3       = require('vec3');
const path       = require('path');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;

// ── Console noise suppression ─────────────────────────────────────────────────
const _warn  = console.warn;
const _error = console.error;

console.warn = (m, ...a) => {
  if (typeof m === 'string' && (
    m.includes('objectType is deprecated') ||
    m.includes('chunk failed to load')     ||
    m.includes('partial packet')           ||
    m.includes('problem inflating')        ||
    m.includes('uncompressed length')
  )) return;
  _warn(m, ...a);
};

console.error = (m, ...a) => {
  const msg = (m instanceof Error) ? (m.message ?? '')
            : (typeof m === 'string') ? m
            : String(m ?? '');
  if (msg.includes('partial packet')         ||
      msg.includes('problem inflating')      ||
      msg.includes('incorrect header check') ||
      msg.includes('Z_DATA_ERROR')           ||
      msg.includes('Chunk size is')          ||
      msg.includes('uncompressed length')) return;
  _error(m, ...a);
};

// ── Protocol patching ─────────────────────────────────────────────────────────
function patchMinecraftProtocol () {
  const zlib = require('zlib');
  if (!zlib._botPatched) {
    const _unzipSync = zlib.unzipSync;
    zlib.unzipSync = function (buf, opts) {
      try {
        return _unzipSync.call(this, buf, opts);
      } catch (_) {
        return Buffer.alloc(0);
      }
    };
    zlib._botPatched = true;
    console.log('🔧 zlib.unzipSync patched');
  }

  const pkgNames = ['minecraft-protocol', 'node-minecraft-protocol'];
  const srcDirs  = ['src', 'lib'];
  const variants = [];
  
  for (const pkg of pkgNames)
    for (const dir of srcDirs)
      variants.push([pkg, dir]);

  try {
    const mfDir = path.dirname(require.resolve('mineflayer'));
    for (const pkg of pkgNames)
      for (const dir of srcDirs)
        variants.push([path.join(mfDir, 'node_modules', pkg), dir]);
  } catch (_) {}

  let decomp = false, parser = false;

  for (const [base, dir] of variants) {
    if (!decomp) {
      try {
        const { createDecompressor } = require(`${base}/${dir}/transforms/compression`);
        const proto = Object.getPrototypeOf(createDecompressor());
        if (typeof proto._transform !== 'function') throw new Error('no _transform');
        const _orig = proto._transform;
        proto._transform = function (chunk, enc, cb) {
          try {
            _orig.call(this, chunk, enc, (err, data) => {
              if (err) return cb();
              cb(null, data);
            });
          } catch (_) { cb(); }
        };
        decomp = true;
        console.log(`🔧 Decompressor patched (${base}/${dir})`);
      } catch (_) {}
    }

    if (!parser) {
      try {
        const mod  = require(`${base}/${dir}/transforms/serializer`);
        const Ctor = mod.FullPacketParser || mod.Deserializer;
        if (!Ctor || typeof Ctor.prototype._transform !== 'function')
          throw new Error('no Ctor');
        const _orig = Ctor.prototype._transform;
        Ctor.prototype._transform = function (chunk, enc, cb) {
          try {
            _orig.call(this, chunk, enc, (err) => {
              if (err) return cb();
              cb();
            });
          } catch (_) { cb(); }
        };
        parser = true;
        console.log(`🔧 Packet parser patched (${base}/${dir})`);
      } catch (_) {}
    }

    if (decomp && parser) break;
  }
}

patchMinecraftProtocol();

// ── Last-resort safety net ────────────────────────────────────────────────────
process.on('uncaughtException', err => {
  const m     = err?.message ?? '';
  const stack = err?.stack   ?? '';

  if (m.includes('incorrect header check') ||
      m.includes('partial packet')          ||
      m.includes('Chunk size is')           ||
      m.includes('Z_DATA_ERROR')) return;

  if (err?.code === 'ERR_ASSERTION' && stack.includes('blocks.js')) return;

  throw err;
});

// ── Global config ─────────────────────────────────────────────────────────────
const HOST         = 'fakepixel.me';
const VERSION      = '1.8.9';
const WARP_COMMAND = '/warp island';

const FARM_ACCOUNT   = { username: 'Makhecha', loginCommand: '/login 3195' };
const REGROW_ACCOUNT = { username: 'LamaMC',   loginCommand: '/login 3195' };

const PING_NAMES = [FARM_ACCOUNT.username, REGROW_ACCOUNT.username];

const FARM_DURATION_MS   = 30 * 60 * 1000;
const REGROW_DURATION_MS = 5 * 60 * 1000; 
const PING_AFK_MS        = 5 * 60 * 1000; 

const SHIFT_DETECT_MIN = 4;
const SHIFT_DETECT_MAX = 256;
const DIG_COOLDOWN_MS = 300;
const MAX_BREAKS_PER_MINUTE = 1300;

let scriptEnabled = true;

// ── Farm bot (Makhecha) ───────────────────────────────────────────────────────
function createFarmBot () {
  if (!scriptEnabled) return;
  console.log(`🚀 createFarmBot() called — connecting as ${FARM_ACCOUNT.username}`);
  try {
    const bot = mineflayer.createBot({
      host: HOST,
      username: FARM_ACCOUNT.username,
      version: VERSION,
      keepAlive: true,
      checkTimeoutInterval: 60000,
    });

    let alive          = true;
    let farmingActive  = false;
    let movingRight    = true;
    let lastPos        = null;
    let pingPaused     = false;
    let regrowing      = false;
    let farmTimer      = null;
    let recentlyDug    = new Set();
    let breaksThisMinute = 0;
    let breaking       = false;

        // ── Clicking ──────────────────────────────────────────────────────────────
    function startClicking() {
  bot.on('physicsTick', onTick);
}

function stopClicking() {
  bot.removeListener('physicsTick', onTick);
}

bot.on('chat', (username, message) => {
  if (message === '!start') startClicking();
  if (message === '!stop') stopClicking();
});

function onTick () {
  if (!alive || !farmingActive || pingPaused || regrowing) return;

  // Force perfect POV lock every tick before checking for blocks.
  // West (-X) is 90 yaw, looking slightly down is 28 pitch.
  bot.look((90 * Math.PI) / 180, (28 * Math.PI) / 180, true);

  if (breaking || breaksThisMinute >= MAX_BREAKS_PER_MINUTE) return;

  const pos = bot.entity.position.floored();
  const melonOffsets = [
    { dx: -1, dy: 1, dz: 0 },
    { dx: -3, dy: 0, dz: 0 },
    { dx: -4, dy: 0, dz: 0 }
  ];

  for (const { dx, dy, dz } of melonOffsets) {
    const block = bot.blockAt(pos.offset(dx, dy, dz));
    if (!block || block.name !== 'melon_block') continue;
    
    const key = `${block.position.x},${block.position.y},${block.position.z}`;
    if (recentlyDug.has(key)) continue;

    recentlyDug.add(key);
    setTimeout(() => recentlyDug.delete(key), DIG_COOLDOWN_MS);
    breaksThisMinute++;
    breaking = true;

    bot.dig(block)
      .catch(err => console.log('⚠️ dig failed:', err.message))
      .finally(() => { breaking = false; });

    return; 
  }
}


    // ── GUI / warp ────────────────────────────────────────────────────────────
    function openTeleportGUI () {
      bot.setQuickBarSlot(0);
      bot.activateItem();

      let handled = false;

      const fallback = setTimeout(() => {
        if (handled || !alive) return;
        handled = true;
        bot.removeListener('windowOpen', onWindow);
        console.log('⚠️ [Makhecha] windowOpen timed out — disconnecting to reconnect and start over.');
        alive = false;
        bot.quit();
      }, 6000);

      async function onWindow (window) {
        if (handled || !alive) { clearTimeout(fallback); return; }
        handled = true;
        clearTimeout(fallback);

        await new Promise(res => setTimeout(res, 1000));
        if (!alive) return;
        const slot = window.slots[20];
        if (slot && slot.name !== 'air') {
          try {
            await bot.clickWindow(20, 0, 1);
            console.log('🎯 Clicked teleport item.');
          } catch (err) {
            console.log('❌ GUI click error:', err.message);
          }
        }
        if (!alive) return;
        setTimeout(() => {
          if (!alive) return;
          bot.chat(WARP_COMMAND);
          setTimeout(() => { if (alive) startFarming(); }, 5000);
        }, 2000);
      }

      bot.once('windowOpen', onWindow);
    }

    // ── Farming ───────────────────────────────────────────────────────────────
    function startFarming () {
      if (farmingActive) return;
      farmingActive = true;
      regrowing = false;

      bot.setQuickBarSlot(0);
      bot.look(-Math.PI / 2, 0, true);
      console.log('🌾 Farming started.');

      startClicking();
      setMoveDirection('right');

      farmTimer = setTimeout(() => {
        if (!alive) return;
        triggerRegrow('30-minute farm timer');
      }, FARM_DURATION_MS);

      const nudgeInterval = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(nudgeInterval); return; }
        if (pingPaused || regrowing) return;
        bot.look(-Math.PI / 2, 0, true);
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 100);
      }, 10000);

      const breakCounterInterval = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(breakCounterInterval); return; }
        breaksThisMinute = 0;
      }, 60 * 1000);

      setTimeout(() => {
        if (!alive || !farmingActive) return;
        lastPos = bot.entity.position.clone();
        console.log('📍 Position tracking started.');

        const poll = setInterval(() => {
          if (!alive || !farmingActive) { clearInterval(poll); return; }
          if (pingPaused || regrowing) { lastPos = bot.entity.position.clone(); return; }

          const pos      = bot.entity.position;
          const dropY    = lastPos.y - pos.y;
          const horizDist = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z);

          if (horizDist >= SHIFT_DETECT_MIN && horizDist <= SHIFT_DETECT_MAX) {
            console.log(`🌀 Instant XZ shift (ΔXZ: ${horizDist.toFixed(1)}) — triggering regrow.`);
            lastPos = pos.clone();
            triggerRegrow('position shift');
            return;
          }

          if (dropY >= 2 && dropY <= 3) {
            lastPos = pos.clone();
            movingRight = !movingRight;
            const dir = movingRight ? 'right' : 'left';
            console.log(`⬇️ Dropped ${dropY.toFixed(1)} blocks — switching to ${dir}`);
            setMoveDirection(dir);
          } else if (Math.abs(dropY) < 0.5) {
            lastPos = pos.clone();
          }
        }, 200);

      }, 3000);
    }

    function setMoveDirection (dir) {
      bot.setControlState('left',  false);
      bot.setControlState('right', false);
      if (dir === 'right') bot.setControlState('right', true);
      else                 bot.setControlState('left',  true);
      bot.look(-Math.PI / 2, 0, true);
    }

    function stopAllMovement () {
      bot.setControlState('right',   false);
      bot.setControlState('left',    false);
      bot.setControlState('forward', false);
      stopClicking();
    }

    function stopFarming () {
      if (!farmingActive) return;
      farmingActive = false;
      stopAllMovement();
      console.log('🛑 Farming stopped.');
    }

    // ── Regrow handoff ────────────────────────────────────────────────────────
    function triggerRegrow (reason) {
      if (regrowing || !alive) return;
      regrowing = true;
      console.log(`🥔 Regrow triggered (${reason}). Handing off to ${REGROW_ACCOUNT.username}...`);
      if (farmTimer) clearTimeout(farmTimer);
      stopFarming();
      alive = false;
      bot.manualQuit = true;
      bot.quit();
      setTimeout(() => { if (scriptEnabled) createRegrowBot(); }, 2000);
    }

    // ── Ping handling ─────────────────────────────────────────────────────────
    function handlePing () {
      if (pingPaused || !alive) return;
      pingPaused = true;
      console.log('🔔 Ping detected — going fully AFK for 5 min, then disconnecting.');
      if (farmTimer) clearTimeout(farmTimer);
      stopAllMovement();
      setTimeout(() => {
        if (!alive) return;
        console.log('🛑 5 min AFK done — disconnecting. Re-run the script to resume.');
        scriptEnabled     = false;
        bot.pingShutdown  = true;
        alive             = false;
        bot.quit();
      }, PING_AFK_MS);
    }

    // ── Bot lifecycle ─────────────────────────────────────────────────────────
    bot.loadPlugin(pathfinder);

    bot.on('login', () => console.log('🔌 [Makhecha] Login packet sent.'));
    bot._client.on('error', err => console.log('🔥 [Makhecha] Client error:', err.message));

    bot.once('spawn', () => {
      console.log('🟢 [Makhecha] SPAWN EVENT FIRED');
      try {
        bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) { console.log('⚠️ socket setup failed:', e.message); }
      console.log('✅ Spawned');
      bot.manualQuit = false;
      setTimeout(() => {
        if (!alive) return;
        bot.chat(FARM_ACCOUNT.loginCommand);
        setTimeout(() => { if (alive) openTeleportGUI(); }, 2000);
      }, 2000);
    });

    bot.on('message', (jsonMsg, position) => {
      if (position === 'game_info') return;
      const msg = jsonMsg.toString();
      console.log(`💬 [Makhecha] ${msg}`);
      if (!alive) return;

      if (farmingActive && !regrowing && /regrow/i.test(msg)) {
        console.log('🥔 "Regrow" seen in chat — triggering regrow mode.');
        triggerRegrow('chat keyword');
        return;
      }

      if (farmingActive && !regrowing && /you have 10 seconds to warp out/i.test(msg)) {
        console.log('⏱️ "10 seconds to warp out" warning seen — triggering regrow mode.');
        triggerRegrow('warp-out warning');
        return;
      }

      if (!regrowing && /Server not found./i.test(msg)) {
        console.log('🥔 "Server not found" warning seen — triggering regrow mode.');
        triggerRegrow('chat keyword');
        return;
      }

      if (!regrowing && /Unfortunately, we were unable to connect you to the server,/i.test(msg)) {
        console.log('🥔 "Unfortunately, we were unable to connect you to the server," warning seen — triggering regrow mode.');
        triggerRegrow('chat keyword');
        return;
      }

      if (!farmingActive || pingPaused) return;
      const isPinged = PING_NAMES.some(n => msg.toLowerCase().includes(n.toLowerCase()));
      if (isPinged) handlePing();
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log('☠️ Died. Restarting...');
      stopFarming();
      movingRight = true;
      setTimeout(() => {
        if (!alive) return;
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) startFarming(); }, 5000);
      }, 2000);
    });

    bot.on('end', (reason) => {
      console.log('📋 [Makhecha] End reason:', reason);
      alive = false;
      stopFarming();
      if (bot.pingShutdown) {
        console.log('🛑 Stopped after a ping — script paused. Re-run to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 Manual quit (regrow handoff) — not reconnecting as Makhecha.');
        return;
      }
      if (scriptEnabled) {
        console.log('🔁 Disconnected unexpectedly. Reconnecting as Makhecha in 5s...');
        setTimeout(createFarmBot, 5000);
      }
    });

    bot.on('error', err => console.log('❌ [Makhecha] Error:', err.message));

    bot.quitBot = function () {
      bot.manualQuit = true;
      scriptEnabled  = false;
      alive          = false;
      stopFarming();
      bot.quit();
    };

  } catch (err) {
    console.log('💥 createFarmBot crashed:', err);
  }
}

// ── Regrow bot (LamaMC) ───────────────────────────────────────────────────────
function createRegrowBot () {
  if (!scriptEnabled) return;
  console.log(`🚀 createRegrowBot() called — connecting as ${REGROW_ACCOUNT.username}`);
  try {
    const bot = mineflayer.createBot({
      host: HOST,
      username: REGROW_ACCOUNT.username,
      version: VERSION,
      keepAlive: true,
      checkTimeoutInterval: 60000,
    });

    let alive       = true;
    let pingPaused  = false;
    let regrowTimer = null;

    // ── GUI / warp ────────────────────────────────────────────────────────────
    function openTeleportGUI () {
      bot.setQuickBarSlot(0);
      bot.activateItem();

      let handled = false;

      const fallback = setTimeout(() => {
        if (handled || !alive) return;
        handled = true;
        bot.removeListener('windowOpen', onWindow);
        console.log('⚠️ [LamaMC] windowOpen timed out — disconnecting to reconnect and start over.');
        alive = false;
        bot.quit();
      }, 6000);

      async function onWindow (window) {
        if (handled || !alive) { clearTimeout(fallback); return; }
        handled = true;
        clearTimeout(fallback);

        await new Promise(res => setTimeout(res, 1000));
        if (!alive) return;
        const slot = window.slots[20];
        if (slot && slot.name !== 'air') {
          try {
            await bot.clickWindow(20, 0, 1);
            console.log('🎯 [LamaMC] Clicked teleport item.');
          } catch (err) {
            console.log('❌ [LamaMC] GUI click error:', err.message);
          }
        }
        if (!alive) return;
        setTimeout(() => {
          if (!alive) return;
          bot.chat(WARP_COMMAND);
          setTimeout(() => { if (alive) enterAfkPool(); }, 5000);
        }, 2000);
      }

      bot.once('windowOpen', onWindow);
    }

    // ── AFK regrow wait ───────────────────────────────────────────────────────
    function enterAfkPool () {
      console.log(`⏳ [LamaMC] AFK regrow wait started (${REGROW_DURATION_MS / 1000}s).`);
      regrowTimer = setTimeout(() => {
        if (!alive) return;
        console.log(`✅ [LamaMC] Regrow wait done — handing back to ${FARM_ACCOUNT.username}.`);
        alive = false;
        bot.manualQuit = true;
        bot.quit();
        setTimeout(() => { if (scriptEnabled) createFarmBot(); }, 2000);
      }, REGROW_DURATION_MS);
    }

    // ── Ping handling ─────────────────────────────────────────────────────────
    function handlePing () {
      if (pingPaused || !alive) return;
      pingPaused = true;
      console.log('🔔 [LamaMC] Ping detected — going fully AFK for 5 min, then disconnecting.');
      if (regrowTimer) clearTimeout(regrowTimer);
      setTimeout(() => {
        if (!alive) return;
        console.log('🛑 [LamaMC] 5 min AFK done — disconnecting. Re-run the script to resume.');
        scriptEnabled    = false;
        bot.pingShutdown = true;
        alive            = false;
        bot.quit();
      }, PING_AFK_MS);
    }

    // ── Bot lifecycle ─────────────────────────────────────────────────────────
    bot.loadPlugin(pathfinder);

    bot.on('login', () => console.log('🔌 [LamaMC] Login packet sent.'));
    bot._client.on('error', err => console.log('🔥 [LamaMC] Client error:', err.message));

    bot.once('spawn', () => {
      console.log('🟢 [LamaMC] SPAWN EVENT FIRED');
      try {
        bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) { console.log('⚠️ [LamaMC] socket setup failed:', e.message); }
      console.log('✅ [LamaMC] Spawned');
      bot.manualQuit = false;
      setTimeout(() => {
        if (!alive) return;
        bot.chat(REGROW_ACCOUNT.loginCommand);
        setTimeout(() => { if (alive) openTeleportGUI(); }, 2000);
      }, 2000);
    });

    bot.on('message', (jsonMsg, position) => {
      if (position === 'game_info') return;
      const msg = jsonMsg.toString();
      console.log(`💬 [LamaMC] ${msg}`);
      if (!alive || pingPaused) return;
      const isPinged = PING_NAMES.some(n => msg.toLowerCase().includes(n.toLowerCase()));
      if (isPinged) handlePing();
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log('☠️ [LamaMC] Died — re-warping and resuming wait.');
      if (regrowTimer) clearTimeout(regrowTimer);
      setTimeout(() => {
        if (!alive) return;
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) enterAfkPool(); }, 5000);
      }, 2000);
    });

    bot.on('end', (reason) => {
      console.log('📋 [LamaMC] End reason:', reason);
      alive = false;
      if (regrowTimer) clearTimeout(regrowTimer);

      if (bot.pingShutdown) {
        console.log('🛑 [LamaMC] Stopped after a ping — script paused. Re-run to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 [LamaMC] Manual quit — not reconnecting as LamaMC.');
        return;
      }
      if (scriptEnabled) {
        console.log('🔁 [LamaMC] Disconnected unexpectedly. Reconnecting in 5s...');
        setTimeout(createRegrowBot, 5000);
      }
    });

    bot.on('error', err => console.log('❌ [LamaMC] Error:', err.message));

  } catch (err) {
    console.log('💥 createRegrowBot crashed:', err);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
createFarmBot();
