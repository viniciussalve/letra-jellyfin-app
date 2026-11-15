import type { Lyrics } from "../../shared/types.ts";

export type JellyfinSession = {
  accessToken: string;
  userId: string;
  username: string;
  serverId: string;
};

export type JellyfinAudioItem = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number;
  hasCover: boolean;
  hasLyrics: boolean;
  container: string | null;
  sizeBytes: number;
  createdAt: string;
};

export type JellyfinListOpts = {
  search?: string;
  ids?: string[];
  limit?: number;
  startIndex?: number;
};

export type ParsedLyrics = Lyrics | null;

export type JellyfinAuthResponse = {
  AccessToken?: string;
  ServerId?: string;
  User?: {
    Id?: string;
    Name?: string;
  };
};

export type JellyfinMediaSourceDto = {
  Container?: string;
  Size?: number;
  RunTimeTicks?: number;
};

export type JellyfinBaseItemDto = {
  Id?: string;
  Name?: string;
  Artists?: string[];
  ArtistItems?: Array<{ Name?: string }>;
  AlbumArtist?: string;
  Album?: string;
  RunTimeTicks?: number;
  HasLyrics?: boolean;
  ImageTags?: Record<string, string>;
  Container?: string;
  Size?: number;
  DateCreated?: string;
  MediaSources?: JellyfinMediaSourceDto[];
};

export type JellyfinItemsResponse = {
  Items?: JellyfinBaseItemDto[];
  TotalRecordCount?: number;
  StartIndex?: number;
};

export type JellyfinLyricLineDto = {
  Text?: string;
  Start?: number | null;
  text?: string;
  start?: number | null;
};

export type JellyfinLyricsDto = {
  Lyrics?: JellyfinLyricLineDto[];
  Lines?: JellyfinLyricLineDto[];
  lyrics?: JellyfinLyricLineDto[];
  lines?: JellyfinLyricLineDto[];
};

export type JellyfinClientOptions = {
  baseUrl: string;
  clientName?: string;
  deviceName?: string;
  deviceId?: string;
  version?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
};

export type JellyfinClient = {
  authenticateByName(username: string, password: string): Promise<JellyfinSession>;
  listAudioItems(token: string, opts?: JellyfinListOpts): Promise<JellyfinAudioItem[]>;
  getAudioItem(token: string, itemId: string): Promise<JellyfinAudioItem | null>;
  getLyrics(token: string, itemId: string): Promise<ParsedLyrics>;
  uploadLyrics(token: string, itemId: string, fileName: string, content: string): Promise<void>;
  deleteLyrics(token: string, itemId: string): Promise<void>;
  streamAudio(token: string, itemId: string, rangeHeader?: string): Promise<Response>;
  getPrimaryImage(token: string, itemId: string, maxWidth?: number): Promise<Response>;
  refreshLibrary(token: string): Promise<void>;
};
