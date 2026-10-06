# How matching works

`GET /api/matches` returns the groups a person is most likely to enjoy, best
first. The ranking is **one SQL query**, in
[`server/src/repositories/match.repo.ts`](../server/src/repositories/match.repo.ts).
Node only passes in the user id and reshapes the rows.

## The score (out of 100)

| Part                | Points   | Rule                                                                                                                                                 |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same game           | 50       | The group's game is in the person's game list.                                                                                                       |
| Same region         | 20       | The group's region equals the person's region.                                                                                                       |
| Shared availability | up to 30 | Average weekly hours the person is free at the same time as one member of the group. 10 hours or more earns all 30; less earns a proportional share. |

Groups that score 0 are not returned. A group is only offered if it is **open
to join, still has a free seat, and the person is not already in it**.
Ties go to the most recently active group.

## Why availability uses the members

A group has no schedule of its own, so we use its members' schedules. For every
active member we add up the minutes where one of the person's weekly slots
overlaps one of that member's slots, then divide by the number of members. The
result is "on average, how many hours a week could I play with one member?".

Slots are stored as **UTC minutes since midnight** (see `docs/schema.md` §5.1),
so two slots on the same day overlap when each starts before the other ends,
and the overlap is `LEAST(end, end) − GREATEST(start, start)`. No time-zone
maths is needed in the query.

## A worked example

Me: EU-West, owns game A, free all day Monday (UTC).

| Group      | Game | Region  | Owner free      | Calculation                  | Score  |
| ---------- | ---- | ------- | --------------- | ---------------------------- | ------ |
| capped     | A    | APAC    | Mon 00:00–12:00 | 50 + 0 + min(30, 30 × 12/10) | **80** |
| both       | A    | EU-West | Mon 18:00–20:00 | 50 + 20 + 30 × 2/10          | **76** |
| gameOnly   | A    | APAC    | —               | 50 + 0 + 0                   | **50** |
| regionOnly | B    | EU-West | —               | 0 + 20 + 0                   | **20** |

These are exactly the groups and numbers asserted in
[`server/tests/match.test.ts`](../server/tests/match.test.ts). The same test
checks that a full group, an invite-only group, a group the person already
belongs to, and a group with nothing in common are all left out.

## The reply

```json
{
  "matches": [
    {
      "groupId": 21,
      "title": "both",
      "gameId": 7,
      "gameTitle": "Example Game",
      "gameCoverUrl": null,
      "regionCode": "EU-West",
      "ownerDisplayName": "match-both",
      "memberCount": 1,
      "maxMembers": 5,
      "openSlots": 4,
      "platforms": ["pc"],
      "score": 76,
      "sameGame": true,
      "sameRegion": true,
      "overlapHours": 2
    }
  ]
}
```

`sameGame`, `sameRegion` and `overlapHours` are the three parts of the score, so
a screen can say _why_ ("Same game, same region, 2 h in common").
`gameCoverUrl` is usually `null` because we do not load cover art.

At most 20 groups are returned.

## What it does not do

No explain endpoint, no adjustable weights, no extra filters, and it does not
check a group's age, microphone or rank limits — `sp_join_group` still enforces
those when the person actually joins. These were cut on purpose; see
[`SCOPE.md`](SCOPE.md).
