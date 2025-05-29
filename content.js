// content.js

// --- Globals & Constants ---
let selectedText = '';
let selectionIcon = null;
let translationPopup = null;
let vocabTooltip = null;
let currentVocab = {};
let highlightDebounceTimer = null;
let domObserver = null;
let vocabTooltipHideTimer = null;
let isHighlightingInProgress = false;

const ICON_ID = 'my-selection-icon-translate-xyz';
const POPUP_ID = 'my-translation-popup-xyz';
const TOOLTIP_ID = 'vocab-tooltip-extension';
const HIGHLIGHT_CLASS = 'vocab-highlighted-extension';
const TOOLTIP_HIDE_DELAY = 100;
const iconUrl = chrome.runtime.getURL('images/translate_icon.png');

// ==========================================================================
// SECTION: Utility Functions
// ==========================================================================

function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');}

function debounce(func, delay) {
    return function(...args) {
        clearTimeout(highlightDebounceTimer); // Assuming highlightDebounceTimer is specific to highlight debounce
        highlightDebounceTimer = setTimeout(() => { func.apply(this, args); }, delay);
    };
}

/**
 * 判断给定的文本是否主要是英文单词或短句。
 * @param {string} text 要检查的文本.
 * @returns {boolean} 如果文本符合英文标准则返回 true, 否则返回 false.
 */
function isLikelyEnglishPhrase(text) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
        return false;
    }
    const trimmedText = text.trim();

    if (trimmedText.length < 1 || trimmedText.length > 300) {
        if (trimmedText.length === 1 && !/^[ai]$/i.test(trimmedText)) return false; // Only allow 'a' or 'I' for single char
        if (trimmedText.length > 300) return false;
    }

    if (/^\d+$/.test(trimmedText) && trimmedText.length > 1) return false; // More than one digit only
    if (/^[^\w\s]+$/.test(trimmedText) && trimmedText.length > 1) return false; // More than one punctuation char only

    const englishChars = trimmedText.match(/[a-z]/gi);
    const totalPrintableChars = trimmedText.replace(/\s+/g, '').length;

    if (!englishChars || totalPrintableChars === 0) return false;

    const englishRatio = englishChars.length / totalPrintableChars;
    // console.log(`isLikelyEnglishPhrase: Text="${trimmedText}", Ratio: ${englishRatio}`);
    return englishRatio > 0.6; // English characters should be more than 60%
}


