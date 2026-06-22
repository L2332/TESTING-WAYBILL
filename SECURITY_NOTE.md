# SECURITY IMPORTANT

Frontend secrets were removed from `private/editor.html`.

Use Netlify Environment Variables only:

```txt
APP_PASSWORD=your_new_password
SESSION_SECRET=long_random_secret
DISCORD_WEBHOOK_URL=your_new_discord_webhook
```

IMPORTANT:
The old Discord webhook and old password were already exposed in browser Inspect.
You must rotate/change them:
1. Delete the old Discord webhook in Discord.
2. Create a new webhook.
3. Put the new webhook in Netlify environment variable `DISCORD_WEBHOOK_URL`.
4. Change `APP_PASSWORD` in Netlify.
5. Redeploy site.

Do not put password or webhook inside HTML/JS frontend files.
