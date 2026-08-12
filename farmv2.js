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

// ── Deep patch: bad server packets no longer kill the connection ───────────────
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
      m.includes('partial packet')         ||
      m.includes('Chunk size is')          ||
      m.includes('Z_DATA_ERROR')) return;

  if (err?.code === 'ERR_ASSERTION' && stack.includes('blocks.js')) return;

  throw err;
});

// ── Global config ─────────────────────────────────────────────────────────────
const HOST         = 'fakepixel.me';
const VERSION      = '1.8.9';
const WARP_COMMAND = '/warp island';

const FARM_ACCOUNT    = { username: 'Banarsi', loginCommand: '/login 3195' };
const FARM_II_ACCOUNT = { username: 'LamaMC',  loginCommand: '/login 3195' };

const PING_NAMES = [FARM_ACCOUNT.username, FARM_II_ACCOUNT.username];

const FARM_DURATION_MS   = 22 * 60 * 1000; // Farm 22 min, then switch
const PING_AFK_MS        =  5 * 60 * 1000; // Stand still 5 min after a ping, then hard-stop

const SHIFT_DETECT_MIN = 4;
const SHIFT_DETECT_MAX = 256;

const DIG_COOLDOWN_MS = 300;
const MAX_BREAKS_PER_MINUTE = 1300;

// Master switch. Set to false (e.g. by a ping) to fully stop the whole loop.
let scriptEnabled = true;

