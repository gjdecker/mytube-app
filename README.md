MyTube — AI-Powered YouTube Content Filter
A Chrome/Edge browser extension that filters your YouTube recommendations using 3-layer AI-powered analysis. Block specific people, channels, topics, and content styles — even when blocked people appear as guests on other channels.
Why MyTube?
YouTube's "Not Interested" button barely works. You tell it you don't want something, and it keeps showing up. MyTube fixes this by adding intelligent, AI-powered filtering that actually understands what you want to avoid.
How It Works
MyTube runs on top of your normal YouTube experience. You stay logged into your account, keep YouTube Premium benefits, and see your real recommendations — minus the stuff you've blocked.
3-Layer Filtering
LayerMethodWhat It Catches🔴 Layer 1Instant text matchingBlocked names/topics in titles, descriptions, channel names🟠 Layer 2AI analysis (Claude)Indirect references, nicknames, collabs, "featuring..." mentions🟣 Layer 3Caption/transcript scanPeople or topics mentioned in conversation but not in the title
YouTube Algorithm Training
When MyTube blocks a video, it also sends YouTube's own "Not Interested" feedback — with humanized timing so it looks natural. Over time, YouTube's algorithm learns from this and stops recommending the content you're filtering.
Features

Block People — Filter a specific person from ALL videos, even when they're a guest on someone else's channel
Block Channels — Hide everything from specific channels
Block Topics — Remove videos about specific subjects
Dislike Content Styles — Filter out clickbait, reaction videos, drama, etc.
AI Chat Interface — Tell the AI what you like/dislike in plain English
Right-Click Blocking — Right-click any video on YouTube to instantly block the channel or a person
Blocked Video Log — See what was filtered on the current page and which layer caught it
YouTube Feedback — Automatically trains YouTube's algorithm with randomized, human-like timing

Installation
Prerequisites

Anthropic API Key — Get one at console.anthropic.com (usage-based pricing, typically under $1/month for personal use)

Install in Chrome or Edge

Download or clone this repository
Open your browser and navigate to:

Chrome: chrome://extensions
Edge: edge://extensions


Enable Developer Mode (toggle in the corner)
Click "Load unpacked"
Select the folder containing these extension files
Click the MyTube icon in your toolbar
Go to ⚙️ Settings and enter your Anthropic API key
Go to 💬 Chat and tell it your preferences

Example Preferences

"Block any video featuring Jake Paul, even as a guest"
"I hate reaction videos, drama content, and pranks"
"Block the channels DramaAlert and Keemstar"
"I love science documentaries and history content"

File Structure
├── manifest.json      # Extension configuration
├── background.js      # Service worker — handles API calls securely
├── content.js         # Runs on YouTube — scans and filters videos
├── content.css        # Styles for filtered/scanning states
├── popup.html         # Extension popup UI
├── popup.js           # Chat, preferences, and blocked log logic
├── icon48.png         # Extension icon (48x48)
└── icon128.png        # Extension icon (128x128)
Privacy & Security

API keys are stored locally in your browser's extension storage — never transmitted anywhere except to Anthropic's API
No data collection — MyTube doesn't send your preferences or browsing data anywhere
No tracking — No analytics, no telemetry, no third-party scripts
All processing is local except for Claude API calls (Layer 2) and caption fetching (Layer 3)

Cost

Extension: Free
Claude API: Usage-based, typically $1-3/month with regular use. Set a spending limit at console.anthropic.com under Settings → Limits

Browser Compatibility
Works on any Chromium-based browser:

✅ Google Chrome
✅ Microsoft Edge
✅ Brave
✅ Opera
✅ Vivaldi

Known Limitations

Caption scanning (Layer 3) depends on a third-party transcript service that may occasionally be slow or unavailable
YouTube UI changes may affect the "Not Interested" feedback feature — the extension handles this gracefully and still filters even if feedback fails
YouTube Shorts have limited metadata, so filtering may be less effective on Shorts

License
MIT — use it, modify it, share it.

Built with Claude by Anthropic.
