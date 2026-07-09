# Thoth 🐒

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

- 🟢 **Static** — no login required; copy and run it as-is.
- 🟡 **Session-bound** — needs a token or cookie that Thoth watched get created
  earlier in the session. Reproducible, but it will expire.
- 🔴 **Blocked** — needs a token whose origin Thoth never saw (it was set before you
  started recording, or generated inside the page). You'd need to capture the step
  that creates it.

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

- Very large or binary responses (file downloads, images) aren't analyzed.
- If the page scrambled a token (hashed or re-signed it) before using it, Thoth
  honestly reports the origin as *not observed* instead of guessing.

---

*Developers: the architecture and design decisions live in [`PLAN.md`](PLAN.md).*