// ==========================================================================
// SECTION: UI Element Creation and Setup (Called ONCE during initialization)
// ==========================================================================
function _createAndSetupSelectionIcon() {
    // console.log("%cCONTENT: _createAndSetupSelectionIcon - Called.", "color: purple; font-weight:bold;");
    let existingIcon = document.getElementById(ICON_ID);
    if (existingIcon) { existingIcon.remove(); }
    const icon = document.createElement('img'); icon.id = ICON_ID; icon.src = iconUrl; icon.dataset.uiType = "selectionTranslatorIcon_ACTIVE";
    Object.assign(icon.style, { position: 'absolute', zIndex: '99999', cursor: 'pointer', width: '20px', height: '20px', display: 'none', border: '1px solid #ccc', borderRadius: '4px', backgroundColor: 'white', padding: '2px' });
    icon.addEventListener('click', async (event) => {
        event.stopPropagation();
        // console.log(`%cCONTENT: SELECTION ICON (ID: ${ICON_ID}) CLICKED! selectedText: '${selectedText}'`, "color: red; font-size: 16px; font-weight: bold;");
        if (selectedText && selectedText.trim() !== '') {
            // console.log("%cCONTENT: selectionIcon click - selectedText is VALID.", "color: #28a745;");
            showTranslationPopup(event.clientX, event.clientY, "翻译中...");
            try {
                const responsePromise = chrome.runtime.sendMessage({ action: "translate", text: selectedText });
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Translation request timed out')), 10000));
                const response = await Promise.race([responsePromise, timeoutPromise]);
                if (translationPopup && translationPopup.style.display !== 'none') {
                    if (response.error) updateTranslationPopup(`错误: ${response.message}`, true, response.phonetic);
                    else if (response.translation || response.phonetic) updateTranslationPopup(response.translation, false, response.phonetic);
                    else updateTranslationPopup("未获取到翻译结果。", true, null);
                }
            } catch (error) { if (translationPopup) updateTranslationPopup(`翻译请求失败: ${error.message}`, true, null); }
        } else { /* console.log("%cCONTENT: selectionIcon click - selectedText is EMPTY.", "color: orange;"); */ }
        hideSelectionIcon();
    });
    document.body.appendChild(icon);
    // console.log("%cCONTENT: _createAndSetupSelectionIcon - Finished.", "color: purple;");
    return icon;
}
function _createAndSetupTranslationPopup() { /* ... (Same as your last working version) ... */
    let popup = document.getElementById(POPUP_ID); if (popup) popup.remove();
    popup = document.createElement('div'); popup.id = POPUP_ID; popup.className = 'translation-popup-extension'; popup.style.display = 'none';
    const closeButton = document.createElement('span'); closeButton.className = 'close-btn-extension'; closeButton.innerHTML = '×';
    closeButton.onclick = (e) => { e.stopPropagation(); hideTranslationPopup(); };
    popup.appendChild(closeButton);
    const contentDiv = document.createElement('div'); contentDiv.className = 'content-area-extension';
    popup.appendChild(contentDiv); document.body.appendChild(popup); return popup;
}
function _createAndSetupVocabTooltip() { /* ... (Same as your last working version, including delete button setup) ... */
    let tip = document.getElementById(TOOLTIP_ID); if (tip) tip.remove();
    tip = document.createElement('div'); tip.id = TOOLTIP_ID; tip.dataset.uiType = "vocabHoverTooltip";
    Object.assign(tip.style, { position: 'absolute', backgroundColor: 'rgba(25, 25, 25, 0.95)', color: 'white', padding: '8px 10px', borderRadius: '6px', zIndex: '2147483647', fontSize: '14px', fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif', display: 'none', pointerEvents: 'auto', maxWidth: '350px', lineHeight: '1.5', boxShadow: '0 4px 12px rgba(0,0,0,0.35)', alignItems: 'center', gap: '10px' });
    const textSpan = document.createElement('span'); textSpan.className = 'vocab-tooltip-text-extension'; Object.assign(textSpan.style, { flexGrow: '1', wordBreak: 'break-word' }); tip.appendChild(textSpan);
    const deleteButton = document.createElement('button'); deleteButton.className = 'vocab-tooltip-delete-btn-extension'; deleteButton.innerHTML = '✖'; deleteButton.title = '从生词本移除'; Object.assign(deleteButton.style, { background: 'transparent', border: '1px solid #555', color: '#ccc', cursor: 'pointer', fontSize: '12px', padding: '3px 6px', borderRadius: '4px', lineHeight: '1', marginLeft: 'auto', flexShrink: '0', transition: 'color 0.2s, background-color 0.2s' });
    deleteButton.onmouseover = () => { deleteButton.style.color = '#fff'; deleteButton.style.backgroundColor = '#555'; }; deleteButton.onmouseout = () => { deleteButton.style.color = '#ccc'; deleteButton.style.backgroundColor = 'transparent';}; tip.appendChild(deleteButton);
    tip.addEventListener('mouseenter', () => { if (vocabTooltipHideTimer) { clearTimeout(vocabTooltipHideTimer); vocabTooltipHideTimer = null; } });
    tip.addEventListener('mouseleave', (e) => { if (e.relatedTarget && e.relatedTarget.classList && e.relatedTarget.classList.contains(HIGHLIGHT_CLASS)) return; startHideTooltipTimer(); });
    document.body.appendChild(tip); return tip;
}

// ==========================================================================
// SECTION: UI Visibility and Update Functions
// ==========================================================================
function showSelectionIcon(x, y) { if (!selectionIcon) { console.error("CONTENT: showSelectionIcon - selectionIcon global var is null!"); return; } selectionIcon.style.left = x + 'px'; selectionIcon.style.top = y + 'px'; selectionIcon.style.display = 'block'; hideVocabTooltip(); }
function hideSelectionIcon() { if (selectionIcon && selectionIcon.style.display !== 'none') selectionIcon.style.display = 'none'; }

function updateTranslationPopup(text, isError = false, phonetic = null) {
    if (!translationPopup) { console.error("CONTENT: updateTranslationPopup - translationPopup global var is null!"); return; }
    if (translationPopup.style.display !== 'none' || text === "翻译中...") {
        const contentArea = translationPopup.querySelector('.content-area-extension');
        if (contentArea) {
            contentArea.innerHTML = '';
            if (isError) { const eSpan = document.createElement('span'); eSpan.className = 'error-message-extension'; eSpan.textContent = text; contentArea.appendChild(eSpan); }
            else if (text === "翻译中...") { const lSpan = document.createElement('span'); lSpan.className = 'loading-indicator-extension'; lSpan.textContent = text; contentArea.appendChild(lSpan); }
            else {
                if (text) contentArea.appendChild(document.createTextNode(text));
                if (phonetic) { if (text) contentArea.appendChild(document.createElement('br')); const pSpan = document.createElement('span'); pSpan.className = 'phonetic-display-extension'; pSpan.textContent = phonetic; contentArea.appendChild(pSpan); }
                if (!text && !phonetic) { const nSpan = document.createElement('span'); nSpan.className = 'error-message-extension'; nSpan.textContent = "未获取到结果。"; contentArea.appendChild(nSpan); }
            }
        }
    }
}
function showTranslationPopup(x, y, text, isError = false, phonetic = null) { /* ... (Same as your version that includes phonetic param) ... */
    if (!translationPopup) { console.error("CONTENT: showTranslationPopup - translationPopup global var is null!"); return; }
    updateTranslationPopup(text, isError, phonetic); // Pass phonetic here
    translationPopup.style.visibility = 'hidden'; translationPopup.style.display = 'block'; const popupWidth = translationPopup.offsetWidth; const popupHeight = translationPopup.offsetHeight; let popupX = x + 15; let popupY = y - popupHeight / 2; const vpWidth = window.innerWidth; const vpHeight = window.innerHeight; if (popupX < 10) popupX = 10; if (popupY < 10) popupY = 10; if (popupX + popupWidth > vpWidth - 10) popupX = vpWidth - popupWidth - 10; if (popupY + popupHeight > vpHeight - 10) popupY = vpHeight - popupHeight - 10; translationPopup.style.left = popupX + window.scrollX + 'px'; translationPopup.style.top = popupY + window.scrollY + 'px'; translationPopup.style.visibility = 'visible';
}
function hideTranslationPopup() { if (translationPopup && translationPopup.style.display !== 'none') translationPopup.style.display = 'none'; }
function startHideTooltipTimer() { if (vocabTooltipHideTimer) clearTimeout(vocabTooltipHideTimer); vocabTooltipHideTimer = setTimeout(() => { if (vocabTooltip && vocabTooltip.matches(':hover')) return; hideVocabTooltip(); }, TOOLTIP_HIDE_DELAY); }
function showVocabTooltip(highlightedElement, translationText, originalWord) { /* ... (Same as your version that includes delete button logic) ... */
    if (vocabTooltipHideTimer) { clearTimeout(vocabTooltipHideTimer); vocabTooltipHideTimer = null; } if (!vocabTooltip) { console.error("CONTENT: showVocabTooltip - vocabTooltip global var is null!"); return; } const textSpan = vocabTooltip.querySelector('.vocab-tooltip-text-extension'); if (textSpan) textSpan.textContent = translationText; const deleteButton = vocabTooltip.querySelector('.vocab-tooltip-delete-btn-extension'); if (deleteButton && originalWord) { const newDeleteButton = deleteButton.cloneNode(true); Object.assign(newDeleteButton.style, { background: 'transparent', border: '1px solid #555', color: '#ccc', cursor: 'pointer', fontSize: '12px', padding: '3px 6px', borderRadius: '4px', lineHeight: '1', marginLeft: 'auto', flexShrink: '0', transition: 'color 0.2s, background-color 0.2s' }); newDeleteButton.onmouseover = () => { newDeleteButton.style.color = '#fff'; newDeleteButton.style.backgroundColor = '#555'; }; newDeleteButton.onmouseout = () => { newDeleteButton.style.color = '#ccc'; newDeleteButton.style.backgroundColor = 'transparent';}; newDeleteButton.onclick = async (e) => { e.stopPropagation(); e.preventDefault(); hideVocabTooltip(); try { await chrome.runtime.sendMessage({ action: "removeWord", word: originalWord.toLowerCase() }); } catch (error) { console.error("Content: Error sending removeWord message:", error); } }; if(deleteButton.parentNode === vocabTooltip) vocabTooltip.replaceChild(newDeleteButton, deleteButton); else vocabTooltip.appendChild(newDeleteButton); } const rect = highlightedElement.getBoundingClientRect(); vocabTooltip.style.visibility = 'hidden'; vocabTooltip.style.display = 'flex'; const tooltipHeight = vocabTooltip.offsetHeight; const tooltipWidth = vocabTooltip.offsetWidth; let tipY, tipX; const gap = 0; tipY = rect.top - tooltipHeight - gap; tipX = rect.left + (rect.width / 2) - (tooltipWidth / 2); if (tipY < window.scrollY || tipY < 0) tipY = rect.bottom + gap; if (tipY < 0 && (rect.bottom + gap + tooltipHeight < window.innerHeight)) tipY = rect.bottom + gap; if (tipX < 5) tipX = 5; if (tipX + tooltipWidth > window.innerWidth - 5) tipX = window.innerWidth - tooltipWidth - 5; if (tipX < 0) tipX = 0; vocabTooltip.style.left = tipX + window.scrollX + 'px'; vocabTooltip.style.top = tipY + window.scrollY + 'px'; vocabTooltip.style.visibility = 'visible';
}
function hideVocabTooltip() { if (vocabTooltip && vocabTooltip.style.display !== 'none') vocabTooltip.style.display = 'none'; if (vocabTooltipHideTimer) { clearTimeout(vocabTooltipHideTimer); vocabTooltipHideTimer = null; } }

// ==========================================================================
// SECTION: Highlighting Logic
// ==========================================================================
function unhighlightAllWords() { /* ... (Same as before) ... */
    const highlightedSpans = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    highlightedSpans.forEach(span => { const parent = span.parentNode; if (parent) { const textNode = document.createTextNode(span.textContent); try { parent.replaceChild(textNode, span); } catch (e) {} } });
}
function highlightWordsInNode(node) { /* ... (Same as before, ensure it uses global currentVocab and calls showVocabTooltip correctly) ... */
    if (!node || Object.keys(currentVocab).length === 0) return;
    if (node.nodeType === Node.TEXT_NODE) { if (node.parentNode && (node.parentNode.nodeName === 'SCRIPT' || node.parentNode.nodeName === 'STYLE' || node.parentNode.isContentEditable || node.parentNode.closest('code, pre, textarea, input, select, button'))) return; if (node.parentNode && node.parentNode.classList && node.parentNode.classList.contains(HIGHLIGHT_CLASS)) return; let text = node.nodeValue; const fragment = document.createDocumentFragment(); let lastIndex = 0; const sortedWords = Object.keys(currentVocab).sort((a, b) => b.length - a.length); if (sortedWords.length === 0) return; const regexPattern = `\\b(${sortedWords.map(escapeRegExp).join('|')})\\b`; const globalRegex = new RegExp(regexPattern, 'gi'); let matchFoundThisNode = false; let match;
        while ((match = globalRegex.exec(text)) !== null) {
            const originalWordFromText = match[0]; const vocabKey = originalWordFromText.toLowerCase();
            if (currentVocab[vocabKey]) { matchFoundThisNode = true; if (match.index > lastIndex) fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index))); const span = document.createElement('span'); span.className = HIGHLIGHT_CLASS; span.textContent = originalWordFromText; span.dataset.translation = currentVocab[vocabKey]; span.dataset.originalWord = originalWordFromText; span.addEventListener('mouseenter', (e) => { if (vocabTooltipHideTimer) { clearTimeout(vocabTooltipHideTimer); vocabTooltipHideTimer = null; } const targetSpan = e.target; showVocabTooltip(targetSpan, targetSpan.dataset.translation, targetSpan.dataset.originalWord); }); span.addEventListener('mouseleave', (e) => { startHideTooltipTimer(); }); fragment.appendChild(span); lastIndex = globalRegex.lastIndex; }
        }
        if (matchFoundThisNode) { if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.substring(lastIndex))); if (node.parentNode) { try { node.parentNode.replaceChild(fragment, node); } catch (e) {} } }
    } else if (node.nodeType === Node.ELEMENT_NODE) { if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'IFRAME', 'CANVAS', 'CODE', 'PRE', 'SELECT', 'BUTTON'].includes(node.nodeName.toUpperCase()) || node.isContentEditable || node.closest('code, pre')) return; if (node.classList && node.classList.contains(HIGHLIGHT_CLASS)) return; const children = Array.from(node.childNodes); for (let i = 0; i < children.length; i++) highlightWordsInNode(children[i]); }
}
const performFullHighlight = () => { if (isHighlightingInProgress) return; isHighlightingInProgress = true; if (domObserver) domObserver.disconnect(); if (Object.keys(currentVocab).length === 0 && document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).length === 0) {} else { unhighlightAllWords(); if (document.body && Object.keys(currentVocab).length > 0) highlightWordsInNode(document.body); } if (domObserver && document.body) domObserver.observe(document.body, { childList: true, subtree: true, characterData: true }); isHighlightingInProgress = false; };
const debouncedFullHighlight = debounce(performFullHighlight, 500);
async function initWordHighlightingAndVocab() { /* ... (Same as before, calls performFullHighlight) ... */
    try {
        const response = await chrome.runtime.sendMessage({ action: "getVocab" });
        if (response && response.vocab) {
            currentVocab = response.vocab; performFullHighlight();
            if (domObserver) domObserver.disconnect();
            domObserver = new MutationObserver((mutationsList) => { if (isHighlightingInProgress) return; let relevantMutation = false; for(const mutation of mutationsList) { if (mutation.target === vocabTooltip || (vocabTooltip && vocabTooltip.contains(mutation.target)) || mutation.target === translationPopup || (translationPopup && translationPopup.contains(mutation.target)) || mutation.target === selectionIcon ) continue; if (mutation.addedNodes.length > 0) { let allPluginUINodes = true; for (const addedNode of mutation.addedNodes) { if (addedNode.id !== TOOLTIP_ID && addedNode.id !== POPUP_ID && addedNode.id !== ICON_ID && !(addedNode.nodeType === Node.ELEMENT_NODE && addedNode.classList && addedNode.classList.contains(HIGHLIGHT_CLASS))) { allPluginUINodes = false; break; } } if (allPluginUINodes) continue; } if (mutation.type === 'childList' && mutation.addedNodes.length > 0) { for (const addedNode of mutation.addedNodes) { if (addedNode.nodeType === Node.ELEMENT_NODE && addedNode.classList && addedNode.classList.contains(HIGHLIGHT_CLASS)) continue; if (addedNode.nodeType === Node.TEXT_NODE || (addedNode.nodeType === Node.ELEMENT_NODE && addedNode.textContent.trim() !== '' && !addedNode.closest(`.${HIGHLIGHT_CLASS}`))) { relevantMutation = true; break; } } } if (relevantMutation) break; if (mutation.type === 'characterData') { let parent = mutation.target.parentNode; let isSafeToHighlight = true; while(parent && parent !== document.body) { if (parent.classList && parent.classList.contains(HIGHLIGHT_CLASS)) { isSafeToHighlight = false; break; } if (parent.id === TOOLTIP_ID || parent.id === POPUP_ID || parent.id === ICON_ID) { isSafeToHighlight = false; break; } parent = parent.parentNode; } if (isSafeToHighlight) { relevantMutation = true; break; } } } if(relevantMutation) debouncedFullHighlight(); });
            if (document.body) { domObserver.observe(document.body, { childList: true, subtree: true, characterData: true }); } else { document.addEventListener('DOMContentLoaded', () => { if (document.body) domObserver.observe(document.body, { childList: true, subtree: true, characterData: true }); }, { once: true }); }
        } else if (response && response.error) console.error("Content: Error getting vocab from background:", response.error);
    } catch (error) { console.error("Content: Failed to send 'getVocab' message for init:", error); }
}

