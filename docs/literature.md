# Literature review

How other systems put players together, and where FAZE fits.

## 1. Skill-based matchmaking

Most online games match players by **skill**. The Elo system [1], first built
for chess, gives each player a number that rises after a win and falls after a
loss, and pairs players with similar numbers. Microsoft's TrueSkill [2] extends
the idea to teams and to games with more than two players, and keeps an
uncertainty value per player so that new players settle faster; TrueSkill 2 [3]
adds signals such as quitting and per-player performance. These systems answer
"who is a fair opponent right now?" for one match. They do not try to build a
group that keeps playing together, and they ignore when people are free.

## 2. What players experience

Véron, Marin and Monnet [4] studied traces of real matchmaking in an online game
and found that waiting time and the quality of the match pull against each
other: the stricter the matching rules, the longer players wait. Their work
supports keeping FAZE's rule simple and explainable, and ranking groups instead
of refusing to show any until a perfect match exists.

## 3. Looking-for-group tools

Discord servers, Steam groups and "LFG" forums let people post and browse, but
the matching is done by the reader, by scrolling. They store the facts FAZE
uses (game, region, play times) as free text in a post, so the facts cannot be
queried, compared or ranked.

## 4. The database side

FAZE is a relational design in the sense of Codd [5]: the facts about people,
games, groups and schedules live in separate tables joined by keys, normalised
so each fact is stored once [6]. Weekly free time is stored as intervals
(UTC minutes since midnight), and "do two people overlap?" is the interval
overlap test from Allen's interval algebra [7]: two intervals overlap when each
starts before the other ends.

## How FAZE differs

- **What it matches on.** FAZE matches on shared free time, region and game,
  not skill. It answers "who could I keep playing with?", which skill systems
  do not try to answer.
- **Where the matching happens.** The score is one SQL query over normalised
  tables. Section "Baselines" in [`experiments.md`](experiments.md) shows the
  same ranking computed in application code needs every member's schedule sent
  out of the database first.
- **What it gives up.** FAZE has no notion of skill, and its weights are fixed
  rather than learned. A real product would combine both: FAZE's schedule and
  region score to form groups, and a skill rating to balance them.

## References

1. A. E. Elo. _The Rating of Chessplayers, Past and Present._ Arco, 1978.
2. R. Herbrich, T. Minka and T. Graepel. "TrueSkill: A Bayesian Skill Rating
   System." _Advances in Neural Information Processing Systems 19 (NIPS 2006)_, 2007.
3. T. Minka, R. Cleven and Y. Zaykov. "TrueSkill 2: An improved Bayesian skill
   rating system." Microsoft Research Technical Report MSR-TR-2018-8, 2018.
4. M. Véron, O. Marin and S. Monnet. "Matchmaking in multi-player on-line games:
   studying user traces to improve the user experience." _Proceedings of ACM
   NOSSDAV_, 2014.
5. E. F. Codd. "A Relational Model of Data for Large Shared Data Banks."
   _Communications of the ACM_ 13(6), 1970.
6. W. Kent. "A Simple Guide to Five Normal Forms in Relational Database Theory."
   _Communications of the ACM_ 26(2), 1983.
7. J. F. Allen. "Maintaining Knowledge about Temporal Intervals."
   _Communications of the ACM_ 26(11), 1983.
