# HL Discord Bot — Render Deployment Guide

## যা যা ফিক্স করা হয়েছে
- Replit-only lock (`REPLIT_DEPLOYMENT` চেক) সরানো হয়েছে — এখন সব ফিচার যেকোনো হোস্টে কাজ করবে
- Economy + mute state এখন `DATA_DIR` (persistent disk-এ mount করার জন্য) ফোল্ডারে সেভ হয়, রিস্টার্টে হারায় না
- Mute হওয়া member রিস্টার্টের পরও ঠিক সময়ে unmute হবে
- `ffmpeg-static` npm প্যাকেজ ব্যবহার করা হয়েছে — সিস্টেম ffmpeg ইনস্টল করার দরকার নেই
- Missing `support.gif` থাকলেও ticket panel এখন ক্র্যাশ করবে না
- সব চ্যানেল/রোল ID এখন env var দিয়ে override করা যায়
- Webhook endpoint-এ rate limiting যোগ হয়েছে
- Blocked-word filter এখন leetspeak/spacing bypass ধরতে পারে
- `package.json`-এ `start` script ও Node engine version যোগ হয়েছে

## নতুন ফিচার
- `/mute`, `/unmute`, `/warn`, `/kick`, `/ban` — ম্যানুয়াল moderation কমান্ড (staff-only permission)
- `/shop`, `/buy`, `/inventory` — coin shop সিস্টেম
- Uncaught error/exception এখন log চ্যানেলেও পাঠানো হয়, শুধু console-এ না

## Render-এ ডিপ্লয় করার ধাপ

1. এই কোড একটা GitHub রিপোতে পুশ করো।
2. Render Dashboard → **New → Web Service** → রিপো সিলেক্ট করো।
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Environment → Environment Variables**-এ `.env.example` দেখে সব দরকারি ভ্যারিয়েবল যোগ করো (অন্তত `DISCORD_TOKEN` আর `WEBHOOK_SECRET`)।
6. **Persistent Disk** যোগ করো (Render Dashboard → Disks): mount path `/data`, এরপর env var `DATA_DIR=/data` সেট করো — নাহলে প্রতি ডিপ্লয়ে coins/mute ডেটা মুছে যাবে।
7. **Plan:** ফ্রি টিয়ার নিও না — inactivity-তে spin down হয়ে বট অফলাইন হয়ে যাবে। কমপক্ষে Starter plan ব্যবহার করো যাতে বট 24/7 চলে।
8. Deploy করার পর Render-এর দেওয়া URL-এ (`https://your-app.onrender.com/webhook`) IFTTT/Twitter webhook পয়েন্ট করো, `?secret=তোমার-WEBHOOK_SECRET` সহ।

## নতুন সার্ভারে ব্যবহার করতে চাইলে
`.env.example`-এর চ্যানেল/রোল ID ভ্যারিয়েবলগুলো তোমার নিজের সার্ভারের ID দিয়ে পূরণ করো — কোড এডিট করার দরকার নেই।
