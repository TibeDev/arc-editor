import { useSyncExternalStore } from "react";
import { store } from "./store";

export function useAgentsStore() {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
