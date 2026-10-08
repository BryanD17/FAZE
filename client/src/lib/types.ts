export type LookupItem = { id: number; name: string };
export type SluggedItem = LookupItem & { slug: string };
export type CodedItem = LookupItem & { code: string };

export type Lookups = {
  regions: CodedItem[];
  languages: CodedItem[];
  platforms: SluggedItem[];
  tags: SluggedItem[];
};

export type Game = { id: number; title: string };

export type GroupRole = 'owner' | 'moderator' | 'member';

export type GroupCard = {
  groupId: number;
  title: string;
  gameId: number;
  gameTitle: string;
  gameCoverUrl: string | null;
  regionCode: string;
  ownerDisplayName: string;
  memberCount: number;
  maxMembers: number;
  openSlots: number;
  platforms: string[];
  status: string;
  createdAt: string;
};

export type GroupListReply = { groups: GroupCard[]; page: number; hasMore: boolean };

export type GroupDetail = GroupCard & {
  description: string | null;
  languageCode: string;
  regionName: string;
  myRole: GroupRole | null;
  members: { displayName: string; role: GroupRole; joinedAt: string }[];
};

export type LeaveResult = 'LEFT_MEMBER_REMAINS' | 'LEFT_SUCCESSOR_PROMOTED' | 'LEFT_GROUP_ARCHIVED';

export type MatchCard = GroupCard & {
  score: number;
  sameGame: boolean;
  sameRegion: boolean;
  overlapHours: number;
};

export type Message = {
  messageId: number;
  displayName: string;
  body: string;
  createdAt: string;
};
