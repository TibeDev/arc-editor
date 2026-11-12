export type UpdateInfo = {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
};

export type UpdateDownloadEvent =
  | { event: "started"; data: { contentLength: number | null } }
  | { event: "progress"; data: { chunkLength: number } }
  | { event: "finished" };
