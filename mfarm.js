const mineflayer = require('mineflayer');
const Vec3 = require('vec3');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;

const originalWarn = console.warn;
console.warn = (msg, ...args) => {
  if (typeof msg === 'string' && msg.includes('objectType is deprecated')) return;
  if (typeof msg === 'string' && msg.includes('chunk failed to load')) return;
  originalWarn(msg, ...args);
};

// ── Global config ────────────────────────────────────────────────────────────
const HOST = 'fakepixel.fun';
const VERSION = '1.8.9';
const WARP_COMMAND = '/warp island';

const FARM_ACCOUNT   = { username: 'Makhecha', loginCommand: '/login 3195' };
const REGROW_ACCOUNT = { username: 'LamaMC',   loginCommand: '/login 3195' };

// Anyone mentioning either name in chat counts as a "ping"
const PING_NAMES = [FARM_ACCOUNT.username, REGROW_ACCOUNT.username];

const FARM_DURATION_MS   = 30 * 60 * 1000; // farm for 30 min, then hand off to regrow
const REGROW_DURATION_MS = 10 * 60 * 1000; // sit in the afk pool for 10 min, then hand back
const PING_AFK_MS        = 5 * 60 * 1000;  // stand still 5 min after a ping, then hard-stop

// Instant XZ position shift in this range (blocks) is treated as the regrow trigger,
// not a slow walking movement. Tune the upper bound if 5 turns out to be too tight/loose.
const SHIFT_DETECT_MIN = 4;
const SHIFT_DETECT_MAX = 256;

// Digging reach — vanilla survival interaction range is ~4.5 blocks. The old code
// scanned columns up to 5 blocks out (≈5.4 diagonal with the +2 Y offset), which is
// past legal reach, so the server was silently dropping those dig packets.
const EYE_HEIGHT = 1.62;
const MAX_DIG_REACH = 4.5;

// System message that signals the patch needs to regrow.
// ⚠️ TODO: replace this with the EXACT text fakepixel sends for this event.
// Anchored (^...) so it only matches that specific system line, not any player
// chat that happens to contain the word "regrow".
const REGROW_SIGNAL = /^\[SkyBlock\] Your potatoes need time to regrow/i;

// Master switch. Set to false (e.g. by a ping) to fully stop the whole farm/regrow loop.
// Re-running the script is what "turns it back on".
let scriptEnabled = true;

