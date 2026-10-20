# Hosting FAZE online

This page explains how the hosted copy of FAZE is put together and who does
which step. It uses three free services:

| Part         | Service | Who owns it            | Settings file |
| ------------ | ------- | ---------------------- | ------------- |
| Database     | Aiven   | nickayvy               | none          |
| API (server) | Render  | Bryan (the repo owner) | `render.yaml` |
| Website      | Vercel  | nickayvy               | `vercel.json` |

The website and the API must appear at **one address** (the Vercel one).
Vercel forwards every `/api/...` request to Render. That way the login cookie
works, because the browser only ever talks to one site.

```
Browser  ->  Vercel (website, and /api/* forwarded)  ->  Render (API)  ->  Aiven (MySQL)
```

**Never put a password or certificate in GitHub.** Secrets are typed into the
Render dashboard only, and shared between us by direct message.

## Part 1. Bryan: create the Render service

Only the owner of the GitHub repository can connect it to Render, so Bryan does
this part once.

1. Go to <https://render.com> and click **Get Started**. Sign up with
   **GitHub**, using the BryanD17 account.
2. When GitHub asks which repositories Render may see, choose **Only select
   repositories**, pick **FAZE**, and click **Install**.
3. In the Render dashboard click **New +**, then **Blueprint**.
4. Pick the **FAZE** repository and the **main** branch. Render reads
   `render.yaml` and shows one service called **faze-api** on the free plan.
5. Render asks for two values that are not in the file. Get them from Nick
   by direct message:

   | Setting       | What to paste                                                                                                                            |
   | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
   | `DB_PASSWORD` | The Aiven `avnadmin` password                                                                                                            |
   | `DB_SSL_CA`   | The Aiven **CA certificate**, the whole text from `-----BEGIN CERTIFICATE-----` to `-----END CERTIFICATE-----`, without quotes around it |

   `CLIENT_ORIGIN` (`https://faze-alpha.vercel.app`) and `TRUST_PROXY` (`2`)
   are already set in `render.yaml`.

6. Click **Apply**. The first build takes a few minutes. Watch it under the
   service's **Logs** tab until it says `FAZE API listening`.
7. Copy the service address shown at the top of the page, for example
   `https://faze-api.onrender.com`. Open that address followed by
   `/api/health` in a browser. You should see `{"ok":true,"db":"up"}`.
8. Send Nick the service address. He needs it for the Vercel step.
9. Optional: if Render offers it under **Workspace Settings > Members**,
   invite Nick, so he can read the logs himself.

**Good to know about the free plan.** The API goes to sleep after about 15
minutes without visitors, and the first visit after that takes about a minute
to wake it up. Open the site a couple of minutes before a demo or presentation.

## Part 2. nickayvy: connect the website to the API

1. Add the forwarding rule to `vercel.json`, **above** the existing rule, with
   the address Bryan sent:

   ```json
   "rewrites": [
     { "source": "/api/:path*", "destination": "https://faze-api.onrender.com/api/:path*" },
     { "source": "/((?!api/).*)", "destination": "/index.html" }
   ]
   ```

2. Open a pull request, and redeploy on Vercel once it is merged.
3. `CLIENT_ORIGIN` and `TRUST_PROXY` come from `render.yaml`. To check
   `TRUST_PROXY=2`, two people on different networks should each be able to
   register without hitting "Too many requests" from the other's attempts. If
   they do block each other, try `3` under **Environment** on Render.
4. Test the whole flow on the live site (see the GitHub issue for the list).

## Part 3. If something goes wrong

| What you see                                 | Most likely cause                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `/api/health` shows `"db":"down"`            | Wrong `DB_PASSWORD` or `DB_SSL_CA`, or the Aiven service is powered off   |
| The build fails on Render                    | Read the Logs tab; the first red line names the problem                   |
| Login works but you are logged out on reload | The `/api` forwarding rule is missing, so the cookie goes to another site |
| "Too many requests" after a few sign-ups     | `TRUST_PROXY` is not set yet (Part 2, step 4)                             |
| The first page load takes about a minute     | Normal on the free plan; the API was asleep                               |
