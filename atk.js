const mineflayer = require('mineflayer');
// const { SocksProxyAgent } = require('socks-proxy-agent'); // Uncomment if using SOCKS proxies

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
  { username: 'Mantaa707', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.101' },
  { username: 'Octopi888', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.102' },
  { username: 'Sirenn303', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.103' },
  { username: 'Kelpys101', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.104' },
  { username: 'Walrus404', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.105' },
  { username: 'Hydraa999', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.106' },
  { username: 'Viperr505', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.107' },
  { username: 'Corall606', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.108' },
  { username: 'Pelica202', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.109' },
  { username: 'Nautil111', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.110' },
  { username: 'Salmon102', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.111' },
  { username: 'Marlin103', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.112' },
  { username: 'Shrimp104', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.113' },
  { username: 'Urchin105', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.114' },
  { username: 'Dugong106', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.115' },
  { username: 'Beluga107', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.116' },
  { username: 'Whalee108', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.117' },
  { username: 'Mussell109', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.118' },
  { username: 'Oyster110', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.119' },
  { username: 'Barram112', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.120' },
  { username: 'Gudgeo113', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.121' },
  { username: 'Medusa114', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.122' },
  { username: 'Polyps115', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.123' },
  { username: 'Spongy116', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.124' },
  { username: 'Snappe117', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.125' },
  { username: 'Anemno118', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.126' },
  { username: 'Angler119', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.127' },
  { username: 'Triton120', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.128' },
  { username: 'Abysss121', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.129' },
  { username: 'Trench122', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.130' },
  { username: 'Lagoon123', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.131' },
  { username: 'Reeffs124', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.132' },
  { username: 'Oceanic125', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.133' },
  { username: 'Tsunami126', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.134' },
  { username: 'Aqueus127', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.135' },
  { username: 'Marine128', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.136' },
  { username: 'Pelagi129', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.137' },
  { username: 'Benths130', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.138' },
  { username: 'Deepsea131', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.139' },
  { username: 'Finnees132', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.140' },
  { username: 'Gillee133', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.141' },
  { username: 'Guppyy134', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.142' },
  { username: 'Minnow135', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.143' },
  { username: 'Clamm210', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.144' },
  { username: 'Krilll211', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.145' },
  { username: 'Orcaas212', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.146' },
  { username: 'Limpets213', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.147' },
  { username: 'Plankt214', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.148' },
  { username: 'Barnac215', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.149' },
  { username: 'Squids216', registerCommand: '/register 1122 1122', loginCommand: '/login 1122', localAddress: '192.168.1.150' }
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
  console.log(`🚀 createBot() called — connecting as ${account.username} from IP ${account.localAddress}`);
  
  try {
    // If using SOCKS proxies instead of local IPs, you would configure it here:
    // const agent = account.proxy ? new SocksProxyAgent(account.proxy) : null;

    const bot = mineflayer.createBot({
      host: HOST,
      username: account.username,
      version: VERSION,
      keepAlive: true,
      checkTimeoutInterval: 60000,
      
      // THIS BINDS THE BOT TO THE SPECIFIC LOCAL IP
      localAddress: account.localAddress,
      
      // If using SOCKS proxy, use this instead of localAddress:
      // agent: agent 
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
// Stagger the logins slightly to avoid immediately overloading the IP/Server limits
ACCOUNTS.forEach((account, index) => {
  setTimeout(() => {
    createBot(account);
  }, index * 2000); // 2-second delay between each bot spawning
});
