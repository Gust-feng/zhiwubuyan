import { useCallback, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { KanshanPerch } from "@ui/components/kanshan-mascot/KanshanPerch";
import type { KanshanMascotHandle } from "@ui/components/kanshan-mascot/KanshanMascot";
import type { KanshanGesture } from "@ui/components/kanshan-mascot/kanshan-clips";

interface SidebarResearchPromptProps {
  readonly collapsed: boolean;
  readonly onStartResearch: () => void;
}

// 悬停/聚焦后短暂抑制重复的注意力手势，避免动作抖动。
const ATTENTION_COOLDOWN_MS = 8000;

export function SidebarResearchPrompt({ collapsed, onStartResearch }: SidebarResearchPromptProps) {
  const mascotRef = useRef<KanshanMascotHandle>(null);
  const [hovered, setHovered] = useState(false);
  const attentionLockRef = useRef(0);

  const triggerAttention = useCallback(() => {
    const now = Date.now();
    if (now < attentionLockRef.current) return;
    attentionLockRef.current = now + ATTENTION_COOLDOWN_MS;
    mascotRef.current?.gesture("attention" satisfies KanshanGesture);
  }, []);

  // 收起时栖位卸载，由全局导演负责隐藏；展开重新挂载后会试探着出现。
  if (collapsed) return null;

  return (
    <div
      className={`ui-sidebar-research-prompt${hovered ? " is-hovered" : ""}`}
      onMouseEnter={() => {
        setHovered(true);
        triggerAttention();
      }}
      onMouseLeave={() => setHovered(false)}
    >
      <KanshanPerch
        ref={mascotRef}
        perchId="sidebar"
        className="ui-sidebar-research-prompt__mascot"
      />
      <button
        type="button"
        className="ui-sidebar-research-prompt__card"
        onFocus={triggerAttention}
        onClick={() => onStartResearch()}
      >
        <span className="ui-sidebar-research-prompt__eyebrow">
          今天想弄清什么？
        </span>
        <span className="ui-sidebar-research-prompt__title">
          把一个问题，追到有据可查。
        </span>
        <span className="ui-sidebar-research-prompt__action">
          开始研究
          <ArrowUpRight size={13} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
