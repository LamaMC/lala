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
  if (msg.includes('partial packet')         ||
      msg.includes('problem inflating')      ||
      msg.includes('incorrect header check') ||
      msg.includes('Z_DATA_ERROR')           ||
      msg.includes('Chunk size is')          ||
      msg.includes('uncompressed length')) return;
  _error(m, ...a);
};

// ── Deep patch: bad server packets no longer kill the connection ───────────────
//
// WHY THE PROTOTYPE PATCH WASN'T ENOUGH:
//
//  In newer Node.js, zlib.unzipSync internally calls zlibOnError() which runs
//  this.destroy(err) BEFORE throwing.  destroy() schedules a stream 'error' event
//  asynchronously (next tick), so even though our try-catch around _orig.call()
//  catches the synchronous throw and calls cb(), the async 'error' event still
//  fires afterwards and destroys the socket.
//
// ROOT FIX — patch zlib.unzipSync itself:
//
//  If unzipSync never throws, the async destroy path is never triggered.
//  We return Buffer.alloc(0) on failure so compression.js can still call cb()
//  without crashing (no .length access on null).  The empty buffer then reaches
//  FullPacketParser, which fails to parse it; the FullPacketParser prototype
//  patch (below) eats that error and calls cb() — packet silently dropped.
//
// SECONDARY: prototype patch on FullPacketParser for parse failures.
//
function patchMinecraftProtocol () {
  // ── 0. Patch zlib.unzipSync — the actual root cause ──────────────────────
  // Must run before any bot connects. zlib is a singleton so one patch covers all.
  const zlib = require('zlib');
  if (!zlib._botPatched) {
    const _unzipSync = zlib.unzipSync;
    zlib.unzipSync = function (buf, opts) {
      try {
        return _unzipSync.call(this, buf, opts);
      } catch (_) {
        // Return an empty buffer instead of throwing.
        // compression.js calls cb(null, emptyBuf); afterTransform doesn't push
        // empty data; FullPacketParser receives it, fails to parse, our prototype
        // patch eats that error.  Net result: bad packet silently dropped.
        return Buffer.alloc(0);
      }
    };
    zlib._botPatched = true;
    console.log('🔧 zlib.unzipSync patched (bad compressed packets → empty buffer → dropped)');
  }

  // Try every combination of package name × src|lib layout.
  const pkgNames = ['minecraft-protocol', 'node-minecraft-protocol'];
  const srcDirs  = ['src', 'lib'];   // src first — confirmed by stack trace

  const variants = [];
  for (const pkg of pkgNames)
    for (const dir of srcDirs)
      variants.push([pkg, dir]);

  // Also probe mineflayer's own nested copy if it has one.
  try {
    const mfDir = path.dirname(require.resolve('mineflayer'));
    for (const pkg of pkgNames)
      for (const dir of srcDirs)
        variants.push([path.join(mfDir, 'node_modules', pkg), dir]);
  } catch (_) {}

  let decomp = false, parser = false;

  for (const [base, dir] of variants) {
    // ── 1. Decompressor prototype patch (belt-and-suspenders) ────────────────
    // Handles the cb(err) async pattern for versions that do catch + cb(err).
    // Also guards any remaining sync throws the zlib patch doesn't prevent.
    if (!decomp) {
      try {
        const { createDecompressor } = require(`${base}/${dir}/transforms/compression`);
        const proto = Object.getPrototypeOf(createDecompressor());
        if (typeof proto._transform !== 'function') throw new Error('no _transform');
        const _orig = proto._transform;
        proto._transform = function (chunk, enc, cb) {
          try {
            _orig.call(this, chunk, enc, (err, data) => {
              if (err) return cb();   // async cb(err) path → drop packet
              cb(null, data);
            });
          } catch (_) { cb(); }      // any remaining sync throw → drop packet
        };
        decomp = true;
        console.log(`🔧 Decompressor prototype patched (${base}/${dir})`);
      } catch (_) {}
    }

    // ── 2. Packet deserializer prototype patch ────────────────────────────────
    // Catches the empty-buffer parse failure produced by the zlib patch above,
    // plus any other ProtoDef "Chunk size is N but only M was read" errors.
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
              if (err) return cb();   // drop unreadable packet, keep stream alive
              cb();
            });
          } catch (_) { cb(); }
        };
        parser = true;
        console.log(`🔧 Packet deserializer prototype patched (${base}/${dir})`);
      } catch (_) {}
    }

    if (decomp && parser) break;
  }

  if (!decomp)
    console.warn('⚠️  Decompressor not patched — inflate/unzip errors may cause disconnects');
  if (!parser)
    console.warn('⚠️  Packet parser not patched — protodef errors may cause disconnects');
}

patchMinecraftProtocol();

// ── Last-resort safety net ────────────────────────────────────────────────────
process.on('uncaughtException', err => {
  const m     = err?.message ?? '';
  const stack = err?.stack   ?? '';

  // Compression / framing noise from the server
  if (m.includes('incorrect header check') ||
      m.includes('partial packet')          ||
      m.includes('Chunk size is')           ||
      m.includes('Z_DATA_ERROR')) return;

  // Block-palette assertion (blocks.js:360 — server reports different block-state
  // count than mineflayer expects; harmless for farming, but would crash the bot)
  if (err?.code === 'ERR_ASSERTION' && stack.includes('blocks.js')) return;

  throw err; // anything else is a real bug — let it crash visibly
});

