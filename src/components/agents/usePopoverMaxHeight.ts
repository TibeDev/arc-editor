import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

export default function usePopoverMaxHeight<T extends HTMLElement>(
  open: boolean,
  rootRef: RefObject<T | null>,
) {
  const [maxHeight, setMaxHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!open) {
      setMaxHeight(undefined);
      return;
    }
    const update = () => {
      const box = rootRef.current?.closest<HTMLElement>(".agents-composer-box");
      const page = rootRef.current?.closest<HTMLElement>(".agents-workspace-page");
      if (!box || !page) return;
      const available =
        box.getBoundingClientRect().top - page.getBoundingClientRect().top - 16;
      setMaxHeight(Math.max(160, Math.round(available)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open, rootRef]);
  return maxHeight;
}
