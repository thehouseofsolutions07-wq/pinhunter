# Getting started with PinHunter

This guide gets PinHunter running on your own computer with your own accounts. Nothing is shared with anyone else: your keys stay in a file on your computer.

**You need:** a Windows, Mac or Linux computer, about 30 minutes, and free accounts at Google and Pinterest.

---

## Step 1: Install Node.js (5 minutes, once)

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version (22 or newer).
2. Run the installer and keep the default options.
3. Check that it worked: open **PowerShell** (Windows) or **Terminal** (Mac) and type:
   ```
   node --version
   ```
   You should see `v22` or higher.

PinHunter needs nothing else installed.

## Step 2: Get PinHunter (2 minutes)

**Easy way:** on the [GitHub page](https://github.com/thehouseofsolutions07-wq/pinhunter), click the green **Code** button, then **Download ZIP**. Unzip it somewhere you'll find again, such as `Documents\pinhunter`.

**With Git:**
```
git clone https://github.com/thehouseofsolutions07-wq/pinhunter.git
```

## Step 3: Try the demo first (1 minute, no accounts)

Open PowerShell or Terminal **inside the pinhunter folder**. On Windows, open the folder in File Explorer, click the address bar, type `powershell` and press Enter. Then run:

```
npm run ui:demo
```

Your browser opens the dashboard with sample products and a pretend Pinterest. Try it:

1. **Hunt**: click **Hunt now**. It finds products and writes 5 pin drafts.
2. **Drafts**: paste any image link (a `.jpg` or `.png` from the web) into a draft, click **Check**, then **Mark Ready**.
3. **Publish**: it "posts" the ready drafts and shows the pin links.

Nothing is saved or posted in the demo. Press `Ctrl+C` in the terminal to stop it.

## Step 4: Start your real dashboard

In the same folder, run:

```
npm run ui
```

The dashboard opens at `http://localhost:8085`. It only runs on your computer, so it has no password. Keep the terminal window open while you use it.

Go to **Keys & connections**. Each section has a **"Where to get these keys"** link. Fill in the sections below in order. After each one, click **Save**, then **Test connections**: a green dot means it works.

### 4a. Your AI (5 minutes, free)

1. Go to [aistudio.google.com](https://aistudio.google.com) and sign in with Google.
2. Click **Get API key → Create API key** and copy it.
3. In PinHunter, set **Provider** to `gemini` and paste the **API key**. Leave **Model** empty or use `gemini-3.5-flash-lite`.

You can use OpenAI, Grok, Claude or others instead. Pick them in the Provider list.

### 4b. Google Sheet, where your drafts go (10 minutes, free)

1. Create an empty Google Sheet. Copy its **ID**: the long part of its address between `/d/` and `/edit`.
2. Open [console.cloud.google.com](https://console.cloud.google.com), create a project, search for **Google Sheets API**, and click **Enable**.
3. Go to **IAM & Admin → Service accounts → Create service account**. Give it any name and click **Done**.
4. Open the new service account and go to **Keys → Add key → Create new key → JSON**. A `.json` file downloads.
5. In PinHunter, paste the **Sheet ID**. Then open the `.json` file in Notepad, copy everything, and paste it into the **…or paste the key JSON** box.
6. PinHunter shows the service account's email address. Click **Copy**, then in your Google Sheet click **Share**, paste that email, give it **Editor** access, and click **Send**.

### 4c. Pinterest, to post the pins (10 minutes, then wait for approval)

1. You need a Pinterest **business** account. Converting a personal account is free.
2. Go to [developers.pinterest.com/apps](https://developers.pinterest.com/apps/) and click **Connect app**. Fill in the form; for the purpose, choose posting your own pins.
3. Pinterest reviews the app (usually a few days). Until then the App secret is hidden.
4. When it's approved, open the app. Add the redirect link `http://localhost:8085/callback` and copy the **App ID** and **App secret** into PinHunter.
5. Click **Connect Pinterest**, log in, and allow access.

### 4d. Products and your commission links

Choose at least one:

- **AliExpress:** join the [AliExpress affiliate program](https://portals.aliexpress.com), create a **Tracking ID** (Account → Tracking ID), then apply for API access (Tools → API) to get an **App key** and **App secret**. API access needs an identity check and takes a few days.
- **Amazon Associates:** needs an approved Associates account with API access.
- **No API yet?** Use the **Products** tab of your Google Sheet. Paste product names, prices and your affiliate links there, and PinHunter writes pins for them.

## Step 5: Daily use

1. **Hunt**: PinHunter finds products and writes drafts. They appear in **Drafts** as *Need an image*.
2. For each draft, read the image idea, make the picture (Canva, AI image tools…), upload it somewhere public (Google Drive set to "Anyone with the link", Imgur…), and paste its link.
3. Click **Mark Ready**.
4. **Publish** posts all ready drafts to Pinterest and saves each pin's link.

Use **Settings** to choose your niches, price range, how many drafts per run, and which Pinterest board each niche goes to.

---

## Good to know

- **Your keys are private.** They're saved in a file named `.env` in the pinhunter folder. Never share that file or upload it anywhere.
- **Stopping:** press `Ctrl+C` in the terminal. Run `npm run ui` again to start.
- **Updating:** download the ZIP again (keep your old `.env` and `pinhunter.config.json`), or run `git pull` if you used Git.
- **Something red on the Overview?** Its message says what's missing. The [README](../README.md#troubleshooting) has a troubleshooting table.
- **Want it online, on your phone?** See *Put the dashboard online* in the [README](../README.md). Online, it asks for a password you choose.
