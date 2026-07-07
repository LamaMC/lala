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
  // Node.js passes Error objects directly — not just strings — so we extract .message.
  const msg = (m instanceof Error) ? (m.message ?? '')
            : (typeof m === 'string') ? m
            : String(m ?? '');
  if (msg.includes('partial packet')              ||
      msg.includes('problem inflating')           ||
      msg.includes('incorrect header check')      ||
      msg.includes('Z_DATA_ERROR')                ||
      msg.includes('Chunk size is')               ||
      msg.includes('uncompressed length')         ||
      msg.includes('Missing characters')          ||
      msg.includes('PartialReadError')            ||
      msg.includes('"offset" is out of range')) return; // ← bad varint in Splitter
  _error(m, ...a);
};

// ── Deep patch: bad server packets no longer kill the connection ───────────────
function patchMinecraftProtocol () {
  // ── 0. Patch zlib.unzipSync — the actual root cause ──────────────────────
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
    console.log('🔧 zlib.unzipSync patched (bad compressed packets → empty buffer → dropped)');
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

  let decomp = false, parser = false, framer = false;

  for (const [base, dir] of variants) {
    // ── 1. Decompressor prototype patch ──────────────────────────────────────
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
        console.log(`🔧 Decompressor prototype patched (${base}/${dir})`);
      } catch (_) {}
    }

    // ── 2. Packet deserializer prototype patch ────────────────────────────────
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
        console.log(`🔧 Packet deserializer prototype patched (${base}/${dir})`);
      } catch (_) {}
    }

    // ── 3. Packet framer (Splitter) prototype patch ───────────────────────────
    // Handles bad varint offsets (ERR_OUT_OF_RANGE) from corrupt server packets.
    // The Splitter reads packet length as a varint; a mangled buffer causes
    // readUInt8 to throw synchronously with an out-of-range offset, killing
    // the connection. We catch it here and drop the bad packet instead.
    if (!framer) {
      try {
        const { Splitter } = require(`${base}/${dir}/transforms/framing`);
        if (!Splitter || typeof Splitter.prototype._transform !== 'function')
          throw new Error('no Splitter');
        const _orig = Splitter.prototype._transform;
        Splitter.prototype._transform = function (chunk, enc, cb) {
          try {
            _orig.call(this, chunk, enc, cb);
          } catch (err) {
            if (err?.code === 'ERR_OUT_OF_RANGE' || err?.message?.includes('out of range')) {
              return cb(); // drop corrupt frame, keep stream alive
            }
            cb(err); // real errors still propagate
          }
        };
        framer = true;
        console.log(`🔧 Splitter prototype patched (${base}/${dir})`);
      } catch (_) {}
    }

    if (decomp && parser && framer) break;
  }

  // ── 3. FIX 3: Patch protodef.parsePacketBuffer directly ──────────────────
  // Catches PartialReadError / "Missing characters in string" at the source.
  try {
    const { CompiledProtodef } = require('protodef/src/compiler');
    if (typeof CompiledProtodef?.prototype?.parsePacketBuffer === 'function') {
      const _orig = CompiledProtodef.prototype.parsePacketBuffer;
      CompiledProtodef.prototype.parsePacketBuffer = function (...args) {
        try { return _orig.apply(this, args); }
        catch (_) { return { data: {}, metadata: { size: 0 } }; }
      };
      console.log('🔧 protodef.parsePacketBuffer patched (PartialReadError → packet dropped)');
    }
  } catch (_) {}

  if (!decomp)
    console.warn('⚠️  Decompressor not patched — inflate/unzip errors may cause disconnects');
  if (!parser)
    console.warn('⚠️  Packet parser not patched — protodef errors may cause disconnects');
  if (!framer)
    console.warn('⚠️  Splitter not patched — bad varint offsets may cause disconnects');
}

patchMinecraftProtocol();

// ── Last-resort safety net ────────────────────────────────────────────────────
process.on('uncaughtException', err => {
  const m     = err?.message ?? '';
  const stack = err?.stack   ?? '';

  // Compression / framing noise from the server
  if (m.includes('incorrect header check')        ||
      m.includes('partial packet')                ||
      m.includes('Chunk size is')                 ||
      m.includes('Z_DATA_ERROR')                  ||
      m.includes('Missing characters')            ||
      m.includes('"offset" is out of range')      || // ← bad varint in Splitter
      (err?.code === 'ERR_OUT_OF_RANGE' && m.includes('offset')) ||
      err?.name === 'PartialReadError') return;

  // Block-palette assertion (harmless for farming)
  if (err?.code === 'ERR_ASSERTION' && stack.includes('blocks.js')) return;

  throw err;
});

// ── Global config ─────────────────────────────────────────────────────────────
const HOST         = 'fakepixel.me';
const VERSION      = '1.8.9';
const WARP_COMMAND = '/warp island';