// ── Farm bot (Banarsi - Potatoes) ─────────────────────────────────────────────
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

    let alive            = true;
    let farmingActive    = false;
    let movingRight      = true;
    let lastPos          = null;
    let pingPaused       = false;
    let switching        = false;
    let farmTimer        = null;
    let recentlyDug      = new Set();
    let breaksThisMinute = 0;

    // ── Clicking ──────────────────────────────────────────────────────────────
    function onTick () {
      if (!alive || !farmingActive || pingPaused || switching) return;
      if (breaksThisMinute >= MAX_BREAKS_PER_MINUTE) return;
      bot.look(-Math.PI / 2, 0, true);

      const pos = bot.entity.position.floored();
      for (let x = 1; x <= 5; x++) {
        const block = bot.blockAt(pos.offset(x, 1, 0));
        if (!block || block.name !== 'potatoes' || block.metadata !== 7) continue;
        const key = `${block.position.x},${block.position.y},${block.position.z}`;
        if (recentlyDug.has(key)) continue;
        recentlyDug.add(key);
        setTimeout(() => recentlyDug.delete(key), DIG_COOLDOWN_MS);
        breaksThisMinute++;
        bot.swingArm('right');
        bot._client.write('block_dig', { status: 0, location: block.position, face: 1 });
        bot._client.write('block_dig', { status: 2, location: block.position, face: 1 });
        if (breaksThisMinute >= MAX_BREAKS_PER_MINUTE) return;
      }
    }

    function startClicking () {
      bot.setQuickBarSlot(0);
      bot.on('physicsTick', onTick);
      console.log('🖱️ [Banarsi] Attack started.');
    }

    function stopClicking () {
      bot.removeListener('physicsTick', onTick);
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
        console.log('⚠️ [Banarsi] windowOpen timed out — disconnecting to swap.');
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
            console.log('🎯 [Banarsi] Clicked teleport item.');
          } catch (err) {
            console.log('❌ [Banarsi] GUI click error:', err.message);
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
      switching = false;

      bot.setQuickBarSlot(0);
      bot.look(Math.PI / 2, 0, true);
      console.log('🌾 [Banarsi] Farming started.');

      startClicking();
      setMoveDirection('right');

      // 22-minute farm timer → hand off to Farm II mode
      farmTimer = setTimeout(() => {
        if (!alive) return;
        triggerSwitch('22-minute farm timer');
      }, FARM_DURATION_MS);

      const nudgeInterval = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(nudgeInterval); return; }
        if (pingPaused || switching) return;
        bot.look(Math.PI / 2, 0, true);
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
        console.log('📍 [Banarsi] Position tracking started.');

        const poll = setInterval(() => {
          if (!alive || !farmingActive) { clearInterval(poll); return; }
          if (pingPaused || switching) { lastPos = bot.entity.position.clone(); return; }

          const pos      = bot.entity.position;
          const dropY    = lastPos.y - pos.y;
          const horizDist = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z);

          if (horizDist >= SHIFT_DETECT_MIN && horizDist <= SHIFT_DETECT_MAX) {
            console.log(`🌀 [Banarsi] Instant XZ shift (ΔXZ: ${horizDist.toFixed(1)}) — triggering switch.`);
            lastPos = pos.clone();
            triggerSwitch('position shift');
            return;
          }

          if (dropY >= 2 && dropY <= 3) {
            lastPos = pos.clone();
            movingRight = !movingRight;
            const dir = movingRight ? 'right' : 'left';
            console.log(`⬇️ [Banarsi] Dropped ${dropY.toFixed(1)} blocks — switching to ${dir}`);
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
      bot.look(Math.PI / 2, 0, true);
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
      console.log('🛑 [Banarsi] Farming stopped.');
    }

    // ── Switch Handoff ────────────────────────────────────────────────────────
    function triggerSwitch (reason) {
      if (switching || !alive) return;
      switching = true;
      console.log(`🥔 [Banarsi] Switch triggered (${reason}). Handing off to ${FARM_II_ACCOUNT.username}...`);
      if (farmTimer) clearTimeout(farmTimer);
      stopFarming();
      alive = false;
      bot.manualQuit = true;
      bot.quit();
      setTimeout(() => { if (scriptEnabled) createFarmIIBot(); }, 2000);
    }

    // ── Ping handling ─────────────────────────────────────────────────────────
    function handlePing () {
      if (pingPaused || !alive) return;
      pingPaused = true;
      console.log('🔔 [Banarsi] Ping detected — going fully AFK for 5 min, then disconnecting.');
      if (farmTimer) clearTimeout(farmTimer);
      stopAllMovement();
      setTimeout(() => {
        if (!alive) return;
        console.log('🛑 [Banarsi] 5 min AFK done — disconnecting. Re-run the script to resume.');
        scriptEnabled     = false;
        bot.pingShutdown  = true;
        alive             = false;
        bot.quit();
      }, PING_AFK_MS);
    }

    // ── Bot lifecycle ─────────────────────────────────────────────────────────
    bot.loadPlugin(pathfinder);
    bot.on('login', () => console.log('🔌 [Banarsi] Login packet sent.'));
    bot._client.on('error', err => console.log('🔥 [Banarsi] Client error:', err.message));

    bot.once('spawn', () => {
      console.log('🟢 [Banarsi] SPAWN EVENT FIRED');
      try {
        bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) { console.log('⚠️ [Banarsi] socket setup failed:', e.message); }
      console.log('✅ [Banarsi] Spawned');
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
      console.log(`💬 [Banarsi] ${msg}`);
      if (!alive) return;

      if (farmingActive && !switching && /regrow/i.test(msg)) {
        triggerSwitch('chat keyword');
        return;
      }

      if (farmingActive && !switching && /you have 10 seconds to warp out/i.test(msg)) {
        triggerSwitch('warp-out warning');
        return;
      }

      if (!switching && /Server not found./i.test(msg)) {
        triggerSwitch('chat keyword');
        return;
      }

      if (!switching && /Unfortunately, we were unable to connect you to the server,/i.test(msg)) {
        triggerSwitch('chat keyword');
        return;
      }

      if (!farmingActive || pingPaused) return;
      const isPinged = PING_NAMES.some(n => msg.toLowerCase().includes(n.toLowerCase()));
      if (isPinged) handlePing();
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log('☠️ [Banarsi] Died. Restarting...');
      stopFarming();
      movingRight = true;
      setTimeout(() => {
        if (!alive) return;
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) startFarming(); }, 5000);
      }, 2000);
    });

    bot.on('end', (reason) => {
      console.log('📋 [Banarsi] End reason:', reason);
      alive = false;
      stopFarming();
      if (bot.pingShutdown) {
        console.log('🛑 [Banarsi] Stopped after a ping — script paused. Re-run to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 [Banarsi] Manual quit (switch handoff).');
        return;
      }
      // Switch on ANY disconnect
      if (scriptEnabled) {
        console.log(`🔁 [Banarsi] Disconnected unexpectedly. Switching to ${FARM_II_ACCOUNT.username} in 5s...`);
        setTimeout(createFarmIIBot, 5000);
      }
    });

    bot.on('error', err => console.log('❌ [Banarsi] Error:', err.message));

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

