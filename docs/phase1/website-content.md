# Phase 1 website: pages and text to paste

This is everything needed to build the Phase 1 website on Google Sites. Each
section below is one page. Copy the text as it is, add the links, and publish.

## Page 1. Home / About

**FAZE: find your group**

FAZE Labs is a small software company started by three CS 514 students. Our
mission is to help every player find a group they actually stick with.

**The problem.** Finding people to play with is still guesswork. Reddit
threads go stale, "looking for group" channels on Discord scroll past by the
thousand, and random matchmaking gives you new strangers every match. None of
these check the three things that keep a group together: playing the same game,
being in the same region, and being free at the same times.

**What FAZE does.** You tell FAZE which games you play, your platform, your
region and when you are free each week. FAZE ranks the open groups for you with
a score out of 100 and tells you why each group was suggested. You can join a
group, see who is in it, and chat with the members.

**Why it is valuable.** Players spend less time searching and more time
playing, with people whose schedules actually match theirs.

**The team.**

| Person         | Role                                           |
| -------------- | ---------------------------------------------- |
| Bryan Djenabia | Project lead, database design, the match query |
| Alvin Hoang    | Profiles, time zones and group messaging       |
| nickayvy       | Groups, the website, demo data                 |

**Where it could go.** As a real product, FAZE could add Discord sign-in, a
mobile app, and a free tier with paid tools for gaming clubs and esports teams.

## Page 2. Overview and instructions

**Overview.** FAZE is a web app backed by a MySQL 8 database with 29 tables, 6
views, 6 stored procedures and 7 triggers, filled with 118,001 real games from
a public Steam dataset. The match score is one SQL query: 50 points for the same
game, 20 for the same region, and up to 30 for shared weekly free time.

**How to use FAZE.**

1. **Register or log in.** Create an account, or log in as the demo user
   `maya@demo.faze` with the password `DemoPass123`.
2. **Fill in your profile.** Choose your region, platform, play styles,
   favourite games and the times you are free each week, in your own time zone.
   Press **Save profile**.
3. **Browse groups.** The Groups page lists every group. Filter by game or
   region.
4. **See your matches.** The Matches page ranks open groups for you, with the
   score and the reasons.
5. **Join and chat.** Open a group, press **Join group**, and use the chat box
   to talk to the members. Press **Leave** to leave.

**How to run it on your own computer.** You need Node 20 and Docker (or MySQL
8). The full steps are in the README on GitHub; in short:

```
git clone https://github.com/BryanD17/FAZE.git
cd FAZE
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run etl:all
npm run db:seed
npm run dev
```

Then open http://localhost:5173.

Add 2 or 3 screenshots from `docs/screenshots/` (`matches.png`,
`group-detail.png` and `profile.png` work best).

## Page 3. Blog

Each team member writes **at least one paragraph in their own words** about the
project and **why it is unique**. Paste them in as three posts, each with the
writer's name as the title.

- Bryan: _[Bryan writes this]_
- Alvin: _[Alvin writes this]_
- nickayvy: _[Nick writes this]_

Ideas for what makes FAZE unique: the match score is computed by the database
itself, not by app code; it compares free time across time zones fairly; the
last seat in a group can never be taken twice, even when people press Join at
the same moment; and it runs on a real catalog of 118,001 games.

## Page 4. Source code and executable

- **GitHub repository:** https://github.com/BryanD17/FAZE
- **Run it:** the steps on page 2 (there is no hosted copy yet; a one-page
  demo guide is planned for Phase 2).
- **Summary of original code beyond AI assistance:** _[the team writes this
  together. It must be accurate: say what each person designed and wrote
  themselves, and where AI tools helped.]_

## Page 5. Presentation

Embed or link the slide deck (Bryan will share it as Google Slides or a PDF).

## Page 6. Product document

Link the PDF:
https://github.com/BryanD17/FAZE/blob/main/docs/phase1/FAZE-Product-Document.pdf

## Not on the website

Peer evaluations go in the comments of each person's own Canvas submission.