const FARM_ACCOUNT   = { username: 'B2C', loginCommand: '/login 3043AA' };
const REGROW_ACCOUNT = { username: 'Beastro', loginCommand: '/login 3043' };

// Anyone mentioning either name in chat counts as a "ping"
const PING_NAMES = [FARM_ACCOUNT.username, REGROW_ACCOUNT.username];

const FARM_DURATION_MS   = 30 * 60 * 1000; // farm 30 min, then hand off to regrow
const REGROW_DURATION_MS =  5 * 60 * 1000; // sit AFK 5 min, then hand back
const PING_AFK_MS        =  5 * 60 * 1000; // stand still 5 min after a ping, then hard-stop

// Instant XZ shift in this range (blocks) → regrow trigger, not normal walking.
const SHIFT_DETECT_MIN = 4;
const SHIFT_DETECT_MAX = 256;

// How long (ms) to skip re-targeting a block right after digging it.
const DIG_COOLDOWN_MS = 300;

// Hard safety cap: never break more than this many blocks in a rolling 60s window.
const MAX_BREAKS_PER_MINUTE = 1200;

// Master switch. Set to false (e.g. by a ping) to fully stop the whole loop.
let scriptEnabled = true;

// ── Farm bot (B2C) ─────────────────────────────────────────────────────
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
    let regrowing        = false;
    let farmTimer        = null;
    let recentlyDug      = new Set();
    let breaksThisMinute = 0;

    // ── Clicking ──────────────────────────────────────────────────────────────
    function onTick () {
      if (!alive || !farmingActive || pingPaused || regrowing) return;
      if (breaksThisMinute >= MAX_BREAKS_PER_MINUTE) return;
      bot.look(Math.PI / 2, 0, true); // west (-X)

      const pos = bot.entity.position.floored();
      for (let x = 1; x <= 5; x++) {
        const block = bot.blockAt(pos.offset(-x, 1, 0));
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
      console.log('🖱️ Attack started.');
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
        console.log('⚠️ [B2C] windowOpen timed out — disconnecting to reconnect.');
        alive = false;
        bot.quit(); // manualQuit stays false → end handler reconnects automatically
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
            console.log('🎯 [B2C] Clicked teleport item.');
          } catch (err) {
            console.log('❌ [B2C] GUI click error:', err.message);
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
      regrowing     = false;

      bot.setQuickBarSlot(0);
      bot.look(Math.PI / 2, 0, true);
      console.log('🌾 Farming started.');

      startClicking();
      setMoveDirection('right');

      // 30-minute farm timer → hand off to regrow mode
      farmTimer = setTimeout(() => {
        if (!alive) return;
        triggerRegrow('30-minute farm timer');
      }, FARM_DURATION_MS);

      // Nudge forward every 10s
      const nudgeInterval = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(nudgeInterval); return; }
        if (pingPaused || regrowing) return;
        bot.look(Math.PI / 2, 0, true);
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 100);
      }, 10000);

      // Reset block-break counter every 60s
      const breakCounterInterval = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(breakCounterInterval); return; }
        breaksThisMinute = 0;
      }, 60 * 1000);

      // Wait 3s for the bot to settle after warp before starting polls
      setTimeout(() => {
        if (!alive || !farmingActive) return;
        lastPos = bot.entity.position.clone();
        console.log('📍 Position tracking started.');

        const poll = setInterval(() => {
          if (!alive || !farmingActive) { clearInterval(poll); return; }
          if (pingPaused || regrowing) { lastPos = bot.entity.position.clone(); return; }

          const pos       = bot.entity.position;
          const dropY     = lastPos.y - pos.y;
          const horizDist = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z);

          // Instant XZ shift 4-256 blocks → regrow trigger
          if (horizDist >= SHIFT_DETECT_MIN && horizDist <= SHIFT_DETECT_MAX) {
            console.log(`🌀 Instant XZ shift (ΔXZ: ${horizDist.toFixed(1)}) — triggering regrow.`);
            lastPos = pos.clone();
            triggerRegrow('position shift');
            return;
          }

          // Normal farm row drop (2-3 blocks Y)
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
        scriptEnabled    = false;
        bot.pingShutdown = true;
        alive            = false;
        bot.quit();
      }, PING_AFK_MS);
    }

    // ── Bot lifecycle ─────────────────────────────────────────────────────────
    bot.loadPlugin(pathfinder);

    bot.on('login', () => console.log('🔌 [B2C] Login packet sent.'));
    bot._client.on('error', err => console.log('🔥 [B2C] Client error:', err.message));

    bot.once('spawn', () => {
      console.log('🟢 [B2C] SPAWN EVENT FIRED');
      try {
        bot._client.socket.setTimeout(24 * 60 * 60 * 1000); // FIX 4: 24h timeout
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) { console.log('⚠️ [B2C] socket setup failed:', e.message); }
      console.log('✅ [B2C] Spawned');
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
      console.log(`💬 [B2C] ${msg}`);
      if (!alive) return;

      if (farmingActive && !regrowing && /regrow/i.test(msg)) {
        console.log('🥔 "Regrow" seen in chat — triggering regrow mode.');
        triggerRegrow('chat keyword');
        return;
      }

      if (farmingActive && !regrowing && /you have 30 seconds to warp out/i.test(msg)) {
        console.log('⏱️ "30 seconds to warp out" warning seen — triggering regrow mode.');
        triggerRegrow('warp-out warning');
        return;
      }

      if (!farmingActive || pingPaused) return;
      const isPinged = PING_NAMES.some(n => msg.toLowerCase().includes(n.toLowerCase()));
      if (isPinged) handlePing();
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log('☠️ [B2C] Died. Restarting...');
      stopFarming();
      movingRight = true;
      setTimeout(() => {
        if (!alive) return;
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) startFarming(); }, 5000);
      }, 2000);
    });

    bot.on('end', (reason) => {
      console.log('📋 [B2C] End reason:', reason);
      alive = false;
      stopFarming();
      if (bot.pingShutdown) {
        console.log('🛑 Stopped after a ping — script paused. Re-run to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 Manual quit (regrow handoff) — not reconnecting as B2C.');
        return;
      }
      if (scriptEnabled) {
        console.log('🔁 [B2C] Disconnected unexpectedly. Reconnecting in 5s...');
        setTimeout(createFarmBot, 5000);
      }
    });

    bot.on('error', err => console.log('❌ [B2C] Error:', err.message));

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