// ── Farm II bot (LamaMC - Wheat) ──────────────────────────────────────────────
function createFarmIIBot () {
  if (!scriptEnabled) return;
  console.log(`🚀 createFarmIIBot() called — connecting as ${FARM_II_ACCOUNT.username}`);
  try {
    const bot = mineflayer.createBot({
      host: HOST,
      username: FARM_II_ACCOUNT.username,
      version: VERSION,
      keepAlive: true,
      checkTimeoutInterval: 60000,
    });

    let alive            = true;
    let farmingActive    = false;
    let movingRight      = true;
    let lastPos          = null;
    let pingPaused       = false;
    let switching        = false;
    let farmTimer        = null;
    let recentlyDug      = new Set();
    let breaksThisMinute = 0;

    // ── Clicking (Custom Wheat Logic) ─────────────────────────────────────────
    function onTick () {
      if (!alive || !farmingActive || pingPaused || switching) return;
      if (breaksThisMinute >= MAX_BREAKS_PER_MINUTE) return;
      bot.look(Math.PI / 2, 0, true);

      const pos = bot.entity.position.floored();
      for (let x = 1; x <= 5; x++) {
        const block = bot.blockAt(pos.offset(-x, 1, 0));
        if (!block || block.name !== 'wheat' || block.metadata !== 7) continue;
        const key = `${block.position.x},${block.position.y},${block.position.z}`;
        if (recentlyDug.has(key)) continue;
        recentlyDug.add(key);
        setTimeout(() => recentlyDug.delete(key), DIG_COOLDOWN_MS);
        breaksThisMinute++;
        bot.swingArm('right');
        bot._client.write('block_dig', { status: 0, location: block.position, face: 1 });
        bot._client.write('block_dig', { status: 2, location: block.position, face: 1 });
        if (breaksThisMinute >= MAX_BREAKS_PER_MINUTE) return;
      }
    }

    function startClicking () {
      bot.setQuickBarSlot(0);
      bot.on('physicsTick', onTick);
      console.log('🖱️ [LamaMC] Attack started.');
    }

    function stopClicking () {
      bot.removeListener('physicsTick', onTick);
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
        console.log('⚠️ [LamaMC] windowOpen timed out — disconnecting to swap.');
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
          setTimeout(() => { if (alive) startFarming(); }, 5000);
        }, 2000);
      }

      bot.once('windowOpen', onWindow);
    }

    // ── Farming ───────────────────────────────────────────────────────────────
    function startFarming () {
      if (farmingActive) return;
      farmingActive = true;
      switching = false;

      bot.setQuickBarSlot(0);
      bot.look(Math.PI / 2, 0, true);
      console.log('🌾 [LamaMC] Farming started.');

      startClicking();
      setMoveDirection('right');

      // 22-minute farm timer → hand off to Banarsi
      farmTimer = setTimeout(() => {
        if (!alive) return;
        triggerSwitch('22-minute farm timer');
      }, FARM_DURATION_MS);

      const nudgeInterval = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(nudgeInterval); return; }
        if (pingPaused || switching) return;
        bot.look(Math.PI / 2, 0, true);
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
        console.log('📍 [LamaMC] Position tracking started.');

        const poll = setInterval(() => {
          if (!alive || !farmingActive) { clearInterval(poll); return; }
          if (pingPaused || switching) { lastPos = bot.entity.position.clone(); return; }

          const pos      = bot.entity.position;
          const dropY    = lastPos.y - pos.y;
          const horizDist = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z);

          if (horizDist >= SHIFT_DETECT_MIN && horizDist <= SHIFT_DETECT_MAX) {
            console.log(`🌀 [LamaMC] Instant XZ shift (ΔXZ: ${horizDist.toFixed(1)}) — triggering switch.`);
            lastPos = pos.clone();
            triggerSwitch('position shift');
            return;
          }

          if (dropY >= 2 && dropY <= 3) {
            lastPos = pos.clone();
            movingRight = !movingRight;
            const dir = movingRight ? 'right' : 'left';
            console.log(`⬇️ [LamaMC] Dropped ${dropY.toFixed(1)} blocks — switching to ${dir}`);
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
      bot.look(Math.PI / 2, 0, true);
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
      console.log('🛑 [LamaMC] Farming stopped.');
    }

    // ── Switch Handoff ────────────────────────────────────────────────────────
    function triggerSwitch (reason) {
      if (switching || !alive) return;
      switching = true;
      console.log(`🥔 [LamaMC] Switch triggered (${reason}). Handing off to ${FARM_ACCOUNT.username}...`);
      if (farmTimer) clearTimeout(farmTimer);
      stopFarming();
      alive = false;
      bot.manualQuit = true;
      bot.quit();
      setTimeout(() => { if (scriptEnabled) createFarmBot(); }, 2000);
    }

    // ── Ping handling ─────────────────────────────────────────────────────────
    function handlePing () {
      if (pingPaused || !alive) return;
      pingPaused = true;
      console.log('🔔 [LamaMC] Ping detected — going fully AFK for 5 min, then disconnecting.');
      if (farmTimer) clearTimeout(farmTimer);
      stopAllMovement();
      setTimeout(() => {
        if (!alive) return;
        console.log('🛑 [LamaMC] 5 min AFK done — disconnecting. Re-run the script to resume.');
        scriptEnabled     = false;
        bot.pingShutdown  = true;
        alive             = false;
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
        bot.chat(FARM_II_ACCOUNT.loginCommand);
        setTimeout(() => { if (alive) openTeleportGUI(); }, 2000);
      }, 2000);
    });

    bot.on('message', (jsonMsg, position) => {
      if (position === 'game_info') return;
      const msg = jsonMsg.toString();
      console.log(`💬 [LamaMC] ${msg}`);
      if (!alive) return;

      if (farmingActive && !switching && /regrow/i.test(msg)) {
        triggerSwitch('chat keyword');
        return;
      }

      if (farmingActive && !switching && /you have 10 seconds to warp out/i.test(msg)) {
        triggerSwitch('warp-out warning');
        return;
      }

      if (!switching && /Server not found./i.test(msg)) {
        triggerSwitch('chat keyword');
        return;
      }

      if (!switching && /Unfortunately, we were unable to connect you to the server,/i.test(msg)) {
        triggerSwitch('chat keyword');
        return;
      }

      if (!farmingActive || pingPaused) return;
      const isPinged = PING_NAMES.some(n => msg.toLowerCase().includes(n.toLowerCase()));
      if (isPinged) handlePing();
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log('☠️ [LamaMC] Died. Restarting...');
      stopFarming();
      movingRight = true;
      setTimeout(() => {
        if (!alive) return;
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) startFarming(); }, 5000);
      }, 2000);
    });

    bot.on('end', (reason) => {
      console.log('📋 [LamaMC] End reason:', reason);
      alive = false;
      stopFarming();
      if (bot.pingShutdown) {
        console.log('🛑 [LamaMC] Stopped after a ping — script paused. Re-run to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 [LamaMC] Manual quit (switch handoff).');
        return;
      }
      // Switch on ANY disconnect
      if (scriptEnabled) {
        console.log(`🔁 [LamaMC] Disconnected unexpectedly. Switching to ${FARM_ACCOUNT.username} in 5s...`);
        setTimeout(createFarmBot, 5000);
      }
    });

    bot.on('error', err => console.log('❌ [LamaMC] Error:', err.message));

    bot.quitBot = function () {
      bot.manualQuit = true;
      scriptEnabled  = false;
      alive          = false;
      stopFarming();
      bot.quit();
    };

  } catch (err) {
    console.log('💥 createFarmIIBot crashed:', err);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
createFarmBot();
