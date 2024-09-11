const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const mineflayer = require('mineflayer');
// Discord Bot Setup
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const discordToken = 'DISCORD_BOT_TOKEN'; // Replace with your Discord bot token

const activeBots = [];
const channelIntervals = new Map()
const botChannelMap = new Map()
const occupiedLobbies = new Map(); // Track occupied lobbies
const channelPlayerLists = new Map()
const channelSendIntervals = new Map()

const authVersion = 'microsoft';
const mcVersion = '1.16.5'; // Can change these 
const serverID = 'PUT DISCORD SERVER ID HERE'

var postInterval = 300000 // 5 minutes

// Mineflayer Bots Setup
const botConfigs = [
  { username: 'USERNAME', host: 'SERVER_IP' },
  // Add more bots as needed
];

function switchLobby(bot) {
  bot.chat('/lobby');
  setTimeout(() => {
      joinPitLobby(bot);
  }, 5000); // Adjust delay as necessary
}

discordClient.on('messageCreate', async (message) => {
  // Command to manually switch a bot's lobby
  if (message.content.startsWith('!switchlobby')) {
      const args = message.content.split(' ');
      if (args.length < 2) {
          message.reply('Usage: !switchlobby <botUsername>');
          return;
      }
      const botUsername = args[1];
      const bot = mineflayer.bots.find(b => b.username === botUsername);
      if (!bot) {
          message.reply(`Bot with username ${botUsername} not found.`);
          return;
      }
      switchLobby(bot);
      message.reply(`Bot ${botUsername} is switching lobbies.`);
  }
});

const bots = botConfigs.map(config => createBot(config));

function createBot({ username, host }) {
  const bot = mineflayer.createBot({
    username: username,
    host: host,
    auth: authVersion,
    version: mcVersion
  });

  bot.on('login', () => {
    console.log(`${username} logged in.`);
  });

  bot.on('spawn', () => {
    console.log(`${username} has spawned.`);
    setTimeout(() => {
      joinPitLobby(bot);
    }, 5000);
  });

  bot.on('message', async (jsonMsg) => {
    if (jsonMsg.toString().includes('PIT! Latest update: ')) {
      fetchServerInfo(bot);
    }
  });

  bot.on('error', err => {
    console.log(`[${bot.username}] Error: ${err}`);
  });

  bot.on('end', () => {
    console.log(`${username} disconnected.`);
    // Optionally, attempt to reconnect or handle disconnections
    activeBots.splice(activeBots.indexOf(bot), 1); // Remove from active bots
  });

  // Store the active bot reference
  activeBots.push(bot);

  return bot;
}

function joinPitLobby(bot) {
  bot.chat('/play pit');
  // Optionally, add a delay or check for confirmation
}

async function manageDiscordChannels(serverName, bot) {
  const guild = discordClient.guilds.cache.get(serverID); // Replace with your Discord guild ID
  if (!guild) return console.error('Guild not found');

  // Normalize serverName to avoid issues with formatting
  const normalizedServerName = serverName.toLowerCase().replace(/\s+/g, '-');

  // Fetch the latest channels from the guild to ensure accuracy
  await guild.channels.fetch();

  // Check if a channel with the normalized server name already exists
  let channel = guild.channels.cache.find(ch => ch.name.toLowerCase() === normalizedServerName);

  if (!channel) {
      // Create a new channel if it doesn't exist
      channel = await guild.channels.create({
          name: normalizedServerName,
          type: ChannelType.GuildText,
      });
      console.log(`Created channel: ${normalizedServerName}`);
  } else {
      console.log(`Channel already exists: ${normalizedServerName}`);
  }

  // Associate the bot with its respective channel
  botChannelMap.set(bot.username, channel.id);

  // Initialize player list for the channel
  if (!channelPlayerLists.has(channel.id)) {
      channelPlayerLists.set(channel.id, []);
  }

  // Clear any existing interval for this channel to avoid overlapping
  if (channelIntervals.has(channel.id)) {
      clearInterval(channelIntervals.get(channel.id));
      channelIntervals.delete(channel.id);
  }

  // Set a new interval for updating the player list every 10 seconds
  const updateInterval = setInterval(async () => {
    const currentLobby = await getCurrentLobby(bot);
    const botIdentifier = { username: bot.username, server: currentLobby };
    if(isLobbyOccupied(botIdentifier) == false) {
      console.log(`Updating player list for channel: ${channel.name} (${channel.id})`);
      updatePlayerList(channel.id, bot)
    }
  }, 10000); // 10 seconds interval

  channelIntervals.set(channel.id, updateInterval);

  // Clear any existing send interval for this channel to avoid overlapping
  if (channelSendIntervals.has(channel.id)) {
      clearInterval(channelSendIntervals.get(channel.id));
      channelSendIntervals.delete(channel.id);
  }

  // Set a new interval for sending messages every 5 minutes
  const sendInterval = setInterval(async () => {
      console.log(`Sending player list for channel: ${channel.name} (${channel.id})`);
      await sendPlayerList(channel.id);
  }, postInterval); // 5 minutes interval

  channelSendIntervals.set(channel.id, sendInterval);
}

async function updatePlayerList(channelId, bot) {
  try {
      const playerList = await getPlayerList(bot);
      channelPlayerLists.set(channelId, playerList);
      console.log(`Player list updated for channel: ${channelId}`);
  } catch (error) {
      console.error('Error updating player list:', error);
  }
}

