const mineflayer = require('mineflayer');
const Vec3 = require('vec3');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear } = goals;

const originalWarn = console.warn;
console.warn = (msg, ...args) => {
  if (typeof msg === 'string' && msg.includes('objectType is deprecated')) return;
  originalWarn(msg, ...args);
};

const botConfig = {
  host: 'server.fakepixel.fun',
  username: 'DrakonTide',
  version: '1.8.9',
  loginCommand: '/login 3043AA',
  warpCommand: '/warp spider',
  waypointRadius: 3,
  homeIndex: 11,
  loopStartIndex: 11,
  reconnectInterval: 35 * 60 * 1000, // 35 minutes in ms
  waypoints: [
    new Vec3(-233, 80, -244),
    new Vec3(-261, 86, -237),
    new Vec3(-281, 95, -233),
    new Vec3(-292, 95, -211),
    new Vec3(-315, 96, -191),
    new Vec3(-331, 81, -228),
    new Vec3(-347, 79, -236),
    new Vec3(-360, 72, -256),
    new Vec3(-357, 67, -270),
    new Vec3(-333, 60, -276),
    new Vec3(-322, 57, -280),
    new Vec3(-300, 45, -273), // index 11 — patrol home
    new Vec3(-291, 45, -278),
    new Vec3(-284, 44, -250),
    new Vec3(-271, 44, -238),
    new Vec3(-273, 44, -224),
    new Vec3(-292, 43, -228),
    new Vec3(-326, 44, -224),
    new Vec3(-336, 44, -236),
    new Vec3(-326, 42, -252),
    new Vec3(-313, 43, -234),
    new Vec3(-288, 44, -259),
  ]
};

let patrolIndex = 0;
let homeReached = false;
let clickInterval = null;
let patrolActive = false;
let activePoll = null;

