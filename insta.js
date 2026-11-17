// bot.js - Instagram Username Availability Finder
const readline = require('readline');

// Helper function to add a delay (to avoid rate limits / IP blocks)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Generate custom patterns and variations based on "zafar"
function generateUsernames(base = "zafar") {
    const candidates = [];
    
    // 1. Single letter suffixes (zafara, zafarb, zafark, zafarl, ..., zafarz)
    for (let i = 97; i <= 122; i++) {
        const char = String.fromCharCode(i);
        candidates.push(`${base}${char}`);
        candidates.push(`${base}_${char}`);
        candidates.push(`${base}.${char}`);
    }

    // 2. Number suffixes (zafar0 to zafar99, zafar9, etc.)
    for (let i = 0; i <= 99; i++) {
        candidates.push(`${base}${i}`);
        candidates.push(`${base}_${i}`);
    }

    // 3. Common professional/brand suffixes & prefixes
    const commonAffixes = ['hq', 'official', 'real', 'the', 'inc', 'gram', 'x', 'edits', 'art', 'pro', 'studio'];
    for (const affix of commonAffixes) {
        candidates.push(`${base}${affix}`);
        candidates.push(`${base}_${affix}`);
        candidates.push(`${affix}${base}`);
        candidates.push(`${affix}_${base}`);
    }

    // Deduplicate and ensure Instagram's 30-character limit
    return [...new Set(candidates)].filter(u => u.length <= 30);
}

// Function to check a single username profile page
async function checkUsername(username) {
    const url = `https://www.instagram.com/${username}/`;
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        // Instagram returns 404 when a profile doesn't exist
        if (response.status === 404) {
            return { username, status: 'AVAILABLE (Likely)' };
        } else if (response.status === 200) {
            const html = await response.text();
            // Fallback check if Instagram renders a custom 200 page with a "Not Found" message
            if (html.includes("Sorry, this page isn't available") || html.includes("Page Not Found")) {
                return { username, status: 'AVAILABLE (Likely)' };
            }
            return { username, status: 'TAKEN' };
        } else if (response.status === 429) {
            return { username, status: 'RATE_LIMITED' };
        } else {
            return { username, status: `UNKNOWN (${response.status})` };
        }
    } catch (error) {
        return { username, status: `ERROR: ${error.message}` };
    }
}

// Main execution loop
async function run() {
    const baseName = "zafar";
    console.log(`[+] Generating username patterns for "${baseName}"...`);
    const usernames = generateUsernames(baseName);
    console.log(`[+] Generated ${usernames.length} candidate usernames.`);
    console.log(`[+] Starting checks... (Delay: 3 seconds per request to prevent bans)\n`);

    const available = [];

    for (let i = 0; i < usernames.length; i++) {
        const username = usernames[i];
        process.stdout.write(`[${i + 1}/${usernames.length}] Checking @${username}... `);
        
        const result = await checkUsername(username);
        console.log(result.status);

        if (result.status.includes('AVAILABLE')) {
            available.push(username);
        }

        // If rate limited, pause longer
        if (result.status === 'RATE_LIMITED') {
            console.log('[!] Rate limited by Instagram. Pausing for 30 seconds...');
            await sleep(30000);
        } else {
            await sleep(3000); // 3-second polite delay between requests
        }
    }

    console.log(`\n========================================`);
    console.log(` Scan Finished! Available Candidates Found:`);
    console.log(`========================================`);
    if (available.length > 0) {
        available.forEach(u => console.log(` ✨ @${u}`));
    } else {
        console.log(` No available usernames found in this batch (or IP was throttled).`);
    }
}

run();