// ==========================================================================
// SECTION: Event Listeners and Initialization
// ==========================================================================
document.addEventListener('mouseup', function(event) {
    if (!selectionIcon || !translationPopup || !vocabTooltip) {
        // console.warn("Content: Mouseup - UI elements not fully initialized yet, skipping event.");
        return; // Critical UI elements not ready
    }

    // If the click/mouseup is on any of our UI elements, or a highlighted word itself, do nothing here.
    if (event.target.id === ICON_ID ||
        translationPopup.contains(event.target) ||
        vocabTooltip.contains(event.target) ||
        (event.target.classList && event.target.classList.contains(HIGHLIGHT_CLASS))) {
        // console.log("Content: Mouseup on UI element or highlighted word, ensuring selection icon is hidden.");
        hideSelectionIcon();
        return;
    }

    const selection = window.getSelection();
    let shouldShowSelectionIcon = false;
    let currentSelectionText = '';

    if (selection && selection.rangeCount > 0) {
        currentSelectionText = selection.toString().trim();

        // ***** APPLY ENGLISH CHECK HERE *****
        if (currentSelectionText.length > 0 &&
            currentSelectionText.length < 1000 && // Basic length check
            !currentSelectionText.includes('\n') && // Avoid multi-paragraph
            isLikelyEnglishPhrase(currentSelectionText)) { // Check if it's likely English

            // console.log(`Content: Mouseup - Text "${currentSelectionText}" IS LIKELY ENGLISH.`);
            const range = selection.getRangeAt(0);
            let commonAncestor = range.commonAncestorContainer;
            if (commonAncestor.nodeType === Node.TEXT_NODE) {
                commonAncestor = commonAncestor.parentNode;
            }

            shouldShowSelectionIcon = true; // Default to show for valid English selections

            // Exception: If the selection is an exact match of an already highlighted word, don't show.
            if (commonAncestor && commonAncestor.classList && commonAncestor.classList.contains(HIGHLIGHT_CLASS)) {
                const highlightedWordText = commonAncestor.textContent.trim();
                if (currentSelectionText.toLowerCase() === highlightedWordText.toLowerCase() &&
                    commonAncestor.contains(range.startContainer) &&
                    commonAncestor.contains(range.endContainer) &&
                    range.startOffset === 0 &&
                    range.endOffset === commonAncestor.textContent.length) {
                    // console.log("Content: Mouseup is an exact selection of an already highlighted word. Not showing selection icon.");
                    shouldShowSelectionIcon = false;
                }
            }
        } else {
            // console.log(`Content: Mouseup - Text "${currentSelectionText}" is NOT likely English or failed other checks.`);
            shouldShowSelectionIcon = false; // Not English or failed other checks
        }
    }

    // Hide any existing selection icon *before* deciding to show a new one.
    hideSelectionIcon();

    if (shouldShowSelectionIcon && currentSelectionText.length > 0) { // Double check currentSelectionText
        selectedText = currentSelectionText; // Update global selectedText
        const range = selection.getRangeAt(0);
        const clientRects = range.getClientRects();
        let finalRect = clientRects.length > 0 ? clientRects[clientRects.length - 1] : range.getBoundingClientRect();
        if (finalRect.width === 0 || finalRect.height === 0) {
            if (clientRects.length > 1) finalRect = clientRects[clientRects.length - 2];
            else finalRect = range.getBoundingClientRect();
        }
        const iconX = finalRect.right + window.scrollX + 5;
        const iconY = finalRect.top + window.scrollY + (finalRect.height / 2) - 10;
        // console.log(`Content: Mouseup: SHOWING selection icon for text "${currentSelectionText}" at (${iconX}, ${iconY})`);
        showSelectionIcon(iconX, iconY);
    } else {
        selectedText = ''; // Clear selectedText if not showing icon
        // hideSelectionIcon(); // Already called above
        hideTranslationPopup(); // Also hide the translation popup if no valid selection for icon
    }
});

