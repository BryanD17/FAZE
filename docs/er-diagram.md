# ER diagram

FAZE has **24 tables**. They are drawn below in two pictures so each one stays
readable, and the remaining housekeeping tables are listed after them. Every
box and line comes from the real database (`information_schema`), and the full
column list for every table is in [`schema.md`](schema.md).

**How to read the lines.** A line is a foreign key. The symbol at each end says
how many rows can sit on that side: `||` exactly one, `o|` zero or one,
`}o` zero or many. So `user ||--o{ lfg_group` reads "one user owns zero or many
groups".

## 1. People, profiles and games

A person has one profile, a weekly availability, and links to the platforms,
play-style tags and games they play. Tables ending in `_platform`, `_tag`,
`_game` or `_genre` are **join tables**: they turn a many-to-many relationship
(a person plays many games, a game is played by many people) into two
one-to-many ones.

![People, profiles and games](img/er-people.png)

```mermaid
erDiagram
    user ||--|| profile : "has one"
    region |o--o{ profile : "lives in"
    language |o--o{ profile : speaks
    user ||--o{ availability_slot : "is free at"
    user ||--o{ user_platform : "plays on"
    platform ||--o{ user_platform : ""
    user ||--o{ user_tag : "describes self with"
    playstyle_tag ||--o{ user_tag : ""
    user ||--o{ user_game : owns
    game ||--o{ user_game : ""
    game ||--o{ game_genre : ""
    genre ||--o{ game_genre : ""
    game ||--o{ game_platform : "runs on"
    platform ||--o{ game_platform : ""

    user {
        int user_id PK
        string email UK
        string password_hash
        enum status
    }
    profile {
        int user_id PK, FK
        string display_name UK
        int region_id FK
        int language_id FK
        string timezone
    }
    availability_slot {
        int slot_id PK
        int user_id FK
        int day_of_week
        int start_minute "UTC"
        int end_minute "UTC"
    }
    user_game {
        int user_id PK, FK
        int game_id PK, FK
        int rank_tier
        enum goal
        bool is_primary
    }
    game {
        int game_id PK
        string title
        string slug UK
        bool is_multiplayer
    }
```

## 2. Groups and what happens in them

A group is created for one game and owned by one user. People belong to it
through `group_member`, talk in it through `message`, schedule a `play_session`,
and can rate each other afterwards.

![Groups, members, messages, sessions and ratings](img/er-groups.png)

```mermaid
erDiagram
    user ||--o{ lfg_group : owns
    game ||--o{ lfg_group : "is played in"
    region |o--o{ lfg_group : "based in"
    language |o--o{ lfg_group : "spoken in"
    lfg_group ||--o{ group_platform : "plays on"
    platform ||--o{ group_platform : ""
    lfg_group ||--o{ group_member : has
    user ||--o{ group_member : "joins as"
    lfg_group ||--o{ message : contains
    user ||--o{ message : writes
    lfg_group ||--o{ play_session : schedules
    play_session ||--o{ rating : "is rated by"
    user ||--o{ rating : "gives and receives"

    lfg_group {
        int group_id PK
        int owner_user_id FK
        int game_id FK
        int region_id FK
        string title
        enum visibility
        enum status
        int max_members
        int member_count "kept by triggers"
    }
    group_member {
        int group_id PK, FK
        int user_id PK, FK
        enum role
        enum state
    }
    message {
        int message_id PK
        int group_id FK
        int user_id FK
        string body
    }
    play_session {
        int session_id PK
        int group_id FK
        datetime starts_at
    }
    rating {
        int session_id PK, FK
        int rater_user_id PK, FK
        int ratee_user_id PK, FK
        int score
    }
```

## Tables not drawn

| Table                                                   | What it is for                                                                                        |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `region_adjacency`                                      | Which regions border each other (region to region).                                                   |
| `join_request`, `report`                                | Join approvals and user reports. Built, but not part of the demo (see [`SCOPE.md`](SCOPE.md)).        |
| `refresh_token`, `email_verification`, `password_reset` | Sign-in housekeeping; each points to one `user`.                                                      |
| `audit_log`                                             | A record of important changes, written by triggers. It keeps its rows even after the user is deleted. |
| `etl_run`, `etl_reject`                                 | A log of each game-data import and the rows it refused, and why.                                      |
| `stg_*` (4 tables)                                      | Temporary staging tables the import loads into first.                                                 |
| `schema_migrations`                                     | Which database changes have been applied.                                                             |

## Redrawing the pictures

The sources are `img/er-people.mmd` and `img/er-groups.mmd` (Mermaid text). Edit
the text, then paste it into <https://mermaid.live> to export a new PNG. The
Mermaid blocks above also render directly on GitHub.
