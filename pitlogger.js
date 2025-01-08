const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
 
const mineflayer = require('mineflayer');
 
// Discord Bot Setup
const discordClient = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const discordToken = 'Bot Token'; // Replace with your Discord bot token

const channelIntervals = new Map()
const botChannelMap = new Map()
const occupiedLobbies = new Map(); // Track occupied lobbies
const channelPlayerLists = new Map()
const channelSendIntervals = new Map()
 
const allowedRole = 'Moderator Role'

// Mineflayer Bots Setup
const botConfigs = [
  { username: 'Bots', host: 'Server IP' },
  // Add more bots as needed
];
 
const bots = new Array()
 
function createBot({ username, host }) {
  const bot = mineflayer.createBot({
    username: username,
    host: host,
    auth: 'microsoft',
    version: '1.17.1'
  });
 
  bot.on('login', () => {
    console.log(`${username} logged in.`);
  });
 
  bot.on('spawn', () => {
    console.log(`${username} has spawned.`);
    setTimeout(() => {
      joinPitLobby(bot)
    }, 5000)
    
  });
 
  bot.on('message', async (jsonMsg) => {
    const message = jsonMsg.toString();
  
    if (message.includes('PIT! Latest update: ')) {
      fetchServerInfo(bot);
    }
  
    if (message.includes('You have joined ')) {
      setTimeout(() => {
        bot.chat("/p leave");
      }, 300)
      
    }
  });
 
  bot.on('error', err => {
    console.log(`[${bot.username}] Error: ${err}`);
  });
 
  bot.on('end', () => {
    console.log(`${username} disconnected.`);
    // Optionally, attempt to reconnect or handle disconnections
    const index = bots.indexOf(bot);
    if (index !== -1) bots.splice(index, 1);
  });

 
  // Store the active bot reference
  bots.push(bot)
 
  return bot;
}
 
function joinPitLobby(bot) {
  bot.chat('/play pit');
  // Optionally, add a delay or check for confirmation
}
 
async function manageDiscordChannels(serverName, bot) {
  const guild = discordClient.guilds.cache.get('Server ID'); // Replace with your Discord guild ID
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
      await fetchPlayerListsForAllBots(bots)
      console.log(`Sending player list for channel: ${channel.name} (${channel.id})`);
      await sendPlayerList(channel.id);
      await remindList(channel.id)
  }, 300000); // 5 minutes interval
 
  channelSendIntervals.set(channel.id, sendInterval);
}
 

 
async function fetchPlayerListsForAllBots(bots) {
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i];
    try {
      const playerList = await getPlayerList(bot);
      const channelId = botChannelMap.get(bot.username);
 
      if (channelId) {
        channelPlayerLists.set(channelId, playerList);
        console.log(`[${bot.username}] Updated player list: ${playerList.join(', ')}`);
      } else {
        console.warn(`[${bot.username}] No channel associated with this bot.`);
      }
    } catch (error) {
      console.error(`[${bot.username}] Error fetching player list: ${error}`);
    }
 
    // Stagger the next bot's execution
    await delay(2000); // Adjust delay time (e.g., 2 seconds)
  }
}
 
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
 
async function remindList(channelId) {
  try {
      const reminders = loadReminders(); // Assuming this loads a map of reminders
      const playerList = channelPlayerLists.get(channelId) || [];
      const channel = await discordClient.channels.fetch(channelId);
 
      // Loop through the usernames in reminders
      for (const username in reminders) {
        // Check if the username is in the player list
        if (playerList.includes(username)) {
          const discordUserIds = reminders[username]; // List of Discord user IDs who want to be notified
 
          // Send a message to each Discord user ID
          for (const discordUserId of discordUserIds) {
            const user = await discordClient.users.fetch(discordUserId);
            if (user) {
              // Notify the user
              user.send(`Hey, ${username} is online now in server: ${channel.name} 🎉
                Type: \`\`\`!join ${channel.name} USERNAME\`\`\``);
            }
          }
        }
      }
 
      console.log(`Reminder list processed for channel: ${channelId}`);
  } catch (error) {
      console.error('Error sending reminder list:', error);
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
      const playerLinks = playerList.map(player => `\`\`\`${player}\`\`\` https://pitpanda.rocks/players/${player}`);
 
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
 
      // Fetch all messages in the channel and delete them
      const fetched = await channel.messages.fetch({ limit: 100 });
      await channel.bulkDelete(fetched);
      console.log(`Purged messages in channel: ${channel.name}`);
  } catch (error) {
      console.error('Error purging channel:', error);
  }
}
 
