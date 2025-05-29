// options.js

// --- API Key Settings ---
const appIdInput = document.getElementById('appId');
const secretKeyInput = document.getElementById('secretKey');
const saveApiKeysButton = document.getElementById('saveApiKeys'); // Updated ID
const apiKeyStatusDiv = document.getElementById('apiKeyStatus');  // Updated ID

function loadApiKeys() {
    chrome.storage.sync.get(['baiduAppId', 'baiduSecretKey'], (items) => {
        if (items.baiduAppId) appIdInput.value = items.baiduAppId;
        if (items.baiduSecretKey) secretKeyInput.value = items.baiduSecretKey;
    });
}

function saveApiKeys() {
    const appId = appIdInput.value.trim();
    const secretKey = secretKeyInput.value.trim();
    if (!appId || !secretKey) {
        showStatusMessage(apiKeyStatusDiv, 'APP ID 和密钥不能为空！', true);
        return;
    }
    chrome.storage.sync.set({
        baiduAppId: appId,
        baiduSecretKey: secretKey
    }, () => {
        if (chrome.runtime.lastError) {
            showStatusMessage(apiKeyStatusDiv, `保存失败: ${chrome.runtime.lastError.message}`, true);
        } else {
            showStatusMessage(apiKeyStatusDiv, 'API设置已保存！', false);
        }
    });
}

// --- Vocabulary Book Import/Export ---
const exportButton = document.getElementById('exportButton');
const importFileElement = document.getElementById('importFile');
const importButton = document.getElementById('importButton');
const importStatusDiv = document.getElementById('importStatus');

exportButton.addEventListener('click', async () => {
    console.log("Export button clicked");
    try {
        const response = await chrome.runtime.sendMessage({ action: "getVocab" });
        console.log("Response from getVocab for export:", response);
        if (response && response.vocab) {
            const vocabData = response.vocab;
            const jsonData = JSON.stringify(vocabData, null, 2); // Pretty print JSON
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const date = new Date();
            const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            a.download = `my_vocabulary_book_${dateString}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showStatusMessage(importStatusDiv, '单词本已成功导出！', false);
        } else if (response && response.error) {
            throw new Error(response.error);
        } else {
            throw new Error('未能获取单词本数据。');
        }
    } catch (error) {
        console.error("Error exporting vocabulary:", error);
        showStatusMessage(importStatusDiv, `导出失败: ${error.message}`, true);
    }
});

importButton.addEventListener('click', () => {
    const file = importFileElement.files[0];
    if (!file) {
        showStatusMessage(importStatusDiv, '请先选择一个JSON文件！', true);
        return;
    }
    if (file.type !== "application/json") {
        showStatusMessage(importStatusDiv, '请选择一个有效的JSON文件 (.json 后缀)。', true);
        importFileElement.value = ""; // Clear the file input
        return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const importedVocab = JSON.parse(event.target.result);
            // Basic validation: check if it's an object (could be more thorough)
            if (typeof importedVocab !== 'object' || importedVocab === null || Array.isArray(importedVocab)) {
                throw new Error('文件内容不是有效的单词本对象格式。');
            }

            // Optional: Ask for confirmation before overwriting
            if (!confirm("确定要导入这个单词本吗？这将覆盖您当前的单词本。")) {
                 importFileElement.value = ""; // Clear the file input
                return;
            }

            console.log("Sending imported vocab to background:", importedVocab);
            const response = await chrome.runtime.sendMessage({
                action: "importVocab",
                vocabData: importedVocab
            });
            console.log("Response from importVocab:", response);

            if (response && response.success) {
                showStatusMessage(importStatusDiv, '单词本已成功导入！页面将尝试重新高亮。', false);
            } else {
                throw new Error(response.error || '导入失败，未知错误。');
            }
        } catch (error) {
            console.error("Error importing vocabulary:", error);
            showStatusMessage(importStatusDiv, `导入失败: ${error.message}`, true);
        } finally {
            importFileElement.value = ""; // Clear the file input after processing
        }
    };
    reader.onerror = () => {
        showStatusMessage(importStatusDiv, '读取文件失败。', true);
        importFileElement.value = "";
    };
    reader.readAsText(file);
});


// --- Utility for Status Messages ---
function showStatusMessage(element, message, isError) {
    element.textContent = message;
    element.className = 'status-message ' + (isError ? 'status-error' : 'status-success');
    element.style.display = 'block';
    setTimeout(() => {
        element.style.display = 'none';
        element.textContent = '';
    }, 5000); // Hide message after 5 seconds
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadApiKeys();
    if(saveApiKeysButton) saveApiKeysButton.addEventListener('click', saveApiKeys);
    // Export and Import listeners are already set above
});