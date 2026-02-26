// ═══════════════════════════════════════════════════
// MyTube Content Script v4
// 3-layer filter + humanized YouTube feedback
// ═══════════════════════════════════════════════════

(function () {
    'use strict';

    let preferences = null;
    let processedVideos = new Set();
    let blockedCount = 0;
    let feedbackCount = 0;
    let feedbackSkipped = 0;
    let isProcessing = false;
    let counterEl = null;
    let blockedLog = [];

    // ── Humanization Config ──
    const FEEDBACK_CONFIG = {
        minDelay: 2000,       // Minimum delay between feedback actions (ms)
        maxDelay: 6000,       // Maximum delay between feedback actions (ms)
        skipChance: 0.20,     // 20% chance to skip feedback on any given video
        maxPerPage: 8,        // Max feedback actions per page load
        initialDelay: 3000,   // Wait before starting any feedback after page scan
        maxInitialDelay: 8000 // Random extra initial wait
    };

    let feedbackThisPage = 0; // Track feedback count for current page

    // ── Initialize ──
    async function init() {
        preferences = await loadPreferences();
        console.log('[MyTube] Loaded preferences:', preferences);
        createCounter();

        if (hasActiveFilters()) {
            scanPage();
        }

        observePageChanges();
    }

    function hasActiveFilters() {
        if (!preferences) return false;
        return (
            (preferences.blockedPeople?.length || 0) > 0 ||
            (preferences.blockedChannels?.length || 0) > 0 ||
            (preferences.blockedTopics?.length || 0) > 0 ||
            (preferences.dislikes?.length || 0) > 0
        );
    }

    async function loadPreferences() {
        return new Promise(resolve => {
            chrome.storage.local.get(['mytube_preferences'], result => {
                resolve(result.mytube_preferences || {
                    likes: [], dislikes: [], blockedChannels: [],
                    blockedTopics: [], blockedPeople: []
                });
            });
        });
    }

    // ── Random Helpers ──
    function randomBetween(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function shouldSkipFeedback() {
        return Math.random() < FEEDBACK_CONFIG.skipChance;
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ── Messages from background/popup ──
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'GET_VIDEO_INFO_AT_LINK') {
            const info = findVideoInfoByLink(message.url);
            sendResponse(info || { channel: null, title: null });
            return;
        }
        if (message.type === 'PROMPT_BLOCK_PERSON') {
            const info = findVideoInfoByLink(message.url);
            const personName = prompt(
                `MyTube: Enter the name of the person to block.\n\nVideo: "${info?.title || 'Unknown'}"\nChannel: ${info?.channel || 'Unknown'}\n\nThis will filter out any video featuring this person:`
            );
            if (personName && personName.trim()) {
                chrome.runtime.sendMessage({
                    type: 'ADD_PREFERENCE',
                    key: 'blockedPeople',
                    value: personName.trim()
                }, () => {
                    loadPreferences().then(p => {
                        preferences = p;
                        fullRescan();
                    });
                });
            }
            sendResponse({ ok: true });
            return;
        }
        if (message.type === 'RESCAN') {
            loadPreferences().then(p => {
                preferences = p;
                fullRescan();
            });
            sendResponse({ ok: true });
            return;
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.mytube_preferences) {
            preferences = changes.mytube_preferences.newValue;
            console.log('[MyTube] Preferences updated, rescanning...');
            fullRescan();
        }
    });

    function fullRescan() {
        processedVideos.clear();
        blockedCount = 0;
        feedbackCount = 0;
        feedbackSkipped = 0;
        feedbackThisPage = 0;
        blockedLog = [];
        updateCounter();
        removeAllMytubeClasses();
        if (hasActiveFilters()) {
            if (!counterEl) createCounter();
            scanPage();
        }
    }

    function removeAllMytubeClasses() {
        document.querySelectorAll('.mytube-blocked, .mytube-scanning').forEach(el => {
            el.classList.remove('mytube-blocked', 'mytube-scanning');
        });
        document.querySelectorAll('.mytube-badge').forEach(el => el.remove());
    }

    // ── Find video info by link URL (for right-click) ──
    function findVideoInfoByLink(url) {
        if (!url) return null;
        const videoIdMatch = url.match(/[?&]v=([^&]+)/) || url.match(/shorts\/([^?&]+)/);
        const videoId = videoIdMatch?.[1];

        const allVideoEls = document.querySelectorAll(
            'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer'
        );

        for (const el of allVideoEls) {
            const linkEl = el.querySelector('a[href*="watch"], a[href*="shorts"]');
            if (linkEl) {
                const href = linkEl.getAttribute('href') || '';
                const elVideoId = href.match(/[?&]v=([^&]+)/)?.[1] || href.match(/shorts\/([^?&]+)/)?.[1];
                if (elVideoId && elVideoId === videoId) {
                    const info = extractVideoInfo(el);
                    if (info) return { channel: info.channel, title: info.title, videoId: elVideoId };
                }
            }
        }

        if (url.includes('/@') || url.includes('/channel/')) {
            const channelMatch = url.match(/@([^/?]+)/);
            if (channelMatch) return { channel: channelMatch[1], title: null };
        }
        return null;
    }

    // ── Counter ──
    function createCounter() {
        if (counterEl) return;
        counterEl = document.createElement('div');
        counterEl.className = 'mytube-counter';
        counterEl.innerHTML = '<span class="mytube-logo">My<span>Tube</span></span> 0 filtered';
        document.body.appendChild(counterEl);
    }

    function updateCounter() {
        if (!counterEl) return;
        if (blockedCount > 0) {
            let text = `${blockedCount} filtered`;
            if (feedbackCount > 0) text += ` · ${feedbackCount} reported`;
            counterEl.innerHTML = `<span class="mytube-logo">My<span>Tube</span></span> ${text}`;
            counterEl.classList.add('visible');
        } else {
            counterEl.classList.remove('visible');
        }
    }

    function updateBlockedLog() {
        try {
            chrome.runtime.sendMessage({ type: 'UPDATE_BLOCKED_LOG', log: blockedLog });
        } catch (e) { /* extension context may be invalidated */ }
    }

    // ── Find & Extract Video Elements ──
    function findVideoElements() {
        const selectors = [
            'ytd-rich-item-renderer', 'ytd-video-renderer',
            'ytd-compact-video-renderer', 'ytd-grid-video-renderer',
            'ytd-reel-item-renderer'
        ];
        const elements = [];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (!processedVideos.has(el)) elements.push(el);
            });
        });
        return elements;
    }

    function extractVideoInfo(element) {
        try {
            const titleEl =
                element.querySelector('#video-title') ||
                element.querySelector('#video-title-link') ||
                element.querySelector('a#video-title') ||
                element.querySelector('[id="video-title"]') ||
                element.querySelector('h3 a');

            const title = titleEl?.textContent?.trim() || titleEl?.getAttribute('title')?.trim() || '';

            const channelEl =
                element.querySelector('#channel-name a') ||
                element.querySelector('ytd-channel-name a') ||
                element.querySelector('.ytd-channel-name a') ||
                element.querySelector('#text.ytd-channel-name') ||
                element.querySelector('yt-formatted-string.ytd-channel-name');

            const channel = channelEl?.textContent?.trim() || '';

            const linkEl =
                element.querySelector('a#video-title-link') ||
                element.querySelector('a#video-title') ||
                element.querySelector('a#thumbnail') ||
                element.querySelector('a[href*="watch"]');

            let videoId = '';
            if (linkEl) {
                const href = linkEl.getAttribute('href') || '';
                const match = href.match(/[?&]v=([^&]+)/);
                if (match) videoId = match[1];
            }

            const descEl = element.querySelector('#description-text') ||
                          element.querySelector('.metadata-snippet-text') ||
                          element.querySelector('#metadata-line');
            const description = descEl?.textContent?.trim() || '';

            const thumbEl = element.querySelector('img#img') ||
                           element.querySelector('yt-image img') ||
                           element.querySelector('ytd-thumbnail img');
            const thumbnail = thumbEl?.src || '';

            return { title, channel, videoId, description, thumbnail, element };
        } catch (e) { return null; }
    }

    // ═══════════════════════════════════════════════════
    //  YouTube "Not Interested" — Humanized
    // ═══════════════════════════════════════════════════
    async function sendYouTubeNotInterested(videoElement) {
        // Check if we've hit the per-page cap
        if (feedbackThisPage >= FEEDBACK_CONFIG.maxPerPage) {
            console.log('[MyTube] Feedback cap reached for this page, skipping');
            return false;
        }

        // Random skip — makes the pattern look more human
        if (shouldSkipFeedback()) {
            feedbackSkipped++;
            console.log('[MyTube] Randomly skipped feedback (human pattern)');
            return false;
        }

        try {
            // Step 1: Find the three-dot menu button
            const menuButton =
                videoElement.querySelector('button.yt-icon-button[aria-label="Action menu"]') ||
                videoElement.querySelector('yt-icon-button#button') ||
                videoElement.querySelector('ytd-menu-renderer button') ||
                videoElement.querySelector('button[aria-label="Action menu"]');

            if (!menuButton) {
                console.log('[MyTube] Could not find menu button');
                return false;
            }

            // Step 2: Click to open menu
            menuButton.click();

            // Step 3: Human-like wait for menu to render (variable)
            await sleep(randomBetween(250, 500));

            // Step 4: Find "Not interested"
            const menuItems = document.querySelectorAll(
                'ytd-menu-service-item-renderer, tp-yt-paper-item'
            );

            let notInterestedItem = null;
            for (const item of menuItems) {
                const text = item.textContent?.trim().toLowerCase() || '';
                if (text.includes('not interested')) {
                    notInterestedItem = item;
                    break;
                }
            }

            if (notInterestedItem) {
                // Step 5: Small human-like pause before clicking the option
                await sleep(randomBetween(100, 300));

                notInterestedItem.click();
                await sleep(randomBetween(150, 350));

                feedbackCount++;
                feedbackThisPage++;
                updateCounter();
                console.log(`[MyTube] ✓ "Not interested" sent (${feedbackThisPage}/${FEEDBACK_CONFIG.maxPerPage} this page)`);
                return true;
            } else {
                console.log('[MyTube] "Not interested" not found in menu');
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape', code: 'Escape', bubbles: true
                }));
                await sleep(100);
                return false;
            }

        } catch (e) {
            console.log('[MyTube] Feedback failed (non-critical):', e.message);
            try {
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape', code: 'Escape', bubbles: true
                }));
            } catch (_) {}
            return false;
        }
    }

    // ═══════════════════════════════════════════
    //  LAYER 1: Instant Text Matching
    // ═══════════════════════════════════════════
    function layer1Check(info) {
        const allText = (info.title + ' ' + info.channel + ' ' + info.description).toLowerCase();

        for (const ch of (preferences.blockedChannels || [])) {
            if (info.channel.toLowerCase().includes(ch.toLowerCase()))
                return { blocked: true, reason: `Channel: ${ch}`, layer: 1 };
        }
        for (const person of (preferences.blockedPeople || [])) {
            if (allText.includes(person.toLowerCase()))
                return { blocked: true, reason: `Person: ${person}`, layer: 1 };
        }
        for (const topic of (preferences.blockedTopics || [])) {
            if (allText.includes(topic.toLowerCase()))
                return { blocked: true, reason: `Topic: ${topic}`, layer: 1 };
        }
        for (const dislike of (preferences.dislikes || [])) {
            if (allText.includes(dislike.toLowerCase()))
                return { blocked: true, reason: `Dislike: ${dislike}`, layer: 1 };
        }
        return { blocked: false };
    }

    // ═══════════════════════════════════════════
    //  LAYER 2: AI Batch Analysis
    // ═══════════════════════════════════════════
    async function layer2BatchCheck(videoInfos) {
        if (videoInfos.length === 0) return {};

        const videoList = videoInfos.map((v, i) =>
            `[${i}] Title: "${v.title}" | Channel: "${v.channel}" | Desc: "${v.description.substring(0, 200)}"`
        ).join('\n');

        const prompt = `Analyze these YouTube videos. Determine which likely feature or discuss any blocked items.

BLOCKED PEOPLE: ${JSON.stringify(preferences.blockedPeople || [])}
BLOCKED TOPICS: ${JSON.stringify(preferences.blockedTopics || [])}
DISLIKED CONTENT: ${JSON.stringify(preferences.dislikes || [])}
BLOCKED CHANNELS: ${JSON.stringify(preferences.blockedChannels || [])}

Videos:
${videoList}

Respond with ONLY a JSON object. Keys = video indices to block, values = reason. If none: {}`;

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'CLAUDE_API_CALL',
                payload: {
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 1000,
                    messages: [{ role: 'user', content: prompt }]
                }
            });

            if (!response.success) throw new Error(response.error);
            const text = response.data.content[0].text.trim();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) return JSON.parse(jsonMatch[0]);
        } catch (e) {
            console.warn('[MyTube] Layer 2 failed:', e.message);
        }
        return {};
    }

    // ═══════════════════════════════════════════
    //  LAYER 3: Caption Scanning
    // ═══════════════════════════════════════════
    async function layer3Check(videoId) {
        const searchTerms = [
            ...(preferences.blockedPeople || []),
            ...(preferences.blockedTopics || [])
        ];
        if (searchTerms.length === 0 || !videoId) return { blocked: false };

        try {
            const response = await chrome.runtime.sendMessage({
                type: 'CAPTION_FETCH', videoId
            });
            if (!response.success) return { blocked: false };

            let transcriptText = '';
            const data = response.data;
            if (data.items?.[0]?.transcript) {
                const segments = data.items[0].transcript.content || [];
                transcriptText = segments.map(s => s.text || '').join(' ').toLowerCase();
            }
            if (!transcriptText) return { blocked: false };

            for (const term of searchTerms) {
                if (transcriptText.includes(term.toLowerCase()))
                    return { blocked: true, reason: `Transcript: ${term}`, layer: 3 };
            }
        } catch (e) {
            console.log('[MyTube] Caption scan skipped:', e.message);
        }
        return { blocked: false };
    }

    // ═══════════════════════════════════════════
    //  Main Scan Pipeline
    // ═══════════════════════════════════════════
    async function scanPage() {
        if (isProcessing || !hasActiveFilters()) return;
        isProcessing = true;

        try {
            const elements = findVideoElements();
            if (elements.length === 0) { isProcessing = false; return; }

            console.log(`[MyTube] Scanning ${elements.length} new videos...`);

            const videoInfos = [];
            elements.forEach(el => {
                processedVideos.add(el);
                const info = extractVideoInfo(el);
                if (info && info.title) videoInfos.push(info);
            });

            if (videoInfos.length === 0) { isProcessing = false; return; }

            // Collect all videos to block
            const toBlock = [];

            // ── LAYER 1 ──
            const layer1Remaining = [];
            videoInfos.forEach(info => {
                const result = layer1Check(info);
                if (result.blocked) {
                    toBlock.push({ info, reason: result.reason, layer: 1 });
                } else {
                    layer1Remaining.push(info);
                }
            });

            // ── LAYER 2 ──
            if (layer1Remaining.length > 0) {
                layer1Remaining.forEach(info => info.element.classList.add('mytube-scanning'));
                const aiResults = await layer2BatchCheck(layer1Remaining);

                const layer2Remaining = [];
                layer1Remaining.forEach((info, index) => {
                    info.element.classList.remove('mytube-scanning');
                    if (aiResults[index.toString()]) {
                        toBlock.push({ info, reason: aiResults[index.toString()], layer: 2 });
                    } else {
                        layer2Remaining.push(info);
                    }
                });

                // ── LAYER 3 ──
                const captionTerms = [
                    ...(preferences.blockedPeople || []),
                    ...(preferences.blockedTopics || [])
                ];

                if (layer2Remaining.length > 0 && captionTerms.length > 0) {
                    for (let i = 0; i < layer2Remaining.length; i += 3) {
                        const batch = layer2Remaining.slice(i, i + 3);
                        const results = await Promise.allSettled(
                            batch.map(info => layer3Check(info.videoId))
                        );
                        results.forEach((result, j) => {
                            if (result.status === 'fulfilled' && result.value.blocked) {
                                toBlock.push({ info: batch[j], reason: result.value.reason, layer: 3 });
                            }
                        });
                    }
                }
            }

            // ── PHASE 1: Hide all blocked videos immediately ──
            // User sees clean results right away
            toBlock.forEach(item => {
                hideVideo(item.info, item.reason, item.layer);
            });

            // ── PHASE 2: Send YouTube feedback in the background ──
            // Staggered, randomized, and capped — runs after videos are already hidden
            if (toBlock.length > 0) {
                sendFeedbackQueue(toBlock.map(item => item.info.element));
            }

        } catch (e) {
            console.error('[MyTube] Scan error:', e);
        }

        isProcessing = false;
    }

    // ── Staggered YouTube Feedback Queue ──
    async function sendFeedbackQueue(elements) {
        // Random initial delay before starting any feedback
        const initialWait = randomBetween(
            FEEDBACK_CONFIG.initialDelay,
            FEEDBACK_CONFIG.maxInitialDelay
        );
        console.log(`[MyTube] Starting YouTube feedback in ${(initialWait / 1000).toFixed(1)}s...`);
        await sleep(initialWait);

        // Shuffle the array so feedback order isn't predictable
        const shuffled = [...elements].sort(() => Math.random() - 0.5);

        for (const element of shuffled) {
            // Check page cap
            if (feedbackThisPage >= FEEDBACK_CONFIG.maxPerPage) {
                console.log(`[MyTube] Feedback cap reached (${FEEDBACK_CONFIG.maxPerPage}/page). Stopping.`);
                break;
            }

            // Make sure the element is still in the DOM (user might have navigated)
            if (!document.body.contains(element)) {
                continue;
            }

            // Briefly unhide the element so YouTube's menu can be interacted with
            // (YouTube doesn't render menus for display:none elements)
            element.style.display = '';
            element.style.position = 'absolute';
            element.style.left = '-9999px';
            element.style.opacity = '0';
            element.style.pointerEvents = 'none';

            await sleep(randomBetween(200, 400));

            await sendYouTubeNotInterested(element);

            // Re-hide after feedback
            element.style.display = 'none';
            element.style.position = '';
            element.style.left = '';
            element.style.opacity = '';
            element.style.pointerEvents = '';

            // Random human-like delay before next feedback
            const delay = randomBetween(
                FEEDBACK_CONFIG.minDelay,
                FEEDBACK_CONFIG.maxDelay
            );
            console.log(`[MyTube] Next feedback in ${(delay / 1000).toFixed(1)}s...`);
            await sleep(delay);
        }

        const total = feedbackCount + feedbackSkipped;
        console.log(`[MyTube] Feedback complete: ${feedbackCount} sent, ${feedbackSkipped} randomly skipped, ${Math.max(0, elements.length - total)} capped`);
    }

    function hideVideo(info, reason, layer) {
        if (!info.element || info.element.classList.contains('mytube-blocked')) return;

        info.element.classList.add('mytube-blocked');
        blockedCount++;
        updateCounter();

        const layerLabels = { 1: 'Text Match', 2: 'AI Analysis', 3: 'Caption Scan' };
        blockedLog.push({
            title: info.title,
            channel: info.channel,
            videoId: info.videoId,
            thumbnail: info.thumbnail,
            reason: reason,
            layer: layer,
            layerLabel: layerLabels[layer] || 'Unknown',
            timestamp: Date.now()
        });

        updateBlockedLog();
        console.log(`[MyTube] Blocked (L${layer}): "${info.title}" — ${reason}`);
    }

    // ── Page Observation ──
    function observePageChanges() {
        const observer = new MutationObserver((mutations) => {
            let hasNewContent = false;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            const tag = node.tagName?.toLowerCase() || '';
                            if (tag.includes('ytd-rich-item') ||
                                tag.includes('ytd-video-renderer') ||
                                tag.includes('ytd-compact-video') ||
                                tag.includes('ytd-grid-video') ||
                                tag.includes('ytd-reel-item') ||
                                node.querySelector?.('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer')) {
                                hasNewContent = true;
                                break;
                            }
                        }
                    }
                }
                if (hasNewContent) break;
            }

            if (hasNewContent) {
                clearTimeout(window._mytubeScanTimeout);
                window._mytubeScanTimeout = setTimeout(() => scanPage(), 300);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        let lastUrl = location.href;
        const urlObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                console.log('[MyTube] Page navigated, rescanning...');
                processedVideos.clear();
                blockedCount = 0;
                feedbackCount = 0;
                feedbackSkipped = 0;
                feedbackThisPage = 0;
                blockedLog = [];
                updateCounter();
                updateBlockedLog();
                setTimeout(() => scanPage(), 1000);
            }
        });

        urlObserver.observe(document.querySelector('title') || document.head, {
            childList: true, subtree: true
        });

        setInterval(() => {
            if (hasActiveFilters() && !isProcessing) {
                const newElements = findVideoElements();
                if (newElements.length > 0) scanPage();
            }
        }, 2000);
    }

    // ── Start ──
    if (document.readyState === 'complete') {
        setTimeout(init, 1000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 1000));
    }
})();
