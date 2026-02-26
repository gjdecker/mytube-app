// ═══════════════════════════════════════════
// MyTube Popup v2 - With Blocked Log
// ═══════════════════════════════════════════

const DEFAULT_PREFS = {
    likes: [], dislikes: [], blockedChannels: [],
    blockedTopics: [], blockedPeople: []
};

let preferences = { ...DEFAULT_PREFS };

// ── DOM ──
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const chatSend = document.getElementById('chatSend');
const prefsContainer = document.getElementById('prefsContainer');
const blockedContainer = document.getElementById('blockedContainer');
const blockedBadge = document.getElementById('blockedBadge');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveSettings = document.getElementById('saveSettings');
const saveStatus = document.getElementById('saveStatus');
const resetPrefs = document.getElementById('resetPrefs');
const statusBadge = document.getElementById('statusBadge');

// ── Tabs ──
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

        // Refresh blocked log when switching to blocked tab
        if (tab.dataset.tab === 'blocked') loadBlockedLog();
    });
});

// ── Initialize ──
async function init() {
    const data = await chrome.storage.local.get(['mytube_preferences', 'anthropic_api_key']);

    if (data.mytube_preferences) {
        preferences = { ...DEFAULT_PREFS, ...data.mytube_preferences };
    }

    if (data.anthropic_api_key) {
        apiKeyInput.value = data.anthropic_api_key;
        statusBadge.textContent = 'Active';
        statusBadge.className = 'status active';
    } else {
        statusBadge.textContent = 'Need API Key';
        statusBadge.className = 'status inactive';
    }

    renderPreferences();
    loadBlockedLog();
}

init();

// ── Blocked Log ──
async function loadBlockedLog() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'GET_BLOCKED_LOG' });
        const log = response?.log || [];
        renderBlockedLog(log);
    } catch (e) {
        console.warn('Failed to load blocked log:', e);
        renderBlockedLog([]);
    }
}

function renderBlockedLog(log) {
    if (log.length === 0) {
        blockedContainer.innerHTML = '<div class="no-blocked">No videos filtered on this page yet.<br><br>Browse YouTube and videos matching your preferences will be filtered automatically.</div>';
        blockedBadge.style.display = 'none';
        return;
    }

    // Show badge with count
    blockedBadge.textContent = log.length;
    blockedBadge.style.display = 'inline-block';

    let html = `<div class="blocked-header">
        <h3>Filtered on this page</h3>
        <span class="blocked-count">${log.length} video${log.length !== 1 ? 's' : ''}</span>
    </div>`;

    // Show most recent first
    const sorted = [...log].reverse();

    sorted.forEach(item => {
        const layerClass = `l${item.layer}`;
        const thumbSrc = item.thumbnail || '';
        const thumbHTML = thumbSrc
            ? `<img class="blocked-thumb" src="${thumbSrc}" alt="">`
            : `<div class="blocked-thumb"></div>`;

        html += `<div class="blocked-item">
            ${thumbHTML}
            <div class="blocked-info">
                <div class="blocked-title">${escapeHtml(item.title || 'Unknown')}</div>
                <div class="blocked-channel">${escapeHtml(item.channel || 'Unknown channel')}</div>
                <span class="blocked-reason ${layerClass}">L${item.layer}: ${escapeHtml(item.reason)}</span>
            </div>
        </div>`;
    });

    blockedContainer.innerHTML = html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Auto-refresh blocked log periodically when popup is open
setInterval(loadBlockedLog, 3000);

// ── Chat ──
function addMessage(text, role) {
    const msg = document.createElement('div');
    msg.className = `chat-message ${role}`;
    msg.innerHTML = text;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return msg;
}

async function sendMessage() {
    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = '';
    chatSend.disabled = true;
    addMessage(text, 'user');
    const typingMsg = addMessage('Thinking...', 'assistant');

    try {
        const result = await processWithAI(text);

        if (result) {
            let changes = [];

            const mergeOps = [
                ['add_likes', 'likes', '👍', 'added'],
                ['add_dislikes', 'dislikes', '👎', 'added'],
                ['add_blocked_channels', 'blockedChannels', '🚫📺', 'removed'],
                ['add_blocked_topics', 'blockedTopics', '🚫', 'removed'],
                ['add_blocked_people', 'blockedPeople', '🚫👤', 'removed']
            ];

            mergeOps.forEach(([key, prefKey, icon, cls]) => {
                if (result[key]) {
                    result[key].forEach(item => {
                        const existing = preferences[prefKey].map(p => p.toLowerCase());
                        if (!existing.includes(item.toLowerCase())) {
                            preferences[prefKey].push(item);
                            changes.push(`<span class="${cls}">${icon} ${item}</span>`);
                        }
                    });
                }
            });

            ['remove_likes', 'remove_dislikes', 'remove_blocked_people'].forEach(key => {
                const map = { remove_likes: 'likes', remove_dislikes: 'dislikes', remove_blocked_people: 'blockedPeople' };
                if (result[key]) {
                    result[key].forEach(item => {
                        preferences[map[key]] = preferences[map[key]].filter(p => p.toLowerCase() !== item.toLowerCase());
                        changes.push(`<span class="removed">- ${item}</span>`);
                    });
                }
            });

            await chrome.storage.local.set({ mytube_preferences: preferences });
            renderPreferences();

            let html = result.response || "Updated!";
            if (changes.length > 0) {
                html += `<div class="pref-update">${changes.join('<br>')}</div>`;
            }
            typingMsg.innerHTML = html;
        } else {
            typingMsg.textContent = "Couldn't extract preferences. Try: \"Block person X\" or \"I hate reaction videos\".";
        }
    } catch (e) {
        typingMsg.innerHTML = `Error: <span style="color:#ff4444">${e.message}</span>`;
    }

    chatSend.disabled = false;
}

async function processWithAI(userMessage) {
    const systemPrompt = `You are a preference assistant for MyTube, a YouTube content filter. Parse the user's message.

Current preferences:
${JSON.stringify(preferences, null, 2)}

Respond with ONLY a JSON object (no markdown):
{
    "response": "Friendly 1-2 sentence reply",
    "add_likes": [],
    "add_dislikes": [],
    "add_blocked_channels": [],
    "add_blocked_topics": [],
    "add_blocked_people": [],
    "remove_likes": [],
    "remove_dislikes": [],
    "remove_blocked_people": []
}

RULES:
- "add_blocked_people" = specific individuals to filter from ALL videos
- Keep items short (2-4 words)
- Only include relevant fields
- Always include "response"`;

    const response = await chrome.runtime.sendMessage({
        type: 'CLAUDE_API_CALL',
        payload: {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 500,
            system: systemPrompt,
            messages: [{ role: 'user', content: userMessage }]
        }
    });

    if (!response.success) throw new Error(response.error);
    const text = response.data.content[0].text.trim();
    try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
    } catch (e) { console.warn('Parse failed:', text); }
    return { response: text };
}

chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
});

// ── Preferences ──
function renderPreferences() {
    const sections = [
        { key: 'blockedPeople', label: 'Blocked People', cls: 'person', icon: '🚫👤' },
        { key: 'blockedChannels', label: 'Blocked Channels', cls: 'blocked', icon: '🚫📺' },
        { key: 'blockedTopics', label: 'Blocked Topics', cls: 'blocked', icon: '🚫' },
        { key: 'likes', label: 'Liked Content', cls: 'like', icon: '👍' },
        { key: 'dislikes', label: 'Disliked Content', cls: 'dislike', icon: '👎' }
    ];

    const hasAny = sections.some(s => preferences[s.key]?.length > 0);
    if (!hasAny) {
        prefsContainer.innerHTML = '<div class="no-prefs">No preferences yet — use the Chat tab to add some!</div>';
        return;
    }

    let html = '';
    sections.forEach(({ key, label, cls, icon }) => {
        if (preferences[key]?.length > 0) {
            html += `<div class="pref-category"><h3>${label}</h3><div class="pref-tags">`;
            preferences[key].forEach(item => {
                html += `<span class="pref-tag ${cls}">${icon} ${escapeHtml(item)} <span class="remove" data-key="${key}" data-item="${escapeHtml(item)}">×</span></span>`;
            });
            html += '</div></div>';
        }
    });

    prefsContainer.innerHTML = html;

    prefsContainer.querySelectorAll('.remove').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.dataset.key;
            const item = btn.dataset.item;
            preferences[key] = preferences[key].filter(i => i !== item);
            await chrome.storage.local.set({ mytube_preferences: preferences });
            renderPreferences();
        });
    });
}

// ── Settings ──
saveSettings.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    await chrome.storage.local.set({ anthropic_api_key: apiKey });

    statusBadge.textContent = apiKey ? 'Active' : 'Need API Key';
    statusBadge.className = apiKey ? 'status active' : 'status inactive';

    saveStatus.style.display = 'block';
    setTimeout(() => { saveStatus.style.display = 'none'; }, 2000);
});

resetPrefs.addEventListener('click', async () => {
    if (confirm('This will remove all your preferences. Are you sure?')) {
        preferences = { ...DEFAULT_PREFS };
        await chrome.storage.local.set({ mytube_preferences: preferences });
        renderPreferences();
        addMessage('All preferences have been reset.', 'assistant');
    }
});
