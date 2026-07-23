const mineflayer = require('mineflayer');
const { SocksClient } = require('socks');

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

// IMPORTANT: Replace the proxy "host" and "port" values with your actual SOCKS5 proxies.
const ACCOUNTS = [
  { username: 'Mantaa707', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.1', port: 1080 } },
  { username: 'Octopi888', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.2', port: 1080 } },
  { username: 'Sirenn303', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.3', port: 1080 } },
  { username: 'Kelpys101', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.4', port: 1080 } },
  { username: 'Walrus404', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.5', port: 1080 } },
  { username: 'Hydraa999', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.6', port: 1080 } },
  { username: 'Viperr505', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.7', port: 1080 } },
  { username: 'Corall606', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.8', port: 1080 } },
  { username: 'Pelica202', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.9', port: 1080 } },
  { username: 'Nautil111', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.10', port: 1080 } },
  { username: 'Salmon102', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.11', port: 1080 } },
  { username: 'Marlin103', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.12', port: 1080 } },
  { username: 'Shrimp104', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.13', port: 1080 } },
  { username: 'Urchin105', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.14', port: 1080 } },
  { username: 'Dugong106', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.15', port: 1080 } },
  { username: 'Beluga107', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.16', port: 1080 } },
  { username: 'Whalee108', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.17', port: 1080 } },
  { username: 'Mussell109', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.18', port: 1080 } },
  { username: 'Oyster110', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.19', port: 1080 } },
  { username: 'Barram112', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.20', port: 1080 } },
  { username: 'Gudgeo113', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.21', port: 1080 } },
  { username: 'Medusa114', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.22', port: 1080 } },
  { username: 'Polyps115', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.23', port: 1080 } },
  { username: 'Spongy116', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.24', port: 1080 } },
  { username: 'Snappe117', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.25', port: 1080 } },
  { username: 'Anemno118', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.26', port: 1080 } },
  { username: 'Angler119', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.27', port: 1080 } },
  { username: 'Triton120', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.28', port: 1080 } },
  { username: 'Abysss121', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.29', port: 1080 } },
  { username: 'Trench122', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.30', port: 1080 } },
  { username: 'Lagoon123', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.31', port: 1080 } },
  { username: 'Reeffs124', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.32', port: 1080 } },
  { username: 'Oceanic125', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.33', port: 1080 } },
  { username: 'Tsunami126', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.34', port: 1080 } },
  { username: 'Aqueus127', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.35', port: 1080 } },
  { username: 'Marine128', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.36', port: 1080 } },
  { username: 'Pelagi129', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.37', port: 1080 } },
  { username: 'Benths130', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.38', port: 1080 } },
  { username: 'Deepsea131', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.39', port: 1080 } },
  { username: 'Finnees132', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.40', port: 1080 } },
  { username: 'Gillee133', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.41', port: 1080 } },
  { username: 'Guppyy134', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.42', port: 1080 } },
  { username: 'Minnow135', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.43', port: 1080 } },
  { username: 'Clamm210', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.44', port: 1080 } },
  { username: 'Krilll211', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.45', port: 1080 } },
  { username: 'Orcaas212', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.46', port: 1080 } },
  { username: 'Limpets213', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.47', port: 1080 } },
  { username: 'Plankt214', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.48', port: 1080 } },
  { username: 'Barnac215', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.49', port: 1080 } },
  { username: 'Squids216', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', proxy: { host: '10.0.0.50', port: 1080 } }
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

// ── Bot factory with SOCKS5 Proxy ──────────────────────────────────────────
function createBot(account) {
  if (account._disabled) return;
  console.log(`🚀 Connecting ${account.username} via proxy ${account.proxy.host}:${account.proxy.port}...`);

  try {
    SocksClient.createConnection({
      proxy: {
        host: account.proxy.host,
        port: account.proxy.port,
        type: 5 // 5 = SOCKS5, 4 = SOCKS4
      },
      command: 'connect',
      destination: {
        host: HOST,
        port: 25565 // Standard Minecraft Port
      }
    }, (err, info) => {
      if (err) {
        console.log(`💥 [${account.username}] Proxy connection failed:`, err.message);
        // Will retry automatically after RECONNECT_MS
        if (!account._disabled) {
            setTimeout(() => createBot(account), RECONNECT_MS);
        }
        return; 
      }

      // The proxy stream is established, pass it to Mineflayer
      const bot = mineflayer.createBot({
        username: account.username,
        version: VERSION,
        stream: info.socket, 
        keepAlive: true,
        checkTimeoutInterval: 60000
      });

      activeBots[account.username] = bot;

      let alive = true;
      let registered = account._registeredOnce || false;
      let lastKickReason = null;

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
            } catch (errClick) {
              console.log(`❌ [${account.username}] GUI click error:`, errClick.message);
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
      bot.on('login', () => console.log(`🔌 [${account.username}] Login packet sent...`));
      
      bot.once('spawn', () => {
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
          console.log(`🔁 [${account.username}] Reconnecting in ${RECONNECT_MS / 1000}s...`);
          setTimeout(() => createBot(account), RECONNECT_MS);
        }
      });

      bot.on('error', err => console.log(`❌ [${account.username}] Bot Error:`, err.message));

      bot.quitBot = function () {
        bot.manualQuit = true;
        account._disabled = true;
        alive = false;
        bot.quit();
      };
    });
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
// Stagger the logins slightly to avoid immediately overloading the network limits
ACCOUNTS.forEach((account, index) => {
  setTimeout(() => {
    createBot(account);
  }, index * 2000); // 2-second delay between each bot spawning
});
