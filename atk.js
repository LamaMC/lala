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
const RECONNECT_MS = 5000;

const ACCOUNTS = [
  { username: 'Mantaa707', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Octopi888', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Sirenn303', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Kelpys101', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Walrus404', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Hydraa999', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Viperr505', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Corall606', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Pelica202', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Nautil111', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Salmon102', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Marlin103', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Shrimp104', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Urchin105', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Dugong106', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Beluga107', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Whalee108', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Mussell109', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Oyster110', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Barram112', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Gudgeo113', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Medusa114', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Polyps115', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Spongy116', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Snappe117', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Anemno118', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Angler119', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Triton120', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Abysss121', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Trench122', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Lagoon123', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Reeffs124', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Oceanic125', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Tsunami126', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Aqueus127', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Marine128', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Pelagi129', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Benths130', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Deepsea131', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Finnees132', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Gillee133', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Guppyy134', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Minnow135', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Clamm210', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Krilll211', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Orcaas212', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Limpets213', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Plankt214', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Barnac215', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' },
  { username: 'Squids216', registerCommand: '/register 1122 1122', loginCommand: '/login 1122' }
];


const activeBots = {}; // username -> bot instance

// ── Duplicate-message filter ───────────────────────────────────────────
const DEDUPE_WINDOW_MS = 1000;
const recentMessages = new Map();

function printOnce(msg) {
  const now = Date.now();
  const last = recentMessages.get(msg);
  if (last && now - last < DEDUPE_WINDOW_MS) {
    return;
  }
  recentMessages.set(msg, now);
  console.log(`💬 ${msg}`);
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
    let lastKickReason = null; // captured by 'kicked', read by 'end'

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

    // ── Message handler (deduped) ──────────────────────────────────────────
    bot.on('message', (jsonMsg, position) => {
      if (position === 'game_info') return;
      const msg = jsonMsg.toString();
      printOnce(msg);
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log(`☠️ [${account.username}] Died while AFK.`);
    });

    // Fires when the server explicitly kicks the bot — usually the most
    // specific reason string (AFK kick, duplicate login, ban, etc.)
    bot.on('kicked', (reason, loggedIn) => {
      lastKickReason = reason;
      console.log(`⛔ [${account.username}] Kicked — reason:`, reason, `(was logged in: ${loggedIn})`);
    });

    bot.on('end', (reason) => {
      const detail = lastKickReason || reason || 'unknown';
      console.log(`📋 [${account.username}] Disconnected — reason:`, detail);
      alive = false;
      delete activeBots[account.username];
      lastKickReason = null;
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
