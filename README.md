# Pathways

Pathways runs on your Mac, inside the Claude desktop app. Setting it up takes about 15 minutes, once.

## Before you start

1. **A Mac with FileVault on:** System Settings > Privacy & Security > FileVault.
2. **The Claude desktop app**, from [claude.ai/download](https://claude.ai/download), signed in to your Claude plan (Pro or Max).
3. **In Claude, Settings > Privacy:** turn off "Help improve Claude".
4. **An authenticator app on your phone**, for example Google Authenticator or Microsoft Authenticator.
5. **An invitation:** your Pathways contact adds your email address first. Sign in with that address.

## Install (once)

1. Open the Claude app and click **Code**. When it asks for a folder, choose any one, for example Documents.
2. Type this and press Enter:

   ```
   /plugin marketplace add Parallel-intelligence/pathways-plugin
   ```

   If your Mac asks to install "command line developer tools", click **Install** and wait for it to finish (it can take 10 minutes). Then type the line again.
3. Type this and press Enter:

   ```
   /plugin install pathways@pathways
   ```

4. Start a new Code chat.

## Start Pathways (each time)

1. Type `/pathways` and press Enter.
2. The first time, it sets itself up, which takes a minute or two. If Claude asks to run the Pathways set-up, choose **Allow**.
3. Pathways opens beside the chat, and your browser opens Cloudflare's sign-in page. Enter your email, then the code emailed to you, then the code from your authenticator app. The first time, Cloudflare walks you through adding Pathways to your authenticator.
4. Once you're signed in, the client's name appears at the top and you can start. When your sign-in expires, Pathways asks you to sign in again.

## Working in it

- **Documents > Fetch latest** downloads the current documents.
- Add any new documents, then press **Analyse and extract**. Check the map preview.
- Press **Publish** when it's ready. Publishing goes straight to the client's site, so it asks you to confirm first.
- Only one person can edit at a time. Pathways tells you if someone else is editing.

## Keeping the data safe

- The documents download to the **Pathways** folder in your Downloads. Don't copy them anywhere else, and don't paste them into other chats.
- After you've published, delete that Pathways folder.
- When you're done for the day, type "stop Pathways" in the chat.

## Updating

When your Pathways contact says there's a new version, type these one at a time in a Code chat, then start a new chat:

```
/plugin marketplace update pathways
/plugin update pathways@pathways
```

## About this repo

This repo holds only the built Pathways plugin: the method and the code. It holds no client data. The documents and everything made from them are kept in Cloudflare and shown only to people who've been invited and have signed in. Each release is copied from a reviewed commit of the team's private repo.
