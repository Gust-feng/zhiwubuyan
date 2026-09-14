import { Check } from 'lucide-react';
import type { ResearchPlanItemView } from '@ui/features/deep-research/research-view-model';

/** 研究子问题清单：Ultra 的研究计划与 Pro 的编排子问题共用同一呈现。
 *  state 只表达待处理/当前/已完成，不展示百分比；tag 承载覆盖判断或关闭原因。 */
export function ResearchPlanItems({ items, className }: {
  items: readonly ResearchPlanItemView[];
  className?: string;
}) {
  const stateNames = { complete: '已完成', active: '当前', pending: '待处理' };
  return (
    <ol className={`dr-plan__items${className ? ` ${className}` : ''}`}>
      {items.map((item) => (
        <li key={item.id} data-state={item.state} data-closed={item.closed || undefined}>
          <span className="dr-plan__check" role="img" aria-label={stateNames[item.state]}>
            {item.state === 'complete' ? <Check size={12} /> : item.state === 'active' ? <span /> : null}
          </span>
          <span className="dr-plan__text">{item.title}</span>
          {item.priority === 'high' && !item.closed && <span className="dr-plan__priority">重点</span>}
          {item.tag && <span className="dr-plan__tag">{item.tag}</span>}
        </li>
      ))}
    </ol>
  );
}
