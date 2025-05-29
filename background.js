// background.js

import md5 from './md5.js';

const VOCAB_BOOK_KEY = 'myPersonalVocabularyBook';

async function getVocabularyBook() {
    // console.log("BG: getVocabularyBook called");
    try {
        const result = await chrome.storage.local.get(VOCAB_BOOK_KEY);
        // console.log("BG: getVocabularyBook - storage.local.get result:", result);
        return result[VOCAB_BOOK_KEY] || {};
    } catch (error) {
        console.error("BG: Error getting vocabulary book from storage:", error);
        return {};
    }
}

async function addWordToVocab(word, translation) {
    console.log(`%cBG: addWordToVocab called with word: "${word}", translation: "${translation}"`, "color: magenta;");
    if (!word || typeof word !== 'string' || !translation || typeof translation !== 'string') {
        console.warn("BG: Invalid word or translation for addWordToVocab.", { word, translation });
        return;
    }
    const cleanedWord = word.toLowerCase().trim();
    if (!cleanedWord) {
        console.warn("BG: Cleaned word is empty, not adding to vocab.");
        return;
    }

    try {
        const vocab = await getVocabularyBook();
        const oldTranslation = vocab[cleanedWord];
        vocab[cleanedWord] = translation;
        await chrome.storage.local.set({ [VOCAB_BOOK_KEY]: vocab });
        if (oldTranslation === translation) {
            console.log(`%cBG: Word "${cleanedWord}" already exists with the same translation. Vocab size: ${Object.keys(vocab).length}`, "color: magenta;");
        } else if (oldTranslation) {
            console.log(`%cBG: Word "${cleanedWord}" updated in vocabulary book. Old: "${oldTranslation}", New: "${translation}". Vocab size: ${Object.keys(vocab).length}`, "color: magenta; font-weight: bold;");
        } else {
            console.log(`%cBG: Word "${cleanedWord}" added to vocabulary book with translation "${translation}". Vocab size: ${Object.keys(vocab).length}`, "color: magenta; font-weight: bold;");
        }
        await notifyAllTabsVocabChanged(vocab, "add", cleanedWord);
    } catch (error) {
        console.error("BG: Error adding word to vocabulary book:", error);
    }
}

async function removeWordFromVocab(word) {
    console.log(`%cBG: removeWordFromVocab called with word: "${word}"`, "color: magenta;");
    if (!word || typeof word !== 'string') {
        console.warn("BG: Invalid word for removeWordFromVocab.", { word });
        return false;
    }
    const cleanedWord = word.toLowerCase().trim();
    if (!cleanedWord) return false;

    try {
        const vocab = await getVocabularyBook();
        if (vocab.hasOwnProperty(cleanedWord)) {
            delete vocab[cleanedWord];
            await chrome.storage.local.set({ [VOCAB_BOOK_KEY]: vocab });
            console.log(`%cBG: Word "${cleanedWord}" removed from vocabulary book. Vocab size: ${Object.keys(vocab).length}`, "color: magenta; font-weight: bold;");
            await notifyAllTabsVocabChanged(vocab, "remove", cleanedWord);
            return true;
        } else {
            console.log(`%cBG: Word "${cleanedWord}" not found in vocabulary book for removal.`, "color: magenta;");
            return false;
        }
    } catch (error) {
        console.error("BG: Error removing word from vocabulary book:", error);
        return false;
    }
}

