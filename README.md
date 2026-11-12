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
2. Copy this message into the chat and press Enter:

   ```
   Please install the Pathways plugin by running: "$CLAUDE_CODE_EXECPATH" plugin install pathways --marketplace Parallel-intelligence/pathways-plugin
   If it fails because git or Apple's developer tools are missing, run xcode-select --install, tell me to click Install in the window that opens, and run the install again when I say it's done. If it fails for any other reason, stop and show me the error. Don't install it another way.
   ```

3. When Claude asks to run the command, check that it names `Parallel-intelligence/pathways-plugin`, then choose **Allow** (once, not "always"). If a window asks to install "command line developer tools", click **Install**, wait for it to finish (it can take 10 minutes), then tell Claude it's done.
4. When Claude says the plugin is installed, start a new Code chat.

The Claude app has no button for adding a plugin from outside its own list, so Claude runs the installer for you. You don't need a GitHub account.

## Start Pathways (each time)

1. Type `/pathways` and press Enter.
2. The first time, it sets itself up, which takes a minute or two. If Claude asks to run the Pathways set-up, choose **Allow**.
3. Pathways opens beside the chat, and your browser opens Cloudflare's sign-in page. Enter your email, then the code emailed to you, then the code from your authenticator app. The first time, Cloudflare walks you through adding Pathways to your authenticator.
4. Once you're signed in, the client's name appears at the top and you can start. When your sign-in expires, Pathways asks you to sign in again.

## Working in it

- **Documents > Fetch latest** downloads the current documents.
- Add any new documents, then press **Analyse and extract**. Check the map preview.
- Press **Publish** when it's ready. Publishing puts the version on the team's staging portal, and asks you to confirm first. Once it's been checked there, an admin presses **Promote** in History to send it to the client's site.
- Only one person can edit at a time. Pathways tells you if someone else is editing.

## Keeping the data safe

- The documents download to the **Pathways** folder in your Downloads. Don't copy them anywhere else, and don't paste them into other chats.
- After you've published, delete that Pathways folder.
- When you're done for the day, type "stop Pathways" in the chat.

## Updating

When your Pathways contact says there's a new version, copy this message into a Code chat and press Enter. Choose **Allow** (once, not "always") when Claude asks, then start a new chat.

```
Please update the Pathways plugin by running: "$CLAUDE_CODE_EXECPATH" plugin marketplace update pathways && "$CLAUDE_CODE_EXECPATH" plugin update pathways@pathways
If it fails, stop and show me the error.
```

The next time you type `/pathways`, it switches to the new version by itself, unless the running one is in the middle of something.

## About this repo

This repo holds only the built Pathways plugin: the method and the code. It holds no client data. The documents and everything made from them are kept in Cloudflare and shown only to people who've been invited and have signed in. Each release is copied from a reviewed commit of the team's private repo.
