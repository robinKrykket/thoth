<img width="1024" height="1024" alt="thoth_vec" src="https://github.com/user-attachments/assets/ae93d5af-1454-40ee-b6b4-2f7f1d8c3396" />

# Thoth 🐒 - Traffic Harvesting & Observation Toolkit for HTTP

**See what a website does behind the scenes.** Thoth records the network traffic
while you click around a site, then gives you a clear report of the API calls it
made — what each request needed, where its login tokens came from, and ready-to-run
code to reproduce the call yourself (curl, Python, Julia, or a `.http` file).

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose this folder.
4. Pin **Thoth** (the baboon) from the toolbar's puzzle-piece menu.

No account, no setup, no build step.

## Record a session

1. Go to the page you want to inspect, and sign in if you need to.
2. Click the **Thoth** icon → **Record**. Chrome shows a banner saying an extension
   is debugging the tab — that's expected; leave it up.
3. Do the actions you want to capture (click a button, save a form, load a list…).
4. Click the icon again → **Stop & generate report**. The report opens in a new tab.

> You can't record a tab that already has DevTools (F12) open — close it first.

## Read the report

Each API call shows its method, URL, the headers it used, its request body, and a
**replayability** light:

- 🟢 **Static** — succeeded and needs no login; copy and run it as-is.
- 🟡 **Session-bound** — succeeded, but it sends a token or cookie. The captured
  values let you replay it now; they expire (and if Thoth didn't see where a token
  came from, you can't regenerate it without re-recording).
- 🔴 **Failed** — the request itself didn't succeed (a network error or an HTTP
  4xx/5xx response). Replaying it as-is reproduces the same failure.

An **Authentication & tokens** section traces each token back to where it came from.

## Reproduce a call

Under every call, click **curl**, **Python**, **Julia**, or **.http** to copy a
ready-to-run snippet, then paste it into your terminal, a script, or a REST client.

> ⚠️ **Running a snippet fires the real request.** If a call creates or changes data
> (like submitting a form), running the snippet really does that — and running it
> twice does it twice. Thoth itself never re-sends a captured request; that only
> happens when *you* run a snippet. Check the request body and the replayability
> light before running anything that writes data.

## Save a report

Click **Export .md + .json** to save the report and its raw data to
`Downloads/Thoth/`, then **Show in folder** to open it.

> Reports contain **live tokens and cookies** — treat the files like passwords.

## Optional: AI summary

Click **✨ Summarize** for a plain-English walkthrough of the authentication flow.
Pick the engine in **⚙ Settings**:

- **On-device (default, fully private)** — uses Chrome's built-in AI; nothing leaves
  your computer. If the button says *unavailable*, turn it on:
  set `chrome://flags/#prompt-api-for-gemini-nano` to **Enabled** and
  `chrome://flags/#optimization-guide-on-device-model` to **Enabled
  BypassPerfRequirement**, then restart Chrome (a one-time model download follows).
- **Claude** — higher quality. Paste an Anthropic API key in Settings and choose a
  model. Only a **redacted** summary is sent — token *names* and where they came
  from, never the token *values*.

## Your data stays with you

- Recordings live in the browser's local storage and never leave your machine.
- The full, accurate report works with no internet and no AI at all.
- The only time Thoth sends anything out is if you switch the summary to **Claude** —
  and then only the redacted digest goes to Anthropic.

## Good to know

- The traffic light judges success by HTTP status. A server can still return
  **200 with an error in the body** (a failed login often re-renders the page at
  200), so a 🟢/🟡 call isn't a guarantee the action worked — check the response.
- A successful POST often shows status **302** — that's the normal redirect to a
  success page, not an error.
- Very large or binary responses (file downloads, images) aren't analyzed.
- If the page scrambled a token (hashed or re-signed it) before using it, Thoth
  honestly reports the origin as *not observed* instead of guessing.

---

*Developers: the architecture and design decisions live in [`PLAN.md`](PLAN.md).*

<img width="1803" height="1200" alt="94pwblzk4caf1" src="https://github.com/user-attachments/assets/82fbfa24-a769-4cc3-bc23-7ac2522900af" />