async function notifyAllTabsVocabChanged(newVocab, operation = "unknown", changedWord = "N/A") {
    console.log(`%cBG: notifyAllTabsVocabChanged - Operation: ${operation}, Word: ${changedWord}, Vocab size: ${Object.keys(newVocab).length}`, "color: orange; font-weight: bold;");
    try {
        const tabs = await chrome.tabs.query({
            status: "complete",
            url: ["http://*/*", "https://*/*"]
        });
        console.log(`%cBG: Found ${tabs.length} tabs to potentially notify.`, "color: orange;");
        if (tabs.length === 0) {
            console.warn("BG: No suitable tabs found to notify for vocab update.");
            return;
        }
        for (const tab of tabs) {
            if (tab.id && tab.url) {
                console.log(`%cBG: Sending 'vocabUpdated' to Tab ID: ${tab.id}, URL: ${tab.url.substring(0, 70)}...`, "color: orange;");
                chrome.tabs.sendMessage(tab.id, {
                    action: "vocabUpdated",
                    newVocab: newVocab
                })
                .then(response => {
                    if (response) {
                        console.log(`%cBG: Response from Tab ID ${tab.id} for vocabUpdated:`, "color: green;", response);
                    } else if (chrome.runtime.lastError) {
                        // console.warn(`BG: No response/Error from Tab ID ${tab.id} (might be fine): ${chrome.runtime.lastError.message}`);
                    }
                })
                .catch(e => { /* console.warn(`BG: sendMessage to Tab ${tab.id} FAILED (catch block): ${e.message}`); */ });
            }
        }
    } catch (error) {
        console.error("BG: Error in notifyAllTabsVocabChanged:", error);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const senderOrigin = sender.tab ? `Tab ID ${sender.tab.id} (${sender.tab.url ? sender.tab.url.substring(0,50) : 'No URL'})` : (sender.id === chrome.runtime.id ? "Extension Popup/Options" : `Other Extension ${sender.id}`);
    console.log("%cBG: Message received", "color:DodgerBlue; font-weight:bold;", request, `%cFrom: ${senderOrigin}`, "color:DodgerBlue;");


    if (request.action === "translate") {
        console.log("BG: 'translate' action requested for text:", request.text);
        chrome.storage.sync.get(['baiduAppId', 'baiduSecretKey'], async (items) => {
            const { baiduAppId: appId, baiduSecretKey: secretKey } = items;
            if (!appId || !secretKey) {
                console.error("BG: translate - API keys missing.");
                sendResponse({ error: "API_KEYS_MISSING", message: "百度翻译API密钥未在插件选项中设置。" });
                return true;
            }
            const query = request.text; const salt = Date.now().toString();
            const from = 'en'; const to = 'zh';
            const str1 = `${appId}${query}${salt}${secretKey}`; const sign = md5(str1);
            const apiUrl = `https://api.fanyi.baidu.com/api/trans/vip/translate?q=${encodeURIComponent(query)}&from=${from}&to=${to}&appid=${appId}&salt=${salt}&sign=${sign}`;
            console.log("BG: translate - Constructed API URL (secretKey hidden):", apiUrl.replace(secretKey, "****"));

            try {
                const apiResponse = await fetch(apiUrl);
                console.log("BG: translate - API fetch response status:", apiResponse.status);
                if (!apiResponse.ok) {
                    const errorBody = await apiResponse.text();
                    console.error("BG: translate - API HTTP error!", apiResponse.status, errorBody);
                    throw new Error(`API HTTP error! status: ${apiResponse.status}, body: ${errorBody}`);
                }
                const data = await apiResponse.json();
                console.log("BG: translate - API response data:", data);

                if (data.error_code) {
                    console.error("BG: translate - API returned error_code:", data.error_code, data.error_msg);
                    sendResponse({ error: "API_ERROR", message: `翻译API错误: ${data.error_msg} (代码: ${data.error_code})` });
                } else if (data.trans_result && data.trans_result.length > 0) {
                    const translation = data.trans_result[0].dst;
                    console.log("BG: translate - Translation successful:", translation);
                    sendResponse({ translation: translation });

                    const trimmedQuery = query.trim();
                    const isSingleWord = !trimmedQuery.includes(' ') && trimmedQuery.length > 0 && trimmedQuery.length < 30 && /^[a-zA-Z]+$/.test(trimmedQuery);
                    if (isSingleWord) {
                        console.log("BG: translate - Query is single word, adding to vocab:", trimmedQuery);
                        await addWordToVocab(trimmedQuery, translation);
                    } else {
                        console.log("BG: translate - Query is not a single word, not adding to vocab:", trimmedQuery);
                    }
                } else {
                    console.warn("BG: translate - No translation result from API, but no error_code.", data);
                    sendResponse({ error: "NO_TRANSLATION", message: "未获取到翻译结果。" });
                }
            } catch (error) {
                console.error("BG: translate - Fetch/JSON parse error:", error);
                sendResponse({ error: "FETCH_ERROR", message: `请求翻译API失败: ${error.message}` });
            }
        });
        return true;
    } else if (request.action === "getVocab") {
        console.log("BG: 'getVocab' action requested.");
        getVocabularyBook()
            .then(vocab => {
                console.log("BG: 'getVocab' - Sending vocab, size:", Object.keys(vocab).length);
                sendResponse({ vocab: vocab });
            })
            .catch(e => {
                console.error("BG: 'getVocab' - Error:", e);
                sendResponse({ error: "Failed to get vocab from storage." }); // More specific error
            });
        return true;
    } else if (request.action === "removeWord") {
        if (request.word) {
            console.log("BG: 'removeWord' action requested for word:", request.word);
            removeWordFromVocab(request.word)
                .then(success => {
                    console.log("BG: 'removeWord' - Success:", success);
                    sendResponse({ success: success, message: success ? `单词 "${request.word}" 已从生词本移除。` : `未能移除单词 "${request.word}" 或单词未找到。` });
                })
                .catch(e => {
                    console.error("BG: 'removeWord' - Error:", e);
                    sendResponse({ success: false, error: "移除单词时发生内部错误。", details: e.message });
                });
            return true;
        } else {
            console.warn("BG: 'removeWord' - No word provided.");
            sendResponse({ success: false, error: "未提供要移除的单词。" });
        }
    } else if (request.action === "importVocab") { // ***** 新增的 Action 处理 *****
        console.log("%cBG: 'importVocab' action received.", "color: #28a745; font-weight: bold;"); // Bootstrap success color
        if (request.vocabData && typeof request.vocabData === 'object' && !Array.isArray(request.vocabData) && request.vocabData !== null) {
            // Basic validation passed. Could add more checks here (e.g., if values are strings).
            const newVocabSize = Object.keys(request.vocabData).length;
            console.log(`%cBG: 'importVocab' - Received vocabData with ${newVocabSize} entries. Attempting to store.`, "color: #28a745;");

            chrome.storage.local.set({ [VOCAB_BOOK_KEY]: request.vocabData }, async () => {
                if (chrome.runtime.lastError) {
                    console.error("BG: 'importVocab' - Error setting new vocab to storage:", chrome.runtime.lastError);
                    sendResponse({ success: false, error: `存储导入的单词本失败: ${chrome.runtime.lastError.message}` });
                } else {
                    console.log("%cBG: 'importVocab' - Vocabulary successfully imported and stored. Notifying tabs.", "color: #28a745; font-weight: bold;");
                    sendResponse({ success: true, message: `单词本已成功导入 (${newVocabSize}个单词)。` });
                    // Import successful, notify all content scripts to update their highlights
                    await notifyAllTabsVocabChanged(request.vocabData, "import_full", "full_list");
                }
            });
        } else {
            console.warn("BG: 'importVocab' - Invalid or missing vocabData. Data received:", request.vocabData);
            sendResponse({ success: false, error: "提供的单词本数据无效或格式不正确。" });
        }
        return true; // Because chrome.storage.local.set is asynchronous
    }

    // console.log("BG: Unhandled action or synchronous message:", request.action);
    return false;
});

chrome.runtime.onInstalled.addListener((details) => {
    console.log("BG: Extension event:", details.reason, details.previousVersion || "");
    if (details.reason === "install") {
        // You could initialize an empty vocab book here if desired
        // chrome.storage.local.set({ [VOCAB_BOOK_KEY]: {} });
        // console.log("BG: Initial empty vocabulary book set up on install.");
    }
});

console.log("Background.js: Script loaded and event listeners are set up.");