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
            await ctx.deleteMessage(loadingMsg.message_id);
            return ctx.reply('Failed to process API response. Please try again.');
        }

        const { bookName, bookCover, introduction, playCount, chapterList, chapterCount } = fullData;
        apiCache.set(bid, chapterList);
        
        await ctx.deleteMessage(loadingMsg.message_id);

        const caption = `🎬 ${bookName}\n📺 Total Episode: ${chapterCount}\n👁️ Total Tayangan: ${playCount} penayangan\n\n${introduction}`;
        const keyboard = createChapterKeyboard(chapterList, bid, 0);

        await ctx.replyWithPhoto(bookCover, {
          caption: caption,
          parse_mode: 'Markdown',
          ...keyboard
        });
      } else {
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
        const bid = args[args.length - 1];
        const chapterList = apiCache.get(bid);

        if (!chapterList) {
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
            return ctx.answerCbQuery('Chapter not found. Please try again.');
        }

        if (type === 'c') {
            const qualityButtons = chapter.cdnList[0].videoPathList.map(video =>
                Markup.button.callback(`${video.quality}p`, `q:${chapterId}:${video.quality}:${bid}`)
            );
            await ctx.telegram.editMessageCaption(chatId, messageId, undefined, `Select quality for ${chapter.chapterName}`, {
                ...Markup.inlineKeyboard(qualityButtons, { columns: 3 })
            });
        
        } else if (type === 'q') {
            const quality = args[1];
            await ctx.deleteMessage(messageId).catch(err => logger.warn(err, 'Failed to delete previous message.'));
            const loadingMessage = await ctx.reply(`🔄 Mengambil ${chapter.chapterName}...`);

            let videoSent = false;
            const sortedCdnList = [...chapter.cdnList].sort((a, b) => a.cdnDomain === 'nakavideo.dramaboxdb.com' ? -1 : 1);

            for (const cdn of sortedCdnList) {
                const video = cdn.videoPathList.find(v => v.quality == quality);
                if (video) {
                    try {
                        logger.info(`Attempting to send video from CDN: ${cdn.cdnDomain}`);
                        const currentChapterIndex = chapterList.findIndex(c => c.chapterId === chapterId);
                        const prevChapter = (currentChapterIndex > 0) ? chapterList[currentChapterIndex - 1] : null;
                        const nextChapter = (currentChapterIndex < chapterList.length - 1) ? chapterList[currentChapterIndex + 1] : null;

                        const navigationButtons = [];
                        if (prevChapter) navigationButtons.push(Markup.button.callback(`⬅️ Previous (${prevChapter.chapterName})`, `c:${prevChapter.chapterId}:${bid}`));
                        if (nextChapter) navigationButtons.push(Markup.button.callback(`Next ➡️ (${nextChapter.chapterName})`, `c:${nextChapter.chapterId}:${bid}`));
                        const replyMarkup = navigationButtons.length > 0 ? Markup.inlineKeyboard(navigationButtons) : undefined;

                        await ctx.replyWithVideo(video.videoPath, { caption: `🎬 *${chapter.chapterName}*`, parse_mode: 'Markdown', ...replyMarkup });
                        videoSent = true;
                        logger.info(`Successfully sent video from ${cdn.cdnDomain}`);
                        break;
                    } catch (error) {
                        if (error.description === 'Bad Request: wrong type of the web page content') {
                            logger.warn(`CDN failed: ${cdn.cdnDomain}. Trying next CDN or fallback.`);
                        } else {
                            throw error;
                        }
                    }
                }
            }

            // Fallback to download-and-upload if all CDNs fail
            if (!videoSent) {
                logger.warn('All CDNs failed. Attempting download-and-upload fallback.');
                const video = chapter.cdnList[0].videoPathList.find(v => v.quality == quality);
                if (video) {
                    const tempDir = './temp';
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
                    const tempFilePath = path.join(tempDir, `${chapterId}.mp4`);
                    try {
                        await downloadFile(video.videoPath, tempFilePath);
                        logger.info(`Downloaded video to ${tempFilePath} as fallback.`);
                        
                        const currentChapterIndex = chapterList.findIndex(c => c.chapterId === chapterId);
                        const prevChapter = (currentChapterIndex > 0) ? chapterList[currentChapterIndex - 1] : null;
                        const nextChapter = (currentChapterIndex < chapterList.length - 1) ? chapterList[currentChapterIndex + 1] : null;
                        const navigationButtons = [];
                        if (prevChapter) navigationButtons.push(Markup.button.callback(`⬅️ Previous (${prevChapter.chapterName})`, `c:${prevChapter.chapterId}:${bid}`));
                        if (nextChapter) navigationButtons.push(Markup.button.callback(`Next ➡️ (${nextChapter.chapterName})`, `c:${nextChapter.chapterId}:${bid}`));
                        const replyMarkup = navigationButtons.length > 0 ? Markup.inlineKeyboard(navigationButtons) : undefined;

                        await ctx.replyWithVideo({ source: tempFilePath }, { caption: `🎬 *${chapter.chapterName}*`, parse_mode: 'Markdown', ...replyMarkup });
                        videoSent = true;
                        fs.unlinkSync(tempFilePath);
                        logger.info('Successfully sent video via download-and-upload fallback.');
                    } catch (downloadError) {
                        logger.error(downloadError, 'Download-and-upload fallback failed.');
                    }
                }
            }

            await ctx.deleteMessage(loadingMessage.message_id);

            if (videoSent) {
                let session = userSessions.get(chatId) || { videosSent: 0 };
                session.videosSent++;
                userSessions.set(chatId, session);
                if (session.videosSent % 3 === 0) {
                    await ctx.reply(`📡 ✅ Episode ${chapter.chapterName} berhasil dikirim.\nInfo update follow channel telegram : t.me/onesecvip`);
                }
            } else {
                logger.error(`All delivery methods failed for chapter: ${chapter.chapterName}`);
                ctx.reply('Sorry, we could not send this video at the moment. Please try another quality or episode.');
            }
        }
    } catch (error) {
        logger.error(error, `Error processing callback query from ${ctx.from.username}`);
        ctx.reply('An error occurred while processing your request.');
    }
});

module.exports = bot;
