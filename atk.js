const mineflayer = require('mineflayer');

const originalWarn = console.warn;
console.warn = (msg, ...args) => {
  if (typeof msg === 'string' && msg.includes('objectType is deprecated')) return;
  if (typeof msg === 'string' && msg.includes('chunk failed to load')) return;
  originalWarn(msg, ...args);
};

// ── Config ────────────────────────────────────────────────────────────────
const HOST = 'fakepixel.me';
const VERSION = '1.8.9';
const WARP_COMMAND = '/warp island';
const RECONNECT_MS = 5000; // was 10000

const ACCOUNTS = [
  { username: 'LamaMC', registerCommand: '/register 3195 3195', loginCommand: '/login 3195' },
  { username: 'Enrage', registerCommand: '/register 3195 3195', loginCommand: '/login 3195' }
];

const activeBots = {}; // username -> bot instance

// ── Duplicate-message filter ───────────────────────────────────────────
// If two bots receive the identical chat line within this window, only
// print it once instead of once per bot.
const DEDUPE_WINDOW_MS = 1000;
const recentMessages = new Map(); // msg text -> timestamp last printed

function printOnce(msg) {
  const now = Date.now();
  const last = recentMessages.get(msg);
  if (last && now - last < DEDUPE_WINDOW_MS) {
    return; // duplicate within window, skip
  }
  recentMessages.set(msg, now);
  console.log(`💬 ${msg}`);
  // periodic cleanup so the map doesn't grow forever
  if (recentMessages.size > 200) {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [k, t] of recentMessages) {
      if (t < cutoff) recentMessages.delete(k);
    }
  }
}

// ── Bot factory ──────────────────────────────────────────────────────────
function createBot(account) {
  if (account._disabled) return;
  console.log(`🚀 createBot() called — connecting as ${account.username}`);
  try {
    const bot = mineflayer.createBot({
      host: HOST,
      username: account.username,
      version: VERSION,
      keepAlive: true,
      checkTimeoutInterval: 60000
    });

    activeBots[account.username] = bot;

    let alive = true;
    let registered = account._registeredOnce || false;

    // ── GUI / warp ────────────────────────────────────────────────────────
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
            console.log(`🎯 [${account.username}] Clicked teleport item.`);
          } catch (err) {
            console.log(`❌ [${account.username}] GUI click error:`, err.message);
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

    function enterAfkPool() {
      console.log(`💤 [${account.username}] In AFK pool — idling indefinitely, keep-alive only.`);
    }

    // ── Bot lifecycle ─────────────────────────────────────────────────────
    bot.on('login', () => console.log(`🔌 [${account.username}] Login packet sent, connecting...`));
    bot._client.on('error', err => console.log(`🔥 [${account.username}] Client error:`, err.message));

    bot.once('spawn', () => {
      console.log(`🟢 [${account.username}] SPAWN EVENT FIRED`);
      try {
        bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) {
        console.log(`⚠️ [${account.username}] socket setup failed:`, e.message);
      }
      console.log(`✅ [${account.username}] Spawned`);
      bot.manualQuit = false;

      setTimeout(() => {
        if (!alive) return;
        if (!registered) {
          bot.chat(account.registerCommand);
          registered = true;
          account._registeredOnce = true;
          setTimeout(() => {
            if (!alive) return;
            bot.chat(account.loginCommand);
            setTimeout(() => { if (alive) openTeleportGUI(); }, 2000);
          }, 2000);
        } else {
          bot.chat(account.loginCommand);
          setTimeout(() => { if (alive) openTeleportGUI(); }, 2000);
        }
      }, 2000);
    });

    // ── Message handler (deduped, no ping detection) ──────────────────────
    bot.on('message', (jsonMsg, position) => {
      if (position === 'game_info') return;
      const msg = jsonMsg.toString();
      printOnce(msg);
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log(`☠️ [${account.username}] Died while AFK.`);
    });

    bot.on('end', (reason) => {
      console.log(`📋 [${account.username}] End reason:`, reason);
      alive = false;
      delete activeBots[account.username];
      if (bot.manualQuit) {
        console.log(`🛑 [${account.username}] Manual quit — not reconnecting.`);
        return;
      }
      if (!account._disabled) {
        console.log(`🔁 [${account.username}] Disconnected unexpectedly. Reconnecting in ${RECONNECT_MS / 1000}s...`);
        setTimeout(() => createBot(account), RECONNECT_MS);
      }
    });

    bot.on('error', err => console.log(`❌ [${account.username}] Error:`, err.message));

    bot.quitBot = function () {
      bot.manualQuit = true;
      account._disabled = true;
      alive = false;
      bot.quit();
    };
  } catch (err) {
    console.log(`💥 [${account.username}] createBot crashed:`, err);
  }
}

// ── Terminal → in-game chat bridge ──────────────────────────────────────
process.stdin.setEncoding('utf8');
process.stdin.on('data', (input) => {
  const line = input.toString().trim();
  if (!line) return;

  if (line.toLowerCase().startsWith('quit')) {
    const target = line.split(' ')[1];
    if (!target || target.toLowerCase() === 'all') {
      Object.values(activeBots).forEach(b => b.quitBot());
      console.log('🛑 Quitting all bots.');
    } else {
      const b = activeBots[target];
      if (b) { b.quitBot(); console.log(`🛑 Quitting ${target}.`); }
      else console.log(`⚠️ No active bot named "${target}".`);
    }
    return;
  }

  const match = line.match(/^([A-Za-z0-9_]+):\s*(.+)$/);
  if (match && activeBots[match[1]]) {
    activeBots[match[1]].chat(match[2]);
    console.log(`⌨️  ${match[1]}: ${match[2]}`);
  } else {
    Object.entries(activeBots).forEach(([name, b]) => {
      b.chat(line);
      console.log(`⌨️  ${name}: ${line}`);
    });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────
ACCOUNTS.forEach(account => createBot(account));