// ── Farm bot (Makhecha) ──────────────────────────────────────────────────────
function createFarmBot() {
  if (!scriptEnabled) return;
  console.log(`🚀 createFarmBot() called — connecting as ${FARM_ACCOUNT.username}`);
  try {
  const bot = mineflayer.createBot({
    host: HOST,
    username: FARM_ACCOUNT.username,
    version: VERSION,
    keepAlive: true,
    checkTimeoutInterval: 60000
  });

  let alive = true;
  let farmingActive = false;
  let movingRight = true;
  let lastPos = null;
  let pingPaused = false;
  let regrowing = false;
  let farmTimer = null;
  let digging = false; // guard against overlapping dig calls across ticks

  // ── Clicking ────────────────────────────────────────────────────────────
  function onTick() {
    if (!alive || !farmingActive || pingPaused || regrowing || digging) return;

    const pos = bot.entity.position.floored();
    const eye = bot.entity.position.offset(0, EYE_HEIGHT, 0);

    for (let x = 1; x <= 5; x++) {
      const blockPos = pos.offset(x, 2, 0);
      const block = bot.blockAt(blockPos);
      if (!block || block.name !== 'potatoes' || block.metadata !== 7) continue;

      // Skip columns out of legal reach instead of firing a dig that'll just
      // get rejected — fall through and try the next (closer) column.
      const dist = eye.distanceTo(blockPos.offset(0.5, 0.5, 0.5));
      if (dist > MAX_DIG_REACH) continue;

      digBlock(block);
      return;
    }
  }

  function digBlock(block) {
    digging = true;
    bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true, () => {
      bot.dig(block, err => {
        digging = false;
        if (err) console.log(`⚠️ Dig failed at ${block.position}:`, err.message);
      });
    });
  }

  function startClicking() {
    bot.setQuickBarSlot(0);
    bot.on('physicsTick', onTick);
    console.log('🖱️ Attack started.');
  }

  function stopClicking() {
    bot.removeListener('physicsTick', onTick);
  }

  // ── GUI / warp ──────────────────────────────────────────────────────────
  function openTeleportGUI() {
    bot.setQuickBarSlot(0);
    bot.activateItem();
    bot.once('windowOpen', async window => {
      if (!alive) return;
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
    });
  }

  // ── Farming ─────────────────────────────────────────────────────────────
  function startFarming() {
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
      bot.look(-Math.PI / 2, 0, true); // face east (+X)
      bot.setControlState('forward', true);
      setTimeout(() => bot.setControlState('forward', false), 100);
    }, 10000);

    // Wait 3s for bot to settle after warp before starting polls
    setTimeout(() => {
      if (!alive || !farmingActive) return;
      lastPos = bot.entity.position.clone();
      console.log('📍 Position tracking started.');

      // ── Position poll: instant-shift → regrow trigger, + row drop ───────
      const poll = setInterval(() => {
        if (!alive || !farmingActive) { clearInterval(poll); return; }
        if (pingPaused || regrowing) {
          lastPos = bot.entity.position.clone();
          return;
        }

        const pos = bot.entity.position;
        const dropY = lastPos.y - pos.y;
        const horizDist = Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z);

        // Instant XZ shift of 4-5 blocks → regrow mode
        if (horizDist >= SHIFT_DETECT_MIN && horizDist <= SHIFT_DETECT_MAX) {
          console.log(`🌀 Instant XZ shift detected (ΔXZ: ${horizDist.toFixed(1)}) — triggering regrow mode.`);
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

  function setMoveDirection(dir) {
    bot.setControlState('left', false);
    bot.setControlState('right', false);
    if (dir === 'right') bot.setControlState('right', true);
    else bot.setControlState('left', true);
    bot.look(-Math.PI / 2, 0, true); // face east (+X)
  }

  function stopAllMovement() {
    bot.setControlState('right', false);
    bot.setControlState('left', false);
    bot.setControlState('forward', false);
    stopClicking();
  }

  function stopFarming() {
    if (!farmingActive) return;
    farmingActive = false;
    stopAllMovement();
    console.log('🛑 Farming stopped.');
  }

  // ── Regrow handoff: disconnect Makhecha, bring in LamaMC ─────────────────
  function triggerRegrow(reason) {
    if (regrowing || !alive) return;
    regrowing = true;
    console.log(`🥔 Regrow mode triggered (${reason}). Handing off to ${REGROW_ACCOUNT.username}...`);
    if (farmTimer) clearTimeout(farmTimer);
    stopFarming();
    alive = false;
    bot.manualQuit = true; // suppress the default reconnect-as-self logic below
    bot.quit();
    setTimeout(() => {
      if (scriptEnabled) createRegrowBot();
    }, 2000);
  }

  // ── Ping handling: stand still 5 min, then hard-stop the whole script ────
  function handlePing() {
    if (pingPaused || !alive) return;
    pingPaused = true;
    console.log('🔔 Ping detected — going fully AFK for 5 min, then disconnecting until restarted.');
    if (farmTimer) clearTimeout(farmTimer);
    stopAllMovement();
    setTimeout(() => {
      if (!alive) return;
      console.log('🛑 5 min AFK complete — disconnecting. Re-run the script to resume.');
      scriptEnabled = false;
      bot.pingShutdown = true;
      alive = false;
      bot.quit();
    }, PING_AFK_MS);
  }

  // ── Bot lifecycle ─────────────────────────────────────────────────────────
  bot.loadPlugin(pathfinder);

  bot.on('login', () => console.log('🔌 [Makhecha] Login packet sent, connecting...'));
  bot._client.on('error', err => console.log('🔥 [Makhecha] Client error:', err.message));

  bot.once('spawn', () => {
    console.log('🟢 [Makhecha] SPAWN EVENT FIRED');
    try {
      bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
      bot._client.socket.setKeepAlive(true, 10000);
    } catch (e) {
      console.log('⚠️ socket setup failed:', e.message);
    }
    console.log('✅ Spawned');
    bot.manualQuit = false;
    setTimeout(() => {
      if (!alive) return;
      bot.chat(FARM_ACCOUNT.loginCommand);
      setTimeout(() => { if (alive) openTeleportGUI(); }, 2000);
    }, 2000);
  });

  // ── Message handler ───────────────────────────────────────────────────────
  bot.on('message', (jsonMsg, position) => {
    if (position === 'game_info') return;
    const msg = jsonMsg.toString();
    console.log(`💬 [Makhecha] ${msg}`);
    if (!alive) return;

    // Regrow signal from the server immediately starts the handoff.
    if (farmingActive && !regrowing && REGROW_SIGNAL.test(msg)) {
      console.log('🥔 Regrow signal seen in chat — triggering regrow mode.');
      triggerRegrow('chat keyword');
      return;
    }

    if (!farmingActive || pingPaused) return;
    const isPinged = PING_NAMES.some(name => msg.toLowerCase().includes(name.toLowerCase()));
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
      console.log('🛑 Stopped after a ping — script paused. Re-run the script to resume.');
      return;
    }
    if (bot.manualQuit) {
      console.log('🛑 Manual quit (regrow handoff) — not reconnecting as Makhecha.');
      return;
    }
    if (scriptEnabled) {
      console.log('🔁 Disconnected unexpectedly. Reconnecting as Makhecha in 10s...');
      setTimeout(createFarmBot, 10000);
    }
  });

  bot.on('error', err => console.log('❌ [Makhecha] Error:', err.message));

  bot.quitBot = function () {
    bot.manualQuit = true;
    scriptEnabled = false;
    alive = false;
    stopFarming();
    bot.quit();
  };
  } catch (err) {
    console.log('💥 createFarmBot crashed:', err);
  }
}

// ── Regrow bot (LamaMC) ──────────────────────────────────────────────────────
function createRegrowBot() {
  if (!scriptEnabled) return;
  console.log(`🚀 createRegrowBot() called — connecting as ${REGROW_ACCOUNT.username}`);
  try {
  const bot = mineflayer.createBot({
    host: HOST,
    username: REGROW_ACCOUNT.username,
    version: VERSION,
    keepAlive: true,
    checkTimeoutInterval: 60000
  });

  let alive = true;
  let pingPaused = false;
  let regrowTimer = null;

  function openTeleportGUI() {
    bot.setQuickBarSlot(0);
    bot.activateItem();
    bot.once('windowOpen', async window => {
      if (!alive) return;
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
    });
  }

  // Just sits connected — keepAlive:true already answers the server's keep-alive
  // pings at the protocol level, so there's nothing else to send here.
  function enterAfkPool() {
    console.log('💤 [LamaMC] In AFK pool — idling, keep-alive only.');
    regrowTimer = setTimeout(() => {
      if (!alive) return;
      endRegrow('10-minute regrow timer elapsed');
    }, REGROW_DURATION_MS);
  }

  function endRegrow(reason) {
    console.log(`🌾 Regrow period over (${reason}). Handing back to ${FARM_ACCOUNT.username}...`);
    if (regrowTimer) clearTimeout(regrowTimer);
    alive = false;
    bot.manualQuit = true;
    bot.quit();
    setTimeout(() => {
      if (scriptEnabled) createFarmBot();
    }, 2000);
  }

  function handlePing() {
    if (pingPaused || !alive) return;
    pingPaused = true;
    console.log('🔔 [LamaMC] Ping detected — going fully AFK for 5 min, then disconnecting until restarted.');
    if (regrowTimer) clearTimeout(regrowTimer);
    setTimeout(() => {
      if (!alive) return;
      console.log('🛑 5 min AFK complete — disconnecting. Re-run the script to resume.');
      scriptEnabled = false;
      bot.pingShutdown = true;
      alive = false;
      bot.quit();
    }, PING_AFK_MS);
  }

  bot.on('login', () => console.log('🔌 [LamaMC] Login packet sent, connecting...'));
  bot._client.on('error', err => console.log('🔥 [LamaMC] Client error:', err.message));

  bot.once('spawn', () => {
    console.log('🟢 [LamaMC] SPAWN EVENT FIRED');
    try {
      bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
      bot._client.socket.setKeepAlive(true, 10000);
    } catch (e) {
      console.log('⚠️ [LamaMC] socket setup failed:', e.message);
    }
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
    const isPinged = PING_NAMES.some(name => msg.toLowerCase().includes(name.toLowerCase()));
    if (isPinged) handlePing();
  });

  bot.on('death', () => {
    if (!alive) return;
    console.log('☠️ [LamaMC] Died while in the regrow/AFK pool.');
    // No farming to restart here — just stays connected; add bot.respawn()
    // if your server doesn't auto-respawn idle players.
  });

  bot.on('end', (reason) => {
    console.log('📋 [LamaMC] End reason:', reason);
    alive = false;
    if (bot.pingShutdown) {
      console.log('🛑 [LamaMC] Stopped after a ping — script paused. Re-run the script to resume.');
      return;
    }
    if (bot.manualQuit) {
      console.log('🛑 [LamaMC] Manual quit (handoff back to Makhecha) — not reconnecting as LamaMC.');
      return;
    }
    if (scriptEnabled) {
      console.log('🔁 [LamaMC] Disconnected unexpectedly. Reconnecting as LamaMC in 10s...');
      setTimeout(createRegrowBot, 10000);
    }
  });

  bot.on('error', err => console.log('❌ [LamaMC] Error:', err.message));

  } catch (err) {
    console.log('💥 createRegrowBot crashed:', err);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────
createFarmBot();