// ── Global config ─────────────────────────────────────────────────────────────
const HOST         = 'fakepixel.me';
const VERSION      = '1.8.9';
const WARP_COMMAND = '/warp island';

const FARM_ACCOUNT   = { username: 'Makhecha', loginCommand: '/login 3195' };
const REGROW_ACCOUNT = { username: 'LamaMC',   loginCommand: '/login 3195' };

// Anyone mentioning either name in chat counts as a "ping"
const PING_NAMES = [FARM_ACCOUNT.username, REGROW_ACCOUNT.username];

const FARM_DURATION_MS   = 30 * 60 * 1000; // farm 30 min, then hand off to regrow
const REGROW_DURATION_MS = 5 * 60 * 1000;  // sit AFK 5 min, then hand back
const PING_AFK_MS        =  5 * 60 * 1000; // stand still 5 min after a ping, then hard-stop

// Instant XZ shift in this range (blocks) → regrow trigger, not normal walking.
const SHIFT_DETECT_MIN = 4;
const SHIFT_DETECT_MAX = 256;

// How long (ms) to skip re-targeting a block right after digging it.
const DIG_COOLDOWN_MS = 300;

// Hard safety cap: never break more than this many blocks in a rolling 60s window.
const MAX_BREAKS_PER_MINUTE = 1300;

// Master switch. Set to false (e.g. by a ping) to fully stop the whole loop.
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

    // ── Clicking ──────────────────────────────────────────────────────────────
    function onTick () {
      if (!alive || !farmingActive || pingPaused || regrowing) return;
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

      // Fallback: if the server never sends windowOpen (common on reconnects),
      // skip the GUI entirely and warp directly after 6 s.
      const fallback = setTimeout(() => {
        if (handled || !alive) return;
        handled = true;
        bot.removeListener('windowOpen', onWindow);
        console.log('⚠️ [Makhecha] windowOpen timed out — warping directly.');
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) startFarming(); }, 5000);
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

      // 30-minute farm timer → hand off to regrow mode
      farmTimer = setTimeout(() => {
        if (!alive) return;
        triggerRegrow('30-minute farm timer');
      }, FARM_DURATION_MS);

      // Nudge forward every 10s
      const nudgeInterval = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(nudgeInterval); return; }
        if (pingPaused || regrowing) return;
        bot.look(-Math.PI / 2, 0, true);
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 100);
      }, 10000);

      // Reset block-break counter every 60s (1300/min safety cap)
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

          const pos      = bot.entity.position;
          const dropY    = lastPos.y - pos.y;
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

    function openTeleportGUI () {
      bot.setQuickBarSlot(0);
      bot.activateItem();

      let handled = false;

      // Fallback: if the server never sends windowOpen, warp directly after 6 s.
      const fallback = setTimeout(() => {
        if (handled || !alive) return;
        handled = true;
        bot.removeListener('windowOpen', onWindow);
        console.log('⚠️ [LamaMC] windowOpen timed out — warping directly.');
        bot.chat(WARP_COMMAND);
        setTimeout(() => { if (alive) enterAfkPool(); }, 5000);
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

    // keepAlive:true already answers the server's keep-alive pings at the protocol
    // level — nothing extra needed here.
    function enterAfkPool () {
      console.log('💤 [LamaMC] In AFK pool — idling, keep-alive only.');
      regrowTimer = setTimeout(() => {
        if (!alive) return;
        endRegrow('10-minute regrow timer elapsed');
      }, REGROW_DURATION_MS);
    }

    function endRegrow (reason) {
      console.log(`🌾 Regrow done (${reason}). Handing back to ${FARM_ACCOUNT.username}...`);
      if (regrowTimer) clearTimeout(regrowTimer);
      alive         = false;
      bot.manualQuit = true;
      bot.quit();
      setTimeout(() => { if (scriptEnabled) createFarmBot(); }, 2000);
    }

    function handlePing () {
      if (pingPaused || !alive) return;
      pingPaused = true;
      console.log('🔔 [LamaMC] Ping detected — going fully AFK for 5 min, then disconnecting.');
      if (regrowTimer) clearTimeout(regrowTimer);
      setTimeout(() => {
        if (!alive) return;
        console.log('🛑 5 min AFK done — disconnecting. Re-run to resume.');
        scriptEnabled    = false;
        bot.pingShutdown = true;
        alive            = false;
        bot.quit();
      }, PING_AFK_MS);
    }

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
      console.log('☠️ [LamaMC] Died while in the regrow/AFK pool.');
    });

    bot.on('end', (reason) => {
      console.log('📋 [LamaMC] End reason:', reason);
      alive = false;
      if (bot.pingShutdown) {
        console.log('🛑 [LamaMC] Stopped after a ping — script paused. Re-run to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 [LamaMC] Manual quit (handoff to Makhecha) — not reconnecting.');
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

// ── Start ─────────────────────────────────────────────────────────────────────
createFarmBot();
