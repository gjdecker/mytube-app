// ═══════════════════════════════════════════
// MyTube Background Service Worker
// Handles API calls, context menu, blocked log
// ═══════════════════════════════════════════

// ── Context Menu Setup ──
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: 'mytube-block-channel',
        title: 'MyTube: Block this channel',
        contexts: ['link'],
        targetUrlPatterns: [
            'https://www.youtube.com/watch*',
            'https://www.youtube.com/shorts/*',
            'https://www.youtube.com/@*',
            'https://www.youtube.com/channel/*'
        ]
    });

    chrome.contextMenus.create({
        id: 'mytube-block-person',
        title: 'MyTube: Block a person in this video...',
        contexts: ['link'],
        targetUrlPatterns: [
            'https://www.youtube.com/watch*',
            'https://www.youtube.com/shorts/*'
        ]
    });

    chrome.contextMenus.create({
        id: 'mytube-not-interested',
        title: 'MyTube: Not interested in this',
        contexts: ['link'],
        targetUrlPatterns: [
            'https://www.youtube.com/watch*',
            'https://www.youtube.com/shorts/*'
        ]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === 'mytube-block-channel') {
        // Ask the content script for the channel name of the right-clicked video
        chrome.tabs.sendMessage(tab.id, {
            type: 'GET_VIDEO_INFO_AT_LINK',
            url: info.linkUrl
        }, async (response) => {
            if (response?.channel) {
                await addPreference('blockedChannels', response.channel);
                // Notify content script to rescan
                chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' });
            }
        });
    }

    if (info.menuItemId === 'mytube-block-person') {
        // Prompt user for person name via content script
        chrome.tabs.sendMessage(tab.id, {
            type: 'PROMPT_BLOCK_PERSON',
            url: info.linkUrl
        });
    }

    if (info.menuItemId === 'mytube-not-interested') {
        chrome.tabs.sendMessage(tab.id, {
            type: 'GET_VIDEO_INFO_AT_LINK',
            url: info.linkUrl
        }, async (response) => {
            if (response?.channel) {
                await addPreference('blockedChannels', response.channel);
                chrome.tabs.sendMessage(tab.id, { type: 'RESCAN' });
            }
        });
    }
});

async function addPreference(key, value) {
    const data = await chrome.storage.local.get(['mytube_preferences']);
    const prefs = data.mytube_preferences || {
        likes: [], dislikes: [], blockedChannels: [],
        blockedTopics: [], blockedPeople: []
    };

    if (!prefs[key].map(i => i.toLowerCase()).includes(value.toLowerCase())) {
        prefs[key].push(value);
        await chrome.storage.local.set({ mytube_preferences: prefs });
        console.log(`[MyTube] Added to ${key}: ${value}`);
    }
}

// ── Message Handler ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'CLAUDE_API_CALL') {
        handleClaudeCall(message.payload)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'CAPTION_FETCH') {
        handleCaptionFetch(message.videoId)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'ADD_PREFERENCE') {
        addPreference(message.key, message.value)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.type === 'UPDATE_BLOCKED_LOG') {
        // Store blocked videos log for the current page
        chrome.storage.session.set({ mytube_blocked_log: message.log })
            .then(() => sendResponse({ success: true }))
            .catch(() => {
                // Fallback to local storage if session not available
                chrome.storage.local.set({ mytube_blocked_log: message.log })
                    .then(() => sendResponse({ success: true }));
            });
        return true;
    }

    if (message.type === 'GET_BLOCKED_LOG') {
        chrome.storage.session.get(['mytube_blocked_log'])
            .then(data => sendResponse({ success: true, log: data.mytube_blocked_log || [] }))
            .catch(() => {
                chrome.storage.local.get(['mytube_blocked_log'])
                    .then(data => sendResponse({ success: true, log: data.mytube_blocked_log || [] }));
            });
        return true;
    }
});

async function handleClaudeCall(payload) {
    const settings = await chrome.storage.local.get(['anthropic_api_key']);
    const apiKey = settings.anthropic_api_key;

    if (!apiKey) throw new Error('Anthropic API key not set. Click the MyTube extension icon to add it.');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message || 'Claude API request failed');
    }

    return await response.json();
}

async function handleCaptionFetch(videoId) {
    const response = await fetch(
        `https://yt.lemnoslife.com/videos?part=transcript&id=${videoId}`,
        { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) throw new Error('Captions unavailable');
    return await response.json();
}
