import { Bookmark, Plus } from 'lucide-react';
import { EntrySeedsList } from '@ui/components/entry-surface/entry-seeds';

/** 还没生成出本人问题时的内置问题：入口先有东西可点，不留空白。
 *  它们不参与任何取数，也不代表用户自己——标题与标注据此如实区分。 */
const BUILT_IN_QUESTIONS: readonly string[] = [
  '长上下文和 RAG，各自适合什么样的知识问答？',
  '家用 NAS 的实际维护负担有多大？',
  'AI 编程工具正在怎样改变中小团队的工作方式？',
  '新能源汽车冬季续航的讨论这两年变了什么？',
];

/** 提问入口上方的种子问题：本人收藏提炼的结果，或内置问题。
 *  内容在挂载那一刻定下、之后不替换，见 useEntrySeeds；排版由共享列表持有。 */
export function ResearchSeeds({ onPick }: { onPick: (title: string) => void }) {
  return (
    <EntrySeedsList
      kind="research"
      fallback={BUILT_IN_QUESTIONS}
      icon={<Bookmark size={14} aria-hidden />}
      heading="为你推荐"
      headingFallback="可以试试"
      label="为你推荐的问题"
      action={<Plus size={13} className="entry-seeds__add" aria-hidden />}
      onPick={onPick}
    />
  );
}