document.addEventListener('mousedown', function(event) { /* ... (Same as your last working mousedown) ... */
    if (!selectionIcon || !translationPopup || !vocabTooltip) return;
    if (selectionIcon.style.display !== 'none' && event.target.id !== ICON_ID && (!translationPopup || !translationPopup.contains(event.target)) && (!vocabTooltip || !vocabTooltip.contains(event.target)) && (!event.target.classList || !event.target.classList.contains(HIGHLIGHT_CLASS))) { if (window.getSelection().toString().trim() === '') { hideSelectionIcon(); hideTranslationPopup(); } }
    if (translationPopup.style.display !== 'none' && !translationPopup.contains(event.target) && event.target.id !== ICON_ID) { hideTranslationPopup(); }
    if (vocabTooltip.style.display !== 'none' && !vocabTooltip.contains(event.target) && (!event.target.classList || !event.target.classList.contains(HIGHLIGHT_CLASS))) { hideVocabTooltip(); }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // console.log("%cCONTENT: Message received (MAIN LISTENER for vocabUpdated)", "color: #6610f2; font-weight: bold;", request);
    if (request.action === "vocabUpdated" && request.newVocab) {
        // console.log("%cCONTENT: 'vocabUpdated' message RECEIVED. New vocab size: " + Object.keys(request.newVocab).length, "color: #6610f2; font-size: 1.1em; font-weight: bold;");
        currentVocab = request.newVocab;
        performFullHighlight();
        if (sendResponse) sendResponse({status: "Vocab updated, content script processed and re-highlighted."});
        return true;
    }
    return false;
});

function initializeExtensionFeatures() {
    // console.log("%cCONTENT: initializeExtensionFeatures CALLED (final-final version)", "color: #d63384; font-size: 1.2em; font-weight: bold;");
    selectionIcon = _createAndSetupSelectionIcon();
    translationPopup = _createAndSetupTranslationPopup();
    vocabTooltip = _createAndSetupVocabTooltip();
    // console.log("%cCONTENT: Core UI elements CREATED/SETUP.", "color: #d63384;");
    initWordHighlightingAndVocab();
}

// --- DOM Ready ---
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initializeExtensionFeatures, { once: true }); }
else if (document.body) { initializeExtensionFeatures(); }
else { document.addEventListener('DOMContentLoaded', initializeExtensionFeatures, { once: true }); }
// console.log("Content.js: Script fully loaded and running.");