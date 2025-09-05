const { Telegraf, Markup } = require('telegraf');
const { fetchAllDramaData } = require('./dramabox-api.obfuscated.js');
const logger = require('./logger');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new Telegraf(token);

const apiCache = new Map();
const userSessions = new Map();
const PAGE_SIZE = 10;

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
  userSessions.set(ctx.chat.id, { videosSent: 0 });
  ctx.reply("🎬 Selamat datang di DramaBox Streaming Bot! Hanya kirim URL saja...");
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

// Helper function to download a file and return a promise
function downloadFile(url, dest) {
    return new Promise(async (resolve, reject) => {
        try {
            const response = await axios({ url, method: 'GET', responseType: 'stream' });
            const writer = fs.createWriteStream(dest);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
        } catch (error) {
            reject(error);
        }
    });
}

bot.on('callback_query', async (ctx) => {
    const chatId = ctx.chat.id;
    const messageId = ctx.callbackQuery.message.message_id;
    const rawData = ctx.callbackQuery.data;
    logger.info(`Received callback query from ${ctx.from.username}: ${rawData}`);

    try {
        const [type, ...args] = rawData.split(':');
        const bid = args[args.length - 1];
        const chapterList = apiCache.get(bid);

        if (!chapterList) {
            logger.error(`Cache miss for bookId: ${bid}. User: ${ctx.from.username}`);
            return ctx.answerCbQuery('Session expired. Please send the DramaBox link again.', { show_alert: true });
        }

        if (type === 'p') {
            const [page] = args;
            const keyboard = createChapterKeyboard(chapterList, bid, parseInt(page, 10));
            await ctx.editMessageReplyMarkup(keyboard.reply_markup);
            return ctx.answerCbQuery();
        }

        const chapterId = args[0];
        const chapter = chapterList.find(c => c.chapterId === chapterId);
        if (!chapter) {
            logger.error(`Chapter not found: ${chapterId} for bookId: ${bid}`);
            return ctx.answerCbQuery('Chapter not found. Please try again.');
        }

        if (type === 'c') {
            const nakaCdn = chapter.cdnList.find(cdn => cdn.cdnDomain === "nakavideo.dramaboxdb.com");
            const cdnToUse = nakaCdn || chapter.cdnList[0];
            const qualityButtons = cdnToUse.videoPathList.map(video =>
                Markup.button.callback(`${video.quality}p`, `q:${chapterId}:${video.quality}:${bid}`)
            );
            await ctx.telegram.editMessageCaption(chatId, messageId, undefined, `Select quality for ${chapter.chapterName}`, {
                ...Markup.inlineKeyboard(qualityButtons, { columns: 3 })
            });
            logger.info(`Sent quality selection to ${ctx.from.username} for chapter: ${chapter.chapterName}`);
        
        } else if (type === 'q') {
            const quality = args[1];
            const nakaCdn = chapter.cdnList.find(cdn => cdn.cdnDomain === "nakavideo.dramaboxdb.com");
            const cdnToUse = nakaCdn || chapter.cdnList[0];
            const video = cdnToUse.videoPathList.find(v => v.quality == quality);

            if (video) {
                await ctx.deleteMessage(messageId).catch(err => logger.warn(err, 'Failed to delete previous message.'));
                const loadingMessage = await ctx.reply(`🔄 Mengambil ${chapter.chapterName}...`);
                
                const tempDir = './temp';
                if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                const tempFilePath = path.join(tempDir, `${chapterId}.mp4`);
                
                try {
                    await downloadFile(video.videoPath, tempFilePath);
                    logger.info(`Downloaded video to ${tempFilePath}`);

                    const currentChapterIndex = chapterList.findIndex(c => c.chapterId === chapterId);
                    const prevChapter = (currentChapterIndex > 0) ? chapterList[currentChapterIndex - 1] : null;
                    const nextChapter = (currentChapterIndex < chapterList.length - 1) ? chapterList[currentChapterIndex + 1] : null;

                    const navigationButtons = [];
                    if (prevChapter) navigationButtons.push(Markup.button.callback(`⬅️ Previous (${prevChapter.chapterName})`, `c:${prevChapter.chapterId}:${bid}`));
                    if (nextChapter) navigationButtons.push(Markup.button.callback(`Next ➡️ (${nextChapter.chapterName})`, `c:${nextChapter.chapterId}:${bid}`));

                    const replyMarkup = navigationButtons.length > 0 ? Markup.inlineKeyboard(navigationButtons) : undefined;

                    await ctx.replyWithVideo({ source: tempFilePath }, {
                        caption: `🎬 *${chapter.chapterName}*`,
                        parse_mode: 'Markdown',
                        ...replyMarkup
                    });
                    
                    await ctx.deleteMessage(loadingMessage.message_id);
                    fs.unlinkSync(tempFilePath);
                    logger.info(`Sent video and cleaned up temp file for ${chapter.chapterName}`);

                    let session = userSessions.get(chatId) || { videosSent: 0 };
                    session.videosSent++;
                    userSessions.set(chatId, session);

                    if (session.videosSent % 3 === 0) {
                        await ctx.reply(`📡 ✅ Episode ${chapter.chapterName} berhasil dikirim.\nInfo update follow channel telegram : t.me/onesecvip`);
                        logger.info(`Sent promotional message to ${ctx.from.username}`);
                    }
                } catch (downloadError) {
                    logger.error(downloadError, 'Failed to download or send video file.');
                    await ctx.deleteMessage(loadingMessage.message_id).catch(err => logger.warn(err, 'Failed to delete loading message.'));
                    ctx.reply('Sorry, there was an error downloading the video. Please try again.');
                }

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