async function sendPlayerList(channelId) {
  try {
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
          console.error('Invalid channel or not a text channel!');
          return;
      }

      console.log(`Purging messages in channel: ${channel.name} (${channelId})`);
      await purgeChannel(channelId);

      const playerList = channelPlayerLists.get(channelId) || [];
      const playerLinks = playerList.map(player => `${player}: https://pitpanda.rocks/players/${player}`);

      playerLinks.forEach(async message => {
          await sendMessage(channelId, message);
      });

      console.log(`Player list sent for channel: ${channel.name} (${channelId})`);
  } catch (error) {
      console.error('Error sending player list:', error);
  }
}

async function sendMessage(channelId, message) {
  try {
      // Fetch the channel by its ID
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel) {
          console.error('Channel not found!');
          return;
      }

      // Send the message to the channel
      await channel.send(message);
  } catch (error) {
      console.error('Error sending message:', error);
  }
}

async function purgeChannel(channelId) {
  try {
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) {
          console.error('Invalid channel or not a text channel!');
          return;
      }
      const fetched = await channel.messages.fetch({ limit: 100 }); // Fetch all messages in the channel and delete them
      await channel.bulkDelete(fetched);
      console.log(`Purged messages in channel: ${channel.name}`);
  } catch (error) {
      console.error('Error purging channel:', error);
  }
}

async function getPlayerList(bot) {
  return new Promise((resolve) => {
      // Ensure bot.players is available
      if (bot && bot.players) {
          resolve(Object.keys(bot.players));
      } else {
          resolve([]);
      }
  });
}

function extractServerName(message) {
  // Ensure message.content is available and is a string
  if (message) {
    const parts = message.toString().split('server');
    if (parts.length > 1) {
      return parts[1].trim(); // Example: "ServerName"
    }
  }
  return null; // Return null if extraction fails
}

function fetchServerInfo(bot) {
  bot.chat('/whereami'); // Fetch the server info
  bot.once('message', (message) => {
    if (message.toString().includes('You are currently connected to server')) {
      console.log(`[${bot.username}] Message received: ${message.content}`);
      const serverName = extractServerName(message);
      if (serverName) {
        manageDiscordChannels(serverName, bot);
        setInterval(() => checkAndSwapLobbies(bot), 5000);
      } else {
        console.error(`Could not extract server name from message: ${message.content}`);
      }
    }
  });
}


async function checkAndSwapLobbies(bot) {
  const currentLobby = await getCurrentLobby(bot);
  console.log(`CURRENT LOBBY IS ${currentLobby}`);

  if (currentLobby) {
      const botIdentifier = { username: bot.username, server: currentLobby };

      // If the lobby contains "dynamic", swap immediately
      if (currentLobby.includes('dynamic')) {
          console.log(`[${bot.username}] Lobby contains 'dynamic'. Swapping lobby...`);
          swapLobby(bot);
          return; // Exit the function to prevent further checks
      }

      if (isLobbyOccupied(botIdentifier)) {
          console.log(`[${bot.username}] Lobby is overcrowded or already occupied. Swapping lobby...`);
          removeBotFromLobby(botIdentifier);
          swapLobby(bot);
      } else {
          // Mark the lobby as occupied for this bot
          addBotToLobby(botIdentifier);
          console.log(`[${bot.username}] Lobby is unique.`);
      }
  }

  // Clean up the occupied lobbies map if necessary
  setTimeout(() => {
      removeBotFromLobby({ username: bot.username, server: currentLobby });
  }, 60000); // Adjust time as necessary
}

function swapLobby(bot) {
  bot.chat('/lobby');
  setTimeout(() => {
      joinPitLobby(bot);
  }, 5000); // Adjust delay as necessary
}

function isLobbyOccupied(botIdentifier) {
  const botsInLobby = occupiedLobbies.get(botIdentifier.server);
  if (botsInLobby) {
      return botsInLobby.some(username => username !== botIdentifier.username);
  }
  return false;
}

function addBotToLobby(botIdentifier) {
  const botsInLobby = occupiedLobbies.get(botIdentifier.server) || [];
  if (!botsInLobby.includes(botIdentifier.username)) {
      botsInLobby.push(botIdentifier.username);
      occupiedLobbies.set(botIdentifier.server, botsInLobby);
  }
}

function removeBotFromLobby(botIdentifier) {
  const botsInLobby = occupiedLobbies.get(botIdentifier.server);
  if (botsInLobby) {
      const index = botsInLobby.indexOf(botIdentifier.username);
      if (index !== -1) {
          botsInLobby.splice(index, 1);
          if (botsInLobby.length === 0) {
              occupiedLobbies.delete(botIdentifier.server);
          } else {
              occupiedLobbies.set(botIdentifier.server, botsInLobby);
          }
      }
  }
}

async function getCurrentLobby(bot) {
  try {
      const serverName = await swaplobbyservername(bot);
      if (typeof serverName === 'string') {
          return serverName.toLowerCase().replace(/\s+/g, '-');
      } else {
          console.error(`[${bot.username}] Error: serverName is not a string or is null.`);
          return null;
      }
  } catch (error) {
      console.error(`[${bot.username}] Error in getCurrentLobby: ${error}`);
      return null;
  }
}

function swaplobbyservername(bot) {
  return new Promise((resolve) => {
      bot.chat('/whereami');
      bot.once('message', (message) => {
          if (message.toString().includes('You are currently connected to server')) {
              console.log(`[${bot.username}] Message received: ${message}`);
              const serverName = extractServerName(message);
              resolve(serverName ? serverName.toLowerCase().replace(/\s+/g, '-') : null);
          } else {
              resolve(null);
          }
      });
  });
}
discordClient.once('ready', () => {
  console.log(`Discord bot logged in as ${discordClient.user.tag}`);
});

discordClient.login(discordToken);
