const mineflayer = require('mineflayer');

const originalWarn = console.warn;
console.warn = (msg, ...args) => {
  if (typeof msg === 'string' && msg.includes('objectType is deprecated')) return;
  if (typeof msg === 'string' && msg.includes('chunk failed to load')) return;
  originalWarn(msg, ...args);
};

// ── Config ────────────────────────────────────────────────────────────────
const HOST = 'fakepixel.me';
const VERSION = '1.26.2';
const SKYBLOCK_COMMAND = '/skyblock';

// email = the Microsoft account used to sign in (auth: 'microsoft' below).
// username = the in-game name tied to that account, used for ping detection.
const ACCOUNT = { email: 'zafar7khan0@gmail.com', username: 'B2C_' };

// Anyone mentioning this name in chat counts as a "ping"
const PING_NAMES = [ACCOUNT.username];

const PING_AFK_MS = 5 * 60 * 1000; // stand still 5 min after a ping, then hard-stop

// Master switch. Set to false (e.g. by a ping) to fully stop reconnecting.
// Re-running the script is what "turns it back on".
let scriptEnabled = true;

// ── AFK bot (LamaMC) ─────────────────────────────────────────────────────────
function createBot() {
  if (!scriptEnabled) return;
  console.log(`🚀 createBot() called — connecting as ${ACCOUNT.username}`);
  try {
    const bot = mineflayer.createBot({
      host: HOST,
      username: ACCOUNT.email,
      auth: 'microsoft',
      version: VERSION,
      keepAlive: true,
      checkTimeoutInterval: 60000
    });

    let alive = true;
    let pingPaused = false;

    // ── Skyblock ──────────────────────────────────────────────────────────
    function goToSkyblock() {
      bot.chat(SKYBLOCK_COMMAND);
      console.log(`💬 Sent ${SKYBLOCK_COMMAND}`);
      setTimeout(() => { if (alive) enterAfkPool(); }, 5000);
    }

    // Just sits connected — keepAlive:true already answers the server's keep-alive
    // pings at the protocol level, so there's nothing else to send here.
    // No timer — stays AFK indefinitely until pinged or manually stopped.
    function enterAfkPool() {
      console.log('💤 In AFK pool — idling indefinitely, keep-alive only.');
    }

    // ── Ping handling: stand still 5 min, then hard-stop ─────────────────
    function handlePing() {
      if (pingPaused || !alive) return;
      pingPaused = true;
      console.log('🔔 Ping detected — going fully AFK for 5 min, then disconnecting until restarted.');
      setTimeout(() => {
        if (!alive) return;
        console.log('🛑 5 min AFK complete — disconnecting. Re-run the script to resume.');
        scriptEnabled = false;
        bot.pingShutdown = true;
        alive = false;
        bot.quit();
      }, PING_AFK_MS);
    }

    // ── Bot lifecycle ─────────────────────────────────────────────────────
    bot.on('login', () => console.log('🔌 Login packet sent, connecting...'));
    bot._client.on('error', err => console.log('🔥 Client error:', err.message));

    bot.once('spawn', () => {
      console.log('🟢 SPAWN EVENT FIRED');
      try {
        bot._client.socket.setTimeout(24 * 60 * 60 * 1000);
        bot._client.socket.setKeepAlive(true, 10000);
      } catch (e) {
        console.log('⚠️ socket setup failed:', e.message);
      }
      console.log('✅ Spawned');
      bot.manualQuit = false;
      
      // Wait 2 seconds after spawning, then go straight to Skyblock
      setTimeout(() => {
        if (alive) goToSkyblock();
      }, 2000);
    });

    // ── Message handler ─────────────────────────────────────────────────
    bot.on('message', (jsonMsg, position) => {
      if (position === 'game_info') return;
      const msg = jsonMsg.toString();
      console.log(`💬 ${msg}`);
      if (!alive || pingPaused) return;
      const isPinged = PING_NAMES.some(name => msg.toLowerCase().includes(name.toLowerCase()));
      if (isPinged) handlePing();
    });

    bot.on('death', () => {
      if (!alive) return;
      console.log('☠️ Died while AFK.');
      // Stays connected — add bot.respawn() here if your server doesn't
      // auto-respawn idle players.
    });

    bot.on('end', (reason) => {
      console.log('📋 End reason:', reason);
      alive = false;
      if (bot.pingShutdown) {
        console.log('🛑 Stopped after a ping — script paused. Re-run the script to resume.');
        return;
      }
      if (bot.manualQuit) {
        console.log('🛑 Manual quit — not reconnecting.');
        return;
      }
      if (scriptEnabled) {
        console.log('🔁 Disconnected unexpectedly. Reconnecting in 10s...');
        setTimeout(createBot, 10000);
      }
    });

    bot.on('error', err => console.log('❌ Error:', err.message));

    bot.quitBot = function () {
      bot.manualQuit = true;
      scriptEnabled = false;
      alive = false;
      bot.quit();
    };
  } catch (err) {
    console.log('💥 createBot crashed:', err);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────
createBot();