function createBot() {
  const bot = mineflayer.createBot({
    host: botConfig.host,
    username: botConfig.username,
    version: botConfig.version,
    keepAlive: true,
    checkTimeoutInterval: 60000
  });

  // Per-instance alive flag — prevents stale callbacks/listeners
  // from a previous instance firing after disconnect
  let alive = true;
  let reconnectTimer = null; // 35-min timer handle

  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    try {
      bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
      bot._client.socket.setKeepAlive(true, 10000);
    } catch (_) {}
    console.log('✅ Spawned');
    patrolIndex = 0;
    homeReached = false;
    patrolActive = false;
    stopClicking();
    clearReconnectTimer();
    bot.manualQuit = false;
    setTimeout(() => {
      if (!alive) return;
      bot.chat(botConfig.loginCommand);
      setTimeout(() => { if (alive) openTeleportGUI(bot); }, 2000);
    }, 2000);
  });

  bot.on('death', () => {
    if (!alive) return;
    console.log('☠️ Bot died. Restarting patrol...');
    patrolIndex = 0;
    homeReached = false;
    patrolActive = false;
    stopClicking();
    clearReconnectTimer();
    setTimeout(() => {
      if (!alive) return;
      bot.chat(botConfig.warpCommand);
      setTimeout(() => { if (alive) startPatrol(bot); }, 8000);
    }, 2000);
  });

  bot.on('end', () => {
    alive = false;
    clearReconnectTimer();
    if (activePoll) { clearInterval(activePoll); activePoll = null; }
    patrolActive = false;
    stopClicking();
    if (!bot.manualQuit) {
      console.log('🔁 Disconnected. Reconnecting in 10s...');
      setTimeout(createBot, 10000);
    } else {
      console.log('🛑 Bot quit manually. No reconnect.');
    }
  });

  bot.on('error', err => console.log('❌ Error:', err.message));

  // ── 35-minute reconnect timer helpers ──────────────────────────────────────
  function startReconnectTimer() {
    clearReconnectTimer();
    console.log('⏱️  35-minute reconnect timer started.');
    reconnectTimer = setTimeout(() => {
      if (!alive) return;
      console.log('⏰ 35 minutes elapsed — disconnecting for scheduled reconnect...');
      patrolActive = false;
      stopClicking();
      bot.manualQuit = false; // allow auto-reconnect on 'end'
      alive = false;
      bot.quit();
    }, botConfig.reconnectInterval);
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  function openTeleportGUI(bot) {
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
        bot.chat(botConfig.warpCommand);
        setTimeout(() => { if (alive) startPatrol(bot); }, 8000);
      }, 2000);
    });
  }

  function startPatrol(bot) {
    if (!alive || patrolActive) return;
    patrolActive = true;

    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);
    movements.maxDropDown = 10;
    movements.allowParkour = true;
    movements.canDig = false;
    movements.allowSprinting = true;
    movements.canUseElytra = false;
    bot.pathfinder.setMovements(movements);

    console.log('🚶 Patrol started.');
    startReconnectTimer(); // ← 35-min clock begins here
    moveToWaypoint();
  }

  function moveToWaypoint() {
    if (!alive || !patrolActive) return;

    if (patrolIndex >= botConfig.waypoints.length) {
      patrolIndex = botConfig.loopStartIndex;
    }

    const target = botConfig.waypoints[patrolIndex];
    bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 1), true);

    let stuckTicks   = 0;
    let lastPos      = bot.entity.position.clone();
    let stuckRetries = 0;
    let jumpRetries  = 0;

    if (activePoll) { clearInterval(activePoll); activePoll = null; }
    activePoll = setInterval(() => {
      const poll = activePoll;
      if (!alive || !patrolActive) { clearInterval(poll); return; }

      const pos    = bot.entity.position;
      const distXZ = Math.hypot(pos.x - target.x, pos.z - target.z);

      // ── Arrived ────────────────────────────────────────────────────────────
      if (distXZ <= botConfig.waypointRadius) {
        clearInterval(poll);
        console.log(`📍 Passed waypoint ${patrolIndex}`);

        if (patrolIndex === botConfig.homeIndex && !homeReached) {
          console.log('🏠 Home reached — starting right-click spam...');
          homeReached = true;
          startClicking();
        }

        patrolIndex++;
        moveToWaypoint();
        return;
      }

      // ── Stuck detection (30 × 100 ms = 3 s) ───────────────────────────────
      const moved = pos.distanceTo(lastPos);
      if (moved < 0.05) { stuckTicks++; }
      else { stuckTicks = 0; lastPos = pos.clone(); }

      if (stuckTicks < 30) return;
      stuckTicks = 0;
      lastPos = pos.clone();

      // ── Phase 1: normal goal retry (up to 3×) ─────────────────────────────
      if (stuckRetries < 3) {
        stuckRetries++;
        console.log(`⚠️ Stuck at waypoint ${patrolIndex} — goal retry ${stuckRetries}/3`);
        bot.pathfinder.setGoal(null);
        setTimeout(() => {
          if (!alive || !patrolActive) return;
          bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 1), true);
        }, 300);
        return;
      }

      // ── Phase 2: jump + retry (up to 3×) ──────────────────────────────────
      if (jumpRetries < 3) {
        jumpRetries++;
        console.log(`🦘 Jump-assist attempt ${jumpRetries}/3 at waypoint ${patrolIndex}`);
        bot.pathfinder.setGoal(null);
        let jumps = 0;
        const jumpTimer = setInterval(() => {
          if (!alive || !patrolActive) { clearInterval(jumpTimer); return; }
          bot.setControlState('jump', true);
          setTimeout(() => bot.setControlState('jump', false), 150);
          if (++jumps >= 4) {
            clearInterval(jumpTimer);
            stuckRetries = 0;
            setTimeout(() => {
              if (!alive || !patrolActive) return;
              bot.pathfinder.setGoal(new GoalNear(target.x, target.y, target.z, 1), true);
            }, 300);
          }
        }, 250);
        return;
      }

      // ── Phase 3: give up → disconnect & reconnect ─────────────────────────
      clearInterval(poll);
      console.log(`❌ Waypoint ${patrolIndex} unreachable after all retries. Reconnecting...`);
      patrolActive = false;
      stopClicking();
      clearReconnectTimer();
      bot.quit();
    }, 100);
  }

  function startClicking() {
    stopClicking();
    bot.setQuickBarSlot(0);
    clickInterval = setInterval(() => {
      if (alive && patrolActive) bot.activateItem();
    }, 600);
  }

  function stopClicking() {
    if (clickInterval) { clearInterval(clickInterval); clickInterval = null; }
  }

  bot.on('message', (jsonMsg, position) => {
    if (position === 'game_info') return; // skip action-bar spam, keep real chat/system messages
    const msg = jsonMsg.toString();
    console.log(`💬 [DrakonTide] ${msg}`);

    if (!alive || !homeReached) return;
    const lower = msg.toLowerCase();
    if (lower.includes('drakontide') || lower.includes('you were killed by')) {
      console.log('📨 Trigger phrase detected. Disconnecting in 5s...');
      alive = false; // prevent double-trigger
      clearReconnectTimer();
      setTimeout(() => bot.quit(), 5000);
    }
  });

  bot.quitBot = function () {
    bot.manualQuit = true;
    alive = false;
    patrolActive = false;
    stopClicking();
    clearReconnectTimer();
    bot.quit();
  };
}

createBot();
