# Demo

How to fill the database with demo data and walk through FAZE in about five
minutes.

## Set up

From an empty database:

```bash
npm run db:migrate
npm run etl:all     # the game catalog; the demo groups use real games from it
npm run db:seed     # 40 users, 15 groups, 200 messages
npm run dev         # API on :4000, website on http://localhost:5173
```

`db:seed` is safe to run again at any time. It deletes every `@demo.faze`
account (and the groups and messages those accounts own) and inserts them
fresh, so it also resets the demo after a walkthrough. The last lines it
prints are the counts:

```
users:       40
groups:      15 (1 full)
members:     51
messages:    200
drift rows:  0 (must be 0)
```

## Logins

Every demo user is `<first name>@demo.faze`, and they all share one password:
**`DemoPass123`**.

| Login              | Who                                                                      |
| ------------------ | ------------------------------------------------------------------------ |
| `maya@demo.faze`   | Main demo user. EU-West, PC; plays CS2, HELLDIVERS 2, Deep Rock Galactic |
| `jordan@demo.faze` | Second account. NA-East; member of the Helldivers 2 group                |

Other examples: `oliver@demo.faze`, `freya@demo.faze`, `kai@demo.faze`,
`gabriel@demo.faze`.

## Five-step click-through

1. **Log in.** Open <http://localhost:5173/login> and sign in as
   `maya@demo.faze` / `DemoPass123`. You land on the profile page.
2. **Open the profile.** Maya's region (Europe West), platform (PC), play
   styles, three favourite games and her weekly evening availability are
   filled in. Change nothing, or edit a field and press **Save profile**.
3. **See matches.** Click **Matches**. The two EU-West groups for her games are
   at the top: _CS2 Premier evenings, chill comms_ (100 / 100) and
   _Helldivers 2 evening drops (Diff 7+)_ (94 / 100). The full CS2 group and
   her own Deep Rock Galactic group are not offered.
   - To show the full state: click **Groups** and open
     _CS2 Premier squad (full for now)_. It shows 4 / 4 and a disabled
     **Group full** button.
4. **Join a group.** Open _Helldivers 2 evening drops (Diff 7+)_ and press
   **Join group**. Maya appears in the member list and the count goes from
   4 / 6 to 5 / 6.
5. **Send a message.** The chat box appears below the members with the
   group's recent messages. Type a message and press **Send**. To show it
   reaching someone else, log in as `jordan@demo.faze` in a private window
   and open the same group; the message appears within five seconds.

Run `npm run db:seed` afterwards to put everything back.
