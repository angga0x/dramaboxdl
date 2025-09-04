const axios = require('axios');
const logger = require('./logger');

// This function makes a single API call for a given index.
async function fetchDramaBoxPage(bookId, index = 1) {
  const url = `https://sapi.dramaboxdb.com/drama-box/chapterv2/batch/load?timestamp=${Date.now()}`;
  const payload = {
    "boundaryIndex": 0,
    "comingPlaySectionId": -1,
    "index": index,
    "currencyPlaySource": "ssym_lxjg",
    "needEndRecommend": 0,
    "currencyPlaySourceName": "搜索页面联想结果",
    "preLoad": false,
    "rid": "",
    "pullCid": "",
    "loadDirection": 0,
    "startUpKey": "5559bad4-848e-48fc-b310-07c4d6c10b1d",
    "bookId": bookId
  };
  const headers = {
    'Host': 'sapi.dramaboxdb.com',
    'Tn': 'Bearer ZXlKMGVYQWlPaUpLVjFRaUxDSmhiR2NpT2lKSVV6STFOaUo5LmV5SnlaV2RwYzNSbGNsUjVjR1VpT2lKVVJVMVFJaXdpZFhObGNrbGtJam95Tnprek5ESTBOVEo5LlZXbGZXS0YxekxjdVZUa20xR0kyaUhFbmo5LVk3S3hDQTVGbXRfSXJSQ1U=',
    'Version': '430',
    'Vn': '4.3.0',
    'Userid': '279342452',
    'Cid': 'DRA1000042',
    'Package-Name': 'com.storymatrix.drama',
    'Apn': '2',
    'Device-Id': '3034a68e-60e1-4b02-bb3e-811eaa8d0617',
    'Android-Id': 'ffffffff8315e7318315e73100000000',
    'Language': 'en',
    'Current-Language': 'en',
    'P': '43',
    'Ins': '',
    'Store-Source': 'store_google',
    'Nchid': 'DRA1000042',
    'Locale': 'en_US',
    'Instanceid': 'f2fc69d16c816c6b23f9b4621fa62ded',
    'Country-Code': 'ID',
    'Sn': 'bMAGl2/fOPZW7coPOs310+JSNzYY4km6oLLwkmD10C3ERLdq8E1AJtSs8+NUcOeEe8tAvPVXU4Pgnnkvw1ncWOxNDHS5tSrsWqWvcGaHDZ3ml4Fh/FVgCgpHShTBXwOI/NGp0rDLNMyhqftX/tWhdYWlvwK0L26/UHPDgWnr3pJRtf9xfdKKQRU44Ahd1B6By45Aw45y6wF5qhFz2MR2hqlX4tmIEDyp1sk61zroPHIa1tZdYwtthu6CEp50s+iRjjj7aTkKKJNEhE7lm5KDsz49Ks5/fiRR23ANqdwhOBeWAXtWJR0/ctfdaq15udh4n54sAV83S7vscAD/T4Dzwg==',
    'Active-Time': '229973',
    'Content-Type': 'application/json; charset=UTF-8',
    'Accept-Encoding': 'gzip, deflate, br',
    'User-Agent': 'okhttp/4.10.0'
  };

  try {
    const response = await axios.post(url, payload, { headers });
    return response.data;
  } catch (error) {
    logger.error(error, `Failed to fetch page for bookId: ${bookId}, index: ${index}`);
    throw error;
  }
}

// This function fetches the initial data and then loops to get all chapters.
async function fetchAllDramaData(bookId) {
    logger.info(`Starting full data fetch for bookId: ${bookId}`);
    const initialResponse = await fetchDramaBoxPage(bookId, 1);

    if (!initialResponse || !initialResponse.data || !initialResponse.data.chapterList) {
        logger.error({ message: 'Invalid initial API response structure', response: initialResponse });
        throw new Error('Failed to fetch initial data.');
    }

    const { chapterCount } = initialResponse.data;
    let allChapters = [...initialResponse.data.chapterList];
    const fetchedIndices = new Set(allChapters.map(c => c.chapterIndex));
    
    let lastFoundIndex = Math.max(...Array.from(fetchedIndices));
    let consecutiveEmptyFetches = 0;

    while (allChapters.length < chapterCount && consecutiveEmptyFetches < 5) {
        // The API seems to return about 6 chapters, so we jump ahead from the last known index.
        const nextIndexToTry = lastFoundIndex + 1;
        logger.info(`Fetching chapter page with index: ${nextIndexToTry} for bookId: ${bookId}`);
        
        const pageResponse = await fetchDramaBoxPage(bookId, nextIndexToTry);

        if (pageResponse && pageResponse.data && pageResponse.data.chapterList && pageResponse.data.chapterList.length > 0) {
            const newChapters = pageResponse.data.chapterList.filter(
                (chapter) => !fetchedIndices.has(chapter.chapterIndex)
            );

            if (newChapters.length > 0) {
                allChapters.push(...newChapters);
                newChapters.forEach(c => fetchedIndices.add(c.chapterIndex));
                lastFoundIndex = Math.max(...Array.from(fetchedIndices));
                consecutiveEmptyFetches = 0; // Reset counter on success
            } else {
                // This page had no new chapters, but we should still continue from the last known index.
                logger.warn(`No new chapters found at index ${nextIndexToTry}, but continuing search.`);
                lastFoundIndex++; // Increment to avoid getting stuck
                consecutiveEmptyFetches++;
            }
        } else {
            // The response was empty or invalid.
            logger.warn(`Stopping fetch loop. No data returned at index ${nextIndexToTry}.`);
            consecutiveEmptyFetches++;
            lastFoundIndex++; // Increment to avoid getting stuck
        }
    }
    
    if (consecutiveEmptyFetches >= 5) {
        logger.warn(`Exiting fetch loop after 5 consecutive empty fetches. Found ${allChapters.length}/${chapterCount} chapters.`);
    }

    // Sort chapters by index to ensure correct order
    allChapters.sort((a, b) => a.chapterIndex - b.chapterIndex);
    logger.info(`Completed full data fetch for bookId: ${bookId}. Found ${allChapters.length} chapters.`);

    // Return the initial response's metadata but with the complete chapter list.
    return {
        ...initialResponse.data,
        chapterList: allChapters,
    };
}


module.exports = {
  fetchAllDramaData,
};
