# Phase 2 plan

**Due: Monday 7 December, 11:59 pm.** Phase 1 was handed in on 19 October. This
page is the whole plan for the final hand-in: what we build, who does it, and
by when. Each line links to its GitHub issue, which has the step-by-step
details.

The rules from [`SCOPE.md`](SCOPE.md) still apply: keep it small, solid and
easy to demo. Anything not on this page needs Bryan's OK first.

## Key dates

| Date          | What has to be true                                                               |
| ------------- | --------------------------------------------------------------------------------- |
| Tue 1 Dec     | **Feature freeze.** Every feature PR below is merged. After this, only bug fixes. |
| Wed 2 Dec     | Experiment results are in [`experiments.md`](experiments.md) (Bryan and Alvin).   |
| Thu 3 Dec     | Final screenshots retaken with the new look (nickayvy).                           |
| Fri 4 Dec     | Draft of the final document and the deck shared with the team.                    |
| Sun 6 Dec     | Everyone runs the full demo on the live site and reports anything broken.         |
| **Mon 7 Dec** | **Hand-in:** document, deck, demo video, website link, peer evaluations.          |

## Who does what

### Bryan: experiments, the final report and the hand-in

| Issue | Task                                                                                            | Size       |
| ----- | ----------------------------------------------------------------------------------------------- | ---------- |
| #55   | Baselines (flat table, scoring in app code, `COUNT(*)`) and the scaling experiment, with charts | 1 day      |
| #56   | Literature review and error analysis                                                            | half a day |
| #57   | Final product document, presentation, backup demo video, website update, repo housekeeping      | 1.5 days   |

### Alvin: new backend features and the concurrency experiment

| Issue | Task                                                     | Size       |
| ----- | -------------------------------------------------------- | ---------- |
| #48   | Play sessions and ratings: API, screens and tests        | 1 day      |
| #49   | The group owner can edit or close a group                | 2 hours    |
| #50   | Concurrency experiment: 50 to 200 people joining at once | half a day |
| #51   | Database stats page (the API already exists)             | 2 hours    |
| #32   | One demo environment guide (`docs/deployment.md`)        | 3 hours    |

### nickayvy: frontend, look and quality

| Issue | Task                                                                          | Size       |
| ----- | ----------------------------------------------------------------------------- | ---------- |
| #52   | Score breakdown on match cards, loading, empty and error states, phone layout | half a day |
| #53   | Visual weekly availability grid on the profile                                | 1 day      |
| #54   | Make the app match the FAZE look (colours, fonts, logo), retake screenshots   | half a day |
| #19   | About 15 key tests, `docs/security.md`, finish `docs/data.md`                 | 7 hours    |
| #43   | Finish the live site: full test on Vercel, demo data on Aiven, link it        | 2 hours    |

### Everyone

- One paragraph each for the final blog, in your own words.
- Your own peer evaluations, in the comments of your own Canvas submission.
- Run the full demo on the live site on Sun 6 Dec.

## What the final report will contain

1. Overview, the problem and the company (from Phase 1)
2. Database design: ER diagram, normalisation, the one deliberate exception
3. Implementation: key SQL, stored procedures, triggers, transactions
4. **New:** literature review
5. **New:** baselines compared with our design
6. **New:** experiments: scaling, concurrency, with charts
7. **New:** error analysis: where the design is weak and how we would fix it
8. Security and testing
9. User guide with the new screens
10. Who did what, limitations and lessons learned

## Optional extras (only after the feature freeze is met)

Not planned. Ask Bryan before starting any of these.

- Match filters by game or platform
- Paging for the groups list and chat history
- One consistent error format for every route
- A scheduled ping so the free Render API does not sleep
- Game search suggestions while typing
- Chat polish: scroll to newest, Enter to send, timestamps
- Toast messages, accessibility pass, a better landing page
- One Playwright browser test in CI, a Lighthouse audit

## Not doing

Real-time sockets for chat, email verification and password reset, join
approvals and moderator roles, error monitoring services, a mobile app,
learned match weights, Docker or Kubernetes hosting.

## How we work (unchanged)

One task, one branch, one pull request into `main`, with real proof in the PR
(test output or a screenshot). nickayvy may merge his own PRs once both CI
checks are green; everyone else waits for Bryan.
