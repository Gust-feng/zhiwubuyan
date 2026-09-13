import { useState } from "react";
import {
  HomeAnswerPanel,
  HomeAskBar,
  HomeFeedView,
  useHomeSearchState,
} from "@ui/personal-workbench/workbench/app/components/home-feed-view";
import { useHomeAnswer, useHomeFeed } from "@ui/personal-workbench/workbench/app/components/use-home-feed";
import {
  HomeMasthead,
  useAmbientGreeting,
} from "@ui/personal-workbench/workbench/app/components/home-feeds";

type HomePageProps = {
  onAskQuestion: (question: string) => void;
};

/**
 * 网页端首页：主题检索与热榜内容流 + 知乎直答快答 + 本地的「今日想问」备忘。
 * 内容全部来自知乎开放平台；直答返回生成内容，界面固定标注未附原始来源。
 */
export function HomePage({ onAskQuestion }: HomePageProps) {
  const greeting = useAmbientGreeting();
  const search = useHomeSearchState();
  const feed = useHomeFeed({ topic: search.topic, scope: search.scope, type: search.type });
  const answer = useHomeAnswer();
  const [tier, setTier] = useState<"fast" | "thinking">("fast");
  const [asked, setAsked] = useState("");

  const askZhida = (question: string, nextTier: "fast" | "thinking") => {
    setAsked(question);
    answer.ask(question, nextTier);
  };

  return (
    <div className="ui-view">
      <div className="ui-view__frame">
        <HomeMasthead lead={greeting.lead} tail={greeting.tail} />

        <HomeAskBar
          draft={search.draft}
          onDraftChange={search.setDraft}
          scope={search.scope}
          onScopeChange={search.setScope}
          onSubmit={() => search.submit(search.draft)}
          onAsk={() => askZhida(search.draft, tier)}
        />

        <div className="ui-home__stack">
          <HomeAnswerPanel
            state={answer.state}
            tier={tier}
            onTierChange={(next) => {
              setTier(next);
              if (asked !== "") askZhida(asked, next);
            }}
            onClose={() => answer.reset()}
            onRetry={() => askZhida(asked, tier)}
            onExplore={() => onAskQuestion(asked)}
          />

          <HomeFeedView
            feed={feed}
            topic={search.topic}
            draft={search.draft}
            onDraftChange={search.setDraft}
            scope={search.scope}
            onScopeChange={search.setScope}
            type={search.type}
            onTypeChange={search.setType}
            onSubmitSearch={() => search.submit(search.draft)}
            onRetry={() => search.submit(search.topic || search.draft)}
            onClearTopic={search.clear}
            onRemember={(question) => rememberQuestion(question)}
          />

          <TodayQuestions onAskQuestion={onAskQuestion} />
        </div>
      </div>
    </div>
  );
}

type SavedQuestion = {
  readonly id: string;
  readonly text: string;
};

const QUESTIONS_KEY = "kanshan/web-v1:questions";

/** 内容流里的「记下」与「今日想问」共用同一份本地列表。 */
let questionsListener: (() => void) | undefined;

function rememberQuestion(text: string): void {
  saveQuestions([{ id: `${Date.now()}`, text }, ...readQuestions()]);
  questionsListener?.();
}

function readQuestions(): SavedQuestion[] {
  try {
    const raw = window.localStorage.getItem(QUESTIONS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedQuestion =>
        item !== null && typeof item === "object" &&
        typeof (item as SavedQuestion).id === "string" &&
        typeof (item as SavedQuestion).text === "string",
    );
  } catch {
    return [];
  }
}

function saveQuestions(next: readonly SavedQuestion[]): void {
  try {
    window.localStorage.setItem(QUESTIONS_KEY, JSON.stringify(next));
  } catch {
    // 本地存储不可用（隐私模式或配额满）时不影响本次会话内的阅读。
  }
}

/** 今日想问：随手记下的问题，存在浏览器本地；点击即可生成众声。 */
function TodayQuestions({ onAskQuestion }: { onAskQuestion: (question: string) => void }) {
  const [questions, setQuestions] = useState<readonly SavedQuestion[]>(readQuestions);
  const [draft, setDraft] = useState("");

  const save = (next: readonly SavedQuestion[]) => {
    setQuestions(next);
    saveQuestions(next);
  };

  // 内容流里的「记下」写入同一份存储，这里订阅刷新，避免两处列表不一致。
  questionsListener = () => setQuestions(readQuestions());

  return (
    <section className="ui-home__core" aria-label="今日想问">
      <div className="ui-home__core-head">
        <h2 className="ui-home__core-name">今日想问</h2>
        <span className="ui-home__core-role">只存在这台设备上</span>
      </div>
      <form
        className="web-ask"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (text.length === 0) return;
          save([{ id: `${Date.now()}`, text }, ...questions]);
          setDraft("");
        }}
      >
        <input
          className="web-ask__input"
          placeholder="刷到时记下，稍后生成众声"
          aria-label="记下问题"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="web-ask__add" disabled={draft.trim().length === 0}>记下</button>
      </form>
      {questions.length === 0 && <p className="web-ask__empty">还没有记下的问题。</p>}
      {questions.map((item) => (
        <div className="web-question-row" key={item.id}>
          <span className="web-question-row__text" title={item.text}>{item.text}</span>
          <button type="button" className="web-question-row__action" onClick={() => onAskQuestion(item.text)}>
            众声
          </button>
          <button
            type="button"
            className="web-question-row__remove"
            aria-label="删除"
            onClick={() => save(questions.filter((q) => q.id !== item.id))}
          >
            删除
          </button>
        </div>
      ))}
    </section>
  );
}
