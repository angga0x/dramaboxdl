const { Telegraf, Markup } = require('telegraf');
const { fetchAllDramaData } = require('./dramabox-api');
const logger = require('./logger');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(token);

const apiCache = new Map();
const PAGE_SIZE = 10; // 5 rows of 2 buttons

// Helper function to create the paginated keyboard
function createChapterKeyboard(chapterList, bid, page = 0) {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageChapters = chapterList.slice(start, end);

    const buttons = pageChapters.map(chapter =>
        Markup.button.callback(chapter.chapterName, `c:${chapter.chapterId}:${bid}`)
    );

    const navigationButtons = [];
    if (start > 0) {
        navigationButtons.push(Markup.button.callback('⬅️ Previous', `p:${page - 1}:${bid}`));
    }
    if (end < chapterList.length) {
        navigationButtons.push(Markup.button.callback('Next ➡️', `p:${page + 1}:${bid}`));
    }

    // Create a 2-column layout for chapters
    const chapterRows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        chapterRows.push(buttons.slice(i, i + 2));
    }

    return Markup.inlineKeyboard([
        ...chapterRows,
        navigationButtons
    ]);
}


bot.start((ctx) => {
  logger.info(`Received /start command from ${ctx.from.username}`);
  ctx.reply("🎬 Selamat datang di DramaBox Streaming Bot! Kirim link DramaBox nya...");
});

bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  if (text.includes('https://app.dramaocean.com/db_land_page/')) {
    logger.info(`Received a DramaBox link from ${ctx.from.username}: ${text}`);
    try {
      const url = new URL(text);
      const bid = url.searchParams.get('bid');

      if (bid) {
        const loadingMsg = await ctx.reply('🔍 Fetching all episodes, please wait...');
        const fullData = await fetchAllDramaData(bid);
        
        if (!fullData) {
            logger.error({ message: 'Invalid API response on initial fetch.' });
            await ctx.deleteMessage(loadingMsg.message_id);
            return ctx.reply('Failed to process API response. Please try again.');
        }

        const { bookName, bookCover, introduction, playCount, chapterList, chapterCount } = fullData;

        apiCache.set(bid, chapterList);
        logger.info(`Cached ${chapterList.length} chapters for bookId: ${bid}`);
        
        await ctx.deleteMessage(loadingMsg.message_id);

        const caption = `🎬 ${bookName}\n📺 Total Episode: ${chapterCount}\n👁️ Total Tayangan: ${playCount} penayangan\n\n${introduction}`;
        const keyboard = createChapterKeyboard(chapterList, bid, 0);

        await ctx.replyWithPhoto(bookCover, {
          caption: caption,
          parse_mode: 'Markdown',
          ...keyboard
        });
        logger.info(`Sent paginated video details to ${ctx.from.username} for bookId: ${bid}`);
      } else {
        logger.warn(`Invalid DramaBox URL from ${ctx.from.username}: ${text}`);
        ctx.reply('Invalid DramaBox URL. Please provide a valid URL.');
      }
    } catch (error) {
      logger.error(error, `Error processing link from ${ctx.from.username}`);
      ctx.reply('An error occurred while processing your request.');
    }
  }
});

bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const messageId = ctx.callbackQuery.message.message_id;
    const rawData = ctx.callbackQuery.data;
    logger.info(`Received callback query from ${ctx.from.username}: ${rawData}`);

    try {
        const [type, ...args] = rawData.split(':');
        
        let bid, chapterId, quality, page;

        const chapterList = apiCache.get(args[args.length - 1]); // BID is always last
        if (!chapterList) {
            logger.error(`Cache miss for bookId: ${args[args.length - 1]}. User: ${ctx.from.username}`);
            return ctx.answerCbQuery('Session expired. Please send the DramaBox link again.', { show_alert: true });
        }

        if (type === 'p') { // Pagination
            [page, bid] = args;
            const keyboard = createChapterKeyboard(chapterList, bid, parseInt(page, 10));
            await ctx.editMessageReplyMarkup(keyboard.reply_markup);
            return ctx.answerCbQuery();
        }

        const chapter = chapterList.find(c => c.chapterId === args[0]);
        if (!chapter) {
            logger.error(`Chapter not found: ${args[0]} for bookId: ${args[args.length - 1]}`);
            return ctx.answerCbQuery('Chapter not found. Please try again.');
        }

        if (type === 'c') { // Chapter selection
            [chapterId, bid] = args;
            const nakaCdn = chapter.cdnList.find(cdn => cdn.cdnDomain === "nakavideo.dramaboxdb.com");
            const cdnToUse = nakaCdn || chapter.cdnList[0];

            const qualityButtons = cdnToUse.videoPathList.map(video =>
                Markup.button.callback(`${video.quality}p`, `q:${chapter.chapterId}:${video.quality}:${bid}`)
            );

            await ctx.telegram.editMessageCaption(chatId, messageId, undefined, `Select quality for ${chapter.chapterName}`, {
                ...Markup.inlineKeyboard(qualityButtons, { columns: 3 })
            });
            logger.info(`Sent quality selection to ${ctx.from.username} for chapter: ${chapter.chapterName}`);
        
        } else if (type === 'q') { // Quality selection
            [chapterId, quality, bid] = args;
            const nakaCdn = chapter.cdnList.find(cdn => cdn.cdnDomain === "nakavideo.dramaboxdb.com");
            const cdnToUse = nakaCdn || chapter.cdnList[0];

            const video = cdnToUse.videoPathList.find(v => v.quality == quality);
            if (video) {
                await ctx.deleteMessage(messageId).catch(err => logger.warn(err, 'Failed to delete previous message. It might have been deleted already.'));
                const loadingMessage = await ctx.reply(`🔄 Mengambil ${chapter.chapterName}...`);
                
                // Find the next chapter to create the "Next Episode" button
                const currentChapterIndex = chapterList.findIndex(c => c.chapterId === chapterId);
                const nextChapter = (currentChapterIndex !== -1 && currentChapterIndex < chapterList.length - 1)
                    ? chapterList[currentChapterIndex + 1]
                    : null;

                const replyMarkup = nextChapter
                    ? Markup.inlineKeyboard([
                        Markup.button.callback(`Next Episode ➡️ (${nextChapter.chapterName})`, `c:${nextChapter.chapterId}:${bid}`)
                      ])
                    : undefined;

                await ctx.replyWithVideo(video.videoPath, {
                    caption: `🎬 *${chapter.chapterName}*`,
                    parse_mode: 'Markdown',
                    ...replyMarkup
                });
                logger.info(`Sent video to ${ctx.from.username} for chapter: ${chapter.chapterName}, quality: ${video.quality}p`);

                await ctx.deleteMessage(loadingMessage.message_id);
            } else {
                logger.error(`Video quality not found: ${quality} for chapter: ${chapter.chapterName}`);
                await ctx.answerCbQuery('Video quality not found.');
            }
        }
    } catch (error) {
        logger.error(error, `Error processing callback query from ${ctx.from.username}`);
        ctx.reply('An error occurred while processing your request.');
    }
});

module.exports = bot;
