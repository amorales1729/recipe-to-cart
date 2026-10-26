# Hands-off: from your phone to a full Walmart cart

Share a recipe on your iPhone and walk away. Within seconds your PC picks it up, finds the
cheapest Walmart items, puts everything in your cart, and your phone tells you the cart is ready.
**Checkout stays yours:** the extension never opens a checkout or payment page.

```
iPhone share sheet ──> Google inbox ──ping──> ntfy.sh ──> Chrome on your PC ──> Walmart cart
                                                          (asleep is fine)          │
iPhone ntfy app  <──────────── "Your Walmart cart is ready" <─────────────────────────┘
```

**Still free.** ntfy.sh is a free, open-source push service with no account. Your inbox sends
it a ping that says only "new recipe"; the recipe itself still goes from your Google Sheet straight
to Chrome. The channel name is a long random code made by the extension, and it works like a
password. If a ping ever goes missing, the regular 5-minute check still finds the recipe.

You need the iPhone inbox set up first ([iphone-shortcut.md](iphone-shortcut.md)). Then, once:

## 1. Update the inbox code (5 minutes)

1. Paste the latest [`apps-script/Code.gs`](../apps-script/Code.gs) into the Apps Script editor and save.
2. Pick **setup** in the function dropdown and click **Run**. Google asks you to authorize again,
   because the inbox can now send the ping (it says it wants to "connect to an external service").
3. **Deploy → Manage deployments → ✎ (edit) → Version: New version → Deploy.** The URL and token
   stay the same.

## 2. Turn it on in Chrome (1 minute)

1. Reload Recipe to Cart in `chrome://extensions` after updating it.
2. Open **Settings** (the gear). Under **When a recipe arrives**, choose **Fill my Walmart cart
   right away**.
3. Tick **Pick up recipes instantly and send alerts to my phone**, then click **Save**. It should
   say "picked up the moment you send them".
4. Copy the **channel** name shown under the tick box. You'll need it on your phone next.

## 3. Get alerts on your iPhone (2 minutes)

1. Install the free **ntfy** app from the App Store.
2. Tap **+**, paste the channel name (it ends in `-alerts`), leave the server as ntfy.sh, and tap
   **Subscribe**. Allow notifications.
3. Back in Chrome Settings, click **Send a test alert**. It shows up on your phone in a few seconds.

You'll get a note when:

- **The cart is ready**: how many items went in, the rough total, and anything that couldn't be
  added or found. Tap it to open your Walmart cart and check out.
- **Walmart needs you**: Walmart's "are you human" check came up. Finish it at your PC; the
  cart carries on by itself once it clears.
- **A recipe couldn't be read**: it's waiting on the Recipes page in Chrome.

## 4. Let Chrome work while you're away

Chrome has to be running for the cart to fill, but no window needs to be open.

1. In Chrome, go to **Settings → System** and turn on **Continue running background apps when
   Google Chrome is closed**. Closing the window then leaves Chrome running quietly, and it
   starts by itself when you sign in to Windows.
2. **Sleep is fine. Shutting down or signing out isn't.** While the PC sleeps, your Windows
   session and Chrome wait where they were. A recipe sent while it's asleep waits safely in
   your Google Sheet.

### Keep the PC awake, or wake it on a timer

Pick one:

- **Simplest: never sleep while plugged in.** Windows **Settings → System → Power** (on some
  versions **Power & battery → Screen and sleep**): set the sleep time when plugged in to
  **Never**. The screen can still turn off. Recipes land in the cart within seconds.
- **Let it sleep and wake it every hour.** It wakes behind the lock screen with the screen off,
  checks for recipes, fills the cart if there are any, and goes back to sleep. Your PIN isn't
  needed and isn't bypassed: you're still signed in, just locked. A recipe sent at 2:10 lands in
  the cart by about 3:00.

To set up the hourly wake, open **PowerShell** (not as administrator) and paste this:

```powershell
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c exit"
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "Recipe to Cart wake" -Action $action -Trigger $trigger -Settings $settings
```

The task itself does nothing. It's only there to wake the PC. Then make sure Windows allows it:
**Control Panel → Power Options → Change plan settings → Change advanced power settings → Sleep →
Allow wake timers → Enable**. Change `-Hours 1` to `-Minutes 30` to check more often. To remove it
later: `Unregister-ScheduledTask -TaskName "Recipe to Cart wake"`.

A PC woken by a timer goes back to sleep after a couple of quiet minutes. The extension keeps it
awake while it's reading recipes or filling the cart, then lets it sleep.

### After a Windows Update restart

A restart signs you out, and Chrome won't run until you sign in again. To have Windows sign you
back in (and lock the screen) by itself after an update: **Settings → Accounts → Sign-in options**,
turn on **Use my sign-in info to automatically finish setting up after an update**.

## If something goes wrong

- **Settings says "Instant pickup isn't on yet"**: the inbox is still running the old code. Do
  step 1 again, including **New version**.
- **No alerts on the phone**: check the channel in the ntfy app matches the one in Settings, and
  that the app may send notifications. **Send a test alert** tells you if ntfy.sh can be reached.
- **The cart only fills when I open Chrome**: turn on the background setting in step 4, and check
  the PC isn't shut down or signed out.
- **Someone else might know the channel name**: click **Make a new channel**, Save, and
  subscribe to the new name in the ntfy app.
