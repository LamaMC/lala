const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const mcDataLoader = require('minecraft-data')

let rightClickIntervals = {}
let teleportingStatus = {}
let keepAliveStarted = {}
let dodgeLoops = {}

const knownBotNames = ['DrakonTide', 'Supreme_Bolt', 'JamaaLcaliph', 'B2C', 'BoltMC']

function createBot({ username, password, delay }) {
  setTimeout(() => {
    const bot = mineflayer.createBot({
      host: 'mc.fakepixel.fun',
      port: 25565,
      username,
      auth: 'offline',
      version: '1.16.5',
      checkTimeoutInterval: 120000
    })

    bot.loadPlugin(pathfinder)
    teleportingStatus[username] = false

    bot.once('spawn', () => {
      console.log(`✅ ${username} spawned.`)
      bot.chat(`/login ${password}`)
      startDodgeLoop(bot)
    })

    bot.on('message', (message) => {
      const msg = message.toString().toLowerCase()

      if (msg.includes('login failed') || msg.includes('please login')) {
        console.log(`🔐 ${username} login retry...`)
        setTimeout(() => bot.chat(`/login ${password}`), 2000)
      }

      if (msg.includes('party my')) {
        console.log(`🎉 ${username} detected "party my", inviting B2C.`)
        bot.chat('/party B2C')
      }

      if (msg.includes('joined the party')) {
        console.log(`👑 ${username} detected party join, transferring leadership to B2C.`)
        bot.chat('/party transfer B2C')
      }

      if (msg.includes('sending to sb')) {
        console.log(`🚪 ${username} preparing for teleport.`)
        teleportingStatus[username] = true

        try { bot.pathfinder.setGoal(null) } catch {}
        stopRightClickSpam(bot)
        if (bot.currentWindow) {
          try { bot.closeWindow(bot.currentWindow) } catch {}
        }
        bot.removeAllListeners('windowOpen')

        setTimeout(() => {
          teleportingStatus[username] = false
          console.log(`🔄 ${username} teleport completed.`)
        }, 5000)
      }

      if (msg.includes('the dungeon will begin') && !teleportingStatus[username]) {
        console.log(`🏃 ${username} moving to NPC.`)
        goToAndClickNPC(bot)
      }

      if (msg.includes('i first entered the dungeon') && !teleportingStatus[username]) {
        console.log(`🔁 ${username} start spamming right-click.`)
        startRightClickSpam(bot)
      }

      if (msg.includes('you have dealt')) {
        console.log(`😴 ${username} going AFK.`)
        stopRightClickSpam(bot)
        startKeepAlive(bot)
      }
    })

    bot.on('windowOpen', (window) => {
      try {
        console.log(`📦 ${bot.username} GUI opened:`, window.title)
      } catch (e) {
        console.warn(`⚠️ ${bot.username} GUI open error:`, e.message)
      }
    })

    bot.on('kicked', (reason) => {
      console.log(`❌ ${username} was kicked:`, reason)
    })

    bot.on('error', (err) => {
      if (err.message.includes('unknown objective')) return
      console.log(`💥 ${username} error:`, err.message)
    })

    bot.on('end', () => {
      console.log(`🔌 ${username} disconnected. Reconnecting in 5s...`)
      clearInterval(rightClickIntervals[username])
      clearInterval(dodgeLoops[username])
      delete keepAliveStarted[username]
      delete dodgeLoops[username]
      setTimeout(() => createBot({ username, password, delay: 0 }), 5000)
    })

    function goToAndClickNPC(bot) {
      if (teleportingStatus[bot.username]) return

      const npc = bot.nearestEntity(e =>
        e.type === 'player' &&
        e.username !== bot.username &&
        !knownBotNames.includes(e.username) &&
        (!bot.players[e.username]?.ping || bot.players[e.username]?.ping === 0) &&
        e.velocity.x === 0 && e.velocity.y === 0 && e.velocity.z === 0
      )

      if (!npc) {
        console.log(`❌ ${bot.username} no NPC found.`)
        return
      }

      const mcData = mcDataLoader(bot.version)
      const movements = new Movements(bot, mcData)
      bot.pathfinder.setMovements(movements)

      const pos = npc.position
      const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 0.3)
      bot.pathfinder.setGoal(goal)

      bot.once('goal_reached', () => {
        console.log(`🎯 ${bot.username} reached NPC at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`)
        bot.setQuickBarSlot(0)

        setTimeout(() => {
          bot.attack(npc)
          console.log(`🖱️ ${bot.username} left-clicked NPC`)

          bot.once('windowOpen', (window) => {
            let clickedAny = false
            try {
              for (let i = 0; i < window.slots.length; i++) {
                const item = window.slots[i]
                if (
                  item &&
                  (
                    item.name === 'red_stained_glass_pane' ||
                    (item.name === 'stained_glass_pane' && item.metadata === 14) ||
                    item.displayName?.toLowerCase().includes('not ready')
                  )
                ) {
                  bot.clickWindow(i, 0, 1)
                  console.log(`✅ ${bot.username} shift-clicked: ${item.displayName || item.name}`)
                  clickedAny = true
                }
              }
            } catch (e) {
              console.warn(`⚠️ GUI error during clickWindow: ${e.message}`)
            }

            if (!clickedAny) {
              console.log(`❌ ${bot.username} no red pane or "Not Ready" found.`)
            }

            bot.pathfinder.setGoal(null)
          })
        }, 1000)
      })
    }

    function startRightClickSpam(bot) {
      if (rightClickIntervals[bot.username] || teleportingStatus[bot.username]) return
      bot.setQuickBarSlot(0)
      rightClickIntervals[bot.username] = setInterval(() => {
        bot.activateItem()
      }, 300)
    }

    function stopRightClickSpam(bot) {
      if (rightClickIntervals[bot.username]) {
        clearInterval(rightClickIntervals[bot.username])
        delete rightClickIntervals[bot.username]
      }
    }

    function startKeepAlive(bot) {
      if (keepAliveStarted[bot.username]) return
      keepAliveStarted[bot.username] = true
      setInterval(() => {
        if (bot && bot.player) {
          bot._client.write('ping', { keepAliveId: Date.now() })
          console.log(`📶 ${bot.username} keep-alive ping sent.`)
        }
      }, 30000)
    }

    function startDodgeLoop(bot) {
      if (dodgeLoops[bot.username]) return
      console.log(`🔁 ${bot.username} dodge loop started (every 5 min)`)

      dodgeLoops[bot.username] = setInterval(() => {
        if (teleportingStatus[bot.username]) return

        console.log(`🚶 ${bot.username} dodge: moving back 2 then forward 2`)

        // Move backward ~2 blocks
        bot.setControlState('back', true)
        setTimeout(() => {
          bot.setControlState('back', false)

          // Brief pause then move forward ~2 blocks
          setTimeout(() => {
            bot.setControlState('forward', true)
            setTimeout(() => {
              bot.setControlState('forward', false)
              console.log(`✅ ${bot.username} dodge complete.`)
            }, 400)
          }, 200)

        }, 400)

      }, 5 * 60 * 1000) // every 5 minutes
    }

  }, delay)
}

process.on('uncaughtException', (err) => {
  console.error('🛑 Uncaught Exception:', err)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('🛑 Unhandled Promise:', reason)
})

// Launching bots
createBot({ username: 'JamaaLcaliph', password: '3043AA', delay: 0 })
