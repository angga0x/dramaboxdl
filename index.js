require('dotenv').config();
const bot = require('./bot');
const logger = require('./logger');

logger.info('Starting bot...');
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  logger.info('Bot stopped due to SIGINT');
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  logger.info('Bot stopped due to SIGTERM');
});
