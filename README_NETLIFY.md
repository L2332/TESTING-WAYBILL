# Netlify Secure Waybill Editor

This is the Netlify-compatible secure version using Netlify Functions.

## Upload to Netlify

1. Upload the whole project to GitHub.
2. In Netlify, choose **Add new site** > **Import an existing project**.
3. Build settings:
   - Build command: leave blank
   - Publish directory: `public`
   - Functions directory: `netlify/functions`

## Environment Variables

In Netlify dashboard:
Site configuration > Environment variables > Add variable

Add:

```txt
APP_PASSWORD=your_password
SESSION_SECRET=long_random_secret
DISCORD_WEBHOOK_URL=your_discord_webhook
```

## Important

- Do not place passwords or Discord webhooks inside frontend HTML/JS files.
- The protected editor is stored in `private/editor.html`.
- If the user is not logged in, `/` and `/editor` redirect to `/login`.
- Password and Discord webhook are handled by Netlify Functions and environment variables.
- Frontend UI code can still be viewed by a logged-in browser user because browsers must download frontend code.


## Website Activity Discord System

Added:

```txt
netlify/functions/usage-alert.js
```

It sends Discord notifications when:
- a logged-in user opens the editor
- the user remains active every 5 minutes
- the user clicks APPLY
- the user clicks DOWNLOAD
- the user leaves/logs out

This uses `DISCORD_WEBHOOK_URL` from Netlify Environment Variables.


## Online Users Count

Added:

```txt
netlify/functions/online-count.js
```

The editor now shows ONLINE NOW. A user is counted online if they sent an activity ping within the last 2 minutes.

The Discord activity alert also includes:
- Online Now
- Online Users list


## Bulk Seller Address Button

Added buttons in the PDF importer:

```txt
APPLY CURRENT SELLER TO ALL
EDIT SELLER FOR ALL
```

These update seller name, seller address, city, barangay/area, province, region, and ZIP for every extracted waybill in one action.
