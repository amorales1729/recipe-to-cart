# Send recipes from your iPhone

Share a recipe from Safari (or any app) on your iPhone, and it lands in your Walmart cart flow on
your PC the next time Chrome is open. Your PC can be off when you send it: the link waits in a
small inbox in your own Google account.

```
iPhone share sheet ──> Google Apps Script inbox (a Google Sheet) ──> Chrome extension on your PC
   "Send to Recipe to Cart"     free, in your Google account          checks when Chrome starts
                                                                      and every 5 minutes
```

**It's free.** Google Apps Script and Google Sheets are free with a personal Google account. The
inbox handles a few hundred requests a day, far below Google's free limits. No paid service,
no API key.

**The cart itself still fills on your PC**, because Walmart only accepts it from your signed-in
Chrome. By default a recipe from your phone waits for you to review it (the toolbar button shows a
number). You can switch to filling the cart right away; it still never checks out.

Setup takes about 10 minutes, once.

## 1. Make the inbox (on your PC, about 5 minutes)

1. Go to [sheets.new](https://sheets.new) to make a new Google Sheet. Name it **Recipe to Cart inbox**.
2. In the sheet, click **Extensions → Apps Script**.
3. Delete everything in the `Code.gs` editor, then paste in the whole of
   [`apps-script/Code.gs`](../apps-script/Code.gs) from this repo. Click the save icon.
4. In the toolbar's function dropdown, pick **setup**, then click **Run**.
   - Google asks you to authorize. Choose your account. If it says **"Google hasn't verified this
     app"**, click **Advanced → Go to (your project) (unsafe)**. It's your own script, and it can
     only touch this one sheet.
   - The **Execution log** at the bottom shows `Your Recipe to Cart token: ...`. Copy that token.
     (Lost it? Run `setup` again; it prints the same one.)
5. Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
   - Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).

"Anyone" means anyone with the URL can reach it, but every request needs your token, so nobody
else can add or read recipes.

## 2. Connect Chrome (on your PC, 1 minute)

1. Update the extension to this version and click its reload arrow in `chrome://extensions`.
2. Right-click the **Recipe to Cart** toolbar button and choose **Options**. The page
   **Recipes from your phone** opens.
3. Paste the **Web app URL** and the **token**. Click **Test connection**; it should say
   "Connected".
4. Choose what happens when a recipe arrives: **wait for me to review it** (recommended) or
   **fill my Walmart cart right away**.
5. Click **Save**. Chrome asks to let the extension **read and change data on all websites**. Click
   **Allow**: recipes arrive as links, so the extension has to open the recipe site to read the
   ingredients. (If you say no, links still show up and you can open each one and click the
   toolbar button yourself.)

## 3. Make the shortcut (on your iPhone, about 4 minutes)

Everything here is on the iPhone. First get the **Web app URL** and **token** onto your phone
(email or text them to yourself) so you can copy and paste them.

1. Open the **Shortcuts** app, tap **+**, and name the shortcut **Send to Recipe to Cart**.
2. At the bottom, tap **Search for actions**, type `get contents`, and tap **Get Contents of URL**.
3. In that action, tap the blue word **URL** and paste your Web app URL.
4. Tap the small **›** arrow on the right of the action to show more options.
   - Change **Method** from GET to **POST**.
   - Set **Request Body** to **JSON**.
   - Tap **Add new field → Text**: key `action`, text `add`.
   - Tap **Add new field → Text**: key `token`, text your token.
   - Tap **Add new field → Text**: key `url`. Tap its empty text box, then tap **Shortcut Input**
     in the bar above the keyboard.
5. A block appears at the top: "Receive **Any** input from **Nowhere**".
   - Tap **Nowhere**, turn on **Share Sheet**, and tap **Done**.
   - Tap **Any**, leave only **URLs**, **Safari web pages** and **Text** on, and tap **Done**.

   (On some iOS versions this is instead under the **ⓘ** button or the shortcut's name →
   **Details** → **Show in Share Sheet**.)