// ── Regrow bot (Beastro) ──────────────────────────────────────────────────────
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
        console.log('⚠️ [Beastro] windowOpen timed out — disconnecting to reconnect.');
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
            console.log('🎯 [Beastro] Clicked teleport item.');
          } catch (err) {
            console.log('❌ [Beastro] GUI click error:', err.message);
          }
        }
        if (!alive) return;
        setTimeout(() => {
          if (!alive) return;
          bot.chat(WARP_COMMAND);
          setTimeout(() => { if (alive) startRegrowWait(); }, 5000);
        }, 2000);
      }

      bot.once('windowOpen', onWindow);
    }

    // ── Regrow wait ───────────────────────────────────────────────────────────
    function startRegrowWait () {
      console.log(`⏳ [Beastro] AFK regrow wait started (${REGROW_DURATION_MS / 1000}s).`);
      regrowTimer = setTimeout(() => {
        if (!alive) return;
        console.log(`✅ [Beastro] Regrow wait done — handing back to ${FARM_ACCOUNT.username}.`);
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
      console.log('🔔 [Beastro] Ping detected — going fully AFK for 5 min, then disconnecting.');
      if (regrowTimer) clearTimeout(regrowTimer);
      setTimeout(() => {
        if (!alive) return;
        console.log('🛑 [Beastro] 5 min AFK done — disconnecting. Re-run the script to resume.');
        scriptEnabled    = false;
        bot.pingShutdown = true;
        alive            = false;
        bot.quit();
      }, PING_AFK_MS);
    }

    // ── Bot lifecycle ─────────────────────────────────────────────────────────
    bot.loadPlugin(pathfinder);

    bot.on('login', () => console.log('🔌 [Beastro] Login packet sent.'));
    bot._client.on('error', err => console.log('🔥 [Beastro] Client error:', err.message));

    bot.once('spawn', () => {
      console.log('🟢 [Beastro] SPAWN EVENT FIRED');
      try {
        bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) { console.log('⚠️ [Beastro] socket setup failed:', e.message); }
      console.log('✅ [Beastro] Spawned');
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
      console.log(`💬 [Beastro] ${msg}`);
      if (!alive || pingPaused) return;
      const isPinged = PING_NAMES.some(n => msg.toLowerCase().includes(n.toLowerCase()));
      if (isPinged) handlePing();
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log('☠️ [Beastro] Died — re-warping and resuming wait.');
      if (regrowTimer) clearTimeout(regrowTimer);
      setTimeout(() => {
        if (!alive) return;
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) startRegrowWait(); }, 5000);
      }, 2000);
    });

    bot.on('end', (reason) => {
      console.log('📋 [Beastro] End reason:', reason);
      alive = false;
      if (regrowTimer) clearTimeout(regrowTimer);

      if (bot.pingShutdown) {
        console.log('🛑 [Beastro] Stopped after a ping — script paused. Re-run to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 [Beastro] Manual quit — not reconnecting as Beastro.');
        return;
      }
      if (scriptEnabled) {
        console.log('🔁 [Beastro] Disconnected unexpectedly. Reconnecting in 5s...');
        setTimeout(createRegrowBot, 5000);
      }
    });

    bot.on('error', err => console.log('❌ [Beastro] Error:', err.message));

  } catch (err) {
    console.log('💥 createRegrowBot crashed:', err);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
createFarmBot();