async function getPlayerList(bot) {
  return new Promise((resolve) => {
    // Ensure bot.entities is available
    if (bot && bot.entities) {
      // Get all entities and filter for players
      const nearbyEntities = Object.values(bot.entities);
      const playerEntities = nearbyEntities.filter(entity => entity.type === 'player');
 
      // Extract usernames of nearby players
      const playerUsernames = playerEntities.map(entity => entity.username);
 
      resolve(playerUsernames);
    } else {
      console.warn(`[${bot.username}] No entities available for this bot.`);
      resolve([]); // Return an empty list if entities are unavailable
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
        setInterval(() => checkAndSwapLobbies(bot), 15000);
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
  }, 30000); // Adjust time as necessary
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
 
const fs = require('fs');
const path = './reminders.json'; // Make sure this is defined
 
// Load reminders from the file
function loadReminders() {
    if (!fs.existsSync(path)) {
        fs.writeFileSync(path, JSON.stringify({}));
    }
    return JSON.parse(fs.readFileSync(path));
}
 
// Save reminders to the file
function saveReminders(reminders) {
    fs.writeFileSync(path, JSON.stringify(reminders, null, 2));
}
 
// Add reminder command
async function addReminder(message, username) {
  const discordUserId = message.author.id;
  const reminders = loadReminders();
 
  // Check if the username already has reminders (Discord user IDs)
  if (!reminders[username]) {
      reminders[username] = []; // Create an empty array if no reminders for this username
  }
 
  // Add the Discord user ID to the list of users who want a reminder
  if (!reminders[username].includes(discordUserId)) {
      reminders[username].push(discordUserId);
      saveReminders(reminders);
      message.channel.send(`Reminder set for ${username}. I'll notify you when they're online!`);
  } else {
      message.channel.send(`You are already set to be notified when ${username} is online.`);
  }
}
 
async function removeReminder(message, username) {
  const discordUserId = message.author.id;
  const reminders = loadReminders();
 
  // Check if the username exists in the reminders
  if (!reminders[username]) {
      message.channel.send(`No reminders set for ${username}.`);
      return;
  }
 
  // Check if the user is in the list of users for the given username
  const userIndex = reminders[username].indexOf(discordUserId);
  if (userIndex === -1) {
      message.channel.send(`You are not set to be notified when ${username} is online.`);
      return;
  }
 
  // Remove the user from the list
  reminders[username].splice(userIndex, 1);
  saveReminders(reminders);
  message.channel.send(`Your reminder for ${username} has been removed.`);
}
 
 
discordClient.on('messageCreate', async (message) => {
  if (message.author.bot) return; // Ignore bot messages
 
  // Command to set a reminder (e.g., !remind <username>)
  if (message.content.startsWith('!remind ')) {
      const args = message.content.split(' ');
      const username = args[1]; // Get the Minecraft username from the command
 
      if (username) {
          await addReminder(message, username); // Call the function to add a reminder
      } else {
          message.channel.send('Please provide a valid Minecraft username.');
      }
  }
 
  if (message.content.startsWith('!remove ')) {
    const args = message.content.split(' ');
    const username = args[1]; // Get the Minecraft username from the command
 
    if (username) {
        await removeReminder(message, username); // Call the function to remove the reminder
    } else {
        message.channel.send('Please provide a valid Minecraft username to remove the reminder.');
    }
  }
 
  if (message.content.startsWith('!join ')) {
    const args = message.content.split(' ');
    const lobby = args[1]; // Get the lobby name from the command
    const playerToParty = args[2];

    if(!playerToParty) {
      message.channel.send('Please provide a user to party');
      return
    }
  
    if (lobby) {
      const botUsername = occupiedLobbies.get(lobby); // Get the bot's username associated with the lobby
      if (botUsername) {
        // Find the bot instance by username
        let botInstance = false;
        console.log(bots.length)
        for(let i = 0; i < bots.length; i++) {
          console.log([bots[i].username])
          console.log(botUsername[0])
          if(bots[i].username == botUsername[0]) {
            botInstance = bots[i]
          }
        }
        if (botInstance) {
          botInstance.chat(`/p ${args[2]}`); // Send the party invite command
          message.channel.send(`Sent party invite command from bot`);
          setTimeout(() => {
            botInstance.chat(`/p warp`);
          }, 5000)
          setTimeout(() => {
            botInstance.chat(`/p disband`);
          }, 9000)
        } else {
          message.channel.send(`Could not find a bot instance for username`);
        }
      } else {
        message.channel.send(`No bot is associated with the lobby: ${lobby}`);
      }
    } else {
      message.channel.send('Please provide a valid lobby name.');
    }
  }

  

  if (message.content.startsWith('!spawn ')) {
    if (message.member.roles.cache.has(allowedRole)) {
      const args = message.content.split(' ');
      const index = parseInt(args[1], 10); // Parse the bot index
      if (isNaN(index) || index < 0 || index >= botConfigs.length) {
        message.reply(`Invalid bot index. Please provide a number between 0 and ${botConfigs.length - 1}.`);
        return;
      }
  
      const { username } = botConfigs[index];
      for(let i = 0; i < bots.length; i++) {
        if (bots[i].username == username) {
          message.reply(`Bot ${username} is already active.`);
          return;
        }
      }
      
  
      createBot(botConfigs[index]);
      message.reply(`Bot ${username} has been spawned.`);
    } else {
      message.reply("You don't have permission to use this command.");
      return;
    }
  }

  if (message.content.startsWith('!disconnect ')) {
    if (message.member.roles.cache.has(allowedRole)) {
      const args = message.content.split(' ');
    const index = parseInt(args[1], 10); // Parse the bot index
    if (isNaN(index) || index < 0 || index >= botConfigs.length) {
      message.reply(`Invalid bot index. Please provide a number between 0 and ${botConfigs.length - 1}.`);
      return;
    }

    const { username } = botConfigs[index];
    for(let i = 0; i < bots.length; i++) {
      if(username === bots[i].username) {
        disconnectBot(bots[i].username);
        bots[i].quit(); // Disconnect the bot
        message.reply(`Bot ${username} has been disconnected.`);
        return;
      }
    }

      message.reply(`Bot ${username} is not currently active.`);
      return;

    
    } else {
      message.reply("You don't have permission to use this command.");
      return;
    }
    
  }
});

function disconnectBot(botUsername) {
  // Remove from occupiedLobbies
  for (const [channelId, playerList] of occupiedLobbies) {
    if (Array.isArray(playerList) && playerList.includes(botUsername)) {
      occupiedLobbies.delete(channelId); // Remove the entry related to this bot
      console.log(`Removed bot ${botUsername} from occupiedLobbies`);
      break; // Break after removing the entry
    } else {
      console.log(`No bot found in occupiedLobbies for channel ${channelId}`);
    }
  }

  // Remove from channelPlayerLists
  for (const channelMap of channelPlayerLists) {
    if (channelMap instanceof Map) {
      for (const [channelId, playerList] of channelMap) {
        if (Array.isArray(playerList) && playerList.includes(botUsername)) {
          channelMap.delete(channelId); // Remove the channel entry
          console.log(`Removed channel ${channelId} from channelPlayerLists`);
          break; // Break after removing the entry
        } else {
          console.log(`No bot found in channelPlayerLists for channel ${channelId}`);
        }
      }
    }
  }

  // Remove from botChannelMap
  for (const [bot, channelId] of botChannelMap) {
    if (bot === botUsername) {
      botChannelMap.delete(bot); // Remove the bot-channel association
      console.log(`Removed ${botUsername} from botChannelMap`);
      break; // Break after removing the entry
    }
  }
}

