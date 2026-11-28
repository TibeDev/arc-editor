import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { invoke } from "@tauri-apps/api/core";
import {
  copyText,
  isAllowedExternalHref,
  isBlockedHref,
  isHttpHref,
} from "../../lib/agents/sanitize";

export default function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className="agents-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const value = href ?? "";
            if (!value || isBlockedHref(value)) {
              return <span>{children}</span>;
            }
            if (isHttpHref(value) && isAllowedExternalHref(value)) {
              return (
                <a
                  href={value}
                  onClick={(event) => {
                    event.preventDefault();
                    void invoke("open_external_url", { url: value }).catch(() =>
                      copyText(value),
                    );
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <button
                type="button"
                className="agents-link-copy"
                title="Copy link"
                onClick={() => void copyText(value)}
              >
                {children}
              </button>
            );
          },
          img: ({ alt }) => <span className="agents-image-alt">[{alt ?? "image"}]</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