6. Search for actions again, type `dictionary value`, and tap **Get Dictionary Value**. Tap the
   blue word **Key** and type `message`. It reads "Get Value for message in Contents of URL".
7. Search for `notification` and tap **Show Notification**. Delete "Hello World!" and tap
   **Dictionary Value** in the bar above the keyboard. The notification then says "Sent to Recipe
   to Cart", or what went wrong (for example "Couldn't send: bad token").
8. Tap **Done**.

### Optional: keep a list in Apple Notes

The shortcut can also add each recipe to a note called **Recipe to Cart**, so you
have a running list on your phone. It sends the name to the inbox too, so the Chrome page shows it
right away.

1. In **Notes**, make a new note whose first line is `Recipe to Cart`.
2. In the shortcut, search for `safari` and add **Get Details of Safari Web Page**. Change the blue
   word to **Name** so it reads "Get Name from Shortcut Input", then drag it to the top, just under
   the "Receive" block.
3. In **Get Contents of URL**, add one more **Text** field: key `title`, and for the value tap
   **Name** above the keyboard.
4. At the bottom, add a **Text** action containing
   `<ul><li><a href="` **Shortcut Input** `">` **Name** `</a></li></ul>` (tap **Shortcut Input**
   and **Name** above the keyboard). Each recipe becomes a bullet with its name as a tappable link.
5. Add **Make Rich Text from HTML**, then **Append to Note**. In Append to Note, pick
   **Recipe to Cart** as the note and **Rich Text from HTML** as the text.
6. Tap **Done**. The first time it runs, allow the shortcut to use Notes.

Shared from Safari, you get the page's title. Some apps don't share a title, and then the bullet has
no name; tap and edit it in Notes.

## Use it

On your iPhone, open a recipe in Safari (or Instagram, Pinterest, a recipe app...), tap **Share**,
and pick **Send to Recipe to Cart**. Shared text with a link in it works: the inbox takes the
first link it finds.

On your PC, whenever Chrome is open, the extension checks the inbox when Chrome starts and every
5 minutes:

- **Review mode** (default): the toolbar button shows a number. Click it (from any page that isn't
  a recipe) to open **Recipes from your phone**, tick the ones you want, and click **Shop for
  checked recipes**. That opens the usual cart list to check and add.
- **Auto mode**: the cart list opens in a background tab and adds everything by itself, then opens
  your Walmart cart. Nothing is ever purchased.

Want it now instead of within 5 minutes? Open **Recipes from your phone** and click **Check now**.

Every link stays in the Google Sheet with its status (`waiting` or `picked up`), so you have a
history and can delete old rows whenever you like.

## Changing the inbox code later

If `apps-script/Code.gs` changes, paste the new version into the Apps Script editor, then
**Deploy → Manage deployments → ✎ (edit) → Version: New version → Deploy**. The URL and token
stay the same, so nothing changes on your phone or in Chrome.

## If something goes wrong

- **Test connection says "answered 401"** (or 403): **Who has access** isn't exactly **Anyone**.
  "Anyone with a Google account" needs a sign-in the extension doesn't send. Fix it under
  **Deploy → Manage deployments → ✎ → Who has access: Anyone → Version: New version → Deploy**.
  Also check the URL ends in `/exec`, not `/dev`. To check by hand, open
  `<your URL>?action=list&token=<your token>` in an incognito window; it should show `{"ok":true,...}`.
- **Test connection says "didn't answer with data"**: the URL is wrong or "Who has access" isn't
  **Anyone**. Use the URL ending in `/exec` from **Deploy → Manage deployments**.
- **"The inbox token doesn't match"**: copy the token again from the Apps Script execution log
  (run `setup`).
- **A recipe shows "couldn't read" on the phone page**: some sites block automatic reading. Click
  **page**, then the Recipe to Cart toolbar button on that page.
- **Nothing arrives**: open the Google Sheet. If the row isn't there, the shortcut didn't send it
  (check its URL and token). If it says `waiting`, Chrome hasn't checked yet; click **Check now**.
