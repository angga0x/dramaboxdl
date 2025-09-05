const axios = require('axios');
const logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

let apiToken = null;

async function fetchNewToken() {
  const url = 'https://sapi.dramaboxdb.com/drama-box/ap001/bootstrap?timestamp=' + Date.now();
  const payload = { "distinctId": "cc85be1f8166bd67" };
  const headers = {
    'Host': 'sapi.dramaboxdb.com',
    'Version': '430',
    'Cid': 'DAUAG1050213',
    'Package-Name': 'com.storymatrix.drama',
    'Apn': '2',
    'Device-Id': uuidv4(),
    'Android-Id': 'ffffffff8315e7318315e73100000007',
    'Language': 'en',
    'Current-Language': 'en',
    'P': '43',
    'Content-Type': 'application/json; charset=UTF-8',
    'User-Agent': 'okhttp/4.10.0'
  };
  try {
    logger.info('Fetching new API token...');
    const response = await axios.post(url, payload, { headers });
    if (response.data && response.data.data && response.data.data.user && response.data.data.user.token) {
        apiToken = response.data.data.user.token;
        logger.info('Successfully fetched and cached new API token.');
        return apiToken;
    }
    logger.error({ message: 'Token not found in bootstrap response', response: response.data });
    throw new Error('Token not found in bootstrap response');
  } catch (error) {
    logger.error(error, 'Failed to get token');
    throw error;
  }
}

async function fetchDramaBoxPage(bookId, index = 1, retries = 15) {
  if (!apiToken) {
      await fetchNewToken();
  }

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
    'Tn': `Bearer ${apiToken}`,
    'Version': '430',
    'Vn': '4.3.0',
    'Userid': '279342452',
    'Cid': 'DRA1000042',
    'Package-Name': 'com.storymatrix.drama',
    'Apn': '2',
    'Device-Id': uuidv4(),
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
    if (response.data && response.data.status === 2 && response.data.message === "接口鉴权不合法") {
        logger.warn(`Authentication error detected (status 2). Retries left: ${retries - 1}`);
        if (retries > 0) {
            apiToken = null;
            return fetchDramaBoxPage(bookId, index, retries - 1);
        } else {
            throw new Error('Failed to authenticate with API after multiple retries.');
        }
    }
    return response.data;
  } catch (error) {
    logger.error(error, `Failed to fetch page for bookId: ${bookId}, index: ${index}`);
    if (error.response && (error.response.status === 401 || error.response.status === 403) && retries > 0) {
        logger.warn(`Auth error (401/403). Retries left: ${retries - 1}`);
        apiToken = null;
        return fetchDramaBoxPage(bookId, index, retries - 1);
    }
    throw error;
  }
}

async function fetchAllDramaData(bookId) {
    logger.info(`Starting full data fetch for bookId: ${bookId}`);
    const initialResponse = await fetchDramaBoxPage(bookId, 1);

    if (!initialResponse || !initialResponse.data || !initialResponse.data.chapterList) {
        logger.error({ message: 'Invalid initial API response structure', response: initialResponse });
        throw new Error('Failed to fetch initial data.');
    }

    const { chapterCount } = initialResponse.data;
    const allChaptersMap = new Map();
    initialResponse.data.chapterList.forEach(c => allChaptersMap.set(c.chapterId, c));
    
    let lastHighestIndex = Math.max(...Array.from(allChaptersMap.values()).map(c => c.chapterIndex));

    while (allChaptersMap.size < chapterCount) {
        const nextIndexToTry = lastHighestIndex + 1;
        
        if (nextIndexToTry > chapterCount + 20) {
            logger.warn(`Breaking fetch loop to prevent infinite recursion.`);
            break;
        }

        logger.info(`Fetching chapter page with index: ${nextIndexToTry} for bookId: ${bookId}`);
        const pageResponse = await fetchDramaBoxPage(bookId, nextIndexToTry);

        if (pageResponse && pageResponse.data && pageResponse.data.chapterList && pageResponse.data.chapterList.length > 0) {
            pageResponse.data.chapterList.forEach(c => allChaptersMap.set(c.chapterId, c));
            const newHighestIndex = Math.max(...Array.from(allChaptersMap.values()).map(c => c.chapterIndex));
            
            if (newHighestIndex === lastHighestIndex) {
                logger.warn(`No progress in fetching chapters. Breaking loop.`);
                break;
            }
            lastHighestIndex = newHighestIndex;
        } else {
            logger.warn(`Fetch at index ${nextIndexToTry} returned no chapter list. Breaking loop.`);
            break;
        }
    }
    
    const allChapters = Array.from(allChaptersMap.values());
    allChapters.sort((a, b) => a.chapterIndex - b.chapterIndex);
    logger.info(`Completed full data fetch for bookId: ${bookId}. Found ${allChapters.length}/${chapterCount} chapters.`);

    return {
        ...initialResponse.data,
        chapterList: allChapters,
    };
}

module.exports = {
  fetchAllDramaData,
};
